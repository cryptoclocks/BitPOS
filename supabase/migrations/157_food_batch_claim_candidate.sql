-- Private candidate only. No app grant until individual proof, recovery and projection are complete.
SET search_path=bitpos,public;
CREATE TABLE food_batch_leases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL UNIQUE REFERENCES food_batches,
 driver_id uuid NOT NULL REFERENCES driver_occupancy,generation bigint NOT NULL CHECK(generation>0),
 state text NOT NULL CHECK(state IN('ACTIVE','RELEASED')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),released_at timestamptz,
 CHECK((state='RELEASED')=(released_at IS NOT NULL)),UNIQUE(driver_id,generation)
);
CREATE UNIQUE INDEX food_batch_driver_active ON food_batch_leases(driver_id) WHERE state='ACTIVE';
CREATE TABLE food_batch_legs(
 batch_id uuid NOT NULL,shipment_id uuid NOT NULL,state text NOT NULL CHECK(state IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT')),
 picked_up_at timestamptz,closed_at timestamptz,
 PRIMARY KEY(batch_id,shipment_id),FOREIGN KEY(batch_id,shipment_id) REFERENCES food_batch_items(batch_id,shipment_id),
 CHECK((closed_at IS NOT NULL)=(state IN('DELIVERED','RELEASED'))),CHECK(state<>'RELEASED' OR picked_up_at IS NULL)
);
CREATE UNIQUE INDEX food_batch_shipment_active ON food_batch_legs(shipment_id) WHERE closed_at IS NULL;
REVOKE ALL ON food_batch_leases,food_batch_legs FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
ALTER TABLE food_batch_leases ENABLE ROW LEVEL SECURITY;ALTER TABLE food_batch_legs ENABLE ROW LEVEL SECURITY;

-- Extend the shared occupancy fence: all three service entry paths lock the same row.
CREATE OR REPLACE FUNCTION ride_food_exclusion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE driver uuid;account uuid;
BEGIN
 IF TG_TABLE_NAME='passenger_trips' THEN
  IF NEW.state NOT IN('MATCHED','ARRIVED','IN_TRIP') OR NEW.driver_account_id IS NULL THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND OLD.driver_account_id IS NOT DISTINCT FROM NEW.driver_account_id AND OLD.state IN('MATCHED','ARRIVED','IN_TRIP') THEN RETURN NEW;END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
  SELECT id INTO driver FROM driver_profiles WHERE account_id=NEW.driver_account_id;IF driver IS NULL THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  INSERT INTO driver_occupancy(driver_id) VALUES(driver) ON CONFLICT DO NOTHING;PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
  IF EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') OR EXISTS(SELECT 1 FROM food_batch_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_BUSY';END IF;
 ELSE
  IF NEW.state<>'ACTIVE' THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND OLD.state='ACTIVE' AND OLD.driver_id=NEW.driver_id THEN RETURN NEW;END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
  SELECT account_id INTO account FROM driver_profiles WHERE id=NEW.driver_id;PERFORM 1 FROM driver_occupancy WHERE driver_id=NEW.driver_id FOR UPDATE;
  IF NOT FOUND OR account IS NULL THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  IF EXISTS(SELECT 1 FROM passenger_trips WHERE driver_account_id=account AND state IN('MATCHED','ARRIVED','IN_TRIP')) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  IF TG_TABLE_NAME='driver_assignment_leases' AND EXISTS(SELECT 1 FROM food_batch_leases WHERE driver_id=NEW.driver_id AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  IF TG_TABLE_NAME='food_batch_leases' THEN
   IF EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=NEW.driver_id AND state='ACTIVE') OR NOT EXISTS(SELECT 1 FROM food_batches b JOIN driver_occupancy o ON o.driver_id=b.driver_id WHERE b.id=NEW.batch_id AND b.driver_id=NEW.driver_id AND b.state='ACTIVE' AND o.assignment_generation=NEW.generation) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER batch_driver_exclusion BEFORE INSERT OR UPDATE OF state,driver_id ON food_batch_leases FOR EACH ROW EXECUTE FUNCTION ride_food_exclusion();

CREATE FUNCTION food_batch_single_exclusion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM food_batch_legs WHERE shipment_id=NEW.shipment_id AND closed_at IS NULL) THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_blocks_single_offer BEFORE INSERT ON food_dispatch_offers FOR EACH ROW EXECUTE FUNCTION food_batch_single_exclusion();
CREATE TRIGGER batch_blocks_single_assignment BEFORE INSERT ON food_assignments FOR EACH ROW EXECUTE FUNCTION food_batch_single_exclusion();
REVOKE ALL ON FUNCTION food_batch_single_exclusion() FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;

