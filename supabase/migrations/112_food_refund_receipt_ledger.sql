-- Private candidate112. Atomic inbound liability / reserve / verified finality.
-- No submission authority or runtime grants; external verification remains in
-- restricted worker provider, never client callbacks or a submitted signature.
SET search_path=bitpos,public;
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_currency_check;
ALTER TABLE ledger_accounts ADD CHECK(currency IN('USD','USDG','USDC','USDT','THB'));
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_currency_check;
ALTER TABLE ledger_transactions ADD CHECK(currency IN('USD','USDG','USDC','USDT','THB'));
CREATE TABLE food_refund112_credit_postings(credit_id uuid PRIMARY KEY REFERENCES food_refund111_credits,posting_id uuid NOT NULL UNIQUE REFERENCES ledger_transactions);
CREATE TABLE food_refund112_claim_postings(binding_id uuid PRIMARY KEY REFERENCES food_refund111_claims,approval_id uuid NOT NULL UNIQUE REFERENCES ledger_transactions,reserve_id uuid NOT NULL UNIQUE REFERENCES ledger_transactions);
CREATE TABLE food_refund112_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES food_refund110_attempts,
 outcome text NOT NULL CHECK(outcome IN('FINALIZED','FAILED')),verification_hash text NOT NULL CHECK(verification_hash~'^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL,posting_id uuid UNIQUE REFERENCES ledger_transactions,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(attempt_id,outcome),CHECK(outcome='FINALIZED'OR posting_id IS NULL)
);
CREATE TABLE food_refund112_incidents(attempt_id uuid PRIMARY KEY REFERENCES food_refund110_attempts,first_outcome text NOT NULL,conflicting_outcome text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(first_outcome<>conflicting_outcome));
ALTER TABLE food_refund112_credit_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund112_claim_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund112_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund112_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund112_credit_postings,food_refund112_claim_postings,food_refund112_receipts,food_refund112_incidents FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_refund112_credit BEFORE UPDATE OR DELETE ON food_refund112_credit_postings FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund112_claim BEFORE UPDATE OR DELETE ON food_refund112_claim_postings FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund112_receipt BEFORE UPDATE OR DELETE ON food_refund112_receipts FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund112_incident BEFORE UPDATE OR DELETE ON food_refund112_incidents FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_refund112_account(kind text,owner_uuid uuid,use_for text,denomination text,scale smallint)RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE account uuid;
BEGIN
 INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals)VALUES(kind,owner_uuid,use_for,denomination,scale)ON CONFLICT DO NOTHING;
 SELECT id INTO STRICT account FROM ledger_accounts WHERE(owner_kind,owner_id,purpose,currency,decimals)=(kind,owner_uuid,use_for,denomination,scale);RETURN account;
END$$;
CREATE FUNCTION food_refund112_post(source_type text,source_uuid uuid,amount bigint,denomination text,scale smallint,debit uuid,credit uuid)RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE posting uuid:=gen_random_uuid();
BEGIN
 INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals)VALUES(posting,source_type,source_uuid,'Canonical refund funding / obligation / reserve / finalized transfer',denomination,scale);
 INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor)VALUES(posting,1,debit,denomination,scale,amount,0),(posting,2,credit,denomination,scale,0,amount);RETURN posting;
