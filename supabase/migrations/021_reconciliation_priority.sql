-- Only merchant IDs and queue priority cross the discovery boundary. All work
-- continues through tenant-scoped RLS. Verified expired signatures are terminal.
CREATE FUNCTION bitpos.reconciliation_queue()
RETURNS TABLE(merchant_id uuid,priority integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT q.merchant_id,min(q.priority) FROM (
  SELECT a.merchant_id,CASE WHEN a.status IN ('SUBMITTING','SUBMITTED','CONFIRMED') AND a.signature IS NOT NULL THEN 0 ELSE 1 END priority
  FROM bitpos.payment_attempts a
  WHERE a.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED') OR
   (a.status='EXPIRED' AND a.signature IS NOT NULL AND a.failure_reconciled_at IS NULL)
  UNION ALL
  SELECT o.merchant_id,2 FROM bitpos.orders o
  WHERE o.quote_expires_at<=now() AND
   (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING') OR
    (o.status='EXPIRED' AND o.closure_reason IS NULL AND EXISTS
      (SELECT 1 FROM bitpos.device_screen_state s WHERE s.merchant_id=o.merchant_id AND s.order_id=o.id AND s.kind='order')))
 ) q GROUP BY q.merchant_id
$$;
REVOKE ALL ON FUNCTION bitpos.reconciliation_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.reconciliation_queue() TO bitpos_app;
CREATE OR REPLACE FUNCTION bitpos.reconciliation_merchants()
RETURNS TABLE(merchant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM bitpos.reconciliation_queue()
$$;
