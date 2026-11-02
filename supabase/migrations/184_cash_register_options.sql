-- Cash register additions: per-drink options (sweetness, paid add-ons), a unit label per product, held bills, and the drawer's opening float.
-- Everything stays inside the cash module (migration 183); the shared product contract and Solana-settled orders are untouched.
-- Rollback: DROP TABLE cash_drawer_openings, cash_held_bills, cash_addons; ALTER TABLE cash_prices DROP COLUMN unit, DROP COLUMN sweetness_enabled;
--           the new columns on cash_sale_lines are history and stay.
SET search_path TO bitpos,extensions,public;
ALTER TABLE cash_prices ADD COLUMN unit text NOT NULL DEFAULT '' CHECK(char_length(unit)<=20), ADD COLUMN sweetness_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE cash_addons(
 merchant_id uuid NOT NULL,
 product_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 label text NOT NULL CHECK(char_length(btrim(label)) BETWEEN 1 AND 40),
 label_en text NOT NULL DEFAULT '' CHECK(char_length(label_en)<=40),
 price_minor bigint NOT NULL CHECK(price_minor>=0),
 sort int NOT NULL DEFAULT 0,
 PRIMARY KEY(merchant_id,product_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
-- A sold line keeps what was chosen at the time: base price, add-ons with their prices then, and the sweetness.
ALTER TABLE cash_sale_lines ADD COLUMN unit text NOT NULL DEFAULT '', ADD COLUMN base_minor bigint,
 ADD COLUMN sweetness smallint CHECK(sweetness IS NULL OR sweetness IN(0,25,50,75,100)), ADD COLUMN addons jsonb NOT NULL DEFAULT '[]';
-- Several lines of the same product (different options) are normal, so the old one-line-per-product rule never existed in the table; line_no is the key.
CREATE TABLE cash_held_bills(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 label text NOT NULL CHECK(char_length(btrim(label)) BETWEEN 1 AND 40),
 items jsonb NOT NULL,
 discount jsonb,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id)
);
-- One opening float per sales round. A round starts at the previous shift close (or the start of the shop's day), so the key is that start.
CREATE TABLE cash_drawer_openings(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 period_start timestamptz NOT NULL,
 float_minor bigint NOT NULL CHECK(float_minor>=0),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 4),
 opened_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,period_start)
);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON cash_drawer_openings FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cash_addons','cash_held_bills','cash_drawer_openings'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON cash_addons TO bitpos_app;
GRANT SELECT,INSERT,DELETE ON cash_held_bills TO bitpos_app;
GRANT SELECT,INSERT ON cash_drawer_openings TO bitpos_app;
