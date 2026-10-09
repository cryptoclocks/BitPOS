SET search_path TO bitpos, public;
-- The service already lists merchant IDs globally. Expose only pending IDs,
-- never payment/customer rows; all processing still enters tenant-scoped RLS.
CREATE FUNCTION bitpos.reconciliation_merchants()
RETURNS TABLE(merchant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = bitpos, pg_temp
AS $$
 SELECT o.merchant_id FROM bitpos.orders o
 WHERE o.quote_expires_at<=now()
   AND o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING')
 UNION
 SELECT a.merchant_id FROM bitpos.payment_attempts a
 WHERE a.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED')
    OR (a.status='EXPIRED' AND a.signature IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION bitpos.reconciliation_merchants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.reconciliation_merchants() TO bitpos_app;
