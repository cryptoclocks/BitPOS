-- Local implementation artifact. Actual-use admission remains disabled pending authorized operations.
-- Rollback: disable BITPOS_MOBILE_ENABLED; preserve verification/command/audit facts.
SET search_path TO bitpos,public;
CREATE TABLE platform_staff_role_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES mobile_accounts,
 role text NOT NULL CHECK(role IN ('verifier','dispatcher','support','finance','administrator')),
 granted_by text NOT NULL CHECK(length(granted_by) BETWEEN 1 AND 160),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX platform_staff_active_role ON platform_staff_role_grants(account_id,role) WHERE revoked_at IS NULL;
CREATE TABLE driver_profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL UNIQUE REFERENCES mobile_accounts,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),
 license_expires_at timestamptz NOT NULL CHECK(isfinite(license_expires_at)),
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','APPROVED','REJECTED','SUSPENDED')),
 verified_until timestamptz CHECK(isfinite(verified_until)),decision_reason text NOT NULL DEFAULT '' CHECK(length(decision_reason)<=500),
 verified_by uuid REFERENCES mobile_accounts,verification_reference text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='APPROVED')=(verified_until IS NOT NULL)),
 CHECK(status<>'APPROVED' OR (verified_by IS NOT NULL AND verified_by<>account_id AND verified_until<=license_expires_at AND verification_reference IS NOT NULL AND length(btrim(verification_reference)) BETWEEN 1 AND 300))
);
CREATE TABLE driver_vehicles(
 driver_id uuid PRIMARY KEY REFERENCES driver_profiles,vehicle_type text NOT NULL CHECK(vehicle_type IN ('MOTORCYCLE','CAR')),
 plate text NOT NULL CHECK(length(btrim(plate)) BETWEEN 1 AND 40),brand text NOT NULL CHECK(length(btrim(brand)) BETWEEN 1 AND 80),
 color text NOT NULL CHECK(length(btrim(color)) BETWEEN 1 AND 40),registration_expires_at timestamptz NOT NULL CHECK(isfinite(registration_expires_at))
);
CREATE TABLE driver_occupancy(
 driver_id uuid PRIMARY KEY REFERENCES driver_profiles,assignment_generation bigint NOT NULL DEFAULT 0 CHECK(assignment_generation>=0)
);
CREATE TABLE driver_availability(
 driver_id uuid PRIMARY KEY REFERENCES driver_occupancy,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 requested_online boolean NOT NULL DEFAULT false,heartbeat_expires_at timestamptz,
 CHECK(NOT requested_online OR heartbeat_expires_at IS NOT NULL)
);
CREATE TABLE driver_identity_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,
 operation text NOT NULL,request jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_account_id,idempotency_key)
);
CREATE TABLE driver_identity_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_account_id uuid NOT NULL REFERENCES mobile_accounts,
 session_id uuid NOT NULL REFERENCES mobile_sessions,driver_id uuid REFERENCES driver_profiles,
 action text NOT NULL,reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON platform_staff_role_grants,driver_profiles,driver_vehicles,driver_occupancy,driver_availability,driver_identity_commands,driver_identity_audit FROM PUBLIC,bitpos_app;
-- All access passes the live-session command boundary; no merchant/public policies.
ALTER TABLE platform_staff_role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_identity_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_identity_audit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION driver_live_actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 SELECT s.account_id INTO actor FROM mobile_sessions s JOIN mobile_accounts a ON a.id=s.account_id
 WHERE s.id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid
 AND s.account_id::text=current_setting('bitpos.mobile_account',true)
 AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.refresh_expires_at>clock_timestamp() AND a.disabled_at IS NULL
 FOR SHARE OF s;
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION driver_staff_roles() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_live_actor();result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(role ORDER BY role),'[]'::jsonb) INTO result FROM platform_staff_role_grants
 WHERE account_id=actor AND revoked_at IS NULL AND expires_at>clock_timestamp();RETURN result;
