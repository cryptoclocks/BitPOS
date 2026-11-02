-- English shop name and address for English / bilingual cash receipts (migration 183 keeps the Thai ones).
-- Rollback: ALTER TABLE cash_settings DROP COLUMN seller_name_en, DROP COLUMN seller_address_en; sold receipts keep their own snapshot.
SET search_path TO bitpos,extensions,public;
ALTER TABLE cash_settings ADD COLUMN seller_name_en text NOT NULL DEFAULT '' CHECK(char_length(seller_name_en)<=120),
 ADD COLUMN seller_address_en text NOT NULL DEFAULT '' CHECK(char_length(seller_address_en)<=300);
