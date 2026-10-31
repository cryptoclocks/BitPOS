-- Local candidate: retain the quoted/requested route across all trip transitions.
SET search_path=bitpos,public;
CREATE OR REPLACE FUNCTION passenger_trip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.rider_account_id<>OLD.rider_account_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.seats<>OLD.seats OR NEW.shared<>OLD.shared OR NEW.rate_id<>OLD.rate_id
  OR NEW.currency<>OLD.currency OR NEW.decimals<>OLD.decimals OR NEW.fare_minor<>OLD.fare_minor OR NEW.distance_metres<>OLD.distance_metres OR NEW.duration_seconds<>OLD.duration_seconds
  OR NEW.pickup_lat_e7<>OLD.pickup_lat_e7 OR NEW.pickup_lng_e7<>OLD.pickup_lng_e7 OR NEW.dropoff_lat_e7<>OLD.dropoff_lat_e7 OR NEW.dropoff_lng_e7<>OLD.dropoff_lng_e7
  OR NEW.pin_salt<>OLD.pin_salt OR NEW.pin_hash<>OLD.pin_hash THEN RAISE EXCEPTION 'TRIP_IMMUTABLE_FIELD'; END IF;
 IF OLD.state IN('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'TRIP_TERMINAL'; END IF;
 RETURN NEW;
END $$;
