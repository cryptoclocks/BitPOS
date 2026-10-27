-- Assigned work authority is distinct from idle consent/online heartbeat and physical custody.
SET search_path=bitpos,public;
CREATE FUNCTION food_driver_authority(driver uuid,shipment uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid;branch uuid;p driver_profiles;v driver_vehicles;
BEGIN
 SELECT s.merchant_id,q.branch_id INTO merchant,branch FROM food_shipments s JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id) WHERE s.id=shipment;
 IF merchant IS NULL THEN RETURN 'FOOD_SERVICE_UNAVAILABLE';END IF;
 -- Callers acquire root/occupancy first. Never block on the inverse sponsor/identity edge.
 BEGIN
  PERFORM 1 FROM driver_profiles d JOIN driver_vehicles vehicle ON vehicle.driver_id=d.id JOIN mobile_accounts account ON account.id=d.account_id WHERE d.id=driver FOR SHARE OF d,vehicle,account NOWAIT;
  PERFORM 1 FROM driver_food_service_grants f JOIN platform_staff_role_grants g ON g.id=f.issued_grant_id JOIN mobile_accounts issuer ON issuer.id=g.account_id JOIN platform_role_scopes sc ON sc.grant_id=g.id AND sc.merchant_id=f.merchant_id
  WHERE f.driver_id=driver AND f.merchant_id=merchant AND f.branch_id=branch FOR SHARE OF f,g,issuer,sc NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 SELECT * INTO p FROM driver_profiles WHERE id=driver;SELECT * INTO v FROM driver_vehicles WHERE driver_id=driver;
 IF p.id IS NULL OR EXISTS(SELECT 1 FROM mobile_accounts WHERE id=p.account_id AND disabled_at IS NOT NULL) OR p.status='SUSPENDED' THEN RETURN 'DRIVER_SUSPENDED';END IF;
 IF p.status<>'APPROVED' OR p.verified_until IS NULL OR p.verified_until<=clock_timestamp() THEN RETURN 'DRIVER_VERIFICATION_REQUIRED';END IF;
 IF p.license_expires_at<=clock_timestamp() OR v.driver_id IS NULL OR v.registration_expires_at<=clock_timestamp() THEN RETURN 'DRIVER_DOCUMENT_EXPIRED';END IF;
 IF NOT food_discovery_grant_live(driver,merchant,branch) THEN RETURN 'FOOD_SERVICE_UNAVAILABLE';END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION food_driver_require_authority(driver uuid,shipment uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE reason text:=food_driver_authority(driver,shipment);
BEGIN
 IF reason='FOOD_SERVICE_UNAVAILABLE' THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE' USING ERRCODE='P7801';ELSIF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P7801';END IF;
END $$;
CREATE FUNCTION food_driver_restricted_duty(a food_assignments,s food_shipments,reason text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('access','RESTRICTED','id',(a).id,'shipmentId',(s).id,'generation',(a).generation::text,'leaseGeneration',(a).lease_generation::text,'shipmentVersion',(s).version::text,'custodyPhase',CASE WHEN (a).picked_up_at IS NULL THEN 'PREPICKUP' ELSE 'PICKED_UP' END,'reason',coalesce(reason,'INCIDENT'))
$$;
REVOKE ALL ON FUNCTION food_driver_restricted_duty(food_assignments,food_shipments,text) FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
REVOKE ALL ON FUNCTION food_driver_authority(uuid,uuid),food_driver_require_authority(uuid,uuid) FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
-- Generated live professional/service fence cutover.
CREATE OR REPLACE FUNCTION dispatch_create_offer_locked(shipment uuid,driver uuid,expires timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;offer uuid:=gen_random_uuid();at timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO STRICT s FROM food_shipments WHERE id=shipment;PERFORM food_driver_require_authority(driver,s.id);
 IF s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF expires<=at OR expires>at+interval '46 seconds' OR NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 UPDATE food_dispatch_offers SET state='EXPIRED',version=version+1 WHERE shipment_id=s.id AND state='OFFERED' AND expires_at<=at;
 IF EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED') THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
 UPDATE food_shipments SET generation=generation+1,state='OFFERING' WHERE id=s.id RETURNING * INTO s;
 INSERT INTO food_dispatch_offers(id,shipment_id,generation,driver_id,state,expires_at) VALUES(offer,s.id,s.generation,driver,'OFFERED',expires);
 PERFORM dispatch_event(s.id,'OFFERED',jsonb_build_object('offerId',offer));
 PERFORM food_driver_require_authority(driver,s.id);
 RETURN jsonb_build_object('offerId',offer,'shipmentId',s.id,'generation',s.generation::text,'version',(s.version+1)::text);
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_claim(offer uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
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
 actor:=dispatch_live_actor();at:=clock_timestamp();PERFORM food_driver_require_authority(driver,s.id);
 IF EXISTS(SELECT 1 FROM food_dispatch_automatic_offers WHERE offer_id=f.id) THEN
  BEGIN
  PERFORM food_dispatch_lock_candidate(driver,(SELECT policy_id FROM food_dispatch_automatic_offers WHERE offer_id=f.id));
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
  IF NOT food_dispatch_automatic_offer_live(f.id) THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 END IF;
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
 PERFORM food_driver_require_authority(driver,s.id);RETURN receipt;
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_arrive(assignment uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
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
 actor:=dispatch_live_actor();PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);
 target:=CASE payload->>'stage' WHEN 'PICKUP' THEN 'AT_PICKUP' ELSE 'AT_DROPOFF' END;
 IF (target='AT_PICKUP' AND a.state<>'ACCEPTED') OR (target='AT_DROPOFF' AND a.state<>'PICKED_UP') THEN RAISE EXCEPTION 'DISPATCH_TRANSITION_INVALID';END IF;
 UPDATE food_assignments SET state=target WHERE id=a.id;
 UPDATE food_shipments SET state=target WHERE id=a.shipment_id;
 PERFORM dispatch_event(a.shipment_id,target,jsonb_build_object('assignmentId',a.id));
 receipt:=jsonb_build_object('assignmentId',a.id,'state',target,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'arrive',digest,receipt);
 PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);RETURN receipt;
END $$;
CREATE OR REPLACE FUNCTION dispatch_consume_proof(assignment uuid,proof uuid,service_gen bigint,lease_gen bigint,key uuid,submitted_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;p fulfillment_proofs;actor uuid;prior food_dispatch_commands;digest text;at timestamptz;receipt jsonb;accrual uuid;
BEGIN
 IF key IS NULL OR submitted_hash IS NULL OR submitted_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(assignment,proof,service_gen,lease_gen,submitted_hash)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'consume-proof' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 a:=dispatch_lock_assignment(assignment,service_gen,lease_gen);actor:=dispatch_live_actor();PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);
 SELECT * INTO p FROM fulfillment_proofs WHERE id=proof AND assignment_id=a.id AND driver_id=a.driver_id AND generation=a.generation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 at:=clock_timestamp();
 IF p.consumed_at IS NOT NULL OR p.revoked_at IS NOT NULL OR p.expires_at<=at OR p.attempts>=10 THEN RAISE EXCEPTION 'PROOF_UNAVAILABLE';END IF;
 IF p.kind='PICKUP' AND (a.state<>'AT_PICKUP' OR NOT EXISTS(SELECT 1 FROM order_fulfillment WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND status='READY'))
 OR p.kind='DELIVERY' AND a.state<>'AT_DROPOFF' OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF p.secret_hash<>submitted_hash THEN
  UPDATE fulfillment_proofs SET attempts=attempts+1 WHERE id=p.id;
  receipt:=jsonb_build_object('accepted',false,'error','PROOF_INVALID','attemptsRemaining',9-p.attempts);
 ELSE
  UPDATE fulfillment_proofs SET consumed_at=at,consumed_by=actor WHERE id=p.id;
  IF p.kind='PICKUP' THEN
   UPDATE order_fulfillment SET status='COLLECTED',version=version+1,updated_at=at WHERE merchant_id=s.merchant_id AND order_id=s.order_id;
   UPDATE food_assignments SET state='PICKED_UP',picked_up_at=at WHERE id=a.id;
   UPDATE food_shipments SET state='PICKED_UP' WHERE id=s.id;
  ELSE
   UPDATE food_assignments SET state='DELIVERED',closed_at=at WHERE id=a.id;
   UPDATE driver_assignment_leases SET state='RELEASED',released_at=at WHERE id=a.lease_id;
   UPDATE food_shipments SET state='DELIVERED',active_assignment_id=NULL WHERE id=s.id;
   accrual:=food_finalize_earning(a.id);
  END IF;
  PERFORM dispatch_event(s.id,p.kind||'_PROOF_CONSUMED',jsonb_build_object('assignmentId',a.id,'proofId',p.id));
  receipt:=jsonb_build_object('accepted',true,'assignmentId',a.id,'proofId',p.id,'kind',p.kind,'consumedAt',at,'accrualId',accrual);
 END IF;
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'consume-proof',digest,receipt);
 PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);RETURN receipt;
END $$;
CREATE OR REPLACE FUNCTION dispatch_issue_proof(assignment uuid,kind text,service_gen bigint,lease_gen bigint,key uuid,secret_hash text,rotate boolean DEFAULT false,merchant_session_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
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
 a:=dispatch_lock_assignment(assignment,service_gen,lease_gen);PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);
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
 PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);RETURN receipt;
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_location(assignment uuid,service_gen bigint,lease_gen bigint,sequence bigint,captured timestamptz,latitude integer,longitude integer,accuracy integer,heading integer DEFAULT NULL,speed integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;actor uuid;prior driver_latest_locations;sample location_samples;at timestamptz;elapsed numeric;distance_m double precision;
BEGIN
 IF service_gen IS NULL OR lease_gen IS NULL OR sequence IS NULL OR sequence<1 OR captured IS NULL OR NOT isfinite(captured)
 OR latitude IS NULL OR abs(latitude::bigint)>900000000 OR longitude IS NULL OR abs(longitude::bigint)>1800000000
 OR accuracy IS NULL OR accuracy NOT BETWEEN 0 AND 100000 OR heading NOT BETWEEN 0 AND 359999 OR speed NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'LOCATION_INVALID';END IF;
 a:=dispatch_lock_assignment(assignment,service_gen,lease_gen);actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);
 IF a.state NOT IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF') THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED';END IF;
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
 PERFORM food_driver_require_authority(a.driver_id,a.shipment_id);
 RETURN jsonb_build_object('sequence',sequence::text,'replayed',false,'receivedAt',at);
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_tracking(shipment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;a food_assignments;actor uuid;point driver_latest_locations;
BEGIN
 s:=dispatch_lock_root(shipment);actor:=dispatch_live_actor();
 SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
 IF actor<>s.account_id AND NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF a.id IS NULL THEN RETURN jsonb_build_object('assignmentId',NULL,'location',NULL);END IF;
 a:=dispatch_lock_assignment(a.id,s.generation,a.lease_generation);actor:=dispatch_live_actor();
 IF a.state='INCIDENT' OR food_driver_authority(a.driver_id,a.shipment_id) IS NOT NULL THEN
  IF actor<>s.account_id THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  RETURN jsonb_build_object('assignmentId',a.id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'location',NULL);
 END IF;
 SELECT * INTO point FROM driver_latest_locations WHERE assignment_id=a.id AND generation=a.generation;
 RETURN jsonb_build_object('assignmentId',a.id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'location',
 CASE WHEN point.assignment_id IS NULL THEN NULL ELSE jsonb_build_object('sequence',point.seq::text,'latitudeE7',point.latitude_e7,'longitudeE7',point.longitude_e7,'accuracyMm',point.accuracy_mm,'capturedAt',point.captured_at,'receivedAt',point.received_at,'stale',least(point.captured_at,point.received_at)<clock_timestamp()-interval '30 seconds') END);
END $$;
CREATE OR REPLACE FUNCTION dispatch_driver_realtime() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE work jsonb;point driver_latest_locations;location jsonb:=NULL;
BEGIN
 -- Work owns the driver/lease locks. Do not acquire a shipment root afterward.
 work:=dispatch_driver_work();
 IF work#>>'{assignment,access}'='NORMAL' THEN
  SELECT * INTO point FROM driver_latest_locations
  WHERE assignment_id=(work#>>'{assignment,id}')::uuid
   AND generation=(work#>>'{assignment,generation}')::bigint
   AND lease_generation=(work#>>'{assignment,leaseGeneration}')::bigint;
  IF FOUND THEN
   location:=jsonb_build_object('sequence',point.seq::text,'latitudeE7',point.latitude_e7,'longitudeE7',point.longitude_e7,
    'accuracyMm',point.accuracy_mm,'capturedAt',point.captured_at,'receivedAt',point.received_at,
    'stale',least(point.captured_at,point.received_at)<clock_timestamp()-interval '30 seconds');
  END IF;
 END IF;
 PERFORM dispatch_realtime_actor();
 RETURN jsonb_build_object('work',work,'location',location,'serverTime',clock_timestamp());
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_navigation(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE snapshot jsonb;work jsonb;assignment jsonb;point jsonb;s food_shipments;destination quote_delivery_snapshots;target text;
BEGIN
 IF oid IS NULL THEN
  snapshot:=dispatch_driver_realtime();work:=snapshot->'work';assignment:=work->'assignment';point:=snapshot->'location';
 ELSE
  snapshot:=dispatch_customer_realtime(oid);work:=snapshot->'work';assignment:=work->'assignment';point:=assignment->'location';
 END IF;
 IF assignment IS NULL OR assignment='null'::jsonb OR assignment->>'access'='RESTRICTED' OR assignment->>'state'='INCIDENT' THEN RETURN NULL;END IF;
 -- Existing projection owns the root/lease locks; no inverse root lock acquisition here.
 SELECT * INTO STRICT s FROM food_shipments WHERE active_assignment_id=(assignment->>'id')::uuid;
 IF food_driver_authority((SELECT driver_id FROM food_assignments WHERE id=s.active_assignment_id),s.id) IS NOT NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT destination FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 target:=CASE WHEN assignment->>'state' IN('ACCEPTED','AT_PICKUP') THEN 'PICKUP' ELSE 'DROPOFF' END;
 PERFORM dispatch_realtime_actor();
 RETURN jsonb_build_object('assignmentId',assignment->>'id','generation',assignment->>'generation','leaseGeneration',assignment->>'leaseGeneration',
  'state',assignment->>'state','shipmentId',s.id,'fixture',destination.fixture,'target',target,
  'targetLatitudeE7',CASE WHEN target='PICKUP' THEN destination.origin_latitude_e7 ELSE destination.latitude_e7 END,
  'targetLongitudeE7',CASE WHEN target='PICKUP' THEN destination.origin_longitude_e7 ELSE destination.longitude_e7 END,
  'location',point);
END $$;
CREATE OR REPLACE FUNCTION dispatch_driver_work() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;a food_assignments;s food_shipments;active jsonb:=NULL;offers jsonb;reason text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 actor:=dispatch_live_actor();SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RETURN jsonb_build_object('offers','[]'::jsonb,'assignment',NULL);END IF;
 SELECT * INTO a FROM food_assignments WHERE driver_id=driver AND closed_at IS NULL;
 IF FOUND THEN
  a:=dispatch_lock_assignment(a.id,a.generation,a.lease_generation);actor:=dispatch_live_actor();
  SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
  reason:=food_driver_authority(a.driver_id,a.shipment_id);
  IF reason IS NOT NULL OR a.state='INCIDENT' THEN
   active:=food_driver_restricted_duty(a,s,reason);
  ELSE
  SELECT jsonb_build_object('access','NORMAL','shipmentVersion',s.version::text,'id',a.id,'shipmentId',s.id,'orderId',s.order_id,'merchantId',s.merchant_id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'state',a.state,
   'pickupLatitudeE7',d.origin_latitude_e7,'pickupLongitudeE7',d.origin_longitude_e7,
   'recipientName',d.recipient_name,'phone',d.phone,'addressText',d.address_text,'instructions',d.instructions,'latitudeE7',d.latitude_e7,'longitudeE7',d.longitude_e7,
   'earning',jsonb_build_object('amountMinor',d.driver_minor::text,'currency',d.currency,'decimals',d.decimals),'fixture',d.fixture,
   'proofs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) ORDER BY f.kind) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.consumed_at IS NULL AND f.revoked_at IS NULL AND f.expires_at>clock_timestamp()),'[]'::jsonb))
  INTO active FROM quote_delivery_snapshots d WHERE d.merchant_id=s.merchant_id AND d.quote_id=s.quote_id;
  END IF;
 END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY expiry,id),'[]'::jsonb) INTO offers FROM (
  SELECT f.id,f.expires_at AS expiry,jsonb_build_object('id',f.id,'shipmentId',f.shipment_id,'generation',f.generation::text,'version',f.version::text,'expiresAt',f.expires_at,
   'pickupLatitudeE7',d.origin_latitude_e7,'pickupLongitudeE7',d.origin_longitude_e7,
   'earning',jsonb_build_object('amountMinor',d.driver_minor::text,'currency',d.currency,'decimals',d.decimals),'fixture',d.fixture) AS row
  FROM food_dispatch_offers f JOIN food_shipments sh ON sh.id=f.shipment_id
  JOIN quote_delivery_snapshots d ON (d.merchant_id,d.quote_id)=(sh.merchant_id,sh.quote_id)
  WHERE active IS NULL AND f.driver_id=driver AND f.state='OFFERED' AND food_discovery_grant_live(driver,sh.merchant_id,d.branch_id) AND (NOT EXISTS(SELECT 1 FROM food_dispatch_automatic_offers automatic WHERE automatic.offer_id=f.id) OR food_dispatch_automatic_offer_live(f.id)) AND f.expires_at>clock_timestamp() AND sh.generation=f.generation AND sh.state='OFFERING' AND sh.active_assignment_id IS NULL
  ORDER BY f.expires_at,f.id LIMIT 10
 ) bounded;
 IF active->>'access'='NORMAL' THEN
  reason:=food_driver_authority(a.driver_id,a.shipment_id);
  IF reason IS NOT NULL THEN active:=food_driver_restricted_duty(a,s,reason);offers:='[]'::jsonb;END IF;
 END IF;
 RETURN jsonb_build_object('offers',offers,'assignment',active);
END $$;
CREATE OR REPLACE FUNCTION dispatch_customer_work(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;s food_shipments;a food_assignments;tracking jsonb;active jsonb:=NULL;available boolean;
BEGIN
 actor:=dispatch_live_actor();
 SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(s.id);actor:=dispatch_live_actor();
 IF s.account_id<>actor THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 tracking:=dispatch_food_tracking(s.id);
 SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
 IF FOUND THEN
  available:=a.state<>'INCIDENT' AND food_driver_authority(a.driver_id,a.shipment_id) IS NULL;
  active:=jsonb_build_object('serviceAvailable',available,'id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
   'location',tracking->'location',
   'deliveryProof',CASE WHEN available THEN (SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='DELIVERY' AND f.revoked_at IS NULL AND f.consumed_at IS NULL) ELSE NULL END);
 END IF;
 RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active);
END $$;
CREATE OR REPLACE FUNCTION food_dispatch_rank_finish(run uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_dispatch_rank_runs;s food_shipments;t food_dispatch_searches;p food_dispatch_policy_versions;entry jsonb;current_source jsonb;choice jsonb;receipt jsonb;outcome text:='STALE';offer_receipt jsonb;driver uuid;locked boolean:=true;
BEGIN
 PERFORM food_dispatch_search_worker();SELECT * INTO r FROM food_dispatch_rank_runs WHERE id=run;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);SELECT * INTO STRICT r FROM food_dispatch_rank_runs WHERE id=run FOR UPDATE;SELECT * INTO STRICT t FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR NOT payload ?& ARRAY['status','results'] OR payload->>'status' NOT IN('ROUTES','PROVIDER_UNAVAILABLE')
 OR jsonb_typeof(payload->'status') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'results') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'results')>6 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF r.response IS NOT NULL THEN IF r.request<>payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN r.response;END IF;
 IF jsonb_array_length(payload->'results')<>(SELECT count(*) FROM food_dispatch_rank_candidates c WHERE c.run_id=run) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'results') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(entry))<>5 OR NOT entry ?& ARRAY['driverId','sourceDigest','status','durationSeconds','distanceMetres']
  OR NOT coalesce(canonical_online_option_uuid(entry->>'driverId'),false) OR jsonb_typeof(entry->'driverId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(entry->'sourceDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'status') IS DISTINCT FROM 'string' OR entry->>'status' NOT IN('ROUTE','UNAVAILABLE')
  OR NOT EXISTS(SELECT 1 FROM food_dispatch_rank_candidates c WHERE c.run_id=run AND c.driver_id=(entry->>'driverId')::uuid AND c.source_digest=entry->>'sourceDigest')
  OR (SELECT count(*) FROM jsonb_array_elements(payload->'results') other WHERE other->>'driverId'=entry->>'driverId')<>1 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  IF entry->>'status'='UNAVAILABLE' THEN IF entry->'durationSeconds'<>'null'::jsonb OR entry->'distanceMetres'<>'null'::jsonb THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  ELSE IF payload->>'status'='PROVIDER_UNAVAILABLE' OR jsonb_typeof(entry->'durationSeconds') IS DISTINCT FROM 'number' OR jsonb_typeof(entry->'distanceMetres') IS DISTINCT FROM 'number'
   OR (entry->>'durationSeconds')!~'^(0|[1-9][0-9]{0,5})$' OR (entry->>'distanceMetres')!~'^(0|[1-9][0-9]{0,6})$'
   OR (entry->>'durationSeconds')::numeric>86400 OR (entry->>'distanceMetres')::numeric>1000000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM food_dispatch_policy_versions WHERE id=t.policy_id;
 IF r.epoch=t.epoch AND t.mode='AUTO' AND t.offers_remaining>0 AND least(r.expires_at,t.cycle_deadline,t.absolute_deadline)>clock_timestamp() AND food_dispatch_policy_live(p.id)
 AND s.active_assignment_id IS NULL AND s.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') AND dispatch_verified_sale(s.id)
 AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers f WHERE f.shipment_id=s.id AND f.state='OFFERED' AND f.expires_at>clock_timestamp()) THEN
  IF payload->>'status'='PROVIDER_UNAVAILABLE' THEN outcome:='UNAVAILABLE';
  ELSE
   outcome:=CASE WHEN jsonb_array_length(payload->'results')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'results') e WHERE e->>'status'='ROUTE') THEN 'UNAVAILABLE' ELSE 'NO_CANDIDATE' END;
   BEGIN
    PERFORM 1 FROM driver_occupancy o WHERE o.driver_id IN(SELECT c.driver_id FROM food_dispatch_rank_candidates c WHERE c.run_id=run) ORDER BY o.driver_id FOR UPDATE NOWAIT;
   EXCEPTION WHEN lock_not_available THEN locked:=false;outcome:='STALE';END;
   IF locked THEN
   FOR entry IN SELECT value FROM jsonb_array_elements(payload->'results') WHERE value->>'status'='ROUTE' AND (value->>'durationSeconds')::integer<=p.max_pickup_seconds
   ORDER BY (value->>'durationSeconds')::integer,(value->>'distanceMetres')::integer,value->>'driverId' LOOP
    driver:=(entry->>'driverId')::uuid;
    BEGIN
     PERFORM food_dispatch_lock_candidate(driver,p.id);locked:=true;
    EXCEPTION WHEN lock_not_available THEN locked:=false;END;
    IF NOT locked THEN outcome:='STALE';CONTINUE;END IF;
    current_source:=food_dispatch_candidate(driver,p.id);
    IF current_source IS NULL OR current_source->>'sourceDigest'<>entry->>'sourceDigest' OR NOT food_dispatch_policy_live(p.id) THEN outcome:='STALE';CONTINUE;END IF;
    choice:=entry;EXIT;
   END LOOP;
   END IF;
   IF choice IS NOT NULL AND least(r.expires_at,t.cycle_deadline,t.absolute_deadline)>clock_timestamp() THEN
    BEGIN
    offer_receipt:=dispatch_create_offer_locked(s.id,(choice->>'driverId')::uuid,least(clock_timestamp()+interval '45 seconds',t.cycle_deadline,t.absolute_deadline));
    INSERT INTO food_dispatch_automatic_offers(offer_id,run_id,policy_id,epoch,driver_id,source_digest,duration_seconds,distance_metres)
    VALUES((offer_receipt->>'offerId')::uuid,run,p.id,t.epoch,(choice->>'driverId')::uuid,choice->>'sourceDigest',(choice->>'durationSeconds')::integer,(choice->>'distanceMetres')::integer);
    UPDATE food_dispatch_searches SET offers_remaining=offers_remaining-1,attention_reason=NULL,version=version+1,next_retry_at=least(clock_timestamp()+interval '45 seconds',cycle_deadline,absolute_deadline) WHERE shipment_id=s.id;
     -- Recheck after every waiting insert/event/budget operation. Exception rollback includes the entire canonical transition.
     current_source:=food_dispatch_candidate((choice->>'driverId')::uuid,p.id);
     IF least(r.expires_at,t.cycle_deadline,t.absolute_deadline)<=clock_timestamp() OR NOT food_dispatch_policy_live(p.id)
      OR current_source IS NULL OR current_source->>'sourceDigest'<>choice->>'sourceDigest' OR NOT dispatch_verified_sale(s.id)
     THEN RAISE EXCEPTION 'stale ranking publication' USING ERRCODE='P7501';END IF;
    EXCEPTION WHEN SQLSTATE 'P7501' OR SQLSTATE 'P7801' THEN offer_receipt:=NULL;choice:=NULL;outcome:='STALE';END;
    IF choice IS NOT NULL THEN outcome:='OFFERED';END IF;
   END IF;
  END IF;
 END IF;
 IF outcome IN('UNAVAILABLE','NO_CANDIDATE') THEN UPDATE food_dispatch_searches SET attention_reason=CASE WHEN outcome='UNAVAILABLE' THEN 'PROVIDER_UNAVAILABLE' ELSE 'NO_CANDIDATE' END,version=version+1,next_retry_at=least(clock_timestamp()+interval '15 seconds',cycle_deadline,absolute_deadline) WHERE shipment_id=s.id;
 ELSIF outcome='STALE' AND r.epoch=t.epoch THEN UPDATE food_dispatch_searches SET next_retry_at=least(clock_timestamp()+interval '1 second',cycle_deadline,absolute_deadline) WHERE shipment_id=s.id;END IF;
 receipt:=jsonb_build_object('status',outcome,'offerId',offer_receipt->'offerId');UPDATE food_dispatch_rank_runs SET request=payload,response=receipt WHERE id=run;RETURN receipt;
END $$;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['driver_food_service_grants','platform_staff_role_grants','platform_role_scopes'] LOOP
  EXECUTE format('CREATE TRIGGER food_realtime_wake AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION dispatch_realtime_wake()',name);
 END LOOP;
END $$;
