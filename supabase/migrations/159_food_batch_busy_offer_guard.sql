-- Keep a batch driver from receiving unrelated single-food offers or new batch drafts.
-- All entry points lock the same occupancy row used by ride and batch claim.
SET search_path=bitpos,public;
CREATE FUNCTION food_batch_busy_entry_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE account uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=NEW.driver_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM food_batch_leases WHERE driver_id=NEW.driver_id AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 IF TG_TABLE_NAME='food_batches' THEN
  SELECT account_id INTO account FROM driver_profiles WHERE id=NEW.driver_id;
  IF account IS NULL OR EXISTS(SELECT 1 FROM passenger_trips WHERE driver_account_id=account AND state IN('MATCHED','ARRIVED','IN_TRIP')) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 END IF;
 RETURN NEW;
END $$;
-- Trigger names sort after the member-specific guard, preserving OFFER_UNAVAILABLE for a reserved shipment.
CREATE TRIGGER zz_batch_busy_single_offer BEFORE INSERT ON food_dispatch_offers FOR EACH ROW EXECUTE FUNCTION food_batch_busy_entry_guard();
CREATE TRIGGER batch_busy_draft BEFORE INSERT ON food_batches FOR EACH ROW EXECUTE FUNCTION food_batch_busy_entry_guard();
CREATE TRIGGER batch_busy_preparation BEFORE INSERT ON food_batch_offer_preparations FOR EACH ROW EXECUTE FUNCTION food_batch_busy_entry_guard();
REVOKE ALL ON FUNCTION food_batch_busy_entry_guard() FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
