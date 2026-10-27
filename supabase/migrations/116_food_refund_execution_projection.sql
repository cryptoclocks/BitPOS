-- Private administrator projection; never exposes payer keys or signed bytes.
SET search_path=bitpos,public;
CREATE FUNCTION food_refund116_execution(case_uuid uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE review jsonb;choice text;expected integer;allocated integer;done integer;failed integer;incidents integer;late integer;status text;order_uuid uuid;
BEGIN
 -- Reuse current administrator/session/scope checks and canonical root lock.
 review:=food_return109_snapshot(case_uuid);choice:=review->'decision'->>'decision';
 SELECT order_id INTO STRICT order_uuid FROM food_return108_financial_reviews WHERE case_id=case_uuid;
 SELECT count(*)INTO expected FROM payments WHERE order_id=order_uuid;
 SELECT count(*)INTO allocated FROM food_return109_allocations WHERE case_id=case_uuid;
 SELECT count(*)FILTER(WHERE receipt.outcome='FINALIZED'AND receipt.posting_id IS NOT NULL),count(*)FILTER(WHERE receipt.outcome='FAILED')INTO done,failed
 FROM food_refund110_attempts attempt JOIN food_refund112_receipts receipt ON receipt.attempt_id=attempt.id WHERE attempt.case_id=case_uuid;
 SELECT count(*)INTO incidents FROM food_refund112_incidents i JOIN food_refund110_attempts a ON a.id=i.attempt_id WHERE a.case_id=case_uuid;
 SELECT count(*)INTO late FROM payments p WHERE p.order_id=order_uuid AND NOT EXISTS(SELECT 1 FROM food_return109_allocations allocation WHERE allocation.case_id=case_uuid AND allocation.payment_id=p.id);
 status:=CASE WHEN choice IS NULL THEN 'NOT_DECIDED'
 WHEN incidents>0 THEN 'RECONCILIATION_REQUIRED'
 WHEN expected<>(review->'decision'->>'paymentCount')::integer THEN 'RECONCILIATION_REQUIRED'
 WHEN choice='NO_REFUND' THEN 'NOT_REQUESTED'
 WHEN late>0 OR allocated<>expected THEN 'RECONCILIATION_REQUIRED'
 WHEN allocated>0 AND done=allocated THEN 'FINALIZED'
 WHEN done>0 THEN 'PARTIAL'
 WHEN failed>0 THEN 'FAILED'
 ELSE 'PENDING' END;
 RETURN jsonb_build_object('caseId',case_uuid,'state',status,'paymentCount',expected,'allocationCount',allocated,'finalizedCount',done,'failedCount',failed,'disputed',incidents>0,'unallocatedPaymentCount',CASE WHEN choice='FULL_REFUND'THEN late ELSE 0 END,'allPaymentsRefunded',status='FINALIZED');
END$$;
REVOKE ALL ON FUNCTION food_refund116_execution(uuid)FROM PUBLIC,bitpos_app,bitpos_refund_worker;