END$$;
CREATE FUNCTION food_refund112_post_credit(credit uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e food_refund111_credits;c settlement088_provider_configs;clearing uuid;payable uuid;posting uuid;
BEGIN
 SELECT * INTO STRICT e FROM food_refund111_credits WHERE id=credit FOR UPDATE;
 IF EXISTS(SELECT 1 FROM food_refund112_credit_postings WHERE credit_id=e.id)THEN RETURN;END IF;
 SELECT cfg.* INTO STRICT c FROM food_refund111_policies p JOIN settlement088_provider_configs cfg ON cfg.id=p.config_id WHERE p.id=e.policy_id;
 clearing:=food_refund112_account('PLATFORM','00000000-0000-4000-8000-000000000001','CASH_CLEARING',c.currency,c.decimals);
 payable:=food_refund112_account('MERCHANT',c.merchant_id,'PAYABLE',c.currency,c.decimals);
 posting:=food_refund112_post('FOOD_REFUND_FUNDING',e.id,e.amount_minor,c.currency,c.decimals,clearing,payable);
 INSERT INTO food_refund112_credit_postings VALUES(e.id,posting);
END$$;
CREATE FUNCTION food_refund112_post_claim(binding uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE claim food_refund111_claims;r food_return109_allocations;customer uuid;merchant_payable uuid;customer_payable uuid;reserve uuid;approval uuid;reservation uuid;currency text;scale smallint;
BEGIN
 SELECT * INTO STRICT claim FROM food_refund111_claims WHERE binding_id=binding;
 IF EXISTS(SELECT 1 FROM food_refund112_claim_postings WHERE binding_id=binding)THEN RETURN;END IF;
 PERFORM food_refund112_post_credit(claim.credit_id);
 SELECT * INTO STRICT r FROM food_return109_allocations WHERE(case_id,payment_id)=(claim.case_id,claim.payment_id);
 SELECT s.account_id INTO STRICT customer FROM food_return108_cases c JOIN food_shipments s ON s.id=c.shipment_id WHERE c.id=r.case_id;
 currency:=r.asset_descriptor->>'symbol';scale:=(r.asset_descriptor->>'decimals')::smallint;
 merchant_payable:=food_refund112_account('MERCHANT',r.merchant_id,'PAYABLE',currency,scale);
 customer_payable:=food_refund112_account('CUSTOMER',customer,'PAYABLE',currency,scale);
 reserve:=food_refund112_account('CUSTOMER',customer,'REFUND_RESERVE',currency,scale);
 approval:=food_refund112_post('FOOD_REFUND_OBLIGATION',binding,r.amount_minor,currency,scale,merchant_payable,customer_payable);
 reservation:=food_refund112_post('FOOD_REFUND_RESERVE',binding,r.amount_minor,currency,scale,customer_payable,reserve);
 INSERT INTO food_refund112_claim_postings VALUES(binding,approval,reservation);
END$$;
CREATE FUNCTION food_refund112_post_event()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN IF TG_TABLE_NAME='food_refund111_credits'THEN PERFORM food_refund112_post_credit(NEW.id);ELSE PERFORM food_refund112_post_claim(NEW.binding_id);END IF;RETURN NEW;END$$;
CREATE TRIGGER funding112_credit_ledger AFTER INSERT ON food_refund111_credits FOR EACH ROW EXECUTE FUNCTION food_refund112_post_event();
CREATE TRIGGER funding112_claim_ledger AFTER INSERT ON food_refund111_claims FOR EACH ROW EXECUTE FUNCTION food_refund112_post_event();
DO $$DECLARE r record;BEGIN FOR r IN SELECT id FROM food_refund111_credits ORDER BY id LOOP PERFORM food_refund112_post_credit(r.id);END LOOP;FOR r IN SELECT binding_id FROM food_refund111_claims ORDER BY binding_id LOOP PERFORM food_refund112_post_claim(r.binding_id);END LOOP;END$$;
CREATE FUNCTION food_refund112_record(attempt uuid,outcome text,proof jsonb,proof_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_refund110_attempts;r food_return109_allocations;prior food_refund112_receipts;opposite food_refund112_receipts;id_uuid uuid:=gen_random_uuid();posting uuid;customer uuid;reserve uuid;clearing uuid;denomination text;scale smallint;field text;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO a FROM food_refund110_attempts WHERE id=attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF a.prepared IS NULL OR a.state NOT IN('PREPARED','UNKNOWN')OR outcome NOT IN('FINALIZED','FAILED')OR outcome IS NULL THEN RAISE EXCEPTION 'REFUND_FINALITY_REQUIRED';END IF;
 SELECT * INTO STRICT r FROM food_return109_allocations WHERE(case_id,payment_id)=(a.case_id,a.payment_id);
 IF NOT EXISTS(SELECT 1 FROM food_refund111_claims cl JOIN food_refund112_claim_postings p ON p.binding_id=cl.binding_id WHERE cl.binding_id=a.binding_id AND cl.amount_minor=r.amount_minor AND(cl.case_id,cl.payment_id)=(a.case_id,a.payment_id))THEN RAISE EXCEPTION 'REFUND_RESERVATION_REQUIRED';END IF;
 IF proof_hash IS NULL OR proof_hash!~'^[a-f0-9]{64}$'OR jsonb_typeof(proof)IS DISTINCT FROM 'object'
 OR proof->>'genesisHash' IS DISTINCT FROM a.prepared->>'genesisHash'OR proof->>'intentDigest' IS DISTINCT FROM a.prepared->>'intentDigest'OR proof->>'signedBytesSha256' IS DISTINCT FROM a.prepared->>'signedBytesSha256'
 THEN RAISE EXCEPTION 'REFUND_RECEIPT_IDENTITY_CONFLICT';END IF;
 IF outcome='FINALIZED'AND(proof->>'commitment' IS DISTINCT FROM 'finalized'OR proof->>'provider' IS DISTINCT FROM 'solana-devnet'OR proof->>'signature' IS DISTINCT FROM a.prepared->>'signature'
 OR proof->>'attemptId' IS DISTINCT FROM a.id::text OR proof->>'batchId' IS DISTINCT FROM a.case_id::text OR proof->>'amountMinor' IS DISTINCT FROM r.amount_minor::text OR proof->'asset' IS DISTINCT FROM r.asset_descriptor
 OR proof->>'recipientOwner' IS DISTINCT FROM r.beneficiary OR proof->>'sourceOwner' IS DISTINCT FROM a.prepared->>'sourceOwner'OR proof->>'recipientTokenAccount' IS DISTINCT FROM a.prepared->>'recipientTokenAccount'OR proof->>'sourceTokenAccount' IS DISTINCT FROM a.prepared->>'sourceTokenAccount'
 OR proof->>'memo' IS DISTINCT FROM a.prepared->>'memo'OR proof->>'reference' IS DISTINCT FROM a.prepared->>'reference')THEN RAISE EXCEPTION 'REFUND_RECEIPT_IDENTITY_CONFLICT';END IF;
 IF outcome='FINALIZED'THEN
 FOREACH field IN ARRAY ARRAY['sourcePreMinor','sourcePostMinor','recipientPreMinor','recipientPostMinor']LOOP
 IF coalesce(proof->>field,'')!~'^(0|[1-9][0-9]{0,19})$'THEN RAISE EXCEPTION 'REFUND_RECEIPT_IDENTITY_CONFLICT';END IF;END LOOP;
 IF(proof->>'sourcePreMinor')::numeric-(proof->>'sourcePostMinor')::numeric<>r.amount_minor OR(proof->>'recipientPostMinor')::numeric-(proof->>'recipientPreMinor')::numeric<>r.amount_minor THEN RAISE EXCEPTION 'REFUND_RECEIPT_IDENTITY_CONFLICT';END IF;
 END IF;
 IF outcome='FAILED'AND(proof->>'kind' IS DISTINCT FROM 'FINALIZED_CHAIN_FAILURE'OR proof->'transactionError' IS NULL OR proof->'transactionError'='null'::jsonb)THEN RAISE EXCEPTION 'REFUND_FINALITY_REQUIRED';END IF;
 SELECT * INTO prior FROM food_refund112_receipts v WHERE v.attempt_id=a.id AND v.outcome=food_refund112_record.outcome;
 IF FOUND THEN
 IF prior.verification_hash<>proof_hash OR prior.evidence<>proof THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 RETURN jsonb_build_object('receiptId',prior.id,'postingId',prior.posting_id,'quarantined',EXISTS(SELECT 1 FROM food_refund112_incidents WHERE attempt_id=a.id));END IF;
 SELECT * INTO opposite FROM food_refund112_receipts WHERE attempt_id=a.id ORDER BY created_at,id LIMIT 1;
 IF FOUND THEN
 INSERT INTO food_refund112_incidents(attempt_id,first_outcome,conflicting_outcome)VALUES(a.id,opposite.outcome,outcome)ON CONFLICT DO NOTHING;
 ELSIF outcome='FINALIZED'THEN
 SELECT s.account_id INTO STRICT customer FROM food_return108_cases c JOIN food_shipments s ON s.id=c.shipment_id WHERE c.id=a.case_id;
 denomination:=r.asset_descriptor->>'symbol';scale:=(r.asset_descriptor->>'decimals')::smallint;
 reserve:=food_refund112_account('CUSTOMER',customer,'REFUND_RESERVE',denomination,scale);
 -- Use the same platform identity as funding and existing ledger.
 SELECT l.id INTO STRICT clearing FROM ledger_accounts l WHERE l.owner_kind='PLATFORM'AND l.owner_id='00000000-0000-4000-8000-000000000001'AND l.purpose='CASH_CLEARING'AND l.currency=denomination AND l.decimals=scale;
 posting:=food_refund112_post('FOOD_REFUND_RECEIPT',id_uuid,r.amount_minor,denomination,scale,reserve,clearing);
 END IF;
 INSERT INTO food_refund112_receipts(id,attempt_id,outcome,verification_hash,evidence,posting_id)VALUES(id_uuid,a.id,outcome,proof_hash,proof,posting);
 RETURN jsonb_build_object('receiptId',id_uuid,'postingId',posting,'quarantined',opposite.id IS NOT NULL);
END$$;
CREATE FUNCTION food_refund112_snapshot(attempt uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE value jsonb;terminal text;
BEGIN value:=food_refund110_snapshot(attempt);SELECT outcome INTO terminal FROM food_refund112_receipts WHERE attempt_id=attempt ORDER BY created_at,id LIMIT 1;IF FOUND THEN value:=value||jsonb_build_object('state',terminal);END IF;RETURN value;END$$;
REVOKE ALL ON FUNCTION food_refund112_account(text,uuid,text,text,smallint),food_refund112_post(text,uuid,bigint,text,smallint,uuid,uuid),food_refund112_post_credit(uuid),food_refund112_post_claim(uuid),food_refund112_post_event(),food_refund112_record(uuid,text,jsonb,text),food_refund112_snapshot(uuid) FROM PUBLIC,bitpos_app,bitpos_refund_worker;
