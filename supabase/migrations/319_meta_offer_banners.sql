-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Offer banners made with Muse Image from the shop's own menu photo. A banner starts PENDING and customers see it on
-- meta-pay only after an owner or manager approves it, while its offer is applied; it is always labelled AI-edited.
SET search_path TO bitpos,extensions,public;
CREATE TABLE meta_offer_banners(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL,
 product_id uuid NOT NULL,
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 image bytea NOT NULL CHECK(octet_length(image) BETWEEN 100 AND 8000000),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_by uuid,
 decided_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK((state='PENDING')=(decided_at IS NULL))
);
CREATE INDEX meta_offer_banner_product ON meta_offer_banners(merchant_id,product_id,decided_at DESC) WHERE state='APPROVED';
ALTER TABLE meta_offer_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_offer_banner_tenant ON meta_offer_banners USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_offer_banners TO bitpos_app;
GRANT UPDATE(state,decided_by,decided_at) ON meta_offer_banners TO bitpos_app;
