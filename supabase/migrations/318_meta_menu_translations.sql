-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Tourist mode on meta-pay: menu item names translated by Muse Spark once per language and cached. source_sha256 is
-- the English name the translation was made from, so a renamed product is translated again. Prices never come from here.
SET search_path TO bitpos,extensions,public;
CREATE TABLE meta_menu_translations(
 merchant_id uuid NOT NULL REFERENCES merchants,
 product_id uuid NOT NULL,
 lang text NOT NULL CHECK(lang IN ('ja','zh','ko','fr','de','es')),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
 source_sha256 bytea NOT NULL CHECK(octet_length(source_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,product_id,lang),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
ALTER TABLE meta_menu_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_menu_translation_tenant ON meta_menu_translations USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON meta_menu_translations TO bitpos_app;
