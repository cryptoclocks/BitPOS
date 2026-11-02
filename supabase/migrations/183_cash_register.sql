-- Cash register for shops that take cash at the counter, separate from the Solana-settled `orders` on purpose: an order may become
-- PAID only through a verified on-chain settlement, and the catalog currencies are USD/USDG with no exchange rate. Cash sales use
-- their own owner-entered price list in one currency (THB by default) and are priced, discounted, taxed and given change on the server.
-- Also: product barcodes (own table, so the shared product contract is untouched).
-- Rollback: DROP TABLE cash_sale_lines, cash_sales, cash_receipt_counters, cash_prices, cash_settings, product_barcodes; keep ledger rows.
SET search_path TO bitpos,extensions,public;

CREATE TABLE product_barcodes(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 barcode text NOT NULL CHECK(barcode~'^[0-9A-Za-z-]{4,32}$'),
 product_id uuid NOT NULL,
 created_by text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,barcode),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
CREATE INDEX product_barcodes_product ON product_barcodes(merchant_id,product_id);
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON product_barcodes FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,DELETE ON product_barcodes TO bitpos_app;

CREATE TABLE cash_settings(
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),
 enabled boolean NOT NULL DEFAULT false,
 currency text NOT NULL DEFAULT 'THB' CHECK(currency~'^[A-Z]{3}$'),
 decimals smallint NOT NULL DEFAULT 2 CHECK(decimals BETWEEN 0 AND 4),
 vat_mode text NOT NULL DEFAULT 'none' CHECK(vat_mode IN('none','inclusive')),
 vat_bps int NOT NULL DEFAULT 700 CHECK(vat_bps BETWEEN 0 AND 3000),
 seller_name text NOT NULL DEFAULT '' CHECK(char_length(seller_name)<=120),
 seller_tax_id text NOT NULL DEFAULT '' CHECK(seller_tax_id~'^([0-9]{13})?$'),
 seller_branch text NOT NULL DEFAULT '00000' CHECK(seller_branch~'^[0-9]{5}$'),
 seller_address text NOT NULL DEFAULT '' CHECK(char_length(seller_address)<=300),
 receipt_prefix text NOT NULL DEFAULT 'R' CHECK(receipt_prefix~'^[A-Z0-9]{0,6}$'),
 staff_max_discount_bps int NOT NULL DEFAULT 0 CHECK(staff_max_discount_bps BETWEEN 0 AND 9999),
 updated_by text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE cash_prices(
 merchant_id uuid NOT NULL,
 product_id uuid NOT NULL,
 price_minor bigint NOT NULL CHECK(price_minor>0),
 updated_by text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,product_id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
-- Gapless receipt numbers: the counter is bumped inside the sale's transaction, so a rolled-back sale does not consume a number.
CREATE TABLE cash_receipt_counters(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 series text NOT NULL,
 last_value bigint NOT NULL DEFAULT 0 CHECK(last_value>=0),
 PRIMARY KEY(merchant_id,series)
);
CREATE TABLE cash_sales(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 seq bigint NOT NULL,
 receipt_no text NOT NULL,
 status text NOT NULL DEFAULT 'PAID' CHECK(status IN('PAID','VOIDED')),
 currency_code text NOT NULL CHECK(currency_code~'^[A-Z]{3}$'),
 decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 4),
 subtotal_minor bigint NOT NULL CHECK(subtotal_minor>0),
 discount_minor bigint NOT NULL DEFAULT 0 CHECK(discount_minor>=0),
 total_minor bigint NOT NULL CHECK(total_minor>0),
 net_minor bigint NOT NULL CHECK(net_minor>0),
 vat_minor bigint NOT NULL DEFAULT 0 CHECK(vat_minor>=0),
 vat_mode text NOT NULL CHECK(vat_mode IN('none','inclusive')),
 vat_bps int NOT NULL,
 tender_minor bigint NOT NULL,
 change_minor bigint NOT NULL CHECK(change_minor>=0),
 cashier text NOT NULL,
 cashier_role text NOT NULL,
 seller jsonb NOT NULL,
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 voided_at timestamptz,
 voided_by text,
 void_reason text CHECK(void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 1 AND 200),
 void_restocked boolean,
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,seq),
 UNIQUE(merchant_id,receipt_no),
 UNIQUE(merchant_id,idempotency_key),
 CHECK(total_minor=subtotal_minor-discount_minor),
 CHECK(discount_minor<subtotal_minor),
 CHECK(net_minor+vat_minor=total_minor),
 CHECK(tender_minor>=total_minor AND change_minor=tender_minor-total_minor),
 CHECK((status='VOIDED')=(voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND void_restocked IS NOT NULL))
);
CREATE INDEX cash_sales_recent ON cash_sales(merchant_id,created_at DESC);
CREATE TABLE cash_sale_lines(
 merchant_id uuid NOT NULL,
 sale_id uuid NOT NULL,
 line_no int NOT NULL,
 product_id uuid NOT NULL,
 name text NOT NULL,
 name_en text NOT NULL,
 qty int NOT NULL CHECK(qty BETWEEN 1 AND 100),
 unit_minor bigint NOT NULL CHECK(unit_minor>0),
 line_total_minor bigint NOT NULL CHECK(line_total_minor=unit_minor*qty),
 PRIMARY KEY(merchant_id,sale_id,line_no),
 FOREIGN KEY(merchant_id,sale_id) REFERENCES cash_sales(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
-- A sale is history. The only permitted change is the one-way PAID -> VOIDED with who/why; lines never change.
CREATE FUNCTION cash_sales_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'cash sales cannot be deleted'; END IF;
 IF OLD.status<>'PAID' OR NEW.status<>'VOIDED'
  OR (to_jsonb(NEW)-'status'-'voided_at'-'voided_by'-'void_reason'-'void_restocked') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'voided_at'-'voided_by'-'void_reason'-'void_restocked')
 THEN RAISE EXCEPTION 'cash sale is immutable except PAID to VOIDED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_sales_guard BEFORE UPDATE OR DELETE ON cash_sales FOR EACH ROW EXECUTE FUNCTION cash_sales_guard();
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON cash_sale_lines FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check CHECK(kind IN('RECEIVE','ADJUST','CHANNEL_SALE','CASH_SALE','CASH_VOID_RETURN'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_cash_direction CHECK((kind<>'CASH_SALE' OR delta<0) AND (kind<>'CASH_VOID_RETURN' OR delta>0));

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cash_settings','cash_prices','cash_receipt_counters','cash_sales','cash_sale_lines'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON cash_settings,cash_receipt_counters TO bitpos_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON cash_prices TO bitpos_app;
GRANT SELECT,INSERT ON cash_sale_lines TO bitpos_app;
GRANT SELECT,INSERT,UPDATE ON cash_sales TO bitpos_app;
