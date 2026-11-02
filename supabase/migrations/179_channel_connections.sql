-- Owner-entered credentials for a delivery-platform order channel (GrabFood, LINE MAN). One row per merchant/source/environment.
-- Secrets are stored ONLY as AES-256-GCM ciphertext written by the API (key derived from the server secret, merchant/source/environment
-- bound as AAD); the API never returns them. Saving credentials does NOT mean the provider accepted them: state stays
-- 'credentials_saved' (unverified) until a provider sandbox call proves otherwise. No provider capability is enabled by this table.
-- Rollback: DROP TABLE bitpos.channel_events, bitpos.channel_order_lines, bitpos.channel_orders; DROP TABLE bitpos.channel_settings; DROP TABLE bitpos.channel_connections;
SET search_path TO bitpos,extensions,public;
CREATE TABLE channel_connections(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 source text NOT NULL CHECK(source IN ('grabfood','lineman')),
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 state text NOT NULL DEFAULT 'credentials_saved' CHECK(state IN ('credentials_saved','linked','disconnected','revoked')),
 external_store_id text NOT NULL DEFAULT '' CHECK(char_length(external_store_id)<=120),
 client_id text NOT NULL DEFAULT '' CHECK(char_length(client_id)<=200),
 secret_ciphertext text NOT NULL DEFAULT '',
 has_client_secret boolean NOT NULL DEFAULT false,
 has_webhook_secret boolean NOT NULL DEFAULT false,
 last_check_at timestamptz,
 last_check_result text NOT NULL DEFAULT '' CHECK(char_length(last_check_result)<=80),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,source,environment)
);
ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON channel_connections FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON channel_connections TO bitpos_app;
-- Which environment BitPOS talks to for a provider. Always starts as sandbox; production needs an explicit owner action (API checks
-- that production credentials exist and the owner confirmed).
CREATE TABLE channel_settings(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 source text NOT NULL CHECK(source IN ('grabfood','lineman')),
 active_environment text NOT NULL DEFAULT 'sandbox' CHECK(active_environment IN ('sandbox','production')),
 last_sync_at timestamptz,
 last_sync_result text NOT NULL DEFAULT '' CHECK(char_length(last_sync_result)<=80),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,source)
);
ALTER TABLE channel_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON channel_settings FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON channel_settings TO bitpos_app;

-- Orders that originate on a delivery platform. They are NOT rows of `orders` (those are tied to a Solana quote/USDG amount).
-- Money is the provider's own integer minor units and currency; nothing is converted. payment_collector says who took the money and
-- settlement_state is a separate fact: platform-collected money is only 'receivable' until the provider says otherwise.
CREATE TABLE channel_orders(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK(source IN ('grabfood','lineman')),
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 external_order_id text NOT NULL CHECK(char_length(external_order_id) BETWEEN 1 AND 120),
 external_store_id text NOT NULL,
 short_number text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('received','accept_pending','accepted','preparing','ready','handed_over','completed','reject_pending','rejected','cancelled','expired','needs_attention')),
 raw_status text NOT NULL DEFAULT '',
 payment_type text NOT NULL DEFAULT '',
 payment_collector text NOT NULL CHECK(payment_collector IN ('platform','cash_on_pickup')),
 settlement_state text NOT NULL CHECK(settlement_state IN ('not_applicable','receivable','settled','disputed')),
 currency_code text NOT NULL CHECK(currency_code~'^[A-Z]{3}$'),
 currency_exponent smallint NOT NULL CHECK(currency_exponent BETWEEN 0 AND 4),
 subtotal_minor bigint NOT NULL CHECK(subtotal_minor>=0),
 total_minor bigint,
 customer_paid_minor bigint,
 net_earning_minor bigint,
 order_time timestamptz NOT NULL,
 scheduled_time timestamptz,
 snapshot jsonb NOT NULL,
 pending_command text CHECK(pending_command IN ('accept','reject','ready')),
 last_command_error text NOT NULL DEFAULT '' CHECK(char_length(last_command_error)<=80),
 first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,source,environment,external_order_id)
);
CREATE INDEX channel_orders_recent ON channel_orders(merchant_id,source,first_seen_at DESC);
CREATE FUNCTION channel_orders_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN RAISE EXCEPTION 'channel order snapshot is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER channel_orders_snapshot_immutable BEFORE UPDATE ON channel_orders FOR EACH ROW EXECUTE FUNCTION channel_orders_snapshot_immutable();
CREATE TABLE channel_order_lines(
 merchant_id uuid NOT NULL,
 order_id uuid NOT NULL,
 line_no int NOT NULL,
 external_item_id text NOT NULL,
 qty int NOT NULL CHECK(qty>0),
 unit_minor bigint NOT NULL,
 tax_minor bigint NOT NULL DEFAULT 0,
 note text NOT NULL DEFAULT '',
 modifiers jsonb NOT NULL DEFAULT '[]',
 mapped_product_id uuid,
 PRIMARY KEY(merchant_id,order_id,line_no),
 FOREIGN KEY(merchant_id,order_id) REFERENCES channel_orders(merchant_id,id),
 FOREIGN KEY(merchant_id,mapped_product_id) REFERENCES products(merchant_id,id)
);
-- One row per distinct provider event; the primary key is the dedupe. Raw provider payload is kept for reconciliation.
CREATE TABLE channel_events(
 merchant_id uuid NOT NULL,
 event_key text NOT NULL,
 order_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('poll','command')),
 raw_status text NOT NULL DEFAULT '',
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,event_key),
 FOREIGN KEY(merchant_id,order_id) REFERENCES channel_orders(merchant_id,id)
);
ALTER TABLE channel_orders ENABLE ROW LEVEL SECURITY;ALTER TABLE channel_order_lines ENABLE ROW LEVEL SECURITY;ALTER TABLE channel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON channel_orders FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY tenant_access ON channel_order_lines FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY tenant_access ON channel_events FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON channel_orders TO bitpos_app;GRANT SELECT,INSERT ON channel_order_lines,channel_events TO bitpos_app;
