-- Merchant weekly opening hours (P36). One revisioned row per merchant; the
-- week is validated by the API (same-day windows, no overlap). Rollback: stop
-- the settings route; the row is configuration only and may be kept.
SET search_path TO bitpos,extensions,public;
CREATE TABLE merchant_opening_hours(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,
 time_zone text NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 64),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 week jsonb NOT NULL CHECK(jsonb_typeof(week)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE merchant_opening_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON merchant_opening_hours FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON merchant_opening_hours TO bitpos_app;
