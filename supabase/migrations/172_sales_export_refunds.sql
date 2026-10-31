-- Per-order finalized refund totals for the server-side net-after-refunds CSV export. Same eligibility and valuation rules as
-- sales_report162_refunds (every allocated transfer FINALIZED, dated by the last finalized receipt in the shop time zone), but
-- grouped by order so the export reconciles to the sales report. Read-only; the refund tables stay closed to the application role.
SET search_path=bitpos,public;
CREATE FUNCTION sales_export172_refunds(p_merchant uuid,p_from date,p_to date,p_zone text)RETURNS TABLE(order_id uuid,currency text,decimals integer,refunded_minor bigint)LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT r.order_id,r.catalog_currency,r.catalog_decimals,sum(coalesce((s.fact->'catalogAmount'->>'amountMinor')::bigint,r.catalog_total_minor))::bigint
 FROM food_return108_financial_reviews r LEFT JOIN food_refund135_selections s ON s.case_id=r.case_id
 WHERE r.merchant_id=p_merchant
 AND EXISTS(SELECT 1 FROM food_return109_allocations al WHERE al.case_id=r.case_id)
 AND NOT EXISTS(SELECT 1 FROM food_return109_allocations al WHERE al.case_id=r.case_id AND NOT EXISTS(
   SELECT 1 FROM food_refund110_attempts at JOIN food_refund112_receipts rc ON rc.attempt_id=at.id AND rc.outcome='FINALIZED' WHERE at.case_id=al.case_id AND at.payment_id=al.payment_id))
 AND(SELECT max(rc.created_at)FROM food_refund110_attempts at JOIN food_refund112_receipts rc ON rc.attempt_id=at.id AND rc.outcome='FINALIZED' WHERE at.case_id=r.case_id)
     BETWEEN(p_from::timestamp AT TIME ZONE p_zone)AND(((p_to+1)::timestamp AT TIME ZONE p_zone)-interval '1 microsecond')
 GROUP BY 1,2,3
$$;
REVOKE ALL ON FUNCTION sales_export172_refunds(uuid,date,date,text)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_export172_refunds(uuid,date,date,text)TO bitpos_app;
