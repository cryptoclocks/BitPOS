-- Existing signed history is never deleted. Discover crash-retained terminal SDK
-- sidecars by merchant ID only so the normal RLS-scoped worker can retire them.
-- Rollback: keep the queue/reconciler until sidecars drain; no data restoration.
SET search_path TO bitpos,public;
CREATE OR REPLACE FUNCTION bitpos.reconciliation_queue()
RETURNS TABLE(merchant_id uuid,priority integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT q.merchant_id,min(q.priority) FROM (
  SELECT a.merchant_id,CASE WHEN a.status IN ('SUBMITTING','SUBMITTED','CONFIRMED') AND a.signature IS NOT NULL THEN 0 ELSE 1 END priority
  FROM bitpos.payment_attempts a
  WHERE a.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED') OR
   (a.status<>'FINALIZED' AND a.signature IS NOT NULL AND a.failure_reconciled_at IS NULL)
  UNION ALL
  SELECT o.merchant_id,2 FROM bitpos.orders o
  WHERE o.quote_expires_at<=now() AND
   (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING') OR
    (o.status='EXPIRED' AND o.closure_reason IS NULL AND EXISTS
      (SELECT 1 FROM bitpos.device_screen_state s WHERE s.merchant_id=o.merchant_id AND s.order_id=o.id AND s.kind='order')))
  UNION ALL
  SELECT s.merchant_id,3 FROM bitpos.x402_pending_settlements s
  JOIN bitpos.payment_attempts a ON a.merchant_id=s.merchant_id AND a.id=s.attempt_id
  WHERE a.status='FINALIZED' OR
   (a.status IN ('FAILED','EXPIRED','REJECTED') AND a.failure_reconciled_at IS NOT NULL)
 ) q GROUP BY q.merchant_id
$$;
REVOKE ALL ON FUNCTION bitpos.reconciliation_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.reconciliation_queue() TO bitpos_app;
