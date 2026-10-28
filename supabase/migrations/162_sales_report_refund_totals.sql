-- Read-only totals for the owner/manager sales report: refund cases whose every allocated transfer has a FINALIZED
-- receipt, valued in the order's catalog currency (partial selections use their recorded catalog amount, full returns
-- the financial review total) and dated by the last finalized receipt in the shop time zone. Nothing here moves state;
-- the refund tables themselves stay closed to the application role.
SET search_path=bitpos,public;
CREATE FUNCTION sales_report162_refunds(p_merchant uuid,p_from date,p_to date,p_zone text)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',t.currency,'decimals',t.decimals,'cases',t.cases,'refundedMinor',t.refunded::text)ORDER BY t.currency,t.decimals),'[]'::jsonb)
 FROM(SELECT r.catalog_currency currency,r.catalog_decimals decimals,count(*)::int cases,
   sum(coalesce((s.fact->'catalogAmount'->>'amountMinor')::bigint,r.catalog_total_minor))refunded
  FROM food_return108_financial_reviews r LEFT JOIN food_refund135_selections s ON s.case_id=r.case_id
  WHERE r.merchant_id=p_merchant
  AND EXISTS(SELECT 1 FROM food_return109_allocations al WHERE al.case_id=r.case_id)
  AND NOT EXISTS(SELECT 1 FROM food_return109_allocations al WHERE al.case_id=r.case_id AND NOT EXISTS(
    SELECT 1 FROM food_refund110_attempts at JOIN food_refund112_receipts rc ON rc.attempt_id=at.id AND rc.outcome='FINALIZED' WHERE at.case_id=al.case_id AND at.payment_id=al.payment_id))
  AND(SELECT max(rc.created_at)FROM food_refund110_attempts at JOIN food_refund112_receipts rc ON rc.attempt_id=at.id AND rc.outcome='FINALIZED' WHERE at.case_id=r.case_id)
      BETWEEN(p_from::timestamp AT TIME ZONE p_zone)AND(((p_to+1)::timestamp AT TIME ZONE p_zone)-interval '1 microsecond')
  GROUP BY 1,2)t
$$;
REVOKE ALL ON FUNCTION sales_report162_refunds(uuid,date,date,text)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_report162_refunds(uuid,date,date,text)TO bitpos_app;
