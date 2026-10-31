-- Private candidate integrity. No app/worker grant and no delivery lifecycle admission.
SET search_path=bitpos,public;
CREATE FUNCTION food_batch_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BATCH_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='food_batches' THEN
  IF (NEW.id,NEW.merchant_id,NEW.branch_id,NEW.driver_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.merchant_id,OLD.branch_id,OLD.driver_id,OLD.created_at) OR NEW.version<OLD.version THEN RAISE EXCEPTION 'BATCH_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='food_batch_leases' THEN
  IF (NEW.id,NEW.batch_id,NEW.driver_id,NEW.generation,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.driver_id,OLD.generation,OLD.created_at) OR OLD.state='RELEASED' OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at) THEN RAISE EXCEPTION 'BATCH_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='food_batch_legs' THEN
  IF (NEW.batch_id,NEW.shipment_id) IS DISTINCT FROM (OLD.batch_id,OLD.shipment_id) OR OLD.closed_at IS NOT NULL OR (OLD.picked_up_at IS NOT NULL AND NEW.picked_up_at IS DISTINCT FROM OLD.picked_up_at) THEN RAISE EXCEPTION 'BATCH_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_identity_guard BEFORE UPDATE OR DELETE ON food_batches FOR EACH ROW EXECUTE FUNCTION food_batch_identity_guard();
CREATE TRIGGER batch_lease_identity_guard BEFORE UPDATE OR DELETE ON food_batch_leases FOR EACH ROW EXECUTE FUNCTION food_batch_identity_guard();
CREATE TRIGGER batch_leg_identity_guard BEFORE UPDATE OR DELETE ON food_batch_legs FOR EACH ROW EXECUTE FUNCTION food_batch_identity_guard();
CREATE FUNCTION food_batch_authority_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE target uuid;b food_batches;members integer;legs integer;open_legs integer;leases integer;valid_leases integer;
BEGIN
 IF TG_TABLE_NAME='food_batches' THEN target:=NEW.id;ELSIF TG_OP='DELETE' THEN target:=OLD.batch_id;ELSE target:=NEW.batch_id;END IF;
 SELECT * INTO b FROM food_batches WHERE id=target;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT count(*) INTO members FROM food_batch_items WHERE batch_id=target;
 SELECT count(*),count(*) FILTER(WHERE closed_at IS NULL) INTO legs,open_legs FROM food_batch_legs WHERE batch_id=target;
 SELECT count(*),count(*) FILTER(WHERE l.driver_id=b.driver_id AND l.generation=o.assignment_generation) INTO leases,valid_leases FROM food_batch_leases l JOIN driver_occupancy o ON o.driver_id=l.driver_id WHERE l.batch_id=target AND l.state='ACTIVE';
 IF (b.state='ACTIVE' AND (leases<>1 OR valid_leases<>1 OR legs<>members OR open_legs=0)) OR (b.state<>'ACTIVE' AND (leases<>0 OR open_legs<>0)) OR EXISTS(SELECT 1 FROM food_batch_leases WHERE batch_id=target AND driver_id<>b.driver_id) THEN RAISE EXCEPTION 'BATCH_AUTHORITY_GRAPH' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER batch_authority_root AFTER INSERT OR UPDATE ON food_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_batch_authority_graph();
CREATE CONSTRAINT TRIGGER batch_authority_item AFTER INSERT OR UPDATE OR DELETE ON food_batch_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_batch_authority_graph();
CREATE CONSTRAINT TRIGGER batch_authority_lease AFTER INSERT OR UPDATE OR DELETE ON food_batch_leases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_batch_authority_graph();
CREATE CONSTRAINT TRIGGER batch_authority_leg AFTER INSERT OR UPDATE OR DELETE ON food_batch_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_batch_authority_graph();
REVOKE ALL ON FUNCTION food_batch_identity_guard(),food_batch_authority_graph() FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;

CREATE FUNCTION food_batch_generation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NEW.assignment_generation IS DISTINCT FROM OLD.assignment_generation AND EXISTS(SELECT 1 FROM food_batch_leases WHERE driver_id=NEW.driver_id AND state='ACTIVE') THEN RAISE EXCEPTION 'BATCH_ACTIVE_GENERATION' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_generation_guard BEFORE UPDATE OF assignment_generation ON driver_occupancy FOR EACH ROW EXECUTE FUNCTION food_batch_generation_guard();
REVOKE ALL ON FUNCTION food_batch_generation_guard() FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
