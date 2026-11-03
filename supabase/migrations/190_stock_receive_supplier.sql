-- M08: a stock RECEIVE can name the supplier it came from. The link is part of the immutable ledger row (set once at insert, never edited), points at the
-- same shop's supplier (composite FK on merchant_id) and is only meaningful for receipts. Suppliers are deactivated, never deleted, so history keeps its link.
SET search_path=bitpos,public;

ALTER TABLE stock_movements
 ADD COLUMN supplier_id uuid,
 ADD CONSTRAINT stock_movements_supplier_fk FOREIGN KEY(merchant_id,supplier_id) REFERENCES suppliers(merchant_id,id),
 ADD CONSTRAINT stock_movements_supplier_only_receive CHECK(supplier_id IS NULL OR kind='RECEIVE');
CREATE INDEX stock_movements_supplier ON stock_movements(merchant_id,supplier_id,created_at DESC,id DESC) WHERE supplier_id IS NOT NULL;
