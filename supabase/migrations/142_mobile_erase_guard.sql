-- Guard for account erasure: counts what must finish first. Erasure anonymises the account's own
-- profile/addresses/favourites and revokes access; order and payment facts are financial records and stay.
-- Conservative: any refund row on the account's orders, any unpaid/recovering order, and any paid order not
-- yet collected blocks erasure (the customer would lose the only way to follow it).
SET search_path=bitpos,public;
CREATE FUNCTION mobile_erase_blockers(p_account uuid,p_session uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts x ON x.id=s.account_id
  WHERE s.id=p_session AND s.account_id=p_account AND s.revoked_at IS NULL
  AND s.access_expires_at>statement_timestamp() AND s.refresh_expires_at>statement_timestamp() AND x.disabled_at IS NULL)
 THEN (SELECT count(*)::integer FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id
   LEFT JOIN order_fulfillment k ON k.merchant_id=f.merchant_id AND k.order_id=f.order_id
   WHERE f.account_id=p_account AND (
    o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING','RECOVERY')
    OR (o.status='PAID' AND coalesce(k.status,'RECEIVED')<>'COLLECTED')
    OR EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=f.merchant_id AND r.order_id=f.order_id)))
 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION mobile_erase_blockers(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_erase_blockers(uuid,uuid) TO bitpos_app;
