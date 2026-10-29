-- Preserve routed awaiting/expired semantics; only terminated online orders may
-- close CONFIRMING after all issued attempts have conclusively failed.
CREATE OR REPLACE FUNCTION bitpos.unpaid_order_safe(p_merchant uuid,p_order uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.merchant_id=p_merchant AND o.id=p_order
 AND (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','EXPIRED')
 OR (o.status='CONFIRMING' AND bitpos.online_acceptance_ended(p_merchant,p_order)
 AND NOT EXISTS(SELECT 1 FROM payments WHERE merchant_id=p_merchant AND order_id=p_order)))
 AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id
 AND NOT (p.status IN ('EXPIRED','FAILED','REJECTED') AND p.failure_reconciled_at IS NOT NULL)
 AND (p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL OR p.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED')
 OR (p.transaction_base64 IS NOT NULL AND p.status NOT IN ('EXPIRED','FAILED','REJECTED')))));
$$;
REVOKE ALL ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) TO bitpos_app;
