-- Also discover old expired-but-owned screens so restart can release safe unpaid bills.
CREATE OR REPLACE FUNCTION bitpos.reconciliation_merchants()
RETURNS TABLE(merchant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=bitpos,pg_temp AS $$
 SELECT o.merchant_id FROM bitpos.orders o
 WHERE o.quote_expires_at<=now() AND
 (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING') OR
 (o.status='EXPIRED' AND o.closure_reason IS NULL AND EXISTS
 (SELECT 1 FROM bitpos.device_screen_state s WHERE s.merchant_id=o.merchant_id AND s.order_id=o.id AND s.kind='order')))
 UNION SELECT a.merchant_id FROM bitpos.payment_attempts a
 WHERE a.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED') OR (a.status='EXPIRED' AND a.signature IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION bitpos.reconciliation_merchants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.reconciliation_merchants() TO bitpos_app;
