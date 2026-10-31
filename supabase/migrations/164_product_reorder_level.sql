-- Optional per-product minimum stock ("reorder level"). NULL means the shop does not track a minimum for this product.
-- It only drives the owner/manager low-stock view; it never blocks or reserves anything.
SET search_path=bitpos,public;
ALTER TABLE products ADD COLUMN reorder_level integer CHECK(reorder_level IS NULL OR reorder_level BETWEEN 0 AND 100000);
