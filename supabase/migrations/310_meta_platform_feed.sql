-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Which platform did what, for a shop shared by the POS (Solana stream) and the Meta channels.
-- Meta orders already live in their own tables (meta_tap_orders, meta_agent_orders), never in the inherited
-- orders table. This adds:
--  * meta_stock_movements: every stock change Meta makes on the shared products table, once per order effect;
--  * bitpos.meta_order_feed(): one list of orders with platform ('pos' | 'meta') and channel;
--  * bitpos.meta_offer_origin(): each offer revision on the shared offer table, with the Meta draft behind it.
-- The inherited tables are only read. The functions are PL/pgSQL so they hold no schema dependency on the
-- inherited tables (the POS stream can still alter its own columns), and they run as the caller, so
-- row-level security and the bitpos.merchant setting apply as for any other query.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_stock_movements(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL,
 delta int NOT NULL CHECK(delta<>0),
 reason text NOT NULL CHECK(reason IN ('tap_paid','agent_confirmed','agent_refunded')),
 order_kind text NOT NULL CHECK(order_kind IN ('tap','agent')),
 order_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 UNIQUE(merchant_id,order_kind,order_id,reason),
 CHECK((reason='agent_refunded')=(delta>0)),
 CHECK((reason='tap_paid')=(order_kind='tap'))
);
CREATE INDEX meta_stock_movement_product ON meta_stock_movements(merchant_id,product_id,created_at DESC);
ALTER TABLE meta_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_stock_movement_tenant ON meta_stock_movements USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_stock_movements TO bitpos_app;

-- Earlier Meta stock effects, reconstructed from the order ledgers (orders that took stock and were not short).
INSERT INTO meta_stock_movements(merchant_id,product_id,delta,reason,order_kind,order_id,created_at)
 SELECT merchant_id,product_id,-quantity,'tap_paid','tap',id,paid_at FROM meta_tap_orders WHERE status='PAID' AND NOT stock_short
 UNION ALL SELECT merchant_id,product_id,-quantity,'agent_confirmed','agent',id,confirmed_at FROM meta_agent_orders WHERE confirmed_at IS NOT NULL AND NOT stock_short
 UNION ALL SELECT merchant_id,product_id,quantity,'agent_refunded','agent',id,cancelled_at FROM meta_agent_orders WHERE status='CANCELLED' AND confirmed_at IS NOT NULL AND NOT stock_short AND stripe_refund_id IS NOT NULL;

CREATE FUNCTION bitpos.meta_order_feed(since timestamptz DEFAULT clock_timestamp()-interval '7 days')
RETURNS TABLE(platform text,channel text,merchant_id uuid,order_id uuid,status text,currency text,amount_minor bigint,created_at timestamptz,paid_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 RETURN QUERY
  SELECT 'pos'::text,'pos'::text,o.merchant_id,o.id,o.status::text,
   CASE WHEN o.usdg_minor IS NOT NULL THEN 'usdg' ELSE 'thb' END,coalesce(o.usdg_minor,o.thb_minor)::bigint,o.created_at,o.paid_at
  FROM orders o WHERE o.created_at>=since
  UNION ALL
  SELECT 'meta','tap',t.merchant_id,t.id,t.status,t.currency,t.amount_minor,t.created_at,t.paid_at
  FROM meta_tap_orders t WHERE t.created_at>=since
  UNION ALL
  -- Agent orders with a Messenger/web customer link came from chat or voice; without one, from an MCP agent.
  SELECT 'meta',CASE WHEN a.link_id IS NULL THEN 'mcp' ELSE 'chat' END,a.merchant_id,a.id,a.status,a.currency,a.amount_minor,a.created_at,a.confirmed_at
  FROM meta_agent_orders a WHERE a.created_at>=since
  ORDER BY 8 DESC;
END $$;
REVOKE ALL ON FUNCTION bitpos.meta_order_feed(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_order_feed(timestamptz) TO bitpos_app;

CREATE FUNCTION bitpos.meta_offer_origin()
RETURNS TABLE(platform text,merchant_id uuid,product_id uuid,price_version_id uuid,revision bigint,enabled boolean,meta_draft_id uuid,approval_kind text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 RETURN QUERY
  SELECT CASE WHEN d.id IS NULL THEN 'pos' ELSE 'meta' END,v.merchant_id,v.product_id,v.price_version_id,v.revision,v.enabled,d.id,d.approval_kind
  FROM versioned_product_offers v
  LEFT JOIN meta_offer_drafts d ON d.merchant_id=v.merchant_id AND d.product_id=v.product_id AND d.price_version_id=v.price_version_id AND d.offer_revision=v.revision::text
  ORDER BY v.merchant_id,v.product_id,v.revision DESC;
END $$;
REVOKE ALL ON FUNCTION bitpos.meta_offer_origin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_offer_origin() TO bitpos_app;
