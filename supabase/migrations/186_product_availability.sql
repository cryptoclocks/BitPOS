-- M03a: per-product pause ("sell later / sold out for now") and a daily selling window. Forward-only and additive: no existing row changes
-- meaning (every product starts available all day). Rollback = stop reading the columns (the API ignores them when NULL); keep the columns.
-- A pause is NOT a stock change and never touches stock, reserved quantities, prices or issued quotes; it only decides whether a product
-- can be offered/accepted *now*. The decision lives in one SQL function so the menu, quote acceptance and the cash register agree.
SET search_path=bitpos,public;

ALTER TABLE products
 ADD COLUMN paused_at timestamptz,
 ADD COLUMN paused_until timestamptz,
 ADD COLUMN paused_by uuid,
 ADD COLUMN paused_reason text NOT NULL DEFAULT '' CHECK(octet_length(paused_reason)<=120),
 ADD COLUMN sell_from time,
 ADD COLUMN sell_to time,
 ADD COLUMN availability_revision bigint NOT NULL DEFAULT 1 CHECK(availability_revision>0),
 ADD CONSTRAINT products_sell_window_pair CHECK((sell_from IS NULL AND sell_to IS NULL) OR (sell_from IS NOT NULL AND sell_to IS NOT NULL AND sell_from<>sell_to)),
 ADD CONSTRAINT products_pause_until_after CHECK(paused_until IS NULL OR (paused_at IS NOT NULL AND paused_until>paused_at));

-- NULL = can be sold now. The window is [sell_from, sell_to) in the shop's local time and may cross midnight (sell_from > sell_to).
CREATE FUNCTION product_unavailable_reason(paused_at timestamptz,paused_until timestamptz,sell_from time,sell_to time,at timestamptz,tz text) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT CASE
  WHEN paused_at IS NOT NULL AND paused_at<=at AND (paused_until IS NULL OR paused_until>at) THEN 'PAUSED'
  WHEN sell_from IS NOT NULL AND NOT (CASE WHEN sell_from<sell_to
    THEN (at AT TIME ZONE tz)::time>=sell_from AND (at AT TIME ZONE tz)::time<sell_to
    ELSE (at AT TIME ZONE tz)::time>=sell_from OR (at AT TIME ZONE tz)::time<sell_to END) THEN 'OUTSIDE_HOURS'
 END
$$;
GRANT EXECUTE ON FUNCTION product_unavailable_reason(timestamptz,timestamptz,time,time,timestamptz,text) TO bitpos_app;
