-- Private administrator projection; approval is not finalized transfer proof.
SET search_path=bitpos,public;
CREATE FUNCTION food_compensation133_execution(return_case uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE d food_compensation120_decisions;r food_compensation124_reservations;i food_compensation126_intents;receipt food_compensation131_receipts;
 state text;amount jsonb;
BEGIN
 PERFORM food_return109_snapshot(return_case);
 SELECT * INTO d FROM food_compensation120_decisions WHERE case_id=return_case;
 IF NOT FOUND THEN state:='NOT_DECIDED';
 ELSE
  amount:=jsonb_build_object('currency',d.currency,'decimals',d.decimals,'amountMinor',d.amount_minor::text);
  SELECT * INTO r FROM food_compensation124_reservations WHERE case_id=return_case;
  SELECT * INTO i FROM food_compensation126_intents WHERE reservation_id=r.id;
  SELECT * INTO receipt FROM food_compensation131_receipts WHERE attempt_id=i.id ORDER BY created_at,id LIMIT 1;
  IF EXISTS(SELECT 1 FROM food_compensation131_incidents WHERE attempt_id=i.id)THEN state:='RECONCILIATION_REQUIRED';
  ELSIF receipt.outcome='FAILED'THEN state:='FAILED';
  ELSIF receipt.outcome='FINALIZED'THEN
   IF receipt.posting_id IS NOT NULL AND EXISTS(SELECT 1 FROM food_compensation131_costs WHERE receipt_id=receipt.id)THEN state:='FINALIZED';ELSE state:='RECONCILIATION_REQUIRED';END IF;
  ELSIF d.amount_minor=0 THEN state:='ZERO_APPROVED';
  ELSIF i.id IS NULL THEN state:='PENDING';
  ELSIF NOT EXISTS(SELECT 1 FROM food_compensation125_claims WHERE reservation_id=r.id)OR NOT EXISTS(SELECT 1 FROM food_compensation127_fee_claims WHERE attempt_id=i.id)THEN state:='FUNDING_REQUIRED';
  ELSIF EXISTS(SELECT 1 FROM food_compensation130_submissions WHERE attempt_id=i.id)THEN state:='UNKNOWN';
  ELSIF EXISTS(SELECT 1 FROM food_compensation128_prepared WHERE attempt_id=i.id)THEN state:='PREPARED';
  ELSE state:='PENDING';END IF;
 END IF;
 RETURN jsonb_build_object('caseId',return_case,'state',state,'approvedAmount',amount,'fundsTransferred',state='FINALIZED');
END $$;
REVOKE ALL ON FUNCTION food_compensation133_execution(uuid)FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
