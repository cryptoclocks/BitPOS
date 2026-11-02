-- Stock taken by delivery-platform orders. The sale goes through the existing append-only stock_movements ledger (one movement per
-- order line, idempotency key channel:<order>:<line>:sale); channel_stock_effects records what was asked for versus what could be
-- taken, so a short shelf is visible rather than silently clamped. Nothing is returned automatically when an order is later
-- cancelled: whether the food can go back on the shelf is a fact only the shop knows, so the owner records it with a manual RECEIVE.
-- Rollback: DROP TABLE bitpos.channel_stock_effects; keep the ledger rows (they are immutable history).
SET search_path TO bitpos,extensions,public;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check CHECK(kind IN ('RECEIVE','ADJUST','CHANNEL_SALE'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_channel_sale_negative CHECK(kind<>'CHANNEL_SALE' OR delta<0);
CREATE TABLE channel_stock_effects(
 merchant_id uuid NOT NULL,
 order_id uuid NOT NULL,
 line_no int NOT NULL,
 product_id uuid NOT NULL,
 qty_requested int NOT NULL CHECK(qty_requested>0),
 qty_applied int NOT NULL CHECK(qty_applied>=0 AND qty_applied<=qty_requested),
 movement_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id,line_no),
 FOREIGN KEY(merchant_id,order_id,line_no) REFERENCES channel_order_lines(merchant_id,order_id,line_no),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 FOREIGN KEY(merchant_id,movement_id) REFERENCES stock_movements(merchant_id,id),
 CHECK((qty_applied>0)=(movement_id IS NOT NULL))
);
ALTER TABLE channel_stock_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON channel_stock_effects FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON channel_stock_effects TO bitpos_app;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON channel_stock_effects FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
