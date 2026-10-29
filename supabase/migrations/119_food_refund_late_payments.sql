-- Private late-payment allocation reconciliation; no transfer or replacement.
SET search_path=bitpos,public;
CREATE TABLE food_refund119_reconciliations(
 case_id uuid NOT NULL REFERENCES food_return109_decisions,actor_id uuid NOT NULL REFERENCES mobile_accounts,
 command_id uuid NOT NULL,request_hash text NOT NULL,receipt jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id)
);
ALTER TABLE food_refund119_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund119_reconciliations FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_refund119_review BEFORE UPDATE OR DELETE ON food_refund119_reconciliations FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_refund119_reconcile(case_uuid uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE review jsonb;actor uuid;key uuid;digest text;prior food_refund119_reconciliations;order_uuid uuid;merchant uuid;inserted integer;receipt jsonb;
BEGIN
 review:=food_return109_snapshot(case_uuid);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(case_uuid,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('refund119:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_refund119_reconciliations WHERE actor_id=actor AND command_id=key;
 IF FOUND THEN IF prior.case_id<>case_uuid OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF review->>'shipmentVersion' IS DISTINCT FROM payload->>'expectedVersion' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF review->'decision'->>'decision' IS DISTINCT FROM 'FULL_REFUND'THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 SELECT r.order_id,r.merchant_id INTO STRICT order_uuid,merchant FROM food_return108_financial_reviews r WHERE r.case_id=case_uuid;
 PERFORM 1 FROM payments WHERE merchant_id=merchant AND order_id=order_uuid ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM payments p WHERE p.order_id=order_uuid AND EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id))THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM payments p LEFT JOIN payment_attempt_assets a ON a.attempt_id=p.attempt_id AND a.order_id=p.order_id AND a.merchant_id=p.merchant_id WHERE p.order_id=order_uuid AND(a.attempt_id IS NULL OR a.payer IS NULL OR p.amount_minor<=0))THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary)
 SELECT case_uuid,p.merchant_id,p.order_id,p.id,p.amount_minor,a.descriptor,a.settlement,a.payer FROM payments p JOIN payment_attempt_assets a ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id)
 WHERE p.merchant_id=merchant AND p.order_id=order_uuid AND NOT EXISTS(SELECT 1 FROM food_return109_allocations old WHERE old.payment_id=p.id);
 GET DIAGNOSTICS inserted=ROW_COUNT;
 receipt:=jsonb_build_object('caseId',case_uuid,'addedPaymentCount',inserted,'executionState','PENDING','fundsTransferred',false);
 INSERT INTO food_refund119_reconciliations(case_id,actor_id,command_id,request_hash,receipt,reason)VALUES(case_uuid,actor,key,digest,receipt,payload->>'reason');RETURN receipt;
END$$;
REVOKE ALL ON FUNCTION food_refund119_reconcile(uuid,jsonb)FROM PUBLIC,bitpos_app,bitpos_refund_worker;

CREATE OR REPLACE FUNCTION food_refund117_safe_execution(case_uuid uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE review jsonb;choice text;expected integer;allocated integer;done integer;failed integer;incidents integer;late integer;status text;order_uuid uuid;
BEGIN
 -- Reuse current administrator/session/scope checks and canonical root lock.
 SELECT jsonb_build_object('decision',d.receipt)INTO review FROM food_return109_decisions d WHERE d.case_id=case_uuid;choice:=review->'decision'->>'decision';
 SELECT order_id INTO STRICT order_uuid FROM food_return108_financial_reviews WHERE case_id=case_uuid;
 SELECT count(*)INTO expected FROM payments WHERE order_id=order_uuid;
 SELECT count(*)INTO allocated FROM food_return109_allocations WHERE case_id=case_uuid;
 SELECT count(*)FILTER(WHERE receipt.outcome='FINALIZED'AND receipt.posting_id IS NOT NULL),count(*)FILTER(WHERE receipt.outcome='FAILED')INTO done,failed
 FROM food_refund110_attempts attempt JOIN food_refund112_receipts receipt ON receipt.attempt_id=attempt.id WHERE attempt.case_id=case_uuid;
 SELECT count(*)INTO incidents FROM food_refund112_incidents i JOIN food_refund110_attempts a ON a.id=i.attempt_id WHERE a.case_id=case_uuid;
 SELECT count(*)INTO late FROM payments p WHERE p.order_id=order_uuid AND NOT EXISTS(SELECT 1 FROM food_return109_allocations allocation WHERE allocation.case_id=case_uuid AND allocation.payment_id=p.id);
 status:=CASE WHEN choice IS NULL THEN 'NOT_DECIDED'
 WHEN incidents>0 THEN 'RECONCILIATION_REQUIRED'
 WHEN choice='NO_REFUND'AND expected<>(review->'decision'->>'paymentCount')::integer THEN 'RECONCILIATION_REQUIRED'
 WHEN choice='NO_REFUND' THEN 'NOT_REQUESTED'
 WHEN late>0 OR allocated<>expected THEN 'RECONCILIATION_REQUIRED'
 WHEN allocated>0 AND done=allocated THEN 'FINALIZED'
 WHEN done>0 THEN 'PARTIAL'
 WHEN failed>0 THEN 'FAILED'
 ELSE 'PENDING' END;
 RETURN jsonb_build_object('caseId',case_uuid,'state',status,'paymentCount',expected,'allocationCount',allocated,'finalizedCount',done,'failedCount',failed,'disputed',incidents>0,'unallocatedPaymentCount',CASE WHEN choice='FULL_REFUND'THEN late ELSE 0 END,'allPaymentsRefunded',status='FINALIZED');
END$$;
