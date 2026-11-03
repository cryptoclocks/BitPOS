-- M06: cash put into / taken out of the drawer during a round (float top-up, bank drop, paying a supplier from the till), each with a reason.
-- Insert-only history like the drawer opening and the sales: a wrong entry is answered by a new opposite entry, never by editing. A movement belongs
-- to the round that was open when it was made (period_start = the drawer opening's round) and is counted in that round's expected cash.
-- expected cash = opening float + cash sales + cash in - cash out (voided sales are not in the sales figure).
SET search_path=bitpos,public;

CREATE TABLE cash_movements(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 period_start timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN('IN','OUT')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 4),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 120),
 created_by text NOT NULL,
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,idempotency_key),
 FOREIGN KEY(merchant_id,period_start) REFERENCES cash_drawer_openings(merchant_id,period_start)
);
CREATE INDEX cash_movements_round ON cash_movements(merchant_id,period_start,created_at);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON cash_movements FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON cash_movements TO bitpos_app;