END $$;
CREATE FUNCTION driver_require_verifier() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_live_actor();grant_id uuid;
BEGIN
 SELECT id INTO grant_id FROM platform_staff_role_grants WHERE account_id=actor AND role IN ('verifier','administrator') AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY id LIMIT 1 FOR SHARE;
 IF grant_id IS NULL OR NOT EXISTS(SELECT 1 FROM platform_staff_role_grants WHERE id=grant_id AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ROLE_REQUIRED' USING ERRCODE='P0001'; END IF;
 PERFORM driver_live_actor();RETURN actor;
END $$;
CREATE FUNCTION driver_identity_snapshot(target uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_live_actor();p driver_profiles;v driver_vehicles;a driver_availability;eligible boolean;
BEGIN
 IF target IS NULL THEN SELECT * INTO p FROM driver_profiles WHERE account_id=actor;
 ELSE PERFORM driver_require_verifier();SELECT * INTO p FROM driver_profiles WHERE id=target; END IF;
 IF p.id IS NULL THEN RETURN jsonb_build_object('driver',NULL);END IF;
 SELECT * INTO v FROM driver_vehicles WHERE driver_id=p.id;SELECT * INTO a FROM driver_availability WHERE driver_id=p.id;
 eligible:=p.status='APPROVED' AND p.verified_until>clock_timestamp() AND p.license_expires_at>clock_timestamp() AND v.registration_expires_at>clock_timestamp();
 IF target IS NOT NULL THEN INSERT INTO driver_identity_audit(actor_account_id,session_id,driver_id,action,reason) VALUES(actor,current_setting('bitpos.mobile_session')::uuid,p.id,'verification.read','Verification queue detail');END IF;
 RETURN jsonb_build_object('driver',jsonb_build_object('id',p.id,'version',p.version::text,'status',p.status,'verifiedUntil',p.verified_until,'decisionReason',p.decision_reason,
 'application',jsonb_build_object('displayName',p.display_name,'licenseExpiresAt',p.license_expires_at,'vehicleType',v.vehicle_type,'plate',v.plate,'brand',v.brand,'color',v.color,'registrationExpiresAt',v.registration_expires_at),
 'availability',jsonb_build_object('version',a.version::text,'requestedOnline',a.requested_online,'online',coalesce(eligible AND a.requested_online AND a.heartbeat_expires_at>clock_timestamp(),false),'heartbeatExpiresAt',a.heartbeat_expires_at,'verificationCurrent',eligible)));
END $$;
CREATE FUNCTION driver_identity_command(op text,target uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_live_actor();key uuid:=(payload->>'idempotencyKey')::uuid;old driver_identity_commands;p driver_profiles;v driver_vehicles;a driver_availability;
 fields jsonb;receipt jsonb;until_time timestamptz;reason text;
BEGIN
 -- Account first only for this identity command; no order/shipment acquisition follows.
 PERFORM 1 FROM mobile_accounts WHERE id=actor FOR UPDATE;
 PERFORM driver_live_actor();
 IF op IN ('approve','reject','suspend') THEN PERFORM driver_require_verifier();SELECT * INTO p FROM driver_profiles WHERE id=target;
 ELSE SELECT * INTO p FROM driver_profiles WHERE account_id=actor; END IF;
 IF op NOT IN ('apply','availability','approve','reject','suspend') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF op IN ('approve','reject','suspend') AND (p.id IS NULL OR p.account_id=actor) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT * INTO old FROM driver_identity_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF old.operation<>op OR old.request<>jsonb_build_object('target',target,'payload',payload) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN old.response;END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR key IS NULL
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string'
 OR (payload->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,18})$'
 OR (payload->>'expectedVersion')::numeric>9223372036854775807
 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (op='apply' AND ((SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','application']))
 OR (op='availability' AND ((SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR jsonb_typeof(payload->'online') IS DISTINCT FROM 'boolean'))
 OR (op='approve' AND ((SELECT count(*) FROM jsonb_object_keys(payload))<>5 OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','reason','verifiedUntil','verificationReference']))
 OR (op IN ('reject','suspend') AND ((SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','reason']))
 OR (op IN ('apply','availability') AND target IS NOT NULL)
 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF p.id IS NOT NULL THEN
  PERFORM 1 FROM driver_occupancy WHERE driver_id=p.id FOR UPDATE;
  SELECT * INTO p FROM driver_profiles WHERE id=p.id FOR UPDATE;
  PERFORM 1 FROM driver_vehicles WHERE driver_id=p.id FOR UPDATE;
  PERFORM 1 FROM driver_availability WHERE driver_id=p.id FOR UPDATE;
 END IF;
 PERFORM driver_live_actor();
 IF op IN ('approve','reject','suspend') THEN PERFORM driver_require_verifier();END IF;
 IF op='apply' THEN
  IF coalesce(p.version,0)<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  -- Suspended drivers cannot erase suspension by resubmitting personal fields.
  IF p.status='SUSPENDED' THEN RAISE EXCEPTION 'DRIVER_SUSPENDED';END IF;
  fields:=payload->'application';
  IF jsonb_typeof(fields) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(fields))<>7
  OR NOT fields ?& ARRAY['displayName','licenseExpiresAt','vehicleType','plate','brand','color','registrationExpiresAt']
  OR EXISTS(SELECT 1 FROM jsonb_each(fields) f WHERE jsonb_typeof(f.value)<>'string')
  OR EXISTS(SELECT 1 FROM jsonb_each_text(fields) f WHERE f.key IN ('displayName','plate','brand','color') AND btrim(f.value)='')
  THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  IF (fields->>'licenseExpiresAt')::timestamptz<=clock_timestamp() OR (fields->>'registrationExpiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'DRIVER_DOCUMENT_EXPIRED';END IF;
  IF p.id IS NULL THEN
   INSERT INTO driver_profiles(account_id,display_name,license_expires_at) VALUES(actor,fields->>'displayName',(fields->>'licenseExpiresAt')::timestamptz) RETURNING * INTO p;
   INSERT INTO driver_occupancy(driver_id) VALUES(p.id);INSERT INTO driver_availability(driver_id) VALUES(p.id);
   INSERT INTO driver_vehicles(driver_id,vehicle_type,plate,brand,color,registration_expires_at) VALUES(p.id,fields->>'vehicleType',fields->>'plate',fields->>'brand',fields->>'color',(fields->>'registrationExpiresAt')::timestamptz);
  ELSE
   UPDATE driver_profiles SET display_name=fields->>'displayName',license_expires_at=(fields->>'licenseExpiresAt')::timestamptz,status='SUBMITTED',verified_until=NULL,verified_by=NULL,verification_reference=NULL,decision_reason='',version=version+1,updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
   UPDATE driver_vehicles SET vehicle_type=fields->>'vehicleType',plate=fields->>'plate',brand=fields->>'brand',color=fields->>'color',registration_expires_at=(fields->>'registrationExpiresAt')::timestamptz WHERE driver_id=p.id;
   UPDATE driver_availability SET requested_online=false,heartbeat_expires_at=NULL,version=version+1 WHERE driver_id=p.id;
  END IF;
 ELSIF op='availability' THEN
  IF p.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  SELECT * INTO a FROM driver_availability WHERE driver_id=p.id FOR UPDATE;
  IF a.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO v FROM driver_vehicles WHERE driver_id=p.id;
  IF (payload->>'online')::boolean AND NOT(p.status='APPROVED' AND p.verified_until>clock_timestamp() AND p.license_expires_at>clock_timestamp() AND v.registration_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'DRIVER_VERIFICATION_REQUIRED';END IF;
  UPDATE driver_availability SET requested_online=(payload->>'online')::boolean,heartbeat_expires_at=CASE WHEN (payload->>'online')::boolean THEN clock_timestamp()+interval '90 seconds' ELSE NULL END,version=version+1 WHERE driver_id=p.id RETURNING * INTO a;
 ELSE
  IF p.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  reason:=btrim(payload->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  IF op='approve' THEN
   SELECT * INTO v FROM driver_vehicles WHERE driver_id=p.id;
   until_time:=(payload->>'verifiedUntil')::timestamptz;
   IF until_time IS NULL OR NOT isfinite(until_time) OR until_time<=clock_timestamp() OR until_time>least(p.license_expires_at,v.registration_expires_at) OR payload->>'verificationReference' IS NULL OR length(btrim(payload->>'verificationReference')) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'DRIVER_DOCUMENT_EXPIRED';END IF;
   -- A suspension is resolved only by an explicit audited verifier decision, never self-service.
   UPDATE driver_profiles SET status='APPROVED',verified_until=until_time,verified_by=actor,verification_reference=payload->>'verificationReference',decision_reason=reason,version=version+1,updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
  ELSE
   UPDATE driver_profiles SET status=CASE op WHEN 'suspend' THEN 'SUSPENDED' ELSE 'REJECTED' END,verified_until=NULL,verified_by=actor,decision_reason=reason,version=version+1,updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
  END IF;
  UPDATE driver_availability SET requested_online=false,heartbeat_expires_at=NULL,version=version+1 WHERE driver_id=p.id;
 END IF;
 receipt:=jsonb_build_object('driverId',p.id,'version',CASE WHEN op='availability' THEN a.version::text ELSE p.version::text END);
 INSERT INTO driver_identity_commands(actor_account_id,idempotency_key,operation,request,response) VALUES(actor,key,op,jsonb_build_object('target',target,'payload',payload),receipt);
 INSERT INTO driver_identity_audit(actor_account_id,session_id,driver_id,action,reason) VALUES(actor,current_setting('bitpos.mobile_session')::uuid,p.id,'driver.'||op,coalesce(reason,''));
 RETURN receipt;
END $$;
CREATE FUNCTION driver_verification_queue(after_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_require_verifier();result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version::text,'displayName',display_name,'status',status) ORDER BY id),'[]'::jsonb) INTO result
 FROM(SELECT id,version,display_name,status FROM driver_profiles WHERE account_id<>actor AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT 21)p;
 INSERT INTO driver_identity_audit(actor_account_id,session_id,action,reason) VALUES(actor,current_setting('bitpos.mobile_session')::uuid,'verification.queue.read','Bounded verification queue');
 RETURN jsonb_build_object('drivers',result);
END $$;
REVOKE ALL ON FUNCTION driver_live_actor(),driver_staff_roles(),driver_require_verifier(),driver_identity_snapshot(uuid),driver_identity_command(text,uuid,jsonb),driver_verification_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_staff_roles(),driver_identity_snapshot(uuid),driver_identity_command(text,uuid,jsonb),driver_verification_queue(uuid) TO bitpos_app;
