-- Private compensation payout fact; no batch/claim/signing/submission authority.
-- Frozen original receipt conversion, derived from settlement088_payout_fact.
SET search_path=bitpos,public;
CREATE FUNCTION food_compensation123_payout_fact(return_case uuid,received_payment uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE f food_compensation120_decisions;s food_shipments;oa order_authority;p payments;side payment_attempt_assets;q payment_quotes;
 policy jsonb;asset jsonb;n numeric;den numeric;product numeric;atoms numeric;received bigint;
BEGIN
 SELECT * INTO STRICT f FROM food_compensation120_decisions WHERE case_id=return_case;
 SELECT sh.* INTO STRICT s FROM food_shipments sh JOIN food_return108_cases c ON c.shipment_id=sh.id WHERE c.id=return_case;
 IF f.amount_minor<=0 OR f.posting_id IS NULL THEN RAISE EXCEPTION 'SETUP_REQUIRED_PAYOUT_AMOUNT';END IF;
 IF NOT EXISTS(SELECT 1 FROM food_return108_cases c JOIN food_assignments a ON a.id=c.assignment_id WHERE c.id=return_case AND a.driver_id=f.driver_id AND a.state='RETURNED'AND s.state='FAILED')THEN RAISE EXCEPTION 'COMPENSATION_REVIEW_REQUIRED';END IF;
 PERFORM settlement088_assert_posting(f.posting_id,'FOOD_RETURN_COMPENSATION',return_case,
 (SELECT id FROM ledger_accounts WHERE owner_kind='PLATFORM'AND owner_id='00000000-0000-4000-8000-000000000001'AND purpose='RECEIVABLE'AND currency=f.currency AND decimals=f.decimals),
 (SELECT id FROM ledger_accounts WHERE owner_kind='DRIVER'AND owner_id=f.driver_id AND purpose='PAYABLE'AND currency=f.currency AND decimals=f.decimals),f.amount_minor,f.currency,f.decimals);
 IF EXISTS(SELECT 1 FROM ledger_transactions WHERE reverses_id=f.posting_id)THEN RAISE EXCEPTION 'COMPENSATION_REVIEW_REQUIRED';END IF;
 SELECT * INTO STRICT oa FROM order_authority WHERE merchant_id=s.merchant_id AND order_id=s.order_id;
 IF received_payment IS NULL THEN
  IF (SELECT count(*) FROM payments WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND state='SETTLED')<>1 THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_RECEIPT';END IF;
  SELECT * INTO STRICT p FROM payments WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND state='SETTLED';
 ELSE
  SELECT * INTO p FROM payments WHERE id=received_payment AND merchant_id=s.merchant_id AND order_id=s.order_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_RECEIPT';END IF;
 END IF;
 SELECT * INTO side FROM payment_attempt_assets WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND attempt_id=p.attempt_id;
 IF side.attempt_id IS NULL THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_ASSET';END IF;
 SELECT * INTO STRICT q FROM payment_quotes WHERE id=side.quote_id AND merchant_id=s.merchant_id AND order_id=s.order_id;
 asset:=side.descriptor;policy:=side.settlement->'denominationPolicy';
 IF (q.original_quote_id,q.price_currency,q.price_total_minor,q.descriptor,q.settlement)
 IS DISTINCT FROM (oa.quote_id,oa.catalog_currency,oa.total_minor::numeric,side.descriptor,side.settlement)
 OR (f.currency,f.decimals) IS DISTINCT FROM (oa.catalog_currency,oa.catalog_decimals)
 OR jsonb_typeof(asset) IS DISTINCT FROM 'object' OR asset->>'cluster' IS DISTINCT FROM 'devnet'
 OR asset->>'genesisHash' IS DISTINCT FROM 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
 OR asset->>'decimals' IS DISTINCT FROM '6' OR coalesce(asset->>'symbol','') NOT IN('USDG','USDC','USDT')
 OR side.settlement->>'currency' IS DISTINCT FROM asset->>'symbol' OR side.settlement->>'decimals' IS DISTINCT FROM '6'
 OR side.settlement->>'mint' IS DISTINCT FROM asset->>'mint' OR side.settlement->>'tokenProgram' IS DISTINCT FROM asset->>'tokenProgram'
 OR side.settlement->>'genesisHash' IS DISTINCT FROM asset->>'genesisHash'
 THEN RAISE EXCEPTION 'SETUP_REQUIRED_FROZEN_DENOMINATION';END IF;
 IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR jsonb_typeof(policy->'id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(policy->'numerator') IS DISTINCT FROM 'string' OR jsonb_typeof(policy->'denominator') IS DISTINCT FROM 'string'
 OR coalesce(policy->>'numerator','')!~'^[1-9][0-9]{0,19}$' OR coalesce(policy->>'denominator','')!~'^[1-9][0-9]{0,19}$'
 THEN RAISE EXCEPTION 'SETUP_REQUIRED_FROZEN_POLICY';END IF;
 n:=(policy->>'numerator')::numeric;den:=(policy->>'denominator')::numeric;
 IF n>18446744073709551615 OR den>18446744073709551615 OR (f.currency='USDG' AND (f.decimals<>6 OR n<>1 OR den<>1 OR asset->>'symbol'<>'USDG'))
 THEN RAISE EXCEPTION 'SETUP_REQUIRED_FROZEN_POLICY';END IF;
 IF coalesce(side.settlement->>'amountMinor','')!~'^[1-9][0-9]{0,17}$' OR jsonb_typeof(side.settlement->'amountMinor') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_AMOUNT';END IF;
 received:=(side.settlement->>'amountMinor')::bigint;
 IF p.amount_minor<>received OR mod(oa.total_minor::numeric*n,den)<>0 OR oa.total_minor::numeric*n/den<>received THEN RAISE EXCEPTION 'SETUP_REQUIRED_POLICY_RECEIPT_MISMATCH';END IF;
 product:=f.amount_minor::numeric*n;
 IF mod(product,den)<>0 THEN RAISE EXCEPTION 'SETUP_REQUIRED_NONDIVISIBLE_PAYOUT';END IF;
 atoms:=product/den;
 IF atoms<=0 OR atoms>999999999999999999 THEN RAISE EXCEPTION 'SETUP_REQUIRED_PAYOUT_AMOUNT';END IF;
 RETURN jsonb_build_object('caseId',return_case,'driverId',f.driver_id,'policyId',f.policy_id,'obligationMinor',f.amount_minor::text,'paymentId',p.id,'paymentQuoteId',q.id,'originalQuoteId',oa.quote_id,'payoutMinor',atoms::bigint::text,
 'payoutCurrency',asset->>'symbol','payoutDecimals',6,'asset',asset,'denominationPolicy',policy);
END $$;
REVOKE ALL ON FUNCTION food_compensation123_payout_fact(uuid,uuid)FROM PUBLIC,bitpos_app;
