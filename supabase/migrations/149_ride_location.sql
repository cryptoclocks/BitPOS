-- Disposable-local admission only. Per-trip driver opt-in; latest point, no route history.
SET search_path TO bitpos,extensions,public;
CREATE TABLE passenger_trip_locations(
 trip_id uuid PRIMARY KEY REFERENCES passenger_trips,
 driver_account_id uuid NOT NULL REFERENCES mobile_accounts,
 enabled boolean NOT NULL DEFAULT false,
 latitude_e7 integer CHECK(latitude_e7 BETWEEN -900000000 AND 900000000),
 longitude_e7 integer CHECK(longitude_e7 BETWEEN -1800000000 AND 1800000000),
 received_at timestamptz,
 CHECK((latitude_e7 IS NULL)=(longitude_e7 IS NULL)),
 CHECK((latitude_e7 IS NULL)=(received_at IS NULL)),
 CHECK(enabled OR received_at IS NULL)
);
REVOKE ALL ON passenger_trip_locations FROM PUBLIC,bitpos_app;
ALTER TABLE passenger_trip_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE passenger_trip_locations FORCE ROW LEVEL SECURITY;
-- All writes serialize with trip completion, and derive driver identity from the trip.
CREATE FUNCTION ride_location_command(trip uuid,consent boolean,lat integer DEFAULT NULL,lng integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;t passenger_trips;
BEGIN
 SELECT * INTO t FROM passenger_trips WHERE id=trip FOR UPDATE;
 IF actor IS NULL OR t.driver_account_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 IF NOT consent THEN DELETE FROM passenger_trip_locations WHERE trip_id=trip;RETURN false;END IF;
 IF t.state<>'IN_TRIP' THEN RAISE EXCEPTION 'TRIP_STATE_CONFLICT';END IF;
 IF NOT ride_driver_approved() THEN RAISE EXCEPTION 'DRIVER_NOT_APPROVED';END IF;
 IF (lat IS NULL)<>(lng IS NULL) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF lat IS NULL THEN
  INSERT INTO passenger_trip_locations(trip_id,driver_account_id,enabled) VALUES(trip,actor,true) ON CONFLICT(trip_id) DO NOTHING;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM passenger_trip_locations WHERE trip_id=trip AND enabled) THEN RAISE EXCEPTION 'LOCATION_OPT_IN_REQUIRED';END IF;
  UPDATE passenger_trip_locations SET latitude_e7=lat,longitude_e7=lng,received_at=clock_timestamp() WHERE trip_id=trip;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION ride_location_view(trip uuid) RETURNS TABLE(enabled boolean,latitude_e7 integer,longitude_e7 integer,received_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;t passenger_trips;
BEGIN
 SELECT * INTO t FROM passenger_trips WHERE id=trip;
 IF actor IS NULL OR t.id IS NULL OR (t.rider_account_id IS DISTINCT FROM actor AND t.driver_account_id IS DISTINCT FROM actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 RETURN QUERY SELECT l.enabled,
 CASE WHEN l.received_at>clock_timestamp()-interval '60 seconds' THEN l.latitude_e7 END,
 CASE WHEN l.received_at>clock_timestamp()-interval '60 seconds' THEN l.longitude_e7 END,
 CASE WHEN l.received_at>clock_timestamp()-interval '60 seconds' THEN l.received_at END,
 CASE WHEN l.received_at>clock_timestamp()-interval '60 seconds' THEN l.received_at+interval '60 seconds' END
 FROM passenger_trip_locations l WHERE l.trip_id=trip AND t.state='IN_TRIP';
END $$;
CREATE FUNCTION ride_location_end() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NEW.state IN('COMPLETED','CANCELLED') THEN DELETE FROM passenger_trip_locations WHERE trip_id=NEW.id;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ride_location_end AFTER UPDATE OF state ON passenger_trips FOR EACH ROW EXECUTE FUNCTION ride_location_end();
-- Maintenance removes physical stale coordinates (TTL reads fail closed even if maintenance stops).
CREATE FUNCTION ride_location_purge() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE n bigint;
BEGIN
 UPDATE passenger_trip_locations SET latitude_e7=NULL,longitude_e7=NULL,received_at=NULL WHERE received_at<=clock_timestamp()-interval '60 seconds';
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
REVOKE ALL ON FUNCTION ride_location_command(uuid,boolean,integer,integer),ride_location_view(uuid),ride_location_end(),ride_location_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_location_command(uuid,boolean,integer,integer),ride_location_view(uuid) TO bitpos_app;
