-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- AI auto-pay allowance: a consented Messenger customer lets the shop's AI (the chat agent, or their own agent through
-- the Muse Connector with a one-time key) pay for them for 1, 7, 30 or 90 days, within a per-order and a total cap,
-- with a card saved through Stripe Checkout (setup mode). The server checks the allowance and charges off-session;
-- PAID still comes only from the PaymentIntent the server created (checked) or a signed webhook. Stopping is immediate.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_autopay_grants(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'SETUP' CHECK(status IN ('SETUP','ACTIVE','REVOKED')),
 days integer NOT NULL CHECK(days IN (1,7,30,90)),
 currency text NOT NULL CHECK(currency IN ('usd','thb')),
 per_order_max_minor bigint NOT NULL CHECK(per_order_max_minor BETWEEN 50 AND 100000),
 total_max_minor bigint NOT NULL CHECK(total_max_minor BETWEEN per_order_max_minor AND 1000000),
 stripe_customer_id text CHECK(stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,200}$'),
 stripe_setup_session_id text UNIQUE CHECK(stripe_setup_session_id ~ '^cs_test_[A-Za-z0-9]{1,200}$'),
 setup_url text CHECK(setup_url ~ '^https://checkout\.stripe\.com/'),
 stripe_payment_method_id text CHECK(stripe_payment_method_id ~ '^pm_[A-Za-z0-9]{1,200}$'),
 card_label text CHECK(char_length(card_label)<=40),
 agent_key_sha256 bytea UNIQUE CHECK(octet_length(agent_key_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 activated_at timestamptz,
 expires_at timestamptz,
 revoked_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 CHECK((activated_at IS NULL)=(expires_at IS NULL)),
 CHECK(expires_at IS NULL OR expires_at=activated_at+make_interval(days=>days)),
 CHECK(status<>'ACTIVE' OR (activated_at IS NOT NULL AND stripe_customer_id IS NOT NULL AND stripe_payment_method_id IS NOT NULL)),
 CHECK((status='REVOKED')=(revoked_at IS NOT NULL))
);
-- One live allowance per customer; a new one replaces the old.
CREATE UNIQUE INDEX meta_autopay_one_active ON meta_autopay_grants(merchant_id,link_id) WHERE status='ACTIVE';
ALTER TABLE meta_autopay_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON meta_autopay_grants FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_autopay_grants TO bitpos_app;
GRANT UPDATE(status,stripe_customer_id,stripe_setup_session_id,setup_url,stripe_payment_method_id,card_label,agent_key_sha256,activated_at,expires_at,revoked_at) ON meta_autopay_grants TO bitpos_app;

-- Orders paid under an allowance; the column is cleared if the off-session charge is declined (the customer then pays by hand).
ALTER TABLE meta_cart_orders ADD COLUMN autopay_grant_id uuid;
ALTER TABLE meta_cart_orders ADD CONSTRAINT meta_cart_orders_autopay_fk FOREIGN KEY(merchant_id,autopay_grant_id) REFERENCES meta_autopay_grants(merchant_id,id);
CREATE INDEX meta_cart_orders_autopay ON meta_cart_orders(merchant_id,autopay_grant_id) WHERE autopay_grant_id IS NOT NULL;
ALTER TABLE meta_agent_orders ADD COLUMN autopay_grant_id uuid;
ALTER TABLE meta_agent_orders ADD CONSTRAINT meta_agent_orders_autopay_fk FOREIGN KEY(merchant_id,autopay_grant_id) REFERENCES meta_autopay_grants(merchant_id,id);
CREATE INDEX meta_agent_orders_autopay ON meta_agent_orders(merchant_id,autopay_grant_id) WHERE autopay_grant_id IS NOT NULL;
GRANT UPDATE(autopay_grant_id) ON meta_cart_orders TO bitpos_app;
GRANT UPDATE(autopay_grant_id) ON meta_agent_orders TO bitpos_app;

-- A cart paid by the server's own off-session PaymentIntent (checked amount, currency and metadata).
ALTER TABLE meta_cart_orders DROP CONSTRAINT meta_cart_orders_paid_source_check;
ALTER TABLE meta_cart_orders ADD CONSTRAINT meta_cart_orders_paid_source_check CHECK(paid_source IN ('webhook','lookup','charge'));

-- The Stripe return page knows only the allowance id.
CREATE FUNCTION bitpos.meta_autopay_grant_merchant(p_grant_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_autopay_grants WHERE id=p_grant_id $$;
REVOKE ALL ON FUNCTION bitpos.meta_autopay_grant_merchant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_autopay_grant_merchant(uuid) TO bitpos_app;
