-- Soft archive: a product leaves menus, stock lists and price publication but its row
-- stays, so past orders, offers and audit rows keep resolving. Never a hard delete.
SET search_path TO bitpos,extensions,public;
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS products_live_idx ON products(merchant_id,sort_order,id) WHERE archived_at IS NULL;
