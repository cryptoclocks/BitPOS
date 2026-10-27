-- Phone push authority. Provider acceptance is not device delivery or domain completion.
SET search_path=bitpos,public;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bitpos_mobile_push_worker') THEN CREATE ROLE bitpos_mobile_push_worker NOLOGIN;END IF;END $$;
GRANT USAGE ON SCHEMA bitpos TO bitpos_mobile_push_worker;
CREATE TABLE mobile_push_bindings(
 installation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),app text NOT NULL CHECK(app IN('CUSTOMER','DRIVER')),device_id uuid NOT NULL,
 installation_key_hash text NOT NULL CHECK(installation_key_hash~'^[0-9a-f]{64}$'),binding_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES mobile_accounts,owner_session_id uuid NOT NULL REFERENCES mobile_sessions,
 revision bigint NOT NULL CHECK(revision>0),generation bigint NOT NULL CHECK(generation>0),platform text CHECK(platform IN('android','ios')),
 locale text NOT NULL CHECK(locale IN('th','en')),
 consent_enabled boolean NOT NULL,consent_version text CHECK(consent_version='food-transactional-v1'),consented_at timestamptz,
 capability text NOT NULL CHECK(capability IN('unknown','denied','authorized','provisional','unsupported','unavailable')),
 endpoint_hash text CHECK(endpoint_hash~'^[0-9a-f]{64}$'),endpoint_ciphertext text,endpoint_key_id text,
 revoked_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(app,device_id),
 CHECK((endpoint_ciphertext IS NULL)=(endpoint_key_id IS NULL)),CHECK(endpoint_ciphertext IS NULL OR endpoint_hash IS NOT NULL),
 CHECK(NOT consent_enabled OR platform IS NOT NULL AND consent_version IS NOT DISTINCT FROM 'food-transactional-v1' AND consented_at IS NOT NULL AND capability IN('authorized','provisional') AND endpoint_ciphertext IS NOT NULL AND revoked_at IS NULL)
);
CREATE UNIQUE INDEX mobile_push_endpoint_owner ON mobile_push_bindings(app,endpoint_hash) WHERE endpoint_hash IS NOT NULL;
CREATE TABLE mobile_push_commands(
 account_id uuid NOT NULL,session_id uuid NOT NULL,app text NOT NULL,device_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,session_id,app,device_id,idempotency_key)
);
CREATE TABLE mobile_push_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_kind text NOT NULL CHECK(source_kind IN('ORDER','SHIPMENT')),
 merchant_id uuid,order_id uuid,order_sequence bigint,shipment_id uuid,shipment_sequence bigint,
 recipient_account_id uuid NOT NULL,app text NOT NULL CHECK(app IN('CUSTOMER','DRIVER')),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 driver_id uuid,offer_id uuid,assignment_id uuid,service_generation bigint,lease_generation bigint,expanded_at timestamptz,
 FOREIGN KEY(merchant_id,order_id,order_sequence) REFERENCES mobile_order_events(merchant_id,order_id,sequence),
 FOREIGN KEY(shipment_id,shipment_sequence) REFERENCES shipment_events(shipment_id,sequence),
 CHECK(source_kind='ORDER' AND merchant_id IS NOT NULL AND order_id IS NOT NULL AND order_sequence IS NOT NULL AND shipment_id IS NULL AND shipment_sequence IS NULL
 OR source_kind='SHIPMENT' AND order_sequence IS NULL AND shipment_id IS NOT NULL AND shipment_sequence IS NOT NULL),
 CHECK(isfinite(expires_at) AND expires_at>occurred_at),CHECK(app='CUSTOMER' OR driver_id IS NOT NULL AND service_generation IS NOT NULL)
);
CREATE UNIQUE INDEX mobile_push_order_intent_identity ON mobile_push_intents(merchant_id,order_id,order_sequence,recipient_account_id,app) WHERE source_kind='ORDER';
CREATE UNIQUE INDEX mobile_push_shipment_intent_identity ON mobile_push_intents(shipment_id,shipment_sequence,recipient_account_id,app) WHERE source_kind='SHIPMENT';
CREATE INDEX mobile_push_intents_pending ON mobile_push_intents(occurred_at,id) WHERE expanded_at IS NULL;
CREATE TABLE mobile_push_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid NOT NULL REFERENCES mobile_push_intents,installation_id uuid NOT NULL REFERENCES mobile_push_bindings,
 binding_id uuid NOT NULL,binding_generation bigint NOT NULL,recipient_account_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('PENDING','LEASED','RETRY','BLOCKED','ACCEPTED','SUPPRESSED','EXPIRED','FAILED')),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_id uuid,lease_until timestamptz,accepted_at timestamptz,provider_message_id text,last_code text CHECK(last_code IN('UNAVAILABLE','RETRY','TOKEN_INVALID','STALE','ACCEPTED','EXPIRED','ATTEMPTS_EXHAUSTED')),
 finished_at timestamptz,UNIQUE(intent_id,binding_id,binding_generation),CHECK((state='LEASED')=(lease_id IS NOT NULL AND lease_until IS NOT NULL)),CHECK(lease_until IS NULL OR isfinite(lease_until))
);
CREATE INDEX mobile_push_delivery_due ON mobile_push_deliveries(next_attempt_at,id) WHERE state IN('PENDING','RETRY','BLOCKED','LEASED');
REVOKE ALL ON mobile_push_bindings,mobile_push_commands,mobile_push_intents,mobile_push_deliveries FROM PUBLIC,bitpos_app,bitpos_mobile_push_worker;

