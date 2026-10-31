-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
-- Per-shop PayPal Sandbox switch. Sandbox only: live is impossible at the schema level. The payee id here is shown to the
-- merchant and must also equal the server's PAYPAL_MERCHANT_ID before any capture is accepted (two independent checks).
-- Orders keep their existing frozen quote (the core schema requires an enabled payment asset as the quote anchor);
-- PayPal is an additional way to settle that same canonical amount.
SET search_path TO bitpos,extensions,public;
CREATE TABLE paypal_merchant_settings(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,
 enabled boolean NOT NULL DEFAULT false,
 environment text NOT NULL DEFAULT 'sandbox' CHECK(environment='sandbox'),
 payee_merchant_id text NOT NULL CHECK(payee_merchant_id ~ '^[A-Z0-9]{13}$'),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 max_order_cents bigint NOT NULL DEFAULT 100000 CHECK(max_order_cents BETWEEN 100 AND 1000000),
 updated_by text NOT NULL CHECK(length(updated_by) BETWEEN 1 AND 200),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE paypal_merchant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON paypal_merchant_settings FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
-- Read-only for the app: the hackathon edition configures it by seed, not from a screen.
GRANT SELECT ON paypal_merchant_settings TO bitpos_app;
