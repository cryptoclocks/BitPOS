-- Candidate draft only: no reservation, dispatch offer, custody or payment effect.
SET search_path=bitpos,public;
CREATE TABLE food_batch_draft_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,
 request jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_account_id,idempotency_key)
);
REVOKE ALL ON food_batch_draft_commands FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
ALTER TABLE food_batch_draft_commands ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER food_batch_draft_command_immutable BEFORE UPDATE OR DELETE ON food_batch_draft_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_batch_create_draft(merchant uuid,branch uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;sponsor uuid;key uuid;driver uuid;anchor uuid;entry jsonb;candidate jsonb;prior food_batch_draft_commands;batch uuid:=gen_random_uuid();receipt jsonb;ids uuid[];idx integer:=0;request jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;sponsor:=food_dispatch_policy_staff(merchant);actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT payload ?& ARRAY['idempotencyKey','driverId','items']
 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false) OR NOT coalesce(canonical_online_option_uuid(payload->>'driverId'),false)
 OR jsonb_typeof(payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF jsonb_array_length(payload->'items') NOT BETWEEN 2 AND 3 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'items') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(entry))<>3 OR NOT entry ?& ARRAY['shipmentId','version','generation']
  OR NOT coalesce(canonical_online_option_uuid(entry->>'shipmentId'),false)
  OR jsonb_typeof(entry->'version') IS DISTINCT FROM 'string' OR (entry->>'version')!~'^[1-9][0-9]{0,18}$'
  OR jsonb_typeof(entry->'generation') IS DISTINCT FROM 'string' OR (entry->>'generation')!~'^(0|[1-9][0-9]{0,18})$'
  THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  IF (entry->>'version')::numeric>9223372036854775807 OR (entry->>'generation')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  ids:=array_append(ids,(entry->>'shipmentId')::uuid);
 END LOOP;
 IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;driver:=(payload->>'driverId')::uuid;anchor:=ids[1];request:=jsonb_build_array(merchant,branch,payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('batch.draft.'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_batch_draft_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF food_dispatch_policy_staff(merchant) IS DISTINCT FROM sponsor OR dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
  RETURN prior.response;END IF;
 -- Canonical roots are acquired in deterministic order before driver occupancy.
 IF (SELECT count(*) FROM food_shipments s JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
  WHERE s.id=ANY(ids) AND s.merchant_id=merchant AND q.branch_id=branch)<>cardinality(ids) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 FOR anchor IN SELECT id FROM unnest(ids) id ORDER BY id LOOP PERFORM dispatch_lock_root(anchor);END LOOP;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
 IF NOT FOUND OR NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 FOREACH anchor IN ARRAY ids LOOP PERFORM food_driver_require_authority(driver,anchor);END LOOP;
 candidate:=food_batch_candidates(merchant,branch,ids[1]);
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'items') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'items') c WHERE c.value=entry) THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 END LOOP;
 IF food_dispatch_policy_staff(merchant) IS DISTINCT FROM sponsor OR dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SET CONSTRAINTS food_batch_storage_root,food_batch_storage_item DEFERRED;
 INSERT INTO food_batches(id,merchant_id,branch_id,driver_id) VALUES(batch,merchant,branch,driver);
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'items') LOOP
  idx:=idx+1;INSERT INTO food_batch_items(batch_id,merchant_id,branch_id,shipment_id,shipment_version,shipment_generation,position)
  VALUES(batch,merchant,branch,(entry->>'shipmentId')::uuid,(entry->>'version')::bigint,(entry->>'generation')::bigint,idx);
 END LOOP;
 SET CONSTRAINTS food_batch_storage_root,food_batch_storage_item IMMEDIATE;
 receipt:=jsonb_build_object('batchId',batch,'state','DRAFT','version','1','assignmentCreated',false,'items',payload->'items');
 INSERT INTO food_batch_draft_commands(actor_account_id,idempotency_key,request,response) VALUES(actor,key,request,receipt);
 IF food_dispatch_policy_staff(merchant) IS DISTINCT FROM sponsor OR dispatch_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 FOREACH anchor IN ARRAY ids LOOP PERFORM food_driver_require_authority(driver,anchor);END LOOP;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_batch_create_draft(uuid,uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
GRANT EXECUTE ON FUNCTION food_batch_create_draft(uuid,uuid,jsonb) TO bitpos_app;
