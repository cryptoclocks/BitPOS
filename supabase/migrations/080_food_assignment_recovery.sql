-- Food-domain recovery: no post-pickup release and no fabricated support/payment effects.
SET search_path=bitpos,public;
CREATE FUNCTION food_release_prepickup_locked(assignment uuid,service_gen bigint,lease_gen bigint,expected bigint,manual boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;l driver_assignment_leases;t food_dispatch_searches;at timestamptz:=clock_timestamp();
BEGIN
 -- Private caller owns canonical root, search and the complete sorted occupancy set.
 SELECT * INTO STRICT a FROM food_assignments WHERE id=assignment FOR UPDATE;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
 SELECT * INTO STRICT l FROM driver_assignment_leases WHERE id=a.lease_id FOR UPDATE;
 IF s.version<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF service_gen IS NULL OR lease_gen IS NULL OR a.generation<>service_gen OR s.generation<>service_gen OR a.lease_generation<>lease_gen
 OR s.active_assignment_id IS DISTINCT FROM a.id OR a.closed_at IS NOT NULL OR l.state<>'ACTIVE'
 OR l.food_assignment_id<>a.id OR l.driver_id<>a.driver_id OR l.generation<>lease_gen
 OR NOT EXISTS(SELECT 1 FROM driver_occupancy WHERE driver_id=a.driver_id AND assignment_generation=lease_gen)
 THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED';END IF;
 IF a.picked_up_at IS NOT NULL OR a.state NOT IN('ACCEPTED','AT_PICKUP')
 OR EXISTS(SELECT 1 FROM fulfillment_proofs WHERE assignment_id=a.id AND kind='PICKUP' AND consumed_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM order_fulfillment WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND status='COLLECTED')
 THEN RAISE EXCEPTION 'CUSTODY_RETAINED';END IF;
 IF NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 UPDATE fulfillment_proofs SET revoked_at=at,revocation_reason='PREPICKUP_RELEASED' WHERE assignment_id=a.id AND consumed_at IS NULL AND revoked_at IS NULL;
 UPDATE food_assignments SET state='RELEASED',closed_at=at WHERE id=a.id;
 UPDATE driver_assignment_leases SET state='RELEASED',released_at=at WHERE id=a.lease_id;
 UPDATE food_shipments SET state='READY_FOR_DISPATCH',active_assignment_id=NULL,generation=generation+1 WHERE id=s.id;
 UPDATE food_dispatch_searches SET version=version+1,epoch=epoch+1,mode=CASE WHEN manual THEN 'MANUAL' ELSE mode END,
 attention_reason=CASE WHEN manual OR mode='MANUAL' THEN 'MANUAL' ELSE attention_reason END,
 next_retry_at=least(absolute_deadline,cycle_deadline,greatest(next_retry_at,at)) WHERE shipment_id=s.id RETURNING * INTO t;
 PERFORM dispatch_event(s.id,'ASSIGNMENT_RELEASED',jsonb_build_object('assignmentId',a.id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text));
 SELECT * INTO STRICT s FROM food_shipments WHERE id=s.id;
 RETURN jsonb_build_object('assignmentId',a.id,'shipmentId',s.id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'shipmentGeneration',s.generation::text,'shipmentVersion',s.version::text,'state','RELEASED','searchEpoch',t.epoch::text);
END $$;
REVOKE ALL ON FUNCTION food_release_prepickup_locked(uuid,bigint,bigint,bigint,boolean) FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
CREATE FUNCTION dispatch_food_recovery(assignment uuid,payload jsonb,staff boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;actor uuid;sponsor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;replacement uuid;op text;name text;offer jsonb;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF staff THEN sponsor:=food_dispatch_policy_staff(s.merchant_id);
 ELSIF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','generation','leaseGeneration','reason']
 OR (SELECT count(*) FROM jsonb_object_keys(payload)) NOT IN(5,6) OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR payload->>'reason' NOT IN('UNAVAILABLE','VEHICLE','SAFETY','OTHER')
 OR (payload ? 'driverId' AND (NOT staff OR jsonb_typeof(payload->'driverId') IS DISTINCT FROM 'string' OR NOT coalesce(canonical_online_option_uuid(payload->>'driverId'),false)))
 OR (SELECT count(*) FROM jsonb_object_keys(payload))<>(CASE WHEN payload ? 'driverId' THEN 6 ELSE 5 END) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOREACH name IN ARRAY ARRAY['expectedVersion','generation','leaseGeneration'] LOOP
  IF jsonb_typeof(payload->name) IS DISTINCT FROM 'string' OR (payload->>name)!~'^[1-9][0-9]{0,18}$' OR (payload->>name)::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 END LOOP;
 replacement:=(payload->>'driverId')::uuid;
 IF replacement=a.driver_id THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 op:=CASE WHEN replacement IS NOT NULL THEN 'staff-reoffer' WHEN staff THEN 'staff-withdraw' ELSE 'withdraw' END;
 key:=(payload->>'idempotencyKey')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array(assignment,payload,staff)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN
  IF prior.operation<>op OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  PERFORM dispatch_realtime_actor();
  IF dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
  IF staff AND food_dispatch_policy_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
  RETURN prior.response;
 END IF;
 PERFORM 1 FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 PERFORM 1 FROM driver_occupancy WHERE driver_id IN(a.driver_id,replacement) ORDER BY driver_id FOR UPDATE;
 IF replacement IS NOT NULL AND NOT EXISTS(SELECT 1 FROM driver_occupancy WHERE driver_id=replacement) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 receipt:=food_release_prepickup_locked(a.id,(payload->>'generation')::bigint,(payload->>'leaseGeneration')::bigint,(payload->>'expectedVersion')::bigint,replacement IS NOT NULL);
 IF replacement IS NOT NULL THEN
  IF NOT dispatch_eligible_driver(replacement) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=replacement AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  offer:=dispatch_create_offer_locked(s.id,replacement,clock_timestamp()+interval '45 seconds');
 ELSE offer:=NULL;END IF;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=s.id;
 receipt:=receipt||jsonb_build_object('shipmentGeneration',s.generation::text,'shipmentVersion',s.version::text,'replacementOffer',offer);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,op,digest,receipt);
 -- Recheck live source after every potentially waiting journal/event write; rollback is atomic.
 PERFORM dispatch_realtime_actor();
 IF dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF staff AND food_dispatch_policy_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF replacement IS NOT NULL THEN PERFORM food_driver_require_authority(replacement,s.id);IF NOT dispatch_eligible_driver(replacement) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;END IF;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION dispatch_food_recovery(uuid,jsonb,boolean) FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
CREATE FUNCTION dispatch_food_withdraw(assignment uuid,payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$ SELECT dispatch_food_recovery(assignment,payload,false) $$;
CREATE FUNCTION dispatch_food_staff_recovery(assignment uuid,payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$ SELECT dispatch_food_recovery(assignment,payload,true) $$;
REVOKE ALL ON FUNCTION dispatch_food_withdraw(uuid,jsonb),dispatch_food_staff_recovery(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dispatch_food_withdraw(uuid,jsonb),dispatch_food_staff_recovery(uuid,jsonb) TO bitpos_app;

CREATE FUNCTION food_assignment_recovery_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ASSIGNMENT_HISTORY' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='food_assignments' THEN
  IF (to_jsonb(NEW)-ARRAY['state','picked_up_at','closed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','picked_up_at','closed_at'])
  OR (OLD.picked_up_at IS NOT NULL AND NEW.picked_up_at IS DISTINCT FROM OLD.picked_up_at)
  OR (OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.state IS DISTINCT FROM OLD.state))
  OR (NEW.state='RELEASED' AND NEW.picked_up_at IS NOT NULL)
  OR ((NEW.closed_at IS NOT NULL) IS DISTINCT FROM (NEW.state IN('RELEASED','DELIVERED')))
  THEN RAISE EXCEPTION 'IMMUTABLE_ASSIGNMENT_HISTORY' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','released_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','released_at'])
  OR (OLD.state='RELEASED' AND NEW IS DISTINCT FROM OLD)
  THEN RAISE EXCEPTION 'IMMUTABLE_LEASE_HISTORY' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_assignment_recovery_identity BEFORE UPDATE OR DELETE ON food_assignments FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_identity();
CREATE TRIGGER food_lease_recovery_identity BEFORE UPDATE OR DELETE ON driver_assignment_leases FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_identity();
CREATE FUNCTION food_assignment_recovery_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE target uuid;s food_shipments;a food_assignments;l driver_assignment_leases;
BEGIN
 IF TG_TABLE_NAME='food_shipments' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='food_assignments' THEN target:=NEW.shipment_id;
 ELSIF TG_TABLE_NAME='fulfillment_proofs' THEN
  SELECT shipment_id INTO target FROM food_assignments WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END;
 ELSIF TG_TABLE_NAME='driver_occupancy' THEN
  SELECT shipment_id INTO target FROM food_assignments WHERE driver_id=CASE WHEN TG_OP='DELETE' THEN OLD.driver_id ELSE NEW.driver_id END AND closed_at IS NULL;
 ELSE SELECT shipment_id INTO target FROM food_assignments WHERE id=NEW.food_assignment_id;END IF;
 IF target IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=target;
 IF s.active_assignment_id IS NOT NULL THEN
  SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
  SELECT * INTO l FROM driver_assignment_leases WHERE id=a.lease_id;
  IF a.id IS NULL OR a.shipment_id<>s.id OR a.generation<>s.generation OR a.closed_at IS NOT NULL OR a.state IN('RELEASED','DELIVERED')
  OR l.id IS NULL OR l.state<>'ACTIVE' OR l.food_assignment_id<>a.id OR l.driver_id<>a.driver_id OR l.generation<>a.lease_generation
  OR NOT EXISTS(SELECT 1 FROM driver_occupancy WHERE driver_id=a.driver_id AND assignment_generation=a.lease_generation)
  THEN RAISE EXCEPTION 'ASSIGNMENT_RECOVERY_GRAPH' USING ERRCODE='23514';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM food_assignments x JOIN driver_assignment_leases y ON y.id=x.lease_id WHERE x.shipment_id=s.id AND
  ((x.closed_at IS NULL AND (s.active_assignment_id IS DISTINCT FROM x.id OR y.state<>'ACTIVE'))
   OR (x.closed_at IS NOT NULL AND (y.state<>'RELEASED' OR y.released_at IS DISTINCT FROM x.closed_at))
   OR (x.state='RELEASED' AND (x.picked_up_at IS NOT NULL OR EXISTS(SELECT 1 FROM fulfillment_proofs p WHERE p.assignment_id=x.id AND p.kind='PICKUP' AND p.consumed_at IS NOT NULL)))))
 THEN RAISE EXCEPTION 'ASSIGNMENT_RECOVERY_GRAPH' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER food_assignment_recovery_graph AFTER INSERT OR UPDATE ON food_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_graph();
CREATE CONSTRAINT TRIGGER food_lease_recovery_graph AFTER INSERT OR UPDATE ON driver_assignment_leases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_graph();
CREATE CONSTRAINT TRIGGER food_shipment_recovery_graph AFTER INSERT OR UPDATE ON food_shipments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_graph();
CREATE CONSTRAINT TRIGGER food_proof_recovery_graph AFTER INSERT OR UPDATE OR DELETE ON fulfillment_proofs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_graph();
CREATE CONSTRAINT TRIGGER food_occupancy_recovery_graph AFTER INSERT OR UPDATE OR DELETE ON driver_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_assignment_recovery_graph();
REVOKE ALL ON FUNCTION food_assignment_recovery_identity(),food_assignment_recovery_graph() FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;

CREATE FUNCTION food_proof_recovery_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_PROOF_HISTORY' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.assignment_id,NEW.driver_id,NEW.generation,NEW.kind,NEW.secret_hash,NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.assignment_id,OLD.driver_id,OLD.generation,OLD.kind,OLD.secret_hash,OLD.expires_at)
 OR (OLD.consumed_at IS NOT NULL AND ROW(NEW.consumed_at,NEW.consumed_by) IS DISTINCT FROM ROW(OLD.consumed_at,OLD.consumed_by))
 OR (OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at,NEW.revocation_reason) IS DISTINCT FROM ROW(OLD.revoked_at,OLD.revocation_reason))
 OR NEW.attempts<OLD.attempts
 THEN RAISE EXCEPTION 'IMMUTABLE_PROOF_HISTORY' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_proof_recovery_history BEFORE UPDATE OR DELETE ON fulfillment_proofs FOR EACH ROW EXECUTE FUNCTION food_proof_recovery_history();
REVOKE ALL ON FUNCTION food_proof_recovery_history() FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
