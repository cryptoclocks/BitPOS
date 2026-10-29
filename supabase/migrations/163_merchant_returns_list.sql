-- Read-only list of a merchant's food return/refund cases for the owner/manager "Cancellations and refunds" page.
-- One row per case: when it was requested, whether the shop recorded the return, whether it was resolved, and how far the
-- money refund is (financial review, allocated transfers, finalized receipts). Nothing here moves state; the refund tables
-- stay closed to the application role.
SET search_path=bitpos,public;
CREATE FUNCTION merchant_returns163_list(p_merchant uuid,p_limit int)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF p_merchant IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 RETURN coalesce((SELECT jsonb_agg(x.row ORDER BY x.updated DESC,x.id)FROM(
  SELECT c.id,greatest(c.requested_at,rc.received_at,rs.resolved_at,fin.last_finalized)updated,jsonb_build_object(
   'caseId',c.id,'orderId',s.order_id,'reason',c.reason,'requestedAt',c.requested_at,'receivedAt',rc.received_at,'resolvedAt',rs.resolved_at,
   'condition',rc.condition,
   'amount',CASE WHEN fr.case_id IS NULL THEN NULL ELSE jsonb_build_object('currency',fr.catalog_currency,'decimals',fr.catalog_decimals,'totalMinor',fr.catalog_total_minor::text)END,
   'refund',CASE WHEN al.n=0 THEN 'NONE' WHEN fin.finalized_n>=al.n THEN 'REFUNDED' ELSE 'IN_PROGRESS' END,
   'stage',CASE WHEN al.n>0 AND fin.finalized_n>=al.n THEN 'REFUNDED' WHEN al.n>0 THEN 'REFUNDING' WHEN rs.case_id IS NOT NULL THEN 'RESOLVED' WHEN rc.case_id IS NOT NULL THEN 'RECEIVED' ELSE 'REQUESTED' END)row
  FROM food_return108_cases c
  JOIN food_shipments s ON s.id=c.shipment_id AND s.merchant_id=p_merchant
  LEFT JOIN food_return108_receipts rc ON rc.case_id=c.id
  LEFT JOIN food_return108_resolutions rs ON rs.case_id=c.id
  LEFT JOIN food_return108_financial_reviews fr ON fr.case_id=c.id
  LEFT JOIN LATERAL(SELECT count(*)::int n FROM food_return109_allocations a WHERE a.case_id=c.id)al ON true
  LEFT JOIN LATERAL(SELECT count(DISTINCT a.payment_id)::int finalized_n,max(r.created_at)last_finalized FROM food_return109_allocations a
    JOIN food_refund110_attempts t ON t.case_id=a.case_id AND t.payment_id=a.payment_id
    JOIN food_refund112_receipts r ON r.attempt_id=t.id AND r.outcome='FINALIZED' WHERE a.case_id=c.id)fin ON true
  ORDER BY 2 DESC NULLS LAST,c.id LIMIT p_limit)x),'[]'::jsonb);
END$$;
REVOKE ALL ON FUNCTION merchant_returns163_list(uuid,int)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_returns163_list(uuid,int)TO bitpos_app;
