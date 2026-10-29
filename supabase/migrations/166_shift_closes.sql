-- Sales-round closing records (P05). A close freezes, in one immutable row, the server-computed paid totals of the period since
-- the previous close (or the start of the shop's day for the first one), who closed it, an optional counted-cash figure the
-- person declared, and a note. Nothing is reconciled against cash by the system: counted cash is a declaration, not a fact
-- the server can verify. Rows are never updated or deleted.
SET search_path TO bitpos,extensions,public;
CREATE TABLE shift_closes(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL CHECK(period_end>period_start),
 closed_by text NOT NULL,
 counted_cash_minor bigint CHECK(counted_cash_minor IS NULL OR counted_cash_minor>=0),
 cash_currency text CHECK(cash_currency IS NULL OR length(cash_currency) BETWEEN 3 AND 10),
 cash_decimals integer CHECK(cash_decimals IS NULL OR cash_decimals BETWEEN 0 AND 18),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=200),
 snapshot jsonb NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,idempotency_key),
 UNIQUE(merchant_id,period_end),
 CHECK((counted_cash_minor IS NULL)=(cash_currency IS NULL) AND (cash_currency IS NULL)=(cash_decimals IS NULL))
);
CREATE INDEX shift_closes_recent ON shift_closes(merchant_id,period_end DESC);
ALTER TABLE shift_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON shift_closes FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON shift_closes TO bitpos_app;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON shift_closes FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
