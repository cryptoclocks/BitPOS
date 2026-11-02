-- Owner-confirmed mapping from a delivery platform's item id to a BitPOS product. Names are never matched: a line is "mapped"
-- only because an owner/manager chose the product, or because the platform item id already equals one of this merchant's product ids.
CREATE TABLE channel_item_map(
 merchant_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('grabfood','lineman')),
 external_item_id text NOT NULL CHECK(char_length(external_item_id) BETWEEN 1 AND 200),
 product_id uuid NOT NULL,
 updated_by text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,source,external_item_id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
ALTER TABLE channel_item_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON channel_item_map FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON channel_item_map TO bitpos_app;
-- Lines are insert-only history except for the mapping, which may be filled in later once the owner decides.
GRANT UPDATE(mapped_product_id) ON channel_order_lines TO bitpos_app;
CREATE INDEX channel_order_lines_item ON channel_order_lines(merchant_id,external_item_id);
