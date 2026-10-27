-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Which approved offer was shown to a consented customer on a tap, who chose it (Muse Spark or the
-- deterministic fallback) and the server price at that moment. Display only: a purchase is always
-- re-quoted by the inherited catalog, so nothing here can set a price.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_offer_impressions(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 tap_session_id uuid NOT NULL,
 offer_id text NOT NULL CHECK(offer_id ~ '^(product|daily):[0-9a-f-]{36}:[A-Za-z0-9_.-]{1,80}$'),
 product_id uuid NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3,4}$'),
 decimals smallint NOT NULL CHECK(decimals IN (2,4,6)),
 base_price_minor bigint NOT NULL CHECK(base_price_minor>0),
 unit_price_minor bigint NOT NULL CHECK(unit_price_minor>0 AND unit_price_minor<base_price_minor),
 candidate_count int NOT NULL CHECK(candidate_count BETWEEN 1 AND 20),
 chosen_by text NOT NULL CHECK(chosen_by IN ('model','fallback')),
 invocation_id uuid,
 -- ASCII digits only here so the check is encoding-independent; the API also refuses Thai digits.
 reason_th text NOT NULL CHECK(length(reason_th) BETWEEN 1 AND 160 AND reason_th !~ '[0-9]'),
 reason_en text NOT NULL CHECK(length(reason_en) BETWEEN 1 AND 160 AND reason_en !~ '[0-9]'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,tap_session_id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 FOREIGN KEY(merchant_id,tap_session_id) REFERENCES meta_tap_sessions(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 FOREIGN KEY(merchant_id,invocation_id) REFERENCES meta_ai_invocations(merchant_id,id),
 CHECK((chosen_by='model')=(invocation_id IS NOT NULL))
);
CREATE INDEX meta_offer_impressions_link ON meta_offer_impressions(merchant_id,link_id,created_at DESC);

ALTER TABLE meta_offer_impressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_offer_tenant ON meta_offer_impressions USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_offer_impressions TO bitpos_app;
