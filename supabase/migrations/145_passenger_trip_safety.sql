-- Passenger safety: expiring/revocable share links and incident reports. A share link exposes
-- only trip state and last update to whoever holds the token (stored as a hash); incidents are
-- append-only reports by either party. No support workflow or payout is attached here.
SET search_path TO bitpos,extensions,public;
CREATE TABLE passenger_trip_shares(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trip_id uuid NOT NULL REFERENCES passenger_trips,created_by uuid NOT NULL REFERENCES mobile_accounts,
 token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE passenger_trip_incidents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trip_id uuid NOT NULL REFERENCES passenger_trips,reporter_account_id uuid NOT NULL REFERENCES mobile_accounts,
 idempotency_key uuid NOT NULL,kind text NOT NULL CHECK(kind IN('SAFETY','CONDUCT','FARE','OTHER')),body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(reporter_account_id,idempotency_key)
);
CREATE TRIGGER passenger_trip_incidents_immutable BEFORE UPDATE OR DELETE ON passenger_trip_incidents FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
REVOKE ALL ON passenger_trip_shares,passenger_trip_incidents FROM PUBLIC,bitpos_app;
GRANT SELECT,INSERT,UPDATE ON passenger_trip_shares TO bitpos_app;
GRANT SELECT,INSERT ON passenger_trip_incidents TO bitpos_app;
ALTER TABLE passenger_trip_shares ENABLE ROW LEVEL SECURITY;ALTER TABLE passenger_trip_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE passenger_trip_incidents ENABLE ROW LEVEL SECURITY;ALTER TABLE passenger_trip_incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY passenger_share_owner ON passenger_trip_shares TO bitpos_app
 USING(created_by::text=current_setting('bitpos.mobile_account',true)) WITH CHECK(created_by::text=current_setting('bitpos.mobile_account',true));
CREATE POLICY passenger_incident_party ON passenger_trip_incidents TO bitpos_app
 USING(EXISTS(SELECT 1 FROM passenger_trips t WHERE t.id=trip_id)) WITH CHECK(reporter_account_id::text=current_setting('bitpos.mobile_account',true));
-- Anyone holding a live token may read trip state only; the function returns nothing for unknown, expired or revoked tokens.
CREATE FUNCTION ride_share_view(token_digest text) RETURNS TABLE(state text,updated_at timestamptz,expires_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT t.state,t.updated_at,s.expires_at FROM passenger_trip_shares s JOIN passenger_trips t ON t.id=s.trip_id
 WHERE s.token_hash=token_digest AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp();
$$;
REVOKE ALL ON FUNCTION ride_share_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_share_view(text) TO bitpos_app;