CREATE FUNCTION mobile_push_actor() RETURNS mobile_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s mobile_sessions;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();
 SELECT * INTO s FROM mobile_sessions WHERE id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid;
 IF s.device_id IS DISTINCT FROM nullif(current_setting('bitpos.mobile_device',true),'')::uuid THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN s;
END $$;
CREATE FUNCTION mobile_push_binding_status(app_name text,key_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b mobile_push_bindings;s mobile_sessions;owned boolean;
BEGIN
 IF app_name IS NULL OR app_name NOT IN('CUSTOMER','DRIVER') OR key_hash IS NULL OR key_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO b FROM mobile_push_bindings WHERE app=app_name AND device_id=nullif(current_setting('bitpos.mobile_device',true),'')::uuid FOR SHARE;
 s:=mobile_push_actor();
 IF b.installation_id IS NULL THEN RETURN jsonb_build_object('kind','UNREGISTERED','revision','0');END IF;
 IF b.installation_key_hash<>key_hash THEN RAISE EXCEPTION 'PUSH_INSTALLATION_CONFLICT';END IF;
 owned:=b.account_id=s.account_id AND b.owner_session_id=s.id;
 RETURN jsonb_build_object('kind','REGISTERED','installationId',b.installation_id,'bindingId',CASE WHEN owned THEN b.binding_id ELSE NULL END,
 'revision',b.revision::text,'generation',CASE WHEN owned THEN b.generation::text ELSE NULL END,'boundToCurrentSession',owned,
 'consentEnabled',owned AND b.consent_enabled AND b.revoked_at IS NULL,'capability',CASE WHEN owned THEN b.capability ELSE 'unknown' END,
 'endpointRegistered',owned AND b.endpoint_ciphertext IS NOT NULL);
END $$;
CREATE FUNCTION mobile_push_binding_command(app_name text,payload jsonb,key_hash text,next_key_hash text,endpoint_hash_value text,ciphertext text,cipher_key_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b mobile_push_bindings;s mobile_sessions;prior mobile_push_commands;request_digest text;receipt jsonb;action text:=payload->>'kind';command uuid;expected bigint;owned boolean;changed boolean;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF app_name IS NULL OR app_name NOT IN('CUSTOMER','DRIVER') OR key_hash IS NULL OR key_hash!~'^[0-9a-f]{64}$' OR NOT payload?&ARRAY['kind','idempotencyKey','expectedRevision','capability','locale']
 OR EXISTS(SELECT 1 FROM jsonb_each(payload) WHERE jsonb_typeof(value)<>'string')
 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false) OR coalesce(payload->>'expectedRevision','')!~'^(0|[1-9][0-9]{0,18})$' OR (payload->>'expectedRevision')::numeric>9223372036854775807
 OR action NOT IN('ENABLE','ROTATE','DISABLE') OR payload->>'locale' NOT IN('th','en') OR payload->>'capability' NOT IN('unknown','denied','authorized','provisional','unsupported','unavailable') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF action='ENABLE' THEN
  IF NOT payload?&ARRAY['platform','consentVersion'] OR (SELECT count(*) FROM jsonb_object_keys(payload))<>7 OR payload->>'platform' NOT IN('android','ios') OR payload->>'consentVersion'<>'food-transactional-v1' OR next_key_hash IS NULL OR next_key_hash!~'^[0-9a-f]{64}$' OR next_key_hash=key_hash THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 ELSIF action='ROTATE' THEN IF (SELECT count(*) FROM jsonb_object_keys(payload))<>5 OR next_key_hash IS NOT NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 ELSE IF NOT payload?'reason' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>6 OR payload->>'reason' NOT IN('USER_OPT_OUT','OS_PERMISSION','DEVICE_UNAVAILABLE') OR next_key_hash IS NOT NULL OR endpoint_hash_value IS NOT NULL OR ciphertext IS NOT NULL OR cipher_key_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;END IF;
 IF action<>'DISABLE' AND (payload->>'capability' NOT IN('authorized','provisional') OR endpoint_hash_value IS NULL OR endpoint_hash_value!~'^[0-9a-f]{64}$' OR ciphertext IS NULL OR octet_length(ciphertext) NOT BETWEEN 32 AND 8192 OR cipher_key_id IS NULL OR cipher_key_id!~'^[A-Za-z0-9_-]{1,40}$') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 command:=(payload->>'idempotencyKey')::uuid;expected:=(payload->>'expectedRevision')::bigint;
 request_digest:=encode(sha256(convert_to(jsonb_build_array(app_name,payload,key_hash,next_key_hash,endpoint_hash_value)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('bitpos.mobile_session',true)||app_name||command::text,87));
 SELECT * INTO b FROM mobile_push_bindings WHERE app=app_name AND device_id=nullif(current_setting('bitpos.mobile_device',true),'')::uuid FOR UPDATE;
 s:=mobile_push_actor();
 SELECT * INTO prior FROM mobile_push_commands WHERE account_id=s.account_id AND session_id=s.id AND app=app_name AND device_id=s.device_id AND idempotency_key=command;
 IF FOUND THEN IF prior.request_hash<>request_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response||jsonb_build_object('replayed',true);END IF;
 IF b.installation_id IS NULL THEN
  -- A first-install opt-out is a real revocation fence, not a no-op: a delayed expectedRevision0 ENABLE must lose.
  IF expected<>0 OR action NOT IN('ENABLE','DISABLE') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  BEGIN
   INSERT INTO mobile_push_bindings(app,device_id,installation_key_hash,account_id,owner_session_id,revision,generation,platform,locale,consent_enabled,capability)
   VALUES(app_name,s.device_id,key_hash,s.account_id,s.id,1,1,payload->>'platform',payload->>'locale',false,'unknown') RETURNING * INTO b;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'VERSION_CONFLICT';END;
 ELSE
  IF b.installation_key_hash<>key_hash THEN RAISE EXCEPTION 'PUSH_INSTALLATION_CONFLICT';END IF;
  IF b.revision<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 END IF;
 owned:=b.account_id=s.account_id AND b.owner_session_id=s.id;
 IF action<>'ENABLE' AND NOT owned THEN RAISE EXCEPTION 'PUSH_INSTALLATION_CONFLICT';END IF;
 IF action='ROTATE' AND (NOT b.consent_enabled OR b.revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'PUSH_CONSENT_REQUIRED';END IF;
 changed:=action<>'ROTATE' OR b.endpoint_hash IS DISTINCT FROM endpoint_hash_value OR b.capability IS DISTINCT FROM payload->>'capability' OR b.locale IS DISTINCT FROM payload->>'locale';
 IF changed THEN
  BEGIN
   UPDATE mobile_push_bindings SET
    binding_id=CASE WHEN owned THEN binding_id ELSE gen_random_uuid() END,account_id=s.account_id,owner_session_id=s.id,
    installation_key_hash=CASE WHEN action='ENABLE' THEN next_key_hash ELSE installation_key_hash END,
    revision=CASE WHEN expected=0 THEN 1 ELSE revision+1 END,generation=CASE WHEN expected=0 THEN 1 ELSE generation+1 END,
    platform=CASE WHEN action='ENABLE' THEN payload->>'platform' ELSE platform END,
    locale=payload->>'locale',
    consent_enabled=action<>'DISABLE',consent_version=CASE WHEN action='ENABLE' THEN 'food-transactional-v1' ELSE consent_version END,
    consented_at=CASE WHEN action='ENABLE' THEN clock_timestamp() ELSE consented_at END,capability=payload->>'capability',
    endpoint_hash=CASE WHEN action='DISABLE' THEN endpoint_hash ELSE endpoint_hash_value END,
    endpoint_ciphertext=CASE WHEN action='DISABLE' THEN NULL ELSE ciphertext END,endpoint_key_id=CASE WHEN action='DISABLE' THEN NULL ELSE cipher_key_id END,
    revoked_at=CASE WHEN action='DISABLE' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp()
    WHERE installation_id=b.installation_id RETURNING * INTO b;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PUSH_ENDPOINT_CONFLICT';END;
 END IF;
 receipt:=jsonb_build_object('installationId',b.installation_id,'bindingId',b.binding_id,'revision',b.revision::text,'generation',b.generation::text,'action',action,'replayed',false);
 INSERT INTO mobile_push_commands VALUES(s.account_id,s.id,app_name,s.device_id,command,request_digest,receipt,clock_timestamp());
 PERFORM mobile_push_actor();RETURN receipt;
END $$;
CREATE FUNCTION mobile_push_revoke_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 UPDATE mobile_push_bindings SET consent_enabled=false,revoked_at=clock_timestamp(),revision=revision+1,generation=generation+1,endpoint_ciphertext=NULL,endpoint_key_id=NULL,updated_at=clock_timestamp()
 WHERE consent_enabled AND ((TG_TABLE_NAME='mobile_sessions' AND owner_session_id=NEW.id) OR (TG_TABLE_NAME='mobile_accounts' AND account_id=NEW.id));
 -- No delivery locks under session/account: generation invalidation is the durable fence.
 RETURN NEW;
END $$;
CREATE TRIGGER mobile_push_session_revoke AFTER UPDATE OF revoked_at ON mobile_sessions FOR EACH ROW WHEN(OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION mobile_push_revoke_identity();
CREATE TRIGGER mobile_push_account_disable AFTER UPDATE OF disabled_at ON mobile_accounts FOR EACH ROW WHEN(OLD.disabled_at IS NULL AND NEW.disabled_at IS NOT NULL) EXECUTE FUNCTION mobile_push_revoke_identity();

CREATE FUNCTION mobile_push_order_intent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NEW.kind IN('ACCEPTANCE','KITCHEN','PAYMENT') THEN
  INSERT INTO mobile_push_intents(source_kind,merchant_id,order_id,order_sequence,recipient_account_id,app,expires_at)
  SELECT 'ORDER',NEW.merchant_id,NEW.order_id,NEW.sequence,f.account_id,'CUSTOMER',clock_timestamp()+interval '10 minutes' FROM online_food_orders f WHERE(f.merchant_id,f.order_id)=(NEW.merchant_id,NEW.order_id);
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION mobile_push_shipment_intent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;f food_dispatch_offers;a food_assignments;recipient uuid;
BEGIN
 SELECT * INTO STRICT s FROM food_shipments WHERE id=NEW.shipment_id;
 IF NEW.type IN('ASSIGNED','AT_PICKUP','AT_DROPOFF','PICKUP_PROOF_CONSUMED','DELIVERY_PROOF_CONSUMED','ASSIGNMENT_RELEASED','INCIDENT_REPORTED','INCIDENT_ACKNOWLEDGED','INCIDENTS_RESUMED','CANCELLATION_REVIEW_DISPOSITION') THEN
  INSERT INTO mobile_push_intents(source_kind,merchant_id,order_id,shipment_id,shipment_sequence,recipient_account_id,app,expires_at)
  VALUES('SHIPMENT',s.merchant_id,s.order_id,s.id,NEW.sequence,s.account_id,'CUSTOMER',clock_timestamp()+interval '10 minutes');
 END IF;
 IF NEW.type='OFFERED' THEN
  SELECT * INTO STRICT f FROM food_dispatch_offers WHERE id=(NEW.safe_payload->>'offerId')::uuid AND shipment_id=s.id;
  SELECT account_id INTO STRICT recipient FROM driver_profiles WHERE id=f.driver_id;
  INSERT INTO mobile_push_intents(source_kind,merchant_id,order_id,shipment_id,shipment_sequence,recipient_account_id,app,expires_at,driver_id,offer_id,service_generation)
  VALUES('SHIPMENT',s.merchant_id,s.order_id,s.id,NEW.sequence,recipient,'DRIVER',f.expires_at,f.driver_id,f.id,f.generation);
 ELSIF NEW.type IN('ASSIGNED','INCIDENT_ACKNOWLEDGED','INCIDENTS_RESUMED') AND s.active_assignment_id IS NOT NULL THEN
  SELECT * INTO STRICT a FROM food_assignments WHERE id=s.active_assignment_id;
  SELECT account_id INTO STRICT recipient FROM driver_profiles WHERE id=a.driver_id;
  INSERT INTO mobile_push_intents(source_kind,merchant_id,order_id,shipment_id,shipment_sequence,recipient_account_id,app,expires_at,driver_id,assignment_id,service_generation,lease_generation)
  VALUES('SHIPMENT',s.merchant_id,s.order_id,s.id,NEW.sequence,recipient,'DRIVER',clock_timestamp()+interval '10 minutes',a.driver_id,a.id,a.generation,a.lease_generation);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER mobile_push_order_event AFTER INSERT ON mobile_order_events FOR EACH ROW EXECUTE FUNCTION mobile_push_order_intent();
CREATE TRIGGER mobile_push_shipment_event AFTER INSERT ON shipment_events FOR EACH ROW EXECUTE FUNCTION mobile_push_shipment_intent();

REVOKE ALL ON FUNCTION mobile_push_actor(),mobile_push_binding_status(text,text),mobile_push_binding_command(text,jsonb,text,text,text,text,text),mobile_push_revoke_identity(),mobile_push_order_intent(),mobile_push_shipment_intent() FROM PUBLIC,bitpos_app,bitpos_mobile_push_worker;
GRANT EXECUTE ON FUNCTION mobile_push_binding_status(text,text),mobile_push_binding_command(text,jsonb,text,text,text,text,text) TO bitpos_app;

CREATE FUNCTION mobile_push_intent_live(i mobile_push_intents) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;a food_assignments;f food_dispatch_offers;
BEGIN
 IF i.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 IF i.app='CUSTOMER' THEN RETURN EXISTS(SELECT 1 FROM online_food_orders WHERE(merchant_id,order_id,account_id)=(i.merchant_id,i.order_id,i.recipient_account_id));END IF;
 SELECT * INTO s FROM food_shipments WHERE id=i.shipment_id;
 IF s.id IS NULL OR s.generation<>i.service_generation OR NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=i.driver_id AND account_id=i.recipient_account_id) OR food_driver_authority(i.driver_id,s.id) IS NOT NULL THEN RETURN false;END IF;
 IF i.offer_id IS NOT NULL THEN
  SELECT * INTO f FROM food_dispatch_offers WHERE id=i.offer_id;
  RETURN coalesce(f.state='OFFERED' AND f.expires_at>clock_timestamp() AND f.shipment_id=s.id AND f.driver_id=i.driver_id AND f.generation=s.generation AND s.state='OFFERING' AND s.active_assignment_id IS NULL AND dispatch_eligible_driver(i.driver_id)
   AND NOT EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=i.driver_id AND state='ACTIVE')
   AND (NOT EXISTS(SELECT 1 FROM food_dispatch_automatic_offers WHERE offer_id=f.id) OR food_dispatch_automatic_offer_live(f.id)),false);
 END IF;
 SELECT * INTO a FROM food_assignments WHERE id=i.assignment_id;
 RETURN coalesce(a.id=s.active_assignment_id AND a.driver_id=i.driver_id AND a.generation=i.service_generation AND a.lease_generation=i.lease_generation AND a.closed_at IS NULL
 AND EXISTS(SELECT 1 FROM driver_assignment_leases WHERE id=a.lease_id AND food_assignment_id=a.id AND driver_id=a.driver_id AND generation=a.lease_generation AND state='ACTIVE'),false);
END $$;
CREATE FUNCTION mobile_push_binding_live(b mobile_push_bindings) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT (b).consent_enabled AND (b).revoked_at IS NULL AND (b).capability IN('authorized','provisional') AND (b).endpoint_ciphertext IS NOT NULL
 AND EXISTS(SELECT 1 FROM mobile_accounts WHERE id=(b).account_id AND disabled_at IS NULL)
 AND EXISTS(SELECT 1 FROM mobile_sessions WHERE id=(b).owner_session_id AND account_id=(b).account_id AND device_id=(b).device_id AND revoked_at IS NULL AND refresh_expires_at>clock_timestamp())
$$;
CREATE FUNCTION mobile_push_expand(batch_size integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i mobile_push_intents;n integer:=0;
BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR i IN SELECT * FROM mobile_push_intents WHERE expanded_at IS NULL ORDER BY occurred_at,id LIMIT batch_size FOR UPDATE SKIP LOCKED LOOP
  -- Each committed immutable intent is visited independently; sequence allocation is not a commit watermark.
  INSERT INTO mobile_push_deliveries(intent_id,installation_id,binding_id,binding_generation,recipient_account_id,state)
  SELECT i.id,b.installation_id,b.binding_id,b.generation,i.recipient_account_id,'PENDING' FROM mobile_push_bindings b
  WHERE b.app=i.app AND b.account_id=i.recipient_account_id AND b.consented_at<=i.occurred_at AND mobile_push_binding_live(b) AND i.expires_at>clock_timestamp()
  ON CONFLICT DO NOTHING;
  UPDATE mobile_push_intents SET expanded_at=clock_timestamp() WHERE id=i.id;n:=n+1;
 END LOOP;RETURN n;
END $$;
CREATE FUNCTION mobile_push_claim(batch_size integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE d mobile_push_deliveries;i mobile_push_intents;b mobile_push_bindings;result jsonb:='[]';lease uuid;
BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR d IN SELECT * FROM mobile_push_deliveries WHERE
 (state IN('PENDING','RETRY','BLOCKED') AND next_attempt_at<=clock_timestamp() OR state='LEASED' AND lease_until<=clock_timestamp())
 ORDER BY next_attempt_at,id LIMIT batch_size FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO STRICT i FROM mobile_push_intents WHERE id=d.intent_id;
  IF i.expires_at<=clock_timestamp() OR d.attempts>=6 THEN
   UPDATE mobile_push_deliveries SET state=CASE WHEN i.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE 'FAILED' END,lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),last_code=CASE WHEN i.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE 'ATTEMPTS_EXHAUSTED' END WHERE id=d.id;CONTINUE;
  END IF;
  BEGIN SELECT * INTO STRICT b FROM mobile_push_bindings WHERE installation_id=d.installation_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN CONTINUE;END;
  IF b.binding_id<>d.binding_id OR b.generation<>d.binding_generation OR b.account_id<>d.recipient_account_id OR NOT mobile_push_binding_live(b) OR NOT mobile_push_intent_live(i) THEN
   UPDATE mobile_push_deliveries SET state='SUPPRESSED',lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),last_code='STALE' WHERE id=d.id;CONTINUE;
  END IF;
  lease:=gen_random_uuid();UPDATE mobile_push_deliveries SET state='LEASED',lease_id=lease,lease_until=clock_timestamp()+interval '45 seconds',attempts=attempts+1 WHERE id=d.id;
  result:=result||jsonb_build_array(jsonb_build_object('deliveryId',d.id,'leaseId',lease));
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION mobile_push_prepare(delivery uuid,lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE d mobile_push_deliveries;i mobile_push_intents;b mobile_push_bindings;
BEGIN
 SELECT * INTO d FROM mobile_push_deliveries WHERE id=delivery FOR UPDATE;
 IF d.id IS NULL OR d.state<>'LEASED' OR d.lease_id IS DISTINCT FROM lease OR d.lease_until<=clock_timestamp() THEN RETURN NULL;END IF;
 SELECT * INTO STRICT i FROM mobile_push_intents WHERE id=d.intent_id;
 BEGIN SELECT * INTO STRICT b FROM mobile_push_bindings WHERE installation_id=d.installation_id FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 IF b.binding_id<>d.binding_id OR b.generation<>d.binding_generation OR b.account_id<>d.recipient_account_id OR NOT mobile_push_binding_live(b) OR NOT mobile_push_intent_live(i) THEN
  UPDATE mobile_push_deliveries SET state=CASE WHEN i.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE 'SUPPRESSED' END,lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),last_code=CASE WHEN i.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE 'STALE' END WHERE id=d.id;RETURN NULL;
 END IF;
 RETURN jsonb_build_object('eventId',i.id,'expiresAt',i.expires_at,'bindingId',b.binding_id,'bindingGeneration',b.generation::text,'app',b.app,'locale',b.locale,'deviceId',b.device_id,'endpointHash',b.endpoint_hash,'ciphertext',b.endpoint_ciphertext,'keyId',b.endpoint_key_id);
END $$;
CREATE FUNCTION mobile_push_finish(delivery uuid,lease uuid,result text,message_id text,retry_seconds integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE d mobile_push_deliveries;b mobile_push_bindings;i mobile_push_intents;stale boolean;
BEGIN
 IF result IS NULL OR result NOT IN('ACCEPTED','UNAVAILABLE','RETRY','TOKEN_INVALID') OR retry_seconds IS NULL OR retry_seconds NOT BETWEEN 1 AND 3600
 OR result='ACCEPTED' AND (message_id IS NULL OR length(message_id) NOT BETWEEN 1 AND 1024 OR message_id!~'^projects/[a-z][a-z0-9-]{4,61}[a-z0-9]/messages/[A-Za-z0-9%_:.-]+$')
 OR result<>'ACCEPTED' AND message_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO d FROM mobile_push_deliveries WHERE id=delivery FOR UPDATE;
 IF d.id IS NULL OR d.state<>'LEASED' OR d.lease_id IS DISTINCT FROM lease OR d.lease_until<=clock_timestamp() THEN RETURN false;END IF;
 IF result='ACCEPTED' THEN
  -- The irreversible provider receipt needs no unrelated identity/job locks. It is not a phone receipt.
  UPDATE mobile_push_deliveries SET state='ACCEPTED',accepted_at=clock_timestamp(),provider_message_id=message_id,last_code='ACCEPTED',finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=d.id;
  RETURN true;
 END IF;
 BEGIN SELECT * INTO STRICT b FROM mobile_push_bindings WHERE installation_id=d.installation_id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 SELECT * INTO STRICT i FROM mobile_push_intents WHERE id=d.intent_id;
 stale:=b.binding_id<>d.binding_id OR b.generation<>d.binding_generation OR b.account_id<>d.recipient_account_id OR NOT mobile_push_binding_live(b) OR NOT mobile_push_intent_live(i);
 IF stale OR result='TOKEN_INVALID' THEN
  UPDATE mobile_push_deliveries SET state='SUPPRESSED',last_code=CASE WHEN stale THEN 'STALE' ELSE 'TOKEN_INVALID' END,finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=d.id;
  IF NOT stale AND result='TOKEN_INVALID' THEN UPDATE mobile_push_bindings SET consent_enabled=false,revoked_at=clock_timestamp(),revision=revision+1,generation=generation+1,endpoint_ciphertext=NULL,endpoint_key_id=NULL,updated_at=clock_timestamp() WHERE installation_id=b.installation_id;END IF;
 ELSE
  UPDATE mobile_push_deliveries SET state=CASE WHEN attempts>=6 THEN 'FAILED' WHEN result='UNAVAILABLE' THEN 'BLOCKED' ELSE 'RETRY' END,
   last_code=CASE WHEN attempts>=6 THEN 'ATTEMPTS_EXHAUSTED' ELSE result END,next_attempt_at=clock_timestamp()+make_interval(secs=>retry_seconds),
   finished_at=CASE WHEN attempts>=6 THEN clock_timestamp() ELSE NULL END,lease_id=NULL,lease_until=NULL WHERE id=d.id;
 END IF;RETURN true;
END $$;
CREATE FUNCTION mobile_push_open(app_name text,key_hash text,event_id uuid,binding uuid,binding_gen bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b mobile_push_bindings;s mobile_sessions;i mobile_push_intents;answer jsonb:='{"kind":"UNAVAILABLE"}';
BEGIN
 IF app_name IS NULL OR app_name NOT IN('CUSTOMER','DRIVER') OR key_hash IS NULL OR key_hash!~'^[0-9a-f]{64}$' OR event_id IS NULL OR binding IS NULL OR binding_gen IS NULL OR binding_gen<1 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO b FROM mobile_push_bindings WHERE app=app_name AND device_id=nullif(current_setting('bitpos.mobile_device',true),'')::uuid FOR SHARE;
 s:=mobile_push_actor();
 IF b.installation_id IS NULL OR b.installation_key_hash<>key_hash OR b.account_id<>s.account_id OR b.owner_session_id<>s.id OR b.binding_id<>binding OR b.generation<>binding_gen OR NOT mobile_push_binding_live(b) THEN RETURN answer;END IF;
 SELECT * INTO i FROM mobile_push_intents WHERE id=event_id AND app=app_name AND recipient_account_id=s.account_id;
 IF i.id IS NOT NULL AND mobile_push_intent_live(i) AND EXISTS(SELECT 1 FROM mobile_push_deliveries WHERE intent_id=i.id AND binding_id=b.binding_id AND binding_generation=b.generation) THEN
  answer:=CASE WHEN app_name='CUSTOMER' THEN jsonb_build_object('kind','CUSTOMER_ORDER','orderId',i.order_id) ELSE jsonb_build_object('kind','DRIVER_WORK') END;
 END IF;
 PERFORM mobile_push_actor();RETURN answer;
END $$;
REVOKE ALL ON FUNCTION mobile_push_intent_live(mobile_push_intents),mobile_push_binding_live(mobile_push_bindings),mobile_push_expand(integer),mobile_push_claim(integer),mobile_push_prepare(uuid,uuid),mobile_push_finish(uuid,uuid,text,text,integer),mobile_push_open(text,text,uuid,uuid,bigint) FROM PUBLIC,bitpos_app,bitpos_mobile_push_worker;
GRANT EXECUTE ON FUNCTION mobile_push_expand(integer),mobile_push_claim(integer),mobile_push_prepare(uuid,uuid),mobile_push_finish(uuid,uuid,text,text,integer) TO bitpos_mobile_push_worker;
GRANT EXECUTE ON FUNCTION mobile_push_open(text,text,uuid,uuid,bigint) TO bitpos_app;
