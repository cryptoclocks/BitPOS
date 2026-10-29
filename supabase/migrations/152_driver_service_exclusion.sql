-- Local candidate: one driver cannot hold food custody and an active passenger trip.
-- Both entry points lock the same occupancy row before checking the other service.
SET search_path=bitpos,public;
CREATE FUNCTION ride_food_exclusion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE driver uuid; account uuid;
BEGIN
 IF TG_TABLE_NAME='passenger_trips' THEN
  IF NEW.state NOT IN('MATCHED','ARRIVED','IN_TRIP') OR NEW.driver_account_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.driver_account_id IS NOT DISTINCT FROM NEW.driver_account_id AND OLD.state IN('MATCHED','ARRIVED','IN_TRIP') THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
  SELECT id INTO driver FROM driver_profiles WHERE account_id=NEW.driver_account_id;
  IF driver IS NULL THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE'; END IF;
  INSERT INTO driver_occupancy(driver_id) VALUES(driver) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
  IF EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_BUSY'; END IF;
 ELSE
  IF NEW.state<>'ACTIVE' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.state='ACTIVE' AND OLD.driver_id=NEW.driver_id THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
  SELECT account_id INTO account FROM driver_profiles WHERE id=NEW.driver_id;
  PERFORM 1 FROM driver_occupancy WHERE driver_id=NEW.driver_id FOR UPDATE;
  IF NOT FOUND OR account IS NULL THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE'; END IF;
  IF EXISTS(SELECT 1 FROM passenger_trips WHERE driver_account_id=account AND state IN('MATCHED','ARRIVED','IN_TRIP')) THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ride_food_exclusion() FROM PUBLIC,bitpos_app;
CREATE TRIGGER passenger_food_exclusion BEFORE INSERT OR UPDATE OF state,driver_account_id ON passenger_trips
 FOR EACH ROW EXECUTE FUNCTION ride_food_exclusion();
CREATE TRIGGER food_passenger_exclusion BEFORE INSERT OR UPDATE OF state,driver_id ON driver_assignment_leases
 FOR EACH ROW EXECUTE FUNCTION ride_food_exclusion();
