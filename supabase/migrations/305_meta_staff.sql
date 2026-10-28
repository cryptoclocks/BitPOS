-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Staff view of tap orders. Staff sign in with their POS account (Supabase Auth); the membership role is
-- re-read from the inherited members table on every request. Sessions are meta-owned, so the inherited
-- POS sessions table is not written. A paid tap order is handed to the customer once, by a known user.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_staff_sessions(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 token_sha256 bytea NOT NULL UNIQUE CHECK(octet_length(token_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '12 hours'),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);

ALTER TABLE meta_tap_orders ADD COLUMN handed_over_at timestamptz,ADD COLUMN handed_over_by uuid,
 ADD CHECK((handed_over_at IS NULL)=(handed_over_by IS NULL)),
 ADD CHECK(handed_over_at IS NULL OR (status='PAID' AND paid_at IS NOT NULL AND handed_over_at>=paid_at));

ALTER TABLE meta_staff_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_staff_session_tenant ON meta_staff_sessions USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_staff_sessions TO bitpos_app;
GRANT UPDATE(revoked_at) ON meta_staff_sessions TO bitpos_app;
GRANT UPDATE(handed_over_at,handed_over_by) ON meta_tap_orders TO bitpos_app;

-- The staff cookie only learns its tenant here; every check and write then runs under that tenant's RLS.
CREATE FUNCTION bitpos.meta_staff_session_merchant(p_token_sha256 bytea) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_staff_sessions WHERE token_sha256=p_token_sha256 $$;
REVOKE ALL ON FUNCTION bitpos.meta_staff_session_merchant(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_staff_session_merchant(bytea) TO bitpos_app;
