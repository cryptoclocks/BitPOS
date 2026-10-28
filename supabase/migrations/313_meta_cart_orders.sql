-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Multi-item orders for meta-pay (ordering at the table or on the web) and meta-pos (counter sale shown as a Stripe
-- QR). The server prices every line from the live catalog and approved offers; the total is fixed when the order is
-- made and paid only through a signed Stripe webhook or a server-side Checkout lookup. Stock is taken once per line
-- and recorded in meta_stock_movements. The inherited orders tables are not used.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_cart_orders(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 channel text NOT NULL CHECK(channel IN ('table','counter','web')),
 table_id uuid,
 link_id uuid,
 access_sha256 bytea NOT NULL CHECK(octet_length(access_sha256)=32),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CANCELLED','EXPIRED')),
 currency text NOT NULL CHECK(currency IN ('usd','thb')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 discount_minor bigint NOT NULL DEFAULT 0 CHECK(discount_minor>=0),
 stripe_checkout_id text UNIQUE CHECK(stripe_checkout_id ~ '^cs_test_[A-Za-z0-9]{1,200}$'),
 checkout_url text CHECK(checkout_url ~ '^https://checkout\.stripe\.com/'),
 stripe_payment_intent_id text CHECK(stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]{1,200}$'),
 paid_at timestamptz,
 paid_source text CHECK(paid_source IN ('webhook','lookup')),
 stock_short boolean NOT NULL DEFAULT false,
 handed_over_at timestamptz,
 handed_over_by uuid,
 stripe_refund_id text UNIQUE CHECK(stripe_refund_id ~ '^re_[A-Za-z0-9]{1,200}$'),
 cancelled_at timestamptz,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 CHECK(expires_at>created_at),
 CHECK((status='PAID')=(paid_at IS NOT NULL AND paid_source IS NOT NULL AND stripe_payment_intent_id IS NOT NULL) OR status='CANCELLED'),
 CHECK(handed_over_at IS NULL OR status='PAID'),
 CHECK((channel='counter')=(created_by IS NOT NULL))
);
CREATE INDEX meta_cart_order_recent ON meta_cart_orders(merchant_id,created_at DESC);

CREATE TABLE meta_cart_items(
 merchant_id uuid NOT NULL,
 order_id uuid NOT NULL,
 line int NOT NULL CHECK(line BETWEEN 1 AND 20),
 product_id uuid NOT NULL,
 name text NOT NULL, name_en text NOT NULL, emoji text NOT NULL,
 quantity int NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 unit_minor bigint NOT NULL CHECK(unit_minor>0),
 base_minor bigint NOT NULL CHECK(base_minor>=unit_minor),
 offer_id text,
 PRIMARY KEY(merchant_id,order_id,line),
 FOREIGN KEY(merchant_id,order_id) REFERENCES meta_cart_orders(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);

CREATE TABLE meta_cart_stripe_events(
 merchant_id uuid NOT NULL REFERENCES merchants,
 event_id text NOT NULL PRIMARY KEY CHECK(event_id ~ '^evt_[A-Za-z0-9]{1,200}$'),
 order_id uuid NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,order_id) REFERENCES meta_cart_orders(merchant_id,id)
);

ALTER TABLE meta_cart_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_cart_stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_cart_order_tenant ON meta_cart_orders USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_cart_item_tenant ON meta_cart_items USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_cart_event_tenant ON meta_cart_stripe_events USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_cart_orders,meta_cart_items,meta_cart_stripe_events TO bitpos_app;
GRANT UPDATE(status,stripe_checkout_id,checkout_url,stripe_payment_intent_id,paid_at,paid_source,stock_short,handed_over_at,handed_over_by,stripe_refund_id,cancelled_at) ON meta_cart_orders TO bitpos_app;

-- The webhook learns an order's shop before tenant context exists.
CREATE FUNCTION bitpos.meta_cart_order_merchant(p_order_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_cart_orders WHERE id=p_order_id $$;
REVOKE ALL ON FUNCTION bitpos.meta_cart_order_merchant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_cart_order_merchant(uuid) TO bitpos_app;

-- Stock movements now also come from cart orders and from staff stock counts on meta-pos (order_id = the count's id).
ALTER TABLE meta_stock_movements DROP CONSTRAINT meta_stock_movements_reason_check;
ALTER TABLE meta_stock_movements ADD CONSTRAINT meta_stock_movements_reason_check CHECK(reason IN ('tap_paid','agent_confirmed','agent_refunded','cart_paid','cart_refunded','staff_adjust'));
ALTER TABLE meta_stock_movements DROP CONSTRAINT meta_stock_movements_order_kind_check;
ALTER TABLE meta_stock_movements ADD CONSTRAINT meta_stock_movements_order_kind_check CHECK(order_kind IN ('tap','agent','cart','staff'));
ALTER TABLE meta_stock_movements DROP CONSTRAINT meta_stock_movements_check;
ALTER TABLE meta_stock_movements ADD CONSTRAINT meta_stock_movements_check CHECK(reason='staff_adjust' OR (reason IN ('agent_refunded','cart_refunded'))=(delta>0));
ALTER TABLE meta_stock_movements DROP CONSTRAINT meta_stock_movements_check1;
ALTER TABLE meta_stock_movements ADD CONSTRAINT meta_stock_movements_kind CHECK((reason='tap_paid')=(order_kind='tap') AND (reason='staff_adjust')=(order_kind='staff'));
ALTER TABLE meta_stock_movements DROP CONSTRAINT meta_stock_movements_merchant_id_order_kind_order_id_reason_key;
ALTER TABLE meta_stock_movements ADD COLUMN line int NOT NULL DEFAULT 0;
ALTER TABLE meta_stock_movements ADD CONSTRAINT meta_stock_movements_once UNIQUE(merchant_id,order_kind,order_id,reason,line);

CREATE OR REPLACE FUNCTION bitpos.meta_order_feed(since timestamptz DEFAULT clock_timestamp()-interval '7 days')
RETURNS TABLE(platform text,channel text,merchant_id uuid,order_id uuid,status text,currency text,amount_minor bigint,created_at timestamptz,paid_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 RETURN QUERY
  SELECT 'pos'::text,'pos'::text,o.merchant_id,o.id,o.status::text,
   CASE WHEN o.usdg_minor IS NOT NULL THEN 'usdg' ELSE 'thb' END,coalesce(o.usdg_minor,o.thb_minor)::bigint,o.created_at,o.paid_at
  FROM orders o WHERE o.created_at>=since
  UNION ALL
  SELECT 'meta','tap',t.merchant_id,t.id,t.status,t.currency,t.amount_minor,t.created_at,t.paid_at FROM meta_tap_orders t WHERE t.created_at>=since
  UNION ALL
  SELECT 'meta',CASE WHEN a.link_id IS NULL THEN 'mcp' ELSE 'chat' END,a.merchant_id,a.id,a.status,a.currency,a.amount_minor,a.created_at,a.confirmed_at FROM meta_agent_orders a WHERE a.created_at>=since
  UNION ALL
  SELECT 'meta',c.channel,c.merchant_id,c.id,c.status,c.currency,c.amount_minor,c.created_at,c.paid_at FROM meta_cart_orders c WHERE c.created_at>=since
  ORDER BY 8 DESC;
END $$;
