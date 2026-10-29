-- Derived loyalty points for a mobile account: one point per whole currency unit (integer division per order, never rounded up) of each PAID online
-- food order that has no refund obligation, grouped by currency. Nothing is stored or awarded, so there
-- is nothing to dedupe or reverse; the figure is recomputed from immutable order facts on every read.
-- Authorisation mirrors mobile_owned_order_locations (live session of the same account).
SET search_path=bitpos,public;
CREATE FUNCTION mobile_reward_totals(p_account uuid,p_session uuid)
RETURNS TABLE(currency text,decimals smallint,orders integer,points bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT a.catalog_currency,a.catalog_decimals,count(*)::integer,sum(div(a.total_minor::numeric,10::numeric^a.catalog_decimals))::bigint
 FROM online_food_orders f
 JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id AND o.status='PAID'
 JOIN order_authority a ON a.merchant_id=f.merchant_id AND a.order_id=f.order_id
 WHERE f.account_id=p_account
 AND EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts x ON x.id=s.account_id
  WHERE s.id=p_session AND s.account_id=p_account AND s.revoked_at IS NULL
  AND s.access_expires_at>statement_timestamp() AND s.refresh_expires_at>statement_timestamp() AND x.disabled_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=f.merchant_id AND r.order_id=f.order_id)
 GROUP BY a.catalog_currency,a.catalog_decimals ORDER BY a.catalog_currency,a.catalog_decimals
$$;
REVOKE ALL ON FUNCTION mobile_reward_totals(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_reward_totals(uuid,uuid) TO bitpos_app;
