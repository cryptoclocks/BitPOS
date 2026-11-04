-- M03b: (1) a price for one product on one wallet-quoted channel (counter / table QR / online) that replaces the catalog base price there,
-- (2) a per-product VAT exemption flag used by the cash register.
-- Channel prices belong to a catalog price version (the FK targets that version's catalog_prices row, so a price version without the product cannot
-- carry one) and are an insert-only history: a change is a new row with a higher revision, removing an override is a row with unit_minor NULL.
-- Nothing is ever updated or deleted, so a quote that cites an older price keeps its meaning; quotes themselves are frozen snapshots anyway.
-- Rule: explicit channel price -> base price. Catalog promotions are defined against the base price and are not applied to a product that
-- has a channel price on that channel (no stacking). The cash register keeps its own price list (cash_prices); GrabFood prices come from the platform.
-- Rollback: DROP TABLE catalog_channel_prices; ALTER TABLE products DROP COLUMN vat_exempt; ALTER TABLE cash_sale_lines DROP COLUMN vat_exempt (history is kept in audit_logs).
SET search_path=bitpos,public;

CREATE TABLE catalog_channel_prices(
 merchant_id uuid NOT NULL,
 price_version_id uuid NOT NULL,
 product_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN('counter','table','online')),
 revision bigint NOT NULL CHECK(revision>0),
 unit_minor bigint CHECK(unit_minor IS NULL OR unit_minor>0),
 set_by text NOT NULL,
 set_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,price_version_id,product_id,channel,revision),
 FOREIGN KEY(merchant_id,price_version_id,product_id) REFERENCES catalog_prices(merchant_id,price_version_id,product_id)
);
CREATE INDEX catalog_channel_prices_latest ON catalog_channel_prices(merchant_id,price_version_id,channel,product_id,revision DESC);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON catalog_channel_prices FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
ALTER TABLE catalog_channel_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON catalog_channel_prices FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON catalog_channel_prices TO bitpos_app;

ALTER TABLE products ADD COLUMN vat_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE cash_sale_lines ADD COLUMN vat_exempt boolean NOT NULL DEFAULT false;
