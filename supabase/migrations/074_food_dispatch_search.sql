-- Search intent only. Existing offers/assignments remain the sole delivery lifecycle.
SET search_path=bitpos,public;
CREATE TABLE food_dispatch_searches(
 shipment_id uuid PRIMARY KEY REFERENCES food_shipments,policy_id uuid NOT NULL REFERENCES food_dispatch_policy_versions,
 version bigint NOT NULL CHECK(version>0),epoch bigint NOT NULL CHECK(epoch>0),
 mode text NOT NULL CHECK(mode IN('AUTO','MANUAL')),attention_reason text CHECK(attention_reason IN('PROVIDER_UNAVAILABLE','NO_CANDIDATE','DEADLINE','BUDGET','POLICY_UNAVAILABLE','MANUAL')),
 opened_at timestamptz NOT NULL CHECK(isfinite(opened_at)),absolute_deadline timestamptz NOT NULL CHECK(isfinite(absolute_deadline)),
 cycle_number smallint NOT NULL CHECK(cycle_number BETWEEN 1 AND 3),cycle_started_at timestamptz NOT NULL,cycle_deadline timestamptz NOT NULL,
 offers_remaining smallint NOT NULL CHECK(offers_remaining BETWEEN 0 AND 6),next_retry_at timestamptz NOT NULL,
 CHECK(opened_at<absolute_deadline),CHECK(cycle_started_at>=opened_at AND cycle_started_at<cycle_deadline AND cycle_deadline<=absolute_deadline)
);
CREATE TABLE food_dispatch_search_cycles(
 shipment_id uuid NOT NULL REFERENCES food_dispatch_searches,cycle_number smallint NOT NULL CHECK(cycle_number BETWEEN 1 AND 3),
 epoch bigint NOT NULL CHECK(epoch>0),started_at timestamptz NOT NULL,deadline timestamptz NOT NULL,offer_budget smallint NOT NULL CHECK(offer_budget BETWEEN 1 AND 6),
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 PRIMARY KEY(shipment_id,cycle_number),UNIQUE(shipment_id,epoch),CHECK(started_at<deadline)
);
CREATE TABLE food_dispatch_search_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,request jsonb NOT NULL,response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,idempotency_key)
);
DO $$DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['food_dispatch_searches','food_dispatch_search_cycles','food_dispatch_search_commands'] LOOP
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker',n);EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);END LOOP;
END $$;
CREATE TRIGGER food_search_cycle_immutable BEFORE UPDATE OR DELETE ON food_dispatch_search_cycles FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER food_search_command_immutable BEFORE UPDATE OR DELETE ON food_dispatch_search_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_dispatch_search_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.shipment_id,NEW.policy_id,NEW.opened_at,NEW.absolute_deadline) IS DISTINCT FROM (OLD.shipment_id,OLD.policy_id,OLD.opened_at,OLD.absolute_deadline)
 THEN RAISE EXCEPTION 'immutable search window' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER food_search_identity BEFORE UPDATE OR DELETE ON food_dispatch_searches FOR EACH ROW EXECUTE FUNCTION food_dispatch_search_identity();
CREATE FUNCTION food_dispatch_search_value(shipment uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('shipmentId',s.shipment_id,'policyId',s.policy_id,'version',s.version::text,'epoch',s.epoch::text,'mode',s.mode,
 'attentionReason',CASE WHEN s.mode='MANUAL' THEN 'MANUAL' WHEN NOT food_dispatch_policy_live(s.policy_id) THEN 'POLICY_UNAVAILABLE'
 WHEN s.absolute_deadline<=clock_timestamp() OR s.cycle_deadline<=clock_timestamp() THEN 'DEADLINE' WHEN s.offers_remaining=0 THEN 'BUDGET' ELSE s.attention_reason END,
 'openedAt',s.opened_at,'absoluteDeadline',s.absolute_deadline,'cycleNumber',s.cycle_number,'cycleStartedAt',s.cycle_started_at,'cycleDeadline',s.cycle_deadline,
 'offersRemaining',s.offers_remaining,'nextRetryAt',s.next_retry_at,
 'cycles',(SELECT coalesce(jsonb_agg(jsonb_build_object('cycleNumber',c.cycle_number,'epoch',c.epoch::text,'startedAt',c.started_at,'deadline',c.deadline,'offerBudget',c.offer_budget,'reason',c.reason) ORDER BY c.cycle_number),'[]'::jsonb) FROM food_dispatch_search_cycles c WHERE c.shipment_id=s.shipment_id))
 FROM food_dispatch_searches s WHERE s.shipment_id=shipment
$$;
CREATE FUNCTION food_dispatch_search_snapshot(shipment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;
BEGIN
 s:=dispatch_lock_root(shipment);PERFORM food_dispatch_policy_staff(s.merchant_id);RETURN jsonb_build_object('shipmentId',s.id,'search',food_dispatch_search_value(s.id));
END $$;
CREATE FUNCTION food_dispatch_search_command(shipment uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
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
 IF EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED' AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
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
REVOKE ALL ON FUNCTION food_dispatch_search_identity(),food_dispatch_search_value(uuid),food_dispatch_search_snapshot(uuid),food_dispatch_search_command(uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker;
GRANT EXECUTE ON FUNCTION food_dispatch_search_snapshot(uuid),food_dispatch_search_command(uuid,jsonb) TO bitpos_app;
