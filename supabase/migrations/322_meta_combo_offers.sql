-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Two-item offers ("buy A and B together, X% off the pair"): Muse Spark drafts the pair, an owner or manager approves it,
-- the server applies the discount per pair in the cart price (meta-pay, Messenger, counter). On approval Muse Image may
-- generate an illustrative picture of the pair (labelled AI-generated). Offer animations (GIF) are cached here too.
SET search_path TO bitpos,extensions,public;
CREATE TABLE meta_combo_offers(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 product_a uuid NOT NULL,
 product_b uuid NOT NULL,
 discount_percent int NOT NULL CHECK(discount_percent BETWEEN 5 AND 25),
 duration_hours int NOT NULL CHECK(duration_hours BETWEEN 1 AND 24),
 reason_th text NOT NULL CHECK(char_length(reason_th) BETWEEN 1 AND 200),
 reason_en text NOT NULL CHECK(char_length(reason_en) BETWEEN 1 AND 200),
 chosen_by text NOT NULL CHECK(chosen_by IN ('model','fallback')),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','APPLIED','REJECTED','STOPPED')),
 expires_at timestamptz,
 image bytea CHECK(octet_length(image) BETWEEN 100 AND 8000000),
 image_mime text CHECK(image_mime IN ('image/png','image/jpeg','image/webp')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_by uuid,
 decided_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,product_a) REFERENCES products(merchant_id,id),
 FOREIGN KEY(merchant_id,product_b) REFERENCES products(merchant_id,id),
 CHECK(product_a<>product_b),
 CHECK((state='APPLIED')=(expires_at IS NOT NULL) OR state='STOPPED')
);
CREATE INDEX meta_combo_live ON meta_combo_offers(merchant_id,expires_at) WHERE state='APPLIED';
CREATE TABLE meta_offer_animations(
 merchant_id uuid NOT NULL REFERENCES merchants,
 cache_key text NOT NULL CHECK(cache_key ~ '^[a-z0-9:._-]{1,160}$'),
 gif bytea NOT NULL CHECK(octet_length(gif) BETWEEN 100 AND 6000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,cache_key)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['meta_combo_offers','meta_offer_animations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY %I ON %I USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t||'_tenant',t);
END LOOP; END $$;
GRANT SELECT,INSERT ON meta_combo_offers,meta_offer_animations TO bitpos_app;
GRANT UPDATE(state,expires_at,image,image_mime,decided_by,decided_at) ON meta_combo_offers TO bitpos_app;
GRANT UPDATE(gif,created_at) ON meta_offer_animations TO bitpos_app;
