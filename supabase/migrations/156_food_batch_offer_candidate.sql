-- Private offer preparation. It does not reserve work, notify a driver or expose a claim.
-- No app/worker grant until atomic multi-shipment claim and recovery are implemented.
SET search_path=bitpos,public;
CREATE TABLE food_batch_offer_preparations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES food_batches,
 batch_version bigint NOT NULL CHECK(batch_version>0),driver_id uuid NOT NULL REFERENCES driver_occupancy,
 prepared_by uuid NOT NULL REFERENCES mobile_accounts,prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>prepared_at),
 UNIQUE(batch_id,batch_version)
);
REVOKE ALL ON food_batch_offer_preparations FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
ALTER TABLE food_batch_offer_preparations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER food_batch_offer_preparation_immutable BEFORE UPDATE OR DELETE ON food_batch_offer_preparations FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_batch_prepare_offer(batch uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b food_batches;actor uuid;sponsor uuid;key uuid;prior food_batch_draft_commands;request jsonb;candidate jsonb;entry food_batch_items;offer uuid:=gen_random_uuid();receipt jsonb;at timestamptz;account uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 SELECT * INTO b FROM food_batches WHERE id=batch;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM 1 FROM merchants WHERE id=b.merchant_id FOR NO KEY UPDATE;sponsor:=food_dispatch_policy_staff(b.merchant_id);actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion']
 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (payload->>'expectedVersion')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;request:=jsonb_build_array('prepare-offer',batch,payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('batch.draft.'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_batch_draft_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF food_dispatch_policy_staff(b.merchant_id) IS DISTINCT FROM sponsor OR dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;RETURN prior.response;END IF;
 SELECT * INTO STRICT b FROM food_batches WHERE id=batch FOR UPDATE;
 IF b.state<>'DRAFT' OR b.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM food_batch_offer_preparations p WHERE p.batch_id=b.id AND p.batch_version=b.version) THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
 FOR entry IN SELECT * FROM food_batch_items WHERE batch_id=batch ORDER BY shipment_id LOOP PERFORM dispatch_lock_root(entry.shipment_id);END LOOP;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=b.driver_id FOR UPDATE;
 SELECT account_id INTO account FROM driver_profiles WHERE id=b.driver_id;
 IF account IS NULL OR NOT dispatch_eligible_driver(b.driver_id) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=b.driver_id AND state='ACTIVE')
 OR EXISTS(SELECT 1 FROM passenger_trips WHERE driver_account_id=account AND state IN('MATCHED','ARRIVED','IN_TRIP')) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 SELECT * INTO STRICT entry FROM food_batch_items WHERE batch_id=batch AND position=1;
 candidate:=food_batch_candidates(b.merchant_id,b.branch_id,entry.shipment_id);
 FOR entry IN SELECT * FROM food_batch_items WHERE batch_id=batch ORDER BY position LOOP
  PERFORM food_driver_require_authority(b.driver_id,entry.shipment_id);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'items') c WHERE c.value=jsonb_build_object('shipmentId',entry.shipment_id,'version',entry.shipment_version::text,'generation',entry.shipment_generation::text)) THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 END LOOP;
 IF food_dispatch_policy_staff(b.merchant_id) IS DISTINCT FROM sponsor OR dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 at:=clock_timestamp();INSERT INTO food_batch_offer_preparations(id,batch_id,batch_version,driver_id,prepared_by,prepared_at,expires_at) VALUES(offer,b.id,b.version,b.driver_id,actor,at,at+interval '45 seconds');
 receipt:=jsonb_build_object('preparationId',offer,'batchId',b.id,'batchVersion',b.version::text,'expiresAt',at+interval '45 seconds','driverNotified',false,'assignmentCreated',false);
 INSERT INTO food_batch_draft_commands(actor_account_id,idempotency_key,request,response) VALUES(actor,key,request,receipt);
 IF food_dispatch_policy_staff(b.merchant_id) IS DISTINCT FROM sponsor OR dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF NOT dispatch_eligible_driver(b.driver_id) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=b.driver_id AND state='ACTIVE')
 OR EXISTS(SELECT 1 FROM passenger_trips WHERE driver_account_id=account AND state IN('MATCHED','ARRIVED','IN_TRIP')) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 FOR entry IN SELECT * FROM food_batch_items WHERE batch_id=batch ORDER BY position LOOP PERFORM food_driver_require_authority(b.driver_id,entry.shipment_id);END LOOP;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_batch_prepare_offer(uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
