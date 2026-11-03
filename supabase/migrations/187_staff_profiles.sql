-- M04: staff profile (display name, active flag, allowed daily hours) and a cashier PIN for switching user at an already signed-in POS.
-- Additive and backward compatible: a member with no profile row behaves exactly as before. Owners are never disabled or time-limited
-- (enforced in the function below and again in the API). Rollback = stop reading the table; keep it.
-- Why a SECURITY DEFINER function: `members` and `sessions` have no row-level security and the session lookup runs before any tenant is set,
-- but this table follows the tenant policy used everywhere else. The function is the one place that reads it without a tenant setting, and it
-- only answers "may this member use the POS right now" for one (merchant, user).
SET search_path=bitpos,public;

CREATE TABLE staff_profiles(
 merchant_id uuid NOT NULL REFERENCES merchants,user_id uuid NOT NULL,
 display_name text NOT NULL DEFAULT '' CHECK(octet_length(display_name)<=80),
 active boolean NOT NULL DEFAULT true,
 access_from time,access_to time,
 pin_hash text,pin_set_at timestamptz,pin_failed integer NOT NULL DEFAULT 0 CHECK(pin_failed>=0),pin_locked_until timestamptz,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid,
 PRIMARY KEY(merchant_id,user_id),FOREIGN KEY(user_id,merchant_id) REFERENCES members(user_id,merchant_id) ON DELETE CASCADE,
 CHECK((access_from IS NULL AND access_to IS NULL) OR (access_from IS NOT NULL AND access_to IS NOT NULL AND access_from<>access_to)),
 CHECK(pin_hash IS NULL OR pin_set_at IS NOT NULL)
);
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON staff_profiles FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON staff_profiles TO bitpos_app;

-- NULL = allowed. 'DISABLED' | 'OUTSIDE_HOURS'. Local time window [from,to) in the shop's zone, may cross midnight. Owners always pass.
CREATE FUNCTION staff_access_denied(p_merchant uuid,p_user uuid,p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos AS $$
 SELECT CASE
  WHEN m.role='owner' THEN NULL
  WHEN sp.user_id IS NULL THEN NULL
  WHEN NOT sp.active THEN 'DISABLED'
  WHEN sp.access_from IS NOT NULL AND NOT (CASE WHEN sp.access_from<sp.access_to
    THEN (p_at AT TIME ZONE tz.z)::time>=sp.access_from AND (p_at AT TIME ZONE tz.z)::time<sp.access_to
    ELSE (p_at AT TIME ZONE tz.z)::time>=sp.access_from OR (p_at AT TIME ZONE tz.z)::time<sp.access_to END) THEN 'OUTSIDE_HOURS'
 END
 FROM members m
 LEFT JOIN staff_profiles sp ON sp.merchant_id=m.merchant_id AND sp.user_id=m.user_id
 CROSS JOIN LATERAL(SELECT coalesce((SELECT h.time_zone FROM merchant_opening_hours h WHERE h.merchant_id=p_merchant),'Asia/Bangkok') AS z) tz
 WHERE m.merchant_id=p_merchant AND m.user_id=p_user
$$;
REVOKE ALL ON FUNCTION staff_access_denied(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_access_denied(uuid,uuid,timestamptz) TO bitpos_app;
