-- Private selected-line monetary refund authority. No application grants.
-- A configured line includes its original quantity/options/line discount, not fees.
SET search_path=bitpos,public;
CREATE FUNCTION food_refund135_line_fact(return_case uuid,line_uuid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_return108_financial_reviews;oa order_authority;f order_configured_food;
 p payments;side payment_attempt_assets;q payment_quotes;item jsonb;policy jsonb;asset jsonb;
 n numeric;den numeric;catalog_amount numeric;atoms numeric;
BEGIN
 SELECT * INTO r FROM food_return108_financial_reviews WHERE case_id=return_case;
 IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 SELECT * INTO STRICT oa FROM order_authority WHERE merchant_id=r.merchant_id AND order_id=r.order_id;
 SELECT * INTO f FROM order_configured_food WHERE merchant_id=r.merchant_id AND order_id=r.order_id;
 IF f.order_id IS NULL OR f.quote_id IS DISTINCT FROM r.quote_id OR oa.quote_id IS DISTINCT FROM r.quote_id
 OR (oa.catalog_currency,oa.catalog_decimals,oa.total_minor) IS DISTINCT FROM(r.catalog_currency,r.catalog_decimals,r.catalog_total_minor)
 OR f.snapshot->'total' IS DISTINCT FROM jsonb_build_object('currency',r.catalog_currency,'decimals',r.catalog_decimals,'amountMinor',r.catalog_total_minor::text)
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT value INTO item FROM jsonb_array_elements(f.snapshot->'lines') WHERE value->>'lineId'=line_uuid::text;
 IF item IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF (item->'lineTotal'->>'currency') IS DISTINCT FROM r.catalog_currency
 OR (item->'lineTotal'->>'decimals') IS DISTINCT FROM r.catalog_decimals::text
 OR coalesce(item->'lineTotal'->>'amountMinor','')!~'^[1-9][0-9]{0,17}$'
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 catalog_amount:=(item->'lineTotal'->>'amountMinor')::numeric;
 -- Coupon checkout is not admitted; document-level discounts must not be
 -- silently ignored if another allocator later adds them to configured totals.
 IF (SELECT sum((value->'lineTotal'->>'amountMinor')::numeric) FROM jsonb_array_elements(f.snapshot->'lines'))
 +(f.snapshot->'fees'->>'amountMinor')::numeric+(f.snapshot->'tax'->>'amountMinor')::numeric<>r.catalog_total_minor
 OR catalog_amount>r.catalog_total_minor THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 IF (SELECT count(*) FROM payments WHERE merchant_id=r.merchant_id AND order_id=r.order_id AND state='SETTLED')<>1
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT * INTO STRICT p FROM payments WHERE merchant_id=r.merchant_id AND order_id=r.order_id AND state='SETTLED';
 SELECT * INTO side FROM payment_attempt_assets WHERE merchant_id=r.merchant_id AND order_id=r.order_id AND attempt_id=p.attempt_id;
 IF side.attempt_id IS NULL THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT * INTO STRICT q FROM payment_quotes WHERE id=side.quote_id AND merchant_id=r.merchant_id AND order_id=r.order_id;
 asset:=side.descriptor;policy:=side.settlement->'denominationPolicy';
 IF (q.original_quote_id,q.price_currency,q.price_total_minor,q.descriptor,q.settlement)
 IS DISTINCT FROM(oa.quote_id,oa.catalog_currency,oa.total_minor::numeric,side.descriptor,side.settlement)
 OR asset->>'cluster' IS DISTINCT FROM 'devnet'
 OR asset->>'genesisHash' IS DISTINCT FROM 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
 OR asset->>'decimals' IS DISTINCT FROM '6' OR coalesce(asset->>'symbol','') NOT IN('USDG','USDC','USDT')
 OR side.settlement->>'currency' IS DISTINCT FROM asset->>'symbol' OR side.settlement->>'decimals' IS DISTINCT FROM '6'
 OR side.settlement->>'mint' IS DISTINCT FROM asset->>'mint' OR side.settlement->>'tokenProgram' IS DISTINCT FROM asset->>'tokenProgram'
 OR side.settlement->>'genesisHash' IS DISTINCT FROM asset->>'genesisHash'
 OR jsonb_typeof(policy) IS DISTINCT FROM 'object' OR jsonb_typeof(policy->'id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(policy->'numerator') IS DISTINCT FROM 'string' OR jsonb_typeof(policy->'denominator') IS DISTINCT FROM 'string'
 OR coalesce(policy->>'numerator','')!~'^[1-9][0-9]{0,19}$' OR coalesce(policy->>'denominator','')!~'^[1-9][0-9]{0,19}$'
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 n:=(policy->>'numerator')::numeric;den:=(policy->>'denominator')::numeric;
 IF n>18446744073709551615 OR den>18446744073709551615
 OR (r.catalog_currency='USDG' AND(r.catalog_decimals<>6 OR n<>1 OR den<>1 OR asset->>'symbol'<>'USDG'))
 OR jsonb_typeof(side.settlement->'amountMinor') IS DISTINCT FROM 'string'
 OR coalesce(side.settlement->>'amountMinor','')!~'^[1-9][0-9]{0,17}$'
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 IF p.amount_minor::text IS DISTINCT FROM side.settlement->>'amountMinor'
 OR r.catalog_total_minor::numeric*n<>p.amount_minor::numeric*den
 OR mod(catalog_amount*n,den)<>0 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 atoms:=catalog_amount*n/den;
 IF atoms<=0 OR atoms>p.amount_minor OR atoms>999999999999999999 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 RETURN jsonb_build_object('lineId',line_uuid,'name',item->>'name','nameEn',item->>'nameEn','qty',(item->>'qty')::integer,'selections',item->'selections',
 'catalogAmount',item->'lineTotal','paymentId',p.id,'refundAmount',jsonb_build_object('currency',asset->>'symbol','decimals',6,'amountMinor',atoms::bigint::text));
END $$;
REVOKE ALL ON FUNCTION food_refund135_line_fact(uuid,uuid) FROM PUBLIC,bitpos_app,bitpos_refund_worker;

-- Both authorities serialize on the canonical order row before observing the
-- other lane. A unique payment within either lane alone is not a shared cap.
CREATE FUNCTION food_refund135_exclusive_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM 1 FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id FOR UPDATE;
 IF (TG_TABLE_NAME='refunds' AND EXISTS(SELECT 1 FROM food_return109_allocations WHERE payment_id=NEW.payment_id))
 OR (TG_TABLE_NAME='food_return109_allocations' AND EXISTS(SELECT 1 FROM refunds WHERE payment_id=NEW.payment_id))
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION food_refund135_exclusive_payment() FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER a_refund135_exclusion BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION food_refund135_exclusive_payment();
CREATE TRIGGER a_return135_exclusion BEFORE INSERT ON food_return109_allocations FOR EACH ROW EXECUTE FUNCTION food_refund135_exclusive_payment();

ALTER TABLE food_return109_decisions DROP CONSTRAINT food_return109_decisions_decision_check;
ALTER TABLE food_return109_decisions ADD CHECK(decision IN('FULL_REFUND','NO_REFUND','LINE_REFUND'));
CREATE TABLE food_refund135_selections(
 case_id uuid PRIMARY KEY REFERENCES food_return109_decisions,
 line_id uuid NOT NULL, fact jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_refund135_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund135_selections FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE FUNCTION food_refund135_selection_guard() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM food_return109_decisions WHERE case_id=NEW.case_id AND decision='LINE_REFUND')
 OR NEW.fact IS DISTINCT FROM food_refund135_line_fact(NEW.case_id,NEW.line_id)
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION food_refund135_selection_guard() FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER canonical_refund135_selection BEFORE INSERT ON food_refund135_selections FOR EACH ROW EXECUTE FUNCTION food_refund135_selection_guard();
CREATE TRIGGER immutable_refund135_selection BEFORE UPDATE OR DELETE ON food_refund135_selections FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();

CREATE OR REPLACE FUNCTION guard_food_return109_allocation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE choice text;selected jsonb;p payments;a payment_attempt_assets;
BEGIN
 SELECT d.decision INTO choice FROM food_return109_decisions d JOIN food_return108_financial_reviews r ON r.case_id=d.case_id
 WHERE d.case_id=NEW.case_id AND(r.merchant_id,r.order_id)=(NEW.merchant_id,NEW.order_id);
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id AND(merchant_id,order_id)=(NEW.merchant_id,NEW.order_id);
 SELECT * INTO a FROM payment_attempt_assets WHERE(merchant_id,order_id,attempt_id)=(p.merchant_id,p.order_id,p.attempt_id);
 IF choice IS NULL OR p.id IS NULL OR a.attempt_id IS NULL
 OR(a.descriptor,a.settlement,a.payer) IS DISTINCT FROM(NEW.asset_descriptor,NEW.settlement,NEW.beneficiary)
 THEN RAISE EXCEPTION 'RETURN_ALLOCATION_MUST_MATCH_PAYMENT' USING ERRCODE='23514';END IF;
 IF choice='LINE_REFUND' THEN
  SELECT fact INTO selected FROM food_refund135_selections WHERE case_id=NEW.case_id;
  IF selected IS NULL OR (
   (selected->>'paymentId'=p.id::text AND selected->'refundAmount'->>'amountMinor' IS DISTINCT FROM NEW.amount_minor::text)
   OR (selected->>'paymentId'<>p.id::text AND(p.state<>'RECOVERY' OR NEW.amount_minor<>p.amount_minor)))
  OR NEW.amount_minor>p.amount_minor THEN RAISE EXCEPTION 'RETURN_ALLOCATION_MUST_MATCH_PAYMENT' USING ERRCODE='23514';END IF;
 ELSIF choice<>'FULL_REFUND' OR NEW.amount_minor<>p.amount_minor THEN
  RAISE EXCEPTION 'RETURN_ALLOCATION_MUST_MATCH_PAYMENT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Replace, rather than retain a second command authority. Existing commands and
-- receipts are byte-for-byte unchanged; only LINE_REFUND carries a lineId.
CREATE OR REPLACE FUNCTION food_return109_decide(case_id uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;actor uuid;sponsor uuid;key uuid;digest text;
 prior food_return109_decisions;receipt jsonb;count_payments integer;selected jsonb;
BEGIN
 SELECT * INTO c FROM food_return108_cases WHERE id=case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(c.shipment_id);PERFORM food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 SELECT g.id INTO sponsor FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
 WHERE g.account_id=actor AND g.role='administrator' AND sc.merchant_id=s.merchant_id
 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() ORDER BY g.id LIMIT 1 FOR SHARE OF g,sc NOWAIT;
 IF sponsor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF payload->>'decision'='LINE_REFUND' THEN
  key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','decision','reason','lineId'],ARRAY['expectedVersion']);
  IF jsonb_typeof(payload->'lineId') IS DISTINCT FROM 'string' OR coalesce(payload->>'lineId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 ELSE
  key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','decision','reason'],ARRAY['expectedVersion']);
 END IF;
 IF jsonb_typeof(payload->'decision') IS DISTINCT FROM 'string' OR payload->>'decision' NOT IN('FULL_REFUND','NO_REFUND','LINE_REFUND')
 OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(case_id,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('return109:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_return109_decisions d WHERE d.actor_id=actor AND d.command_id=key;
 IF FOUND THEN IF prior.case_id<>case_id OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM food_return108_financial_reviews r WHERE r.case_id=c.id) OR s.state<>'FAILED' THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM food_return109_decisions d WHERE d.case_id=c.id) THEN RAISE EXCEPTION 'RETURN_FINANCIAL_ALREADY_DECIDED';END IF;
 IF EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=s.merchant_id AND r.order_id=s.order_id) THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 PERFORM 1 FROM payments p WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id ORDER BY p.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM payments p LEFT JOIN payment_attempt_assets a ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id)
 WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id AND(a.attempt_id IS NULL OR a.payer IS NULL OR p.amount_minor<=0))
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT count(*) INTO count_payments FROM payments p WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id;
 IF count_payments=0 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 -- Excess receipts need their own full refund, not a fraction of the food line.
 -- Until reconciled they block selected-line approval rather than losing money.
 IF payload->>'decision'='LINE_REFUND' THEN
  IF count_payments<>1 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
  selected:=food_refund135_line_fact(c.id,(payload->>'lineId')::uuid);
 END IF;
 receipt:=jsonb_build_object('caseId',c.id,'decision',payload->>'decision','paymentCount',count_payments,'executionState',
 CASE WHEN payload->>'decision'='NO_REFUND' THEN 'NOT_REQUESTED' ELSE 'PENDING' END,'fundsTransferred',false,'stockRestored',false);
 IF selected IS NOT NULL THEN receipt:=receipt||jsonb_build_object('selection',selected);END IF;
 INSERT INTO food_return109_decisions(case_id,actor_id,session_id,grant_id,command_id,request_hash,decision,reason,receipt)
 VALUES(c.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,sponsor,key,digest,payload->>'decision',payload->>'reason',receipt);
 IF selected IS NOT NULL THEN
  INSERT INTO food_refund135_selections(case_id,line_id,fact) VALUES(c.id,(payload->>'lineId')::uuid,selected);
  INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary)
  SELECT c.id,p.merchant_id,p.order_id,p.id,(selected->'refundAmount'->>'amountMinor')::bigint,a.descriptor,a.settlement,a.payer
  FROM payments p JOIN payment_attempt_assets a ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id) WHERE p.id=(selected->>'paymentId')::uuid;
 ELSIF payload->>'decision'='FULL_REFUND' THEN
  INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary)
  SELECT c.id,p.merchant_id,p.order_id,p.id,p.amount_minor,a.descriptor,a.settlement,a.payer FROM payments p JOIN payment_attempt_assets a
  ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id) WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id;
 END IF;
 PERFORM dispatch_event(s.id,'RETURN_FINANCIAL_DECIDED',jsonb_build_object('caseId',c.id,'fundsTransferred',false));
 RETURN receipt;
