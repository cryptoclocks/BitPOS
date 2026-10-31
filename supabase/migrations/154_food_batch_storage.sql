-- Private candidate storage only. No app/worker command or assignment admission is granted.
-- Existing per-shipment leases and custody remain authoritative until a full cutover.
SET search_path=bitpos,public;
CREATE TABLE food_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,
 branch_id uuid NOT NULL,driver_id uuid NOT NULL REFERENCES driver_occupancy,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','OFFERED','ACTIVE','CANCELLED','COMPLETED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES marketplace_branches(merchant_id,id),UNIQUE(id,merchant_id,branch_id)
);
CREATE TABLE food_batch_items(
 batch_id uuid NOT NULL,merchant_id uuid NOT NULL,branch_id uuid NOT NULL,shipment_id uuid NOT NULL REFERENCES food_shipments,
 shipment_version bigint NOT NULL CHECK(shipment_version>0),shipment_generation bigint NOT NULL CHECK(shipment_generation>=0),
 position smallint NOT NULL CHECK(position BETWEEN 1 AND 3),
 PRIMARY KEY(batch_id,shipment_id),UNIQUE(batch_id,position),
 FOREIGN KEY(batch_id,merchant_id,branch_id) REFERENCES food_batches(id,merchant_id,branch_id)
);
REVOKE ALL ON food_batches,food_batch_items FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
ALTER TABLE food_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_batch_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER food_batch_item_immutable BEFORE UPDATE OR DELETE ON food_batch_items FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_batch_storage_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE target uuid; b food_batches; n integer;
BEGIN
 IF TG_TABLE_NAME='food_batches' THEN target:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target:=OLD.batch_id;
 ELSE target:=NEW.batch_id;END IF;
 SELECT * INTO b FROM food_batches WHERE id=target;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT count(*) INTO n FROM food_batch_items WHERE batch_id=target;
 IF n NOT BETWEEN 2 AND 3 OR EXISTS(
  SELECT 1 FROM food_batch_items i JOIN food_shipments s ON s.id=i.shipment_id
  JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
  WHERE i.batch_id=target AND (s.merchant_id<>b.merchant_id OR q.branch_id<>b.branch_id)
 ) THEN RAISE EXCEPTION 'BATCH_STORAGE_GRAPH' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER food_batch_storage_root AFTER INSERT OR UPDATE ON food_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_batch_storage_graph();
CREATE CONSTRAINT TRIGGER food_batch_storage_item AFTER INSERT OR UPDATE OR DELETE ON food_batch_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_batch_storage_graph();
REVOKE ALL ON FUNCTION food_batch_storage_graph() FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
