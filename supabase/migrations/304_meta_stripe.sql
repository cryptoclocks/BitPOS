-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Paying for the offer shown on a tap, through Stripe (test mode). The inherited orders/payments tables
-- settle only Solana transfers, so tap purchases keep their own ledger instead of altering them.
-- The amount is re-quoted from the catalog when checkout starts; PAID is set only from a Stripe-signed
-- webhook or a server-side Stripe lookup whose amount, currency and ids match this row.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_tap_orders(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 tap_session_id uuid NOT NULL,
 offer_id text NOT NULL CHECK(offer_id ~ '^(product|daily):[0-9a-f-]{36}:[A-Za-z0-9_.-]{1,80}$'),
 product_id uuid NOT NULL,
 quantity int NOT NULL DEFAULT 1 CHECK(quantity=1),
 currency text NOT NULL CHECK(currency IN ('thb','usd')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=99999999),
 status text NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED','PAID','EXPIRED')),
 stripe_checkout_id text CHECK(stripe_checkout_id ~ '^cs_test_[A-Za-z0-9]{1,200}$'),
 checkout_url text CHECK(checkout_url ~ '^https://checkout\.stripe\.com/'),
 stripe_payment_intent_id text CHECK(stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]{1,200}$'),
 paid_at timestamptz,
 paid_source text CHECK(paid_source IN ('webhook','lookup')),
 stock_short boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 UNIQUE(stripe_checkout_id),
 UNIQUE(stripe_payment_intent_id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 FOREIGN KEY(merchant_id,tap_session_id) REFERENCES meta_tap_sessions(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour'),
 CHECK((status='PAID')=(paid_at IS NOT NULL AND paid_source IS NOT NULL AND stripe_payment_intent_id IS NOT NULL)),
 CHECK((stripe_checkout_id IS NULL)=(checkout_url IS NULL))
);
-- At most one open checkout per tap; a paid tap cannot be paid again.
CREATE UNIQUE INDEX meta_tap_order_per_tap ON meta_tap_orders(merchant_id,tap_session_id) WHERE status IN ('CREATED','PAID');

-- Stripe retries webhooks; each event takes effect once.
CREATE TABLE meta_stripe_events(
 merchant_id uuid NOT NULL,
 event_id text NOT NULL CHECK(event_id ~ '^evt_[A-Za-z0-9]{1,200}$'),
 order_id uuid,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,event_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES meta_tap_orders(merchant_id,id)
);

ALTER TABLE meta_tap_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_tap_order_tenant ON meta_tap_orders USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_stripe_event_tenant ON meta_stripe_events USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_tap_orders,meta_stripe_events TO bitpos_app;
GRANT UPDATE(status,stripe_checkout_id,checkout_url,stripe_payment_intent_id,paid_at,paid_source,stock_short) ON meta_tap_orders TO bitpos_app;

-- A Stripe webhook names the order only through metadata we wrote; this resolves its shop.
CREATE FUNCTION bitpos.meta_tap_order_merchant(p_order_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_tap_orders WHERE id=p_order_id $$;
REVOKE ALL ON FUNCTION bitpos.meta_tap_order_merchant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_tap_order_merchant(uuid) TO bitpos_app;
