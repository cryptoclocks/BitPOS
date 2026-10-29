-- Food-first dispatch runtime; local preparation, not production activation.
SET search_path=bitpos,public;
CREATE TABLE platform_role_scopes(
 grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,merchant_id uuid NOT NULL REFERENCES merchants,
 PRIMARY KEY(grant_id,merchant_id)
);
CREATE TABLE food_dispatch_offers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shipment_id uuid NOT NULL REFERENCES food_shipments,
 generation bigint NOT NULL CHECK(generation>0),driver_id uuid NOT NULL REFERENCES driver_occupancy,
 state text NOT NULL CHECK(state IN('OFFERED','ACCEPTED','REJECTED','EXPIRED','WITHDRAWN')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,shipment_id,driver_id,generation)
);
CREATE UNIQUE INDEX food_offer_one_active ON food_dispatch_offers(shipment_id) WHERE state='OFFERED';
CREATE INDEX food_offers_driver ON food_dispatch_offers(driver_id,state,expires_at,id);
CREATE TABLE driver_assignment_leases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_id uuid NOT NULL REFERENCES driver_occupancy,
 generation bigint NOT NULL CHECK(generation>0),food_assignment_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('ACTIVE','RELEASED')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),released_at timestamptz,
 UNIQUE(id,driver_id,generation),UNIQUE(driver_id,generation),CHECK((state='RELEASED')=(released_at IS NOT NULL))
);
CREATE UNIQUE INDEX driver_one_active_lease ON driver_assignment_leases(driver_id) WHERE state='ACTIVE';
CREATE TABLE food_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shipment_id uuid NOT NULL REFERENCES food_shipments,
 driver_id uuid NOT NULL REFERENCES driver_occupancy,generation bigint NOT NULL CHECK(generation>0),
 lease_id uuid NOT NULL UNIQUE,lease_generation bigint NOT NULL CHECK(lease_generation>0),offer_id uuid NOT NULL UNIQUE,
 vehicle_type text NOT NULL CHECK(vehicle_type IN('MOTORCYCLE','CAR')),plate_snapshot text NOT NULL,
 registration_expires_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT')),
 accepted_at timestamptz NOT NULL,picked_up_at timestamptz,closed_at timestamptz,
 UNIQUE(id,shipment_id),UNIQUE(id,driver_id,generation),UNIQUE(id,lease_id,driver_id,lease_generation),
 FOREIGN KEY(lease_id,driver_id,lease_generation) REFERENCES driver_assignment_leases(id,driver_id,generation) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(offer_id,shipment_id,driver_id,generation) REFERENCES food_dispatch_offers(id,shipment_id,driver_id,generation)
);
CREATE UNIQUE INDEX food_assignment_one_active ON food_assignments(shipment_id) WHERE closed_at IS NULL;
ALTER TABLE food_shipments ADD FOREIGN KEY(active_assignment_id,id) REFERENCES food_assignments(id,shipment_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE driver_assignment_leases ADD FOREIGN KEY(food_assignment_id,id,driver_id,generation) REFERENCES food_assignments(id,lease_id,driver_id,lease_generation) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE fulfillment_proofs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL,driver_id uuid NOT NULL,generation bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN('PICKUP','DELIVERY')),secret_hash text NOT NULL CHECK(secret_hash~'^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),consumed_at timestamptz,consumed_by uuid REFERENCES mobile_accounts,
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),revoked_at timestamptz,revocation_reason text,
 FOREIGN KEY(assignment_id,driver_id,generation) REFERENCES food_assignments(id,driver_id,generation),
 CHECK((consumed_at IS NULL)=(consumed_by IS NULL)),CHECK((revoked_at IS NULL)=(revocation_reason IS NULL)),CHECK(revoked_at IS NULL OR consumed_at IS NULL)
);
CREATE UNIQUE INDEX food_proof_live ON fulfillment_proofs(assignment_id,kind) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX food_proof_consumed ON fulfillment_proofs(assignment_id,kind) WHERE consumed_at IS NOT NULL;
CREATE TABLE shipment_events(
 shipment_id uuid NOT NULL REFERENCES food_shipments,sequence bigint NOT NULL CHECK(sequence>0),type text NOT NULL,
 safe_payload jsonb NOT NULL CHECK(jsonb_typeof(safe_payload)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(shipment_id,sequence)
);
CREATE TABLE food_dispatch_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,operation text NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,idempotency_key)
);
CREATE TABLE food_merchant_commands(
 merchant_id uuid NOT NULL REFERENCES merchants,user_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 operation text NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,user_id,idempotency_key)
);
CREATE TABLE driver_latest_locations(
 assignment_id uuid NOT NULL,driver_id uuid NOT NULL,generation bigint NOT NULL CHECK(generation>0),lease_generation bigint NOT NULL CHECK(lease_generation>0),
 seq bigint NOT NULL CHECK(seq>0),captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 latitude_e7 integer NOT NULL CHECK(abs(latitude_e7::bigint)<=900000000),longitude_e7 integer NOT NULL CHECK(abs(longitude_e7::bigint)<=1800000000),
 accuracy_mm integer NOT NULL CHECK(accuracy_mm BETWEEN 0 AND 100000),heading_mdeg integer CHECK(heading_mdeg BETWEEN 0 AND 359999),speed_mm_s integer CHECK(speed_mm_s BETWEEN 0 AND 100000),
 PRIMARY KEY(assignment_id,generation),FOREIGN KEY(assignment_id,driver_id,generation) REFERENCES food_assignments(id,driver_id,generation)
);
CREATE TABLE location_samples(LIKE driver_latest_locations INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE location_samples ADD PRIMARY KEY(assignment_id,generation,seq);
ALTER TABLE location_samples ADD FOREIGN KEY(assignment_id,driver_id,generation) REFERENCES food_assignments(id,driver_id,generation);
CREATE INDEX location_retention ON location_samples(received_at);
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['platform_role_scopes','food_dispatch_offers','driver_assignment_leases','food_assignments','fulfillment_proofs','shipment_events','food_dispatch_commands','food_merchant_commands','driver_latest_locations','location_samples'] LOOP
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,bitpos_app',name);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
 END LOOP;
END $$;
-- Root-first commands never wait on the inverse identity->occupancy lock edge.
CREATE FUNCTION dispatch_live_actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;sid uuid:=nullif(current_setting('bitpos.mobile_session',true),'')::uuid;
BEGIN
 BEGIN
  PERFORM 1 FROM mobile_accounts WHERE id=actor FOR SHARE NOWAIT;
  PERFORM 1 FROM mobile_sessions WHERE id=sid AND account_id=actor FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 IF NOT EXISTS(SELECT 1 FROM mobile_accounts a JOIN mobile_sessions s ON s.account_id=a.id WHERE a.id=actor AND s.id=sid AND a.disabled_at IS NULL AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.refresh_expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN actor;
END $$;
CREATE FUNCTION dispatch_lock_root(shipment uuid) RETURNS food_shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 SELECT * INTO s FROM food_shipments WHERE id=shipment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM 1 FROM merchants WHERE id=s.merchant_id FOR NO KEY UPDATE;
 PERFORM 1 FROM orders WHERE merchant_id=s.merchant_id AND id=s.order_id FOR UPDATE;
 PERFORM 1 FROM online_food_orders WHERE merchant_id=s.merchant_id AND order_id=s.order_id FOR UPDATE;
 PERFORM 1 FROM order_fulfillment WHERE merchant_id=s.merchant_id AND order_id=s.order_id FOR UPDATE;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=shipment FOR UPDATE;
 RETURN s;
END $$;
CREATE FUNCTION dispatch_event(shipment uuid,event_type text,payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE n bigint;
BEGIN
 UPDATE food_shipments SET version=version+1,event_sequence=event_sequence+1 WHERE id=shipment RETURNING event_sequence INTO STRICT n;
 INSERT INTO shipment_events(shipment_id,sequence,type,safe_payload) VALUES(shipment,n,event_type,payload);
END $$;
CREATE FUNCTION dispatch_verified_sale(shipment uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM food_shipments s JOIN orders o ON (o.merchant_id,o.id)=(s.merchant_id,s.order_id)
 JOIN online_food_orders f ON (f.merchant_id,f.order_id)=(s.merchant_id,s.order_id)
 WHERE s.id=shipment AND o.status='PAID' AND f.acceptance_status='ACCEPTED'
 AND EXISTS(SELECT 1 FROM payments p WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id AND p.state='SETTLED'))
$$;
CREATE FUNCTION dispatch_eligible_driver(driver uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM driver_profiles p JOIN mobile_accounts m ON m.id=p.account_id
 JOIN driver_vehicles v ON v.driver_id=p.id JOIN driver_availability a ON a.driver_id=p.id
 WHERE p.id=driver AND m.disabled_at IS NULL AND p.status='APPROVED' AND p.verified_until>clock_timestamp()
 AND p.license_expires_at>clock_timestamp() AND v.registration_expires_at>clock_timestamp()
 AND a.requested_online AND a.heartbeat_expires_at>clock_timestamp())
$$;
REVOKE ALL ON FUNCTION dispatch_live_actor(),dispatch_lock_root(uuid),dispatch_event(uuid,text,jsonb),dispatch_verified_sale(uuid),dispatch_eligible_driver(uuid) FROM PUBLIC,bitpos_app;
CREATE FUNCTION dispatch_food_offer(shipment uuid,driver uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;actor uuid;key uuid;digest text;prior food_dispatch_commands;offer uuid:=gen_random_uuid();receipt jsonb;
BEGIN
 s:=dispatch_lock_root(shipment);actor:=dispatch_live_actor();
 PERFORM 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.account_id=actor AND sc.merchant_id=s.merchant_id FOR SHARE OF g,sc;
 IF NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.account_id=actor AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=s.merchant_id)
 THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion'] OR (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false) OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR (payload->>'expectedVersion')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;
 digest:=encode(sha256(convert_to(jsonb_build_array(shipment,driver,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'offer' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
 IF NOT FOUND OR NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.account_id=actor AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=s.merchant_id) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 UPDATE food_dispatch_offers SET state='EXPIRED',version=version+1 WHERE shipment_id=s.id AND state='OFFERED' AND expires_at<=clock_timestamp();
 IF EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED') THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
 UPDATE food_shipments SET generation=generation+1,state='OFFERING' WHERE id=s.id RETURNING * INTO s;
 INSERT INTO food_dispatch_offers(id,shipment_id,generation,driver_id,state,expires_at) VALUES(offer,s.id,s.generation,driver,'OFFERED',clock_timestamp()+interval '45 seconds');
 PERFORM dispatch_event(s.id,'OFFERED',jsonb_build_object('offerId',offer));
 receipt:=jsonb_build_object('offerId',offer,'shipmentId',s.id,'generation',s.generation::text,'version',(s.version+1)::text);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'offer',digest,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION dispatch_food_offer(uuid,uuid,jsonb) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_food_offer(uuid,uuid,jsonb) TO bitpos_app;
CREATE FUNCTION dispatch_food_claim(offer uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE f food_dispatch_offers;s food_shipments;actor uuid;driver uuid;key uuid;digest text;prior food_dispatch_commands;lease uuid:=gen_random_uuid();assignment uuid:=gen_random_uuid();lease_gen bigint;vehicle driver_vehicles;receipt jsonb;at timestamptz;
BEGIN
 SELECT * INTO f FROM food_dispatch_offers WHERE id=offer;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(f.shipment_id);actor:=dispatch_live_actor();
 SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS DISTINCT FROM f.driver_id THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','generation'] OR (SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR (payload->>'generation')!~'^[1-9][0-9]{0,18}$'
 OR (payload->>'expectedVersion')::numeric>9223372036854775807 OR (payload->>'generation')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'generation') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array(offer,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'claim' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
 SELECT * INTO STRICT f FROM food_dispatch_offers WHERE id=offer FOR UPDATE;
 actor:=dispatch_live_actor();at:=clock_timestamp();
 IF f.version<>(payload->>'expectedVersion')::bigint OR f.generation<>(payload->>'generation')::bigint OR s.generation<>f.generation THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF f.state<>'OFFERED' OR f.expires_at<=at OR s.state<>'OFFERING' OR s.active_assignment_id IS NOT NULL OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 IF NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 UPDATE driver_occupancy SET assignment_generation=assignment_generation+1 WHERE driver_id=driver RETURNING assignment_generation INTO STRICT lease_gen;
 SELECT * INTO STRICT vehicle FROM driver_vehicles WHERE driver_id=driver;
 SET CONSTRAINTS driver_assignment_leases_food_assignment_id_id_driver_id_g_fkey DEFERRED;
 INSERT INTO driver_assignment_leases(id,driver_id,generation,food_assignment_id,state,created_at) VALUES(lease,driver,lease_gen,assignment,'ACTIVE',at);
 INSERT INTO food_assignments(id,shipment_id,driver_id,generation,lease_id,lease_generation,offer_id,vehicle_type,plate_snapshot,registration_expires_at,state,accepted_at)
 VALUES(assignment,s.id,driver,s.generation,lease,lease_gen,f.id,vehicle.vehicle_type,vehicle.plate,vehicle.registration_expires_at,'ACCEPTED',at);
 SET CONSTRAINTS driver_assignment_leases_food_assignment_id_id_driver_id_g_fkey IMMEDIATE;
 UPDATE food_dispatch_offers SET state='ACCEPTED',version=version+1 WHERE id=f.id;
 UPDATE food_shipments SET state='ASSIGNED',active_assignment_id=assignment WHERE id=s.id;
 PERFORM dispatch_event(s.id,'ASSIGNED',jsonb_build_object('assignmentId',assignment));
 receipt:=jsonb_build_object('shipmentId',s.id,'assignmentId',assignment,'generation',s.generation::text,'leaseId',lease,'leaseGeneration',lease_gen::text,'version',(s.version+1)::text);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'claim',digest,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION dispatch_food_claim(uuid,jsonb) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_food_claim(uuid,jsonb) TO bitpos_app;
CREATE FUNCTION dispatch_lock_assignment(assignment uuid,service_gen bigint,lease_gen bigint) RETURNS food_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;l driver_assignment_leases;occupancy driver_occupancy;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);
 SELECT * INTO STRICT occupancy FROM driver_occupancy WHERE driver_id=a.driver_id FOR UPDATE;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=assignment FOR UPDATE;
 SELECT * INTO STRICT l FROM driver_assignment_leases WHERE id=a.lease_id FOR UPDATE;
 IF service_gen IS NULL OR lease_gen IS NULL OR a.generation<>service_gen OR s.generation<>service_gen
 OR a.lease_generation<>lease_gen OR occupancy.assignment_generation<>lease_gen OR l.generation<>lease_gen
 OR s.active_assignment_id IS DISTINCT FROM a.id OR a.closed_at IS NOT NULL OR l.state<>'ACTIVE' OR l.food_assignment_id<>a.id
 THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED';END IF;
 RETURN a;
END $$;
CREATE FUNCTION dispatch_food_arrive(assignment uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;actor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;target text;s food_shipments;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','generation','leaseGeneration','stage']
 OR (SELECT count(*) FROM jsonb_object_keys(payload))<>4 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'generation') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'leaseGeneration') IS DISTINCT FROM 'string'
 OR (payload->>'generation')!~'^[1-9][0-9]{0,18}$' OR (payload->>'leaseGeneration')!~'^[1-9][0-9]{0,18}$'
 OR (payload->>'generation')::numeric>9223372036854775807 OR (payload->>'leaseGeneration')::numeric>9223372036854775807
 OR coalesce(payload->>'stage','') NOT IN('PICKUP','DROPOFF') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 -- Historical replay is checked after actor authorization but before active fences.
 SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 key:=(payload->>'idempotencyKey')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array(assignment,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'arrive' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 a:=dispatch_lock_assignment(assignment,(payload->>'generation')::bigint,(payload->>'leaseGeneration')::bigint);
 actor:=dispatch_live_actor();
 target:=CASE payload->>'stage' WHEN 'PICKUP' THEN 'AT_PICKUP' ELSE 'AT_DROPOFF' END;
 IF (target='AT_PICKUP' AND a.state<>'ACCEPTED') OR (target='AT_DROPOFF' AND a.state<>'PICKED_UP') THEN RAISE EXCEPTION 'DISPATCH_TRANSITION_INVALID';END IF;
 UPDATE food_assignments SET state=target WHERE id=a.id;
 UPDATE food_shipments SET state=target WHERE id=a.shipment_id;
 PERFORM dispatch_event(a.shipment_id,target,jsonb_build_object('assignmentId',a.id));
 receipt:=jsonb_build_object('assignmentId',a.id,'state',target,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'arrive',digest,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION dispatch_lock_assignment(uuid,bigint,bigint),dispatch_food_arrive(uuid,jsonb) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_food_arrive(uuid,jsonb) TO bitpos_app;
CREATE FUNCTION dispatch_issue_proof(assignment uuid,kind text,service_gen bigint,lease_gen bigint,key uuid,secret_hash text,rotate boolean DEFAULT false,merchant_session_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;actor uuid;proof uuid:=gen_random_uuid();expires timestamptz;digest text;prior_hash text;prior_response jsonb;receipt jsonb;
BEGIN
 IF key IS NULL OR rotate IS NULL OR kind IS NULL OR kind NOT IN('PICKUP','DELIVERY') OR secret_hash IS NULL OR secret_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO a FROM food_assignments WHERE id=assignment;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;s:=dispatch_lock_root(a.shipment_id);
 digest:=encode(sha256(convert_to(jsonb_build_array(assignment,kind,service_gen,lease_gen,rotate)::text,'UTF8')),'hex');
 IF kind='PICKUP' THEN
  IF current_setting('bitpos.merchant',true) IS DISTINCT FROM s.merchant_id::text OR merchant_session_hash IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
  PERFORM 1 FROM sessions WHERE token_hash=merchant_session_hash AND merchant_id=s.merchant_id FOR SHARE;
  SELECT se.user_id INTO actor FROM sessions se JOIN members m ON (m.merchant_id,m.user_id)=(se.merchant_id,se.user_id)
  WHERE se.token_hash=merchant_session_hash AND se.merchant_id=s.merchant_id AND se.expires_at>clock_timestamp() AND m.role IN('owner','manager') FOR SHARE OF m;
  IF actor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
  SELECT request_hash,response INTO prior_hash,prior_response FROM food_merchant_commands WHERE merchant_id=s.merchant_id AND user_id=actor AND idempotency_key=key;
 ELSE
  actor:=dispatch_live_actor();
  IF actor<>s.account_id THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  SELECT request_hash,response INTO prior_hash,prior_response FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 END IF;
 IF prior_response IS NOT NULL THEN IF prior_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior_response||jsonb_build_object('replayed',true,'secretRecoveryRequired',true);END IF;
 a:=dispatch_lock_assignment(assignment,service_gen,lease_gen);
 IF kind='PICKUP' THEN
  IF NOT EXISTS(SELECT 1 FROM sessions se JOIN members m ON (m.merchant_id,m.user_id)=(se.merchant_id,se.user_id) WHERE se.token_hash=merchant_session_hash AND se.merchant_id=s.merchant_id AND se.user_id=actor AND se.expires_at>clock_timestamp() AND m.role IN('owner','manager')) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 ELSE
  actor:=dispatch_live_actor();IF actor<>s.account_id THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 END IF;
 IF (kind='PICKUP' AND (a.state<>'AT_PICKUP' OR NOT EXISTS(SELECT 1 FROM order_fulfillment WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND status='READY')))
 OR (kind='DELIVERY' AND a.state<>'AT_DROPOFF') THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF NOT rotate AND EXISTS(SELECT 1 FROM fulfillment_proofs WHERE assignment_id=a.id AND fulfillment_proofs.kind=dispatch_issue_proof.kind AND revoked_at IS NULL AND consumed_at IS NULL) THEN RAISE EXCEPTION 'PROOF_ROTATION_REQUIRED';END IF;
 IF NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 UPDATE fulfillment_proofs SET revoked_at=clock_timestamp(),revocation_reason='Authorized rotation' WHERE assignment_id=a.id AND fulfillment_proofs.kind=dispatch_issue_proof.kind AND consumed_at IS NULL AND revoked_at IS NULL;
 expires:=clock_timestamp()+interval '5 minutes';
 INSERT INTO fulfillment_proofs(id,assignment_id,driver_id,generation,kind,secret_hash,expires_at) VALUES(proof,a.id,a.driver_id,a.generation,kind,secret_hash,expires);
 PERFORM dispatch_event(s.id,'PROOF_ISSUED',jsonb_build_object('assignmentId',a.id,'kind',kind,'proofId',proof));
 receipt:=jsonb_build_object('proofId',proof,'assignmentId',a.id,'kind',kind,'expiresAt',expires,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'replayed',false,'secretRecoveryRequired',false);
 IF kind='PICKUP' THEN INSERT INTO food_merchant_commands(merchant_id,user_id,idempotency_key,operation,request_hash,response) VALUES(s.merchant_id,actor,key,'issue-proof',digest,receipt);
 ELSE INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'issue-proof',digest,receipt);END IF;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION dispatch_issue_proof(uuid,text,bigint,bigint,uuid,text,boolean,text) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_issue_proof(uuid,text,bigint,bigint,uuid,text,boolean,text) TO bitpos_app;
CREATE FUNCTION dispatch_food_location(assignment uuid,service_gen bigint,lease_gen bigint,sequence bigint,captured timestamptz,latitude integer,longitude integer,accuracy integer,heading integer DEFAULT NULL,speed integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;actor uuid;prior driver_latest_locations;sample location_samples;at timestamptz;elapsed numeric;distance_m double precision;
BEGIN
 IF service_gen IS NULL OR lease_gen IS NULL OR sequence IS NULL OR sequence<1 OR captured IS NULL OR NOT isfinite(captured)
 OR latitude IS NULL OR abs(latitude::bigint)>900000000 OR longitude IS NULL OR abs(longitude::bigint)>1800000000
 OR accuracy IS NULL OR accuracy NOT BETWEEN 0 AND 100000 OR heading NOT BETWEEN 0 AND 359999 OR speed NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'LOCATION_INVALID';END IF;
 a:=dispatch_lock_assignment(assignment,service_gen,lease_gen);actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF a.state NOT IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','INCIDENT') THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED';END IF;
 SELECT * INTO sample FROM location_samples WHERE assignment_id=a.id AND generation=service_gen AND seq=sequence;
 IF FOUND THEN
  IF (sample.lease_generation,sample.captured_at,sample.latitude_e7,sample.longitude_e7,sample.accuracy_mm,sample.heading_mdeg,sample.speed_mm_s)
   IS DISTINCT FROM (lease_gen,captured,latitude,longitude,accuracy,heading,speed) THEN RAISE EXCEPTION 'LOCATION_SEQUENCE_CONFLICT';END IF;
  RETURN jsonb_build_object('sequence',sequence::text,'replayed',true,'receivedAt',sample.received_at);
 END IF;
 at:=clock_timestamp();
 IF captured<at-interval '120 seconds' OR captured>at+interval '10 seconds' THEN RAISE EXCEPTION 'LOCATION_STALE';END IF;
 SELECT * INTO prior FROM driver_latest_locations WHERE assignment_id=a.id AND generation=service_gen;
 IF FOUND THEN
  IF sequence<=prior.seq OR captured<=prior.captured_at THEN RAISE EXCEPTION 'LOCATION_SEQUENCE_CONFLICT';END IF;
  IF at<prior.received_at+interval '5 seconds' THEN RAISE EXCEPTION 'LOCATION_RATE_LIMITED';END IF;
  elapsed:=extract(epoch FROM captured-prior.captured_at);
  distance_m:=6371000*2*asin(sqrt(least(1.0,power(sin(radians((latitude::double precision-prior.latitude_e7)/10000000)/2),2)+cos(radians(latitude::double precision/10000000))*cos(radians(prior.latitude_e7::double precision/10000000))*power(sin(radians((longitude::double precision-prior.longitude_e7)/10000000)/2),2))));
  IF distance_m>elapsed*70+(accuracy+prior.accuracy_mm)::numeric/1000+100 THEN RAISE EXCEPTION 'LOCATION_IMPLAUSIBLE';END IF;
 END IF;
 INSERT INTO location_samples(assignment_id,driver_id,generation,lease_generation,seq,captured_at,received_at,latitude_e7,longitude_e7,accuracy_mm,heading_mdeg,speed_mm_s)
 VALUES(a.id,a.driver_id,service_gen,lease_gen,sequence,captured,at,latitude,longitude,accuracy,heading,speed);
 INSERT INTO driver_latest_locations SELECT assignment_id,driver_id,generation,lease_generation,seq,captured_at,received_at,latitude_e7,longitude_e7,accuracy_mm,heading_mdeg,speed_mm_s FROM location_samples WHERE assignment_id=a.id AND generation=service_gen AND seq=sequence
 ON CONFLICT(assignment_id,generation) DO UPDATE SET lease_generation=EXCLUDED.lease_generation,seq=EXCLUDED.seq,captured_at=EXCLUDED.captured_at,received_at=EXCLUDED.received_at,latitude_e7=EXCLUDED.latitude_e7,longitude_e7=EXCLUDED.longitude_e7,accuracy_mm=EXCLUDED.accuracy_mm,heading_mdeg=EXCLUDED.heading_mdeg,speed_mm_s=EXCLUDED.speed_mm_s;
 RETURN jsonb_build_object('sequence',sequence::text,'replayed',false,'receivedAt',at);
END $$;
CREATE FUNCTION dispatch_food_tracking(shipment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;a food_assignments;actor uuid;point driver_latest_locations;
BEGIN
 s:=dispatch_lock_root(shipment);actor:=dispatch_live_actor();
 SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
 IF actor<>s.account_id AND NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF a.id IS NULL THEN RETURN jsonb_build_object('assignmentId',NULL,'location',NULL);END IF;
 a:=dispatch_lock_assignment(a.id,s.generation,a.lease_generation);actor:=dispatch_live_actor();
 SELECT * INTO point FROM driver_latest_locations WHERE assignment_id=a.id AND generation=a.generation;
 RETURN jsonb_build_object('assignmentId',a.id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'location',
 CASE WHEN point.assignment_id IS NULL THEN NULL ELSE jsonb_build_object('sequence',point.seq::text,'latitudeE7',point.latitude_e7,'longitudeE7',point.longitude_e7,'accuracyMm',point.accuracy_mm,'capturedAt',point.captured_at,'receivedAt',point.received_at,'stale',least(point.captured_at,point.received_at)<clock_timestamp()-interval '30 seconds') END);
END $$;
REVOKE ALL ON FUNCTION dispatch_food_location(uuid,bigint,bigint,bigint,timestamptz,integer,integer,integer,integer,integer),dispatch_food_tracking(uuid) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_food_location(uuid,bigint,bigint,bigint,timestamptz,integer,integer,integer,integer,integer),dispatch_food_tracking(uuid) TO bitpos_app;
