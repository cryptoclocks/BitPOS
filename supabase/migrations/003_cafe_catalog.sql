SET search_path TO bitpos, public;
-- Existing product IDs, stock/reservations and order-item snapshots remain unchanged.
ALTER TABLE products ADD COLUMN image_url text;
ALTER TABLE products ADD COLUMN category text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN description text NOT NULL DEFAULT '';
-- Stable external catalog identity supports one idempotent import without name matching.
ALTER TABLE products ADD COLUMN catalog_key text;
CREATE UNIQUE INDEX products_catalog_key ON products(merchant_id,catalog_key) WHERE catalog_key IS NOT NULL;
