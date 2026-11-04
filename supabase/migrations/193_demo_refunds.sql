-- Demo-only simulated refund record. NOT a refund: no money moves, no transfer is built, the closed real refund tables are not touched.
-- It exists so a demo shop (catalog provenance 'demo_configured') can show the "refund paid order" flow on an order that was itself paid with the demo
-- payment button (payments.signature 'demo:...'). The application checks both conditions; the table only guarantees one record per order and that
-- it is insert-only. Rollback: DROP TABLE demo_refunds.
SET search_path=bitpos,public;
CREATE TABLE demo_refunds(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 order_id uuid NOT NULL,
 currency text NOT NULL,
 decimals smallint NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 120),
 refunded_by text NOT NULL,
 refunded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 simulated boolean NOT NULL DEFAULT true CHECK(simulated),
 PRIMARY KEY(merchant_id,order_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON demo_refunds FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
ALTER TABLE demo_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON demo_refunds FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON demo_refunds TO bitpos_app;
