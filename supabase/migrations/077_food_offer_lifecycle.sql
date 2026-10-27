-- Food offer recovery; no assignment/custody release or financial effect.
SET search_path=bitpos,public;
CREATE FUNCTION food_dispatch_close_offers_locked(shipment uuid,disposition text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF disposition NOT IN('EXPIRED','WITHDRAWN') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 -- Caller holds canonical root; no offer can be accepted concurrently.
 UPDATE food_dispatch_offers SET state=disposition,version=version+1
 WHERE shipment_id=shipment AND state='OFFERED' AND (disposition='WITHDRAWN' OR expires_at<=clock_timestamp());GET DIAGNOSTICS n=ROW_COUNT;
 IF n>0 THEN
  UPDATE food_shipments SET state='READY_FOR_DISPATCH' WHERE id=shipment AND state='OFFERING' AND active_assignment_id IS NULL;
  UPDATE food_dispatch_searches SET next_retry_at=least(clock_timestamp(),cycle_deadline,absolute_deadline) WHERE shipment_id=shipment AND mode='AUTO';
  PERFORM dispatch_event(shipment,'OFFERS_'||disposition,jsonb_build_object('count',n));
 END IF;RETURN n;
END $$;
CREATE FUNCTION food_dispatch_expire_offers() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE shipment uuid;n integer:=0;
BEGIN
 PERFORM food_dispatch_search_worker();
 FOR shipment IN SELECT DISTINCT f.shipment_id FROM food_dispatch_offers f WHERE f.state='OFFERED' AND f.expires_at<=clock_timestamp() ORDER BY f.shipment_id LIMIT 16 LOOP
  PERFORM dispatch_lock_root(shipment);n:=n+food_dispatch_close_offers_locked(shipment,'EXPIRED');
 END LOOP;RETURN n;
END $$;
CREATE FUNCTION dispatch_food_decline(offer uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE f food_dispatch_offers;s food_shipments;actor uuid;driver uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;
BEGIN
 SELECT * INTO f FROM food_dispatch_offers WHERE id=offer;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(f.shipment_id);actor:=dispatch_live_actor();SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS DISTINCT FROM f.driver_id THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','generation','reason'] OR (SELECT count(*) FROM jsonb_object_keys(payload))<>4
 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR (payload->>'expectedVersion')::numeric>9223372036854775807
 OR jsonb_typeof(payload->'generation') IS DISTINCT FROM 'string' OR (payload->>'generation')!~'^[1-9][0-9]{0,18}$' OR (payload->>'generation')::numeric>9223372036854775807
 OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR payload->>'reason' NOT IN('UNAVAILABLE','DISTANCE','VEHICLE','SAFETY','OTHER') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array(offer,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'decline' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;SELECT * INTO STRICT f FROM food_dispatch_offers WHERE id=offer FOR UPDATE;PERFORM dispatch_live_actor();
 IF f.version<>(payload->>'expectedVersion')::bigint OR f.generation<>(payload->>'generation')::bigint OR s.generation<>f.generation THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF f.state<>'OFFERED' OR f.expires_at<=clock_timestamp() OR s.state<>'OFFERING' OR s.active_assignment_id IS NOT NULL THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 UPDATE food_dispatch_offers SET state='REJECTED',version=version+1 WHERE id=f.id;
 UPDATE food_shipments SET state='READY_FOR_DISPATCH' WHERE id=s.id;
 UPDATE food_dispatch_searches SET next_retry_at=least(clock_timestamp(),cycle_deadline,absolute_deadline) WHERE shipment_id=s.id AND mode='AUTO';
 PERFORM dispatch_event(s.id,'OFFER_DECLINED',jsonb_build_object('offerId',f.id,'reason',payload->>'reason'));
 receipt:=jsonb_build_object('offerId',f.id,'shipmentId',s.id,'generation',s.generation::text,'version',(f.version+1)::text,'state','REJECTED');
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'decline',digest,receipt);RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_dispatch_close_offers_locked(uuid,text),food_dispatch_expire_offers(),dispatch_food_decline(uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_search_worker;
GRANT EXECUTE ON FUNCTION food_dispatch_expire_offers() TO bitpos_food_search_worker;
GRANT EXECUTE ON FUNCTION dispatch_food_decline(uuid,jsonb) TO bitpos_app;
-- Generated takeover wrapper from exact074; regenerate, do not hand-edit.
CREATE OR REPLACE FUNCTION food_dispatch_search_command(shipment uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;t food_dispatch_searches;p food_dispatch_policy_versions;actor uuid;sponsor uuid;prior food_dispatch_search_commands;request jsonb;key uuid;at timestamptz;branch uuid;action text;receipt jsonb;
BEGIN
 s:=dispatch_lock_root(shipment);sponsor:=food_dispatch_policy_staff(s.merchant_id);actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>4 OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','action','reason']
 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false) OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string'
 OR (payload->>'expectedVersion')!~'^(0|[1-9][0-9]{0,18})$' OR (payload->>'expectedVersion')::numeric>9223372036854775807
 OR jsonb_typeof(payload->'action') IS DISTINCT FROM 'string' OR payload->>'action' NOT IN('START','RETRY','MANUAL')
 OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;action:=payload->>'action';request:=jsonb_build_array(shipment,payload);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,74));
 SELECT * INTO prior FROM food_dispatch_search_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.request<>request THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 SELECT * INTO t FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 IF coalesce(t.version,0)<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF action<>'MANUAL' AND EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED' AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
 IF food_dispatch_policy_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;PERFORM dispatch_realtime_actor();at:=clock_timestamp();
 IF action='START' THEN
  IF t.shipment_id IS NOT NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT q.branch_id INTO STRICT branch FROM quote_delivery_snapshots q WHERE q.merchant_id=s.merchant_id AND q.quote_id=s.quote_id;
  SELECT v.* INTO p FROM food_dispatch_policy_heads h JOIN food_dispatch_policy_versions v ON v.id=h.version_id WHERE h.merchant_id=s.merchant_id AND h.branch_id=branch;
  IF p.id IS NULL OR NOT food_dispatch_policy_live(p.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
  INSERT INTO food_dispatch_searches(shipment_id,policy_id,version,epoch,mode,opened_at,absolute_deadline,cycle_number,cycle_started_at,cycle_deadline,offers_remaining,next_retry_at)
  VALUES(s.id,p.id,1,1,'AUTO',at,at+make_interval(secs=>p.overall_seconds),1,at,at+make_interval(secs=>p.cycle_seconds),p.offer_budget,at) RETURNING * INTO t;
 ELSIF action='MANUAL' THEN
  IF t.shipment_id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  PERFORM food_dispatch_close_offers_locked(s.id,'WITHDRAWN');
  UPDATE food_dispatch_searches SET mode='MANUAL',attention_reason='MANUAL',version=version+1,epoch=epoch+1 WHERE shipment_id=s.id RETURNING * INTO t;
 ELSE
  IF t.shipment_id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  SELECT * INTO STRICT p FROM food_dispatch_policy_versions WHERE id=t.policy_id;
  IF NOT food_dispatch_policy_live(p.id) OR t.absolute_deadline<=at OR t.cycle_number>=p.max_cycles THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
  IF t.mode='AUTO' AND t.attention_reason IS NULL AND t.cycle_deadline>at AND t.offers_remaining>0 THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
  UPDATE food_dispatch_searches SET mode='AUTO',attention_reason=NULL,version=version+1,epoch=epoch+1,cycle_number=cycle_number+1,
   cycle_started_at=at,cycle_deadline=least(t.absolute_deadline,at+make_interval(secs=>p.cycle_seconds)),offers_remaining=p.offer_budget,next_retry_at=at
   WHERE shipment_id=s.id RETURNING * INTO t;
 END IF;
 IF action IN('START','RETRY') THEN
  INSERT INTO food_dispatch_search_cycles(shipment_id,cycle_number,epoch,started_at,deadline,offer_budget,actor_account_id,reason)
  VALUES(s.id,t.cycle_number,t.epoch,t.cycle_started_at,t.cycle_deadline,t.offers_remaining,actor,btrim(payload->>'reason'));
 END IF;
 receipt:=food_dispatch_search_value(s.id);
 INSERT INTO food_dispatch_search_commands(actor_account_id,idempotency_key,request,response) VALUES(actor,key,request,receipt);
 RETURN receipt;
END $$;
