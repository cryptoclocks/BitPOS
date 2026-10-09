SET search_path TO bitpos, public;
-- Explicit merchant configuration only. No offer seeds or historical repricing.
CREATE TABLE product_offers (
 merchant_id uuid NOT NULL,
 product_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
 kind text NOT NULL CHECK (kind IN ('amount','percent')),
 amount_minor bigint,
 percent smallint,
 base_minor bigint NOT NULL CHECK (base_minor > 0),
 current_minor bigint NOT NULL CHECK (current_minor > 0 AND current_minor < base_minor),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (merchant_id,product_id),
 FOREIGN KEY (merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK (
  (kind='amount' AND amount_minor IS NOT NULL AND percent IS NULL
   AND amount_minor>0 AND amount_minor<base_minor AND current_minor=base_minor-amount_minor)
  OR
  (kind='percent' AND percent IS NOT NULL AND amount_minor IS NULL AND percent BETWEEN 1 AND 99
   AND current_minor=base_minor-floor(base_minor::numeric*percent/100)::bigint)
 )
);
ALTER TABLE product_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON product_offers FOR ALL TO bitpos_app
 USING (merchant_id::text=current_setting('bitpos.merchant',true))
 WITH CHECK (merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON product_offers TO bitpos_app;
