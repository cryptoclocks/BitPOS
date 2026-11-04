-- Demo-only simulated refund record for a CASH sale (no money, no drawer movement: the real way to take a cash sale back is the existing void).
-- Application-gated to demo-catalog shops like demo_refunds (migration 193). Insert-only, one per sale. Rollback: DROP TABLE demo_cash_refunds.
SET search_path=bitpos,public;
CREATE TABLE demo_cash_refunds(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 sale_id uuid NOT NULL,
 currency text NOT NULL,
 decimals smallint NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 120),
 refunded_by text NOT NULL,
 refunded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 simulated boolean NOT NULL DEFAULT true CHECK(simulated),
 PRIMARY KEY(merchant_id,sale_id),
 FOREIGN KEY(merchant_id,sale_id) REFERENCES cash_sales(merchant_id,id)
);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON demo_cash_refunds FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
ALTER TABLE demo_cash_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON demo_cash_refunds FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON demo_cash_refunds TO bitpos_app;
