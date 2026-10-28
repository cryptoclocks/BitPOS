-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Canonical server quotes and agent orders for the BitPOS Muse Connector (MCP) and the Messenger agent.
-- A quote is priced by the server from the live catalog (approved offers included) in Stripe minor units;
-- an agent can only reference it by id. One payment attempt per quote; CONFIRMED only from a Stripe
-- PaymentIntent the server created or a signed webhook, both matched to this row. Inherited orders/payments
-- tables (Solana settlement) are not altered.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_quotes(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 channel text NOT NULL CHECK(channel IN ('mcp','messenger')),
 product_id uuid NOT NULL,
 offer_id text CHECK(offer_id ~ '^(product|daily):[0-9a-f-]{36}:[A-Za-z0-9_.-]{1,80}$'),
 quantity int NOT NULL CHECK(quantity BETWEEN 1 AND 10),
 currency text NOT NULL CHECK(currency IN ('thb','usd')),
 unit_amount_minor bigint NOT NULL CHECK(unit_amount_minor>0),
 base_unit_amount_minor bigint NOT NULL CHECK(base_unit_amount_minor>=unit_amount_minor),
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=99999999),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK(amount_minor=unit_amount_minor*quantity),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);

CREATE TABLE meta_agent_orders(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 quote_id uuid NOT NULL,
 product_id uuid NOT NULL,
 quantity int NOT NULL CHECK(quantity BETWEEN 1 AND 10),
 currency text NOT NULL CHECK(currency IN ('thb','usd')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=99999999),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','FAILED','REFUNDING','CANCELLED')),
 stripe_payment_intent_id text UNIQUE CHECK(stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]{1,200}$'),
 decline_code text CHECK(char_length(decline_code)<=80),
 confirmed_at timestamptz,
 confirmed_source text CHECK(confirmed_source IN ('charge','webhook')),
 stock_short boolean NOT NULL DEFAULT false,
 stripe_refund_id text UNIQUE CHECK(stripe_refund_id ~ '^re_[A-Za-z0-9]{1,200}$'),
 cancelled_at timestamptz,
 handed_over_at timestamptz,
 handed_over_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,quote_id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES meta_quotes(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK((confirmed_at IS NULL)=(confirmed_source IS NULL)),
 CHECK(status NOT IN ('CONFIRMED','REFUNDING','CANCELLED') OR (confirmed_at IS NOT NULL AND stripe_payment_intent_id IS NOT NULL)),
 CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL AND stripe_refund_id IS NOT NULL)),
 CHECK((handed_over_at IS NULL)=(handed_over_by IS NULL)),
 CHECK(handed_over_at IS NULL OR status='CONFIRMED')
);

-- Stripe retries webhooks; each event takes effect once.
CREATE TABLE meta_agent_stripe_events(
 merchant_id uuid NOT NULL,
 event_id text NOT NULL CHECK(event_id ~ '^evt_[A-Za-z0-9]{1,200}$'),
 order_id uuid NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,event_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES meta_agent_orders(merchant_id,id)
);

ALTER TABLE meta_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_agent_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_agent_stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_quote_tenant ON meta_quotes USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_agent_order_tenant ON meta_agent_orders USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_agent_stripe_event_tenant ON meta_agent_stripe_events USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_quotes,meta_agent_orders,meta_agent_stripe_events TO bitpos_app;
GRANT UPDATE(status,stripe_payment_intent_id,decline_code,confirmed_at,confirmed_source,stock_short,stripe_refund_id,cancelled_at,handed_over_at,handed_over_by) ON meta_agent_orders TO bitpos_app;

-- Webhooks only learn which tenant an order id belongs to; checks and writes then run under that tenant's RLS.
CREATE FUNCTION bitpos.meta_agent_order_merchant(p_order_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_agent_orders WHERE id=p_order_id $$;
REVOKE ALL ON FUNCTION bitpos.meta_agent_order_merchant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_agent_order_merchant(uuid) TO bitpos_app;
