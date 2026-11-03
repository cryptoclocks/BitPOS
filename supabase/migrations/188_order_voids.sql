-- M05: a merchant can void (cancel) an UNPAID store order with a reason. The order itself is closed by the existing closure routine
-- (reservation released once, status EXPIRED + closure_reason 'canceled'); this table only records who/why/when. Insert-only: the application
-- role has no UPDATE or DELETE, so a void record can never be edited or removed. A void is NOT a refund: paid orders cannot be voided here.
SET search_path=bitpos,public;

CREATE TABLE order_voids(
 merchant_id uuid NOT NULL REFERENCES merchants,order_id uuid NOT NULL,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 120),
 voided_by uuid NOT NULL,voided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(order_id) REFERENCES orders(id)
);
ALTER TABLE order_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON order_voids FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON order_voids TO bitpos_app;

-- Keyset paging for bill history (newest first, per shop).
CREATE INDEX orders_bill_history ON orders(merchant_id,created_at DESC,id DESC);
CREATE INDEX cash_sales_bill_history ON cash_sales(merchant_id,created_at DESC,id DESC);
