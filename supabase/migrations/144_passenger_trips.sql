-- Passenger trip lifecycle (quote -> request -> match -> arrive -> PIN start -> complete/cancel).
-- No payment, settlement or earning is attached: a completed trip is a fact with a quoted fare,
-- not a charge. Quoting stays closed until platform staff publish a fare rate (no default rates).
SET search_path TO bitpos,extensions,public;
CREATE TABLE ride_fare_rates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),currency text NOT NULL CHECK(currency ~ '^[A-Z]{3,10}$'),decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 8),
 base_minor bigint NOT NULL CHECK(base_minor>=0),per_km_minor bigint NOT NULL CHECK(per_km_minor>=0),per_minute_minor bigint NOT NULL CHECK(per_minute_minor>=0),
 minimum_minor bigint NOT NULL CHECK(minimum_minor>=0),shared_discount_bps integer NOT NULL CHECK(shared_discount_bps BETWEEN 0 AND 9000),
 active boolean NOT NULL DEFAULT false,published_by uuid REFERENCES mobile_accounts,published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX ride_fare_rates_one_active ON ride_fare_rates((true)) WHERE active;
CREATE TABLE passenger_trips(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rider_account_id uuid NOT NULL REFERENCES mobile_accounts,driver_account_id uuid REFERENCES mobile_accounts,
 idempotency_key uuid NOT NULL,state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN('REQUESTED','MATCHED','ARRIVED','IN_TRIP','COMPLETED','CANCELLED')),
 seats smallint NOT NULL CHECK(seats BETWEEN 1 AND 6),shared boolean NOT NULL,rate_id uuid NOT NULL REFERENCES ride_fare_rates,
 currency text NOT NULL,decimals smallint NOT NULL,fare_minor bigint NOT NULL CHECK(fare_minor>0),
 distance_metres integer NOT NULL CHECK(distance_metres BETWEEN 1 AND 500000),duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 1 AND 86400),
 pickup_lat_e7 integer NOT NULL,pickup_lng_e7 integer NOT NULL,dropoff_lat_e7 integer NOT NULL,dropoff_lng_e7 integer NOT NULL,
 pin_salt text NOT NULL,pin_hash text NOT NULL,pin_attempts smallint NOT NULL DEFAULT 0 CHECK(pin_attempts BETWEEN 0 AND 3),
 version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(rider_account_id,idempotency_key),
 CHECK((state='REQUESTED')=(driver_account_id IS NULL) OR state='CANCELLED')
);
CREATE INDEX passenger_trips_open_idx ON passenger_trips(created_at) WHERE state='REQUESTED';
CREATE TABLE passenger_trip_events(
 trip_id uuid NOT NULL REFERENCES passenger_trips,seq integer NOT NULL,state text NOT NULL,actor_account_id uuid NOT NULL REFERENCES mobile_accounts,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(trip_id,seq)
);
CREATE FUNCTION passenger_trip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.rider_account_id<>OLD.rider_account_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.seats<>OLD.seats OR NEW.shared<>OLD.shared OR NEW.rate_id<>OLD.rate_id
  OR NEW.currency<>OLD.currency OR NEW.decimals<>OLD.decimals OR NEW.fare_minor<>OLD.fare_minor OR NEW.distance_metres<>OLD.distance_metres OR NEW.duration_seconds<>OLD.duration_seconds
  OR NEW.pin_salt<>OLD.pin_salt OR NEW.pin_hash<>OLD.pin_hash THEN RAISE EXCEPTION 'TRIP_IMMUTABLE_FIELD'; END IF;
 IF OLD.state IN('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'TRIP_TERMINAL'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER passenger_trips_guard BEFORE UPDATE ON passenger_trips FOR EACH ROW EXECUTE FUNCTION passenger_trip_guard();
CREATE TRIGGER passenger_trip_events_immutable BEFORE UPDATE OR DELETE ON passenger_trip_events FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
REVOKE ALL ON ride_fare_rates,passenger_trips,passenger_trip_events FROM PUBLIC,bitpos_app;
GRANT SELECT ON ride_fare_rates TO bitpos_app;
GRANT SELECT,INSERT,UPDATE ON passenger_trips TO bitpos_app;
GRANT SELECT,INSERT ON passenger_trip_events TO bitpos_app;
ALTER TABLE passenger_trips ENABLE ROW LEVEL SECURITY;ALTER TABLE passenger_trips FORCE ROW LEVEL SECURITY;
ALTER TABLE passenger_trip_events ENABLE ROW LEVEL SECURITY;ALTER TABLE passenger_trip_events FORCE ROW LEVEL SECURITY;
-- Riders and the matched driver see a trip; open requests are visible to approved drivers through the service (not by policy).
CREATE POLICY passenger_trip_party ON passenger_trips TO bitpos_app
 USING(rider_account_id::text=current_setting('bitpos.mobile_account',true) OR driver_account_id::text=current_setting('bitpos.mobile_account',true) OR (state='REQUESTED' AND current_setting('bitpos.ride_driver',true)='on'))
 WITH CHECK(rider_account_id::text=current_setting('bitpos.mobile_account',true) OR driver_account_id::text=current_setting('bitpos.mobile_account',true));
CREATE POLICY passenger_trip_event_party ON passenger_trip_events TO bitpos_app
 USING(EXISTS(SELECT 1 FROM passenger_trips t WHERE t.id=trip_id))
 WITH CHECK(actor_account_id::text=current_setting('bitpos.mobile_account',true));
-- bitpos_app cannot read driver_profiles; this answers only for the calling mobile account.
CREATE FUNCTION ride_driver_approved() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM driver_profiles WHERE account_id::text=current_setting('bitpos.mobile_account',true) AND status='APPROVED' AND verified_until>clock_timestamp() AND license_expires_at>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION ride_driver_approved() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_driver_approved() TO bitpos_app;