CREATE FUNCTION food_batch_claim_current(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 WITH rows AS MATERIALIZED(
  SELECT i.shipment_id,i.shipment_version,i.shipment_generation,s.version,s.generation,s.state,s.active_assignment_id,f.status,f.updated_at,q.currency,q.decimals,q.latitude_e7,q.longitude_e7
  FROM food_batch_items i JOIN food_shipments s ON s.id=i.shipment_id JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
  JOIN order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) WHERE i.batch_id=target
 ) SELECT (SELECT count(*) FROM rows)=(SELECT count(*) FROM food_batch_items WHERE batch_id=target)
 AND (SELECT count(*) FROM rows) BETWEEN 2 AND 3
 AND NOT EXISTS(SELECT 1 FROM rows r WHERE r.version<>r.shipment_version OR r.generation<>r.shipment_generation OR r.active_assignment_id IS NOT NULL OR r.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH') OR r.status<>'READY' OR NOT dispatch_verified_sale(r.shipment_id)
  OR EXISTS(SELECT 1 FROM food_dispatch_offers o WHERE o.shipment_id=r.shipment_id AND o.state='OFFERED' AND o.expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM food_batch_legs l WHERE l.shipment_id=r.shipment_id AND l.closed_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM rows a JOIN rows b ON a.shipment_id<b.shipment_id WHERE a.currency<>b.currency OR a.decimals<>b.decimals OR abs(extract(epoch FROM(a.updated_at-b.updated_at)))>300
  OR 12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians((a.latitude_e7::double precision-b.latitude_e7)/10000000)/2),2)+cos(radians(a.latitude_e7::double precision/10000000))*cos(radians(b.latitude_e7::double precision/10000000))*power(sin(radians((a.longitude_e7::double precision-b.longitude_e7)/10000000)/2),2)))))>2000)
$$;
REVOKE ALL ON FUNCTION food_batch_claim_current(uuid) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;

