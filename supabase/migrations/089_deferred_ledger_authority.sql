-- Deferred invariant triggers run at the caller's COMMIT, after their SECURITY
-- DEFINER posting function has returned. Keep the invariant privileged, not the
-- app/worker: neither receives direct ledger SELECT or write authority.
BEGIN;
ALTER FUNCTION bitpos.draft_assert_ledger_balanced() SECURITY DEFINER;
ALTER FUNCTION bitpos.draft_assert_ledger_balanced() SET search_path=pg_catalog,bitpos,pg_temp;
REVOKE ALL ON FUNCTION bitpos.draft_assert_ledger_balanced() FROM PUBLIC,bitpos_app,bitpos_settlement_worker;
COMMIT;