END $$;

CREATE OR REPLACE FUNCTION food_return109_snapshot(case_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;r food_return108_financial_reviews;actor uuid;sponsor uuid;decision jsonb;lines jsonb:='[]';line jsonb;
BEGIN
 SELECT * INTO c FROM food_return108_cases WHERE id=case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(c.shipment_id);PERFORM food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 SELECT g.id INTO sponsor FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
 WHERE g.account_id=actor AND g.role='administrator' AND sc.merchant_id=s.merchant_id
 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() ORDER BY g.id LIMIT 1 FOR SHARE OF g,sc NOWAIT;
 IF sponsor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT * INTO r FROM food_return108_financial_reviews review WHERE review.case_id=c.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 SELECT d.receipt INTO decision FROM food_return109_decisions d WHERE d.case_id=c.id;
 -- Reconciliation conditions prevent selection, not existing whole-refund reads.
 IF decision IS NULL AND(SELECT count(*) FROM payments WHERE merchant_id=r.merchant_id AND order_id=r.order_id)=1
 AND NOT EXISTS(SELECT 1 FROM refunds WHERE merchant_id=r.merchant_id AND order_id=r.order_id) THEN
  FOR line IN SELECT value FROM order_configured_food f CROSS JOIN LATERAL jsonb_array_elements(f.snapshot->'lines')
  WHERE f.merchant_id=r.merchant_id AND f.order_id=r.order_id LOOP
   BEGIN lines:=lines||jsonb_build_array(food_refund135_line_fact(c.id,(line->>'lineId')::uuid));
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'RETURN_FINANCIAL_RECONCILIATION_REQUIRED' THEN RAISE;END IF;
   END;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('caseId',c.id,'shipmentVersion',s.version::text,'catalogTotal',
 jsonb_build_object('currency',r.catalog_currency,'decimals',r.catalog_decimals,'amountMinor',r.catalog_total_minor::text),
 'paymentCount',(SELECT count(*) FROM payments p WHERE p.merchant_id=r.merchant_id AND p.order_id=r.order_id),'decision',decision,'lines',lines);
END $$;

CREATE OR REPLACE FUNCTION food_refund117_safe_execution(case_uuid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE decision jsonb;choice text;expected integer;allocated integer;done integer;failed integer;incidents integer;late integer;status text;order_uuid uuid;selected jsonb;
BEGIN
 SELECT d.receipt INTO decision FROM food_return109_decisions d WHERE d.case_id=case_uuid;choice:=decision->>'decision';
 SELECT order_id INTO STRICT order_uuid FROM food_return108_financial_reviews WHERE case_id=case_uuid;
 SELECT fact INTO selected FROM food_refund135_selections WHERE case_id=case_uuid;
 SELECT count(*) INTO expected FROM payments WHERE order_id=order_uuid;
 SELECT count(*) INTO allocated FROM food_return109_allocations WHERE case_id=case_uuid;
 SELECT count(*) FILTER(WHERE receipt.outcome='FINALIZED' AND receipt.posting_id IS NOT NULL),count(*) FILTER(WHERE receipt.outcome='FAILED') INTO done,failed
 FROM food_refund110_attempts attempt JOIN food_refund112_receipts receipt ON receipt.attempt_id=attempt.id WHERE attempt.case_id=case_uuid;
 SELECT count(*) INTO incidents FROM food_refund112_incidents i JOIN food_refund110_attempts a ON a.id=i.attempt_id WHERE a.case_id=case_uuid;
 SELECT count(*) INTO late FROM payments p WHERE p.order_id=order_uuid AND NOT EXISTS(SELECT 1 FROM food_return109_allocations a WHERE a.case_id=case_uuid AND a.payment_id=p.id);
 status:=CASE WHEN choice IS NULL THEN 'NOT_DECIDED'
 WHEN incidents>0 THEN 'RECONCILIATION_REQUIRED'
 WHEN choice='NO_REFUND' AND expected<>(decision->>'paymentCount')::integer THEN 'RECONCILIATION_REQUIRED'
 WHEN choice='NO_REFUND' THEN 'NOT_REQUESTED'
 WHEN late>0 OR allocated<>expected THEN 'RECONCILIATION_REQUIRED'
 WHEN allocated>0 AND done=allocated THEN CASE WHEN EXISTS(
 SELECT 1 FROM food_return109_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.case_id=case_uuid AND a.amount_minor<p.amount_minor)
 THEN 'SELECTED_FINALIZED' ELSE 'FINALIZED' END
 WHEN done>0 THEN 'PARTIAL' WHEN failed>0 THEN 'FAILED' ELSE 'PENDING' END;
 RETURN jsonb_build_object('caseId',case_uuid,'state',status,'paymentCount',expected,'allocationCount',allocated,'finalizedCount',done,
 'failedCount',failed,'disputed',incidents>0,'unallocatedPaymentCount',CASE WHEN choice IN('FULL_REFUND','LINE_REFUND') THEN late ELSE 0 END,
 'allPaymentsRefunded',status='FINALIZED','selectedRefund',selected);
END $$;

CREATE OR REPLACE FUNCTION food_refund119_reconcile(case_uuid uuid,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE review jsonb;actor uuid;key uuid;digest text;prior food_refund119_reconciliations;order_uuid uuid;merchant uuid;inserted integer;receipt jsonb;
BEGIN
 review:=food_return109_snapshot(case_uuid);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(case_uuid,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('refund119:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_refund119_reconciliations WHERE actor_id=actor AND command_id=key;
 IF FOUND THEN IF prior.case_id<>case_uuid OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF review->>'shipmentVersion' IS DISTINCT FROM payload->>'expectedVersion' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF coalesce(review->'decision'->>'decision','') NOT IN('FULL_REFUND','LINE_REFUND') THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 SELECT r.order_id,r.merchant_id INTO STRICT order_uuid,merchant FROM food_return108_financial_reviews r WHERE r.case_id=case_uuid;
 PERFORM 1 FROM payments WHERE merchant_id=merchant AND order_id=order_uuid ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM payments p WHERE p.order_id=order_uuid AND EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id))
 OR EXISTS(SELECT 1 FROM payments p LEFT JOIN payment_attempt_assets a ON(a.attempt_id,a.order_id,a.merchant_id)=(p.attempt_id,p.order_id,p.merchant_id)
 WHERE p.order_id=order_uuid AND(a.attempt_id IS NULL OR a.payer IS NULL OR p.amount_minor<=0))
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary)
 SELECT case_uuid,p.merchant_id,p.order_id,p.id,p.amount_minor,a.descriptor,a.settlement,a.payer FROM payments p JOIN payment_attempt_assets a
 ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id)
 WHERE p.merchant_id=merchant AND p.order_id=order_uuid AND NOT EXISTS(SELECT 1 FROM food_return109_allocations old WHERE old.payment_id=p.id);
 GET DIAGNOSTICS inserted=ROW_COUNT;
 receipt:=jsonb_build_object('caseId',case_uuid,'addedPaymentCount',inserted,'executionState','PENDING','fundsTransferred',false);
 INSERT INTO food_refund119_reconciliations(case_id,actor_id,command_id,request_hash,receipt,reason) VALUES(case_uuid,actor,key,digest,receipt,payload->>'reason');
 RETURN receipt;
END $$;