CREATE FUNCTION food_batch_claim_candidate(preparation uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE p food_batch_offer_preparations;b food_batches;actor uuid;driver uuid;entry food_batch_items;key uuid;digest text;prior food_dispatch_commands;lease uuid:=gen_random_uuid();lease_gen bigint;receipt jsonb;at timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 SELECT * INTO p FROM food_batch_offer_preparations WHERE id=preparation;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT b FROM food_batches WHERE id=p.batch_id;PERFORM 1 FROM merchants WHERE id=b.merchant_id FOR NO KEY UPDATE;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS DISTINCT FROM p.driver_id THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion'] OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (payload->>'expectedVersion')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array(preparation,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'batch-claim' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;PERFORM dispatch_realtime_actor();RETURN prior.response;END IF;
 SELECT * INTO STRICT b FROM food_batches WHERE id=p.batch_id FOR UPDATE;
 IF b.state<>'DRAFT' OR b.version<>p.batch_version OR b.version<>(payload->>'expectedVersion')::bigint OR p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 FOR entry IN SELECT * FROM food_batch_items WHERE batch_id=b.id ORDER BY shipment_id LOOP PERFORM dispatch_lock_root(entry.shipment_id);END LOOP;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;PERFORM dispatch_realtime_actor();
 IF NOT dispatch_eligible_driver(driver) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 IF NOT food_batch_claim_current(b.id) THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 FOR entry IN SELECT * FROM food_batch_items WHERE batch_id=b.id ORDER BY position LOOP
  PERFORM food_driver_require_authority(driver,entry.shipment_id);
 END LOOP;
 at:=clock_timestamp();IF p.expires_at<=at THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 UPDATE driver_occupancy SET assignment_generation=assignment_generation+1 WHERE driver_id=driver RETURNING assignment_generation INTO STRICT lease_gen;
 UPDATE food_batches SET state='ACTIVE',version=version+1 WHERE id=b.id;
 INSERT INTO food_batch_leases(id,batch_id,driver_id,generation,state,created_at) VALUES(lease,b.id,driver,lease_gen,'ACTIVE',at);
 INSERT INTO food_batch_legs(batch_id,shipment_id,state) SELECT batch_id,shipment_id,'ACCEPTED' FROM food_batch_items WHERE batch_id=b.id ORDER BY position;
 receipt:=jsonb_build_object('batchId',b.id,'leaseId',lease,'leaseGeneration',lease_gen::text,'version',(b.version+1)::text,'state','ACTIVE','shipments',(SELECT jsonb_agg(shipment_id ORDER BY position) FROM food_batch_items WHERE batch_id=b.id));
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'batch-claim',digest,receipt);
 PERFORM dispatch_realtime_actor();IF NOT dispatch_eligible_driver(driver) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 FOR entry IN SELECT * FROM food_batch_items WHERE batch_id=b.id ORDER BY position LOOP PERFORM food_driver_require_authority(driver,entry.shipment_id);END LOOP;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_batch_claim_candidate(uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;

-- Hide reserved batch members from the existing staff candidate snapshot.
CREATE OR REPLACE FUNCTION food_batch_candidates(merchant uuid,branch uuid,anchor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE sponsor uuid; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 sponsor:=food_dispatch_policy_staff(merchant);
 IF NOT EXISTS(SELECT 1 FROM branch_delivery_policies WHERE merchant_id=merchant AND branch_id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 -- A snapshot is intentionally bounded and omits recipient details and coordinates.
 -- READY's updated_at is the server-recorded ready time, not a preparation estimate.
 WITH eligible AS MATERIALIZED (
  SELECT s.id,s.version,s.generation,f.updated_at,q.currency,q.decimals,q.latitude_e7,q.longitude_e7
  FROM food_shipments s JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
  JOIN order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id)
  WHERE s.merchant_id=merchant AND q.branch_id=branch AND f.status='READY'
   AND s.active_assignment_id IS NULL AND s.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH')
   AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers o WHERE o.shipment_id=s.id AND o.state='OFFERED' AND o.expires_at>clock_timestamp())
   AND NOT EXISTS(SELECT 1 FROM food_batch_legs l WHERE l.shipment_id=s.id AND l.closed_at IS NULL)
   AND dispatch_verified_sale(s.id)
 ), root AS (SELECT * FROM eligible WHERE id=anchor), candidates AS (
  SELECT e.* FROM eligible e CROSS JOIN root r WHERE e.id<>r.id AND e.currency=r.currency AND e.decimals=r.decimals
   AND abs(extract(epoch FROM(e.updated_at-r.updated_at)))<=300
   AND 12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians((e.latitude_e7::double precision-r.latitude_e7)/10000000)/2),2)+cos(radians(e.latitude_e7::double precision/10000000))*cos(radians(r.latitude_e7::double precision/10000000))*power(sin(radians((e.longitude_e7::double precision-r.longitude_e7)/10000000)/2),2)))))<=2000
  ORDER BY e.updated_at,e.id LIMIT 50
 ), first_pick AS (SELECT * FROM candidates ORDER BY updated_at,id LIMIT 1), second_pick AS (
  SELECT c.* FROM candidates c CROSS JOIN first_pick p WHERE c.id<>p.id AND abs(extract(epoch FROM(c.updated_at-p.updated_at)))<=300
   AND 12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians((c.latitude_e7::double precision-p.latitude_e7)/10000000)/2),2)+cos(radians(c.latitude_e7::double precision/10000000))*cos(radians(p.latitude_e7::double precision/10000000))*power(sin(radians((c.longitude_e7::double precision-p.longitude_e7)/10000000)/2),2)))))<=2000
  ORDER BY c.updated_at,c.id LIMIT 1
 ), chosen AS (SELECT * FROM root UNION ALL SELECT * FROM first_pick UNION ALL SELECT * FROM second_pick)
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('shipmentId',id,'version',version::text,'generation',generation::text) ORDER BY CASE WHEN id=anchor THEN 0 ELSE 1 END,updated_at,id),'[]'::jsonb),'snapshotAt',clock_timestamp(),'assignmentCreated',false)
 INTO result FROM chosen;
 IF food_dispatch_policy_staff(merchant) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN result;
END $$;
