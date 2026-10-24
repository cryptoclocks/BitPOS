-- Private candidate: verified terminal observations and exact liability discharge.
SET search_path=bitpos,public;
CREATE TABLE food_compensation131_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES food_compensation126_intents,
 outcome text NOT NULL CHECK(outcome IN('FINALIZED','FAILED')),evidence jsonb NOT NULL,verification_hash text NOT NULL,
 posting_id uuid UNIQUE REFERENCES ledger_transactions,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(attempt_id,outcome)
);
CREATE TABLE food_compensation131_incidents(attempt_id uuid PRIMARY KEY REFERENCES food_compensation126_intents,first_outcome text NOT NULL,conflicting_outcome text NOT NULL,CHECK(first_outcome<>conflicting_outcome));
CREATE TABLE food_compensation131_costs(attempt_id uuid PRIMARY KEY REFERENCES food_compensation126_intents,receipt_id uuid NOT NULL UNIQUE REFERENCES food_compensation131_receipts,fee_lamports bigint NOT NULL,rent_lamports bigint NOT NULL,held_remainder_lamports bigint NOT NULL CHECK(held_remainder_lamports>=0));
ALTER TABLE food_compensation131_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_compensation131_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_compensation131_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation131_receipts,food_compensation131_incidents,food_compensation131_costs FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
CREATE TRIGGER immutable_compensation131_receipt BEFORE UPDATE OR DELETE ON food_compensation131_receipts FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_compensation131_incident BEFORE UPDATE OR DELETE ON food_compensation131_incidents FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_compensation131_cost BEFORE UPDATE OR DELETE ON food_compensation131_costs FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation131_record(attempt uuid,terminal text,proof jsonb,proof_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_compensation126_intents;r food_compensation124_reservations;d food_compensation120_decisions;p food_compensation128_prepared;
 prior food_compensation131_receipts;opposite food_compensation131_receipts;f food_compensation127_fee_claims;
 receipt_uuid uuid:=gen_random_uuid();posting uuid;debit uuid;credit uuid;field text;fee bigint;rent bigint;
BEGIN
 IF NOT pg_has_role(session_user,'bitpos_compensation_worker','MEMBER')OR pg_has_role(session_user,'bitpos_app','MEMBER')THEN RAISE EXCEPTION 'COMPENSATION_WORKER_REQUIRED';END IF;
 SELECT * INTO STRICT i FROM food_compensation126_intents WHERE id=attempt;
 SELECT * INTO STRICT r FROM food_compensation124_reservations WHERE id=i.reservation_id;
 PERFORM dispatch_lock_root((SELECT shipment_id FROM food_return108_cases WHERE id=r.case_id));
 SELECT * INTO STRICT i FROM food_compensation126_intents WHERE id=attempt FOR UPDATE;
 SELECT * INTO p FROM food_compensation128_prepared WHERE attempt_id=i.id;
 IF NOT FOUND OR terminal IS NULL OR terminal NOT IN('FINALIZED','FAILED')THEN RAISE EXCEPTION 'COMPENSATION_FINALITY_REQUIRED';END IF;
 SELECT * INTO STRICT d FROM food_compensation120_decisions WHERE case_id=r.case_id;
 SELECT * INTO STRICT f FROM food_compensation127_fee_claims WHERE attempt_id=i.id;
 IF proof_hash IS NULL OR proof_hash!~'^[a-f0-9]{64}$'OR jsonb_typeof(proof)IS DISTINCT FROM 'object'
 OR proof->>'genesisHash'IS DISTINCT FROM p.payload->>'genesisHash'OR proof->>'intentDigest'IS DISTINCT FROM p.payload->>'intentDigest'
 OR proof->>'signedBytesSha256'IS DISTINCT FROM p.bytes_sha256 THEN RAISE EXCEPTION 'COMPENSATION_RECEIPT_CONFLICT';END IF;
 IF terminal='FINALIZED'THEN
  IF proof->>'commitment'IS DISTINCT FROM 'finalized'OR proof->>'provider'IS DISTINCT FROM 'solana-devnet'THEN RAISE EXCEPTION 'COMPENSATION_FINALITY_REQUIRED';END IF;
  FOREACH field IN ARRAY ARRAY['attemptId','batchId','signature','amountMinor','recipientOwner','sourceOwner','recipientTokenAccount','sourceTokenAccount','memo','reference']LOOP
   IF proof->>field IS DISTINCT FROM p.payload->>field THEN RAISE EXCEPTION 'COMPENSATION_RECEIPT_CONFLICT';END IF;
  END LOOP;
  IF proof->'asset'IS DISTINCT FROM i.asset THEN RAISE EXCEPTION 'COMPENSATION_RECEIPT_CONFLICT';END IF;
  FOREACH field IN ARRAY ARRAY['sourcePreMinor','sourcePostMinor','recipientPreMinor','recipientPostMinor']LOOP
   IF coalesce(proof->>field,'')!~'^(0|[1-9][0-9]{0,19})$'THEN RAISE EXCEPTION 'COMPENSATION_RECEIPT_CONFLICT';END IF;
  END LOOP;
  IF(proof->>'sourcePreMinor')::numeric-(proof->>'sourcePostMinor')::numeric<>i.amount_minor OR(proof->>'recipientPostMinor')::numeric-(proof->>'recipientPreMinor')::numeric<>i.amount_minor THEN RAISE EXCEPTION 'COMPENSATION_RECEIPT_CONFLICT';END IF;
  IF jsonb_typeof(proof->'feeLamports')IS DISTINCT FROM 'number'OR coalesce(proof->>'feeLamports','')!~'^[0-9]{1,16}$'THEN RAISE EXCEPTION 'COMPENSATION_FEE_CONFLICT';END IF;
  fee:=(proof->>'feeLamports')::bigint;rent:=(p.payload->>'rentLamports')::bigint;
  IF fee>f.max_fee_lamports OR fee+rent>f.amount_lamports THEN RAISE EXCEPTION 'COMPENSATION_FEE_CONFLICT';END IF;
 ELSE
  IF proof->>'kind'IS DISTINCT FROM 'FINALIZED_CHAIN_FAILURE'OR proof->'transactionError'IS NULL OR proof->'transactionError'='null'::jsonb THEN RAISE EXCEPTION 'COMPENSATION_FINALITY_REQUIRED';END IF;
 END IF;
 SELECT * INTO prior FROM food_compensation131_receipts WHERE attempt_id=i.id AND outcome=terminal;
 IF FOUND THEN IF prior.evidence<>proof OR prior.verification_hash<>proof_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN jsonb_build_object('receiptId',prior.id,'postingId',prior.posting_id,'quarantined',EXISTS(SELECT 1 FROM food_compensation131_incidents WHERE attempt_id=i.id));END IF;
 SELECT * INTO opposite FROM food_compensation131_receipts WHERE attempt_id=i.id ORDER BY created_at,id LIMIT 1;
 IF FOUND THEN INSERT INTO food_compensation131_incidents VALUES(i.id,opposite.outcome,terminal)ON CONFLICT DO NOTHING;
 ELSIF terminal='FINALIZED'THEN
  SELECT id INTO STRICT debit FROM ledger_accounts WHERE owner_kind='DRIVER'AND owner_id=d.driver_id AND purpose='PAYOUT_RESERVE'AND currency=d.currency AND decimals=d.decimals;
  INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals)VALUES('PLATFORM','00000000-0000-4000-8000-000000000001','CASH_CLEARING',d.currency,d.decimals)ON CONFLICT DO NOTHING;
  SELECT id INTO STRICT credit FROM ledger_accounts WHERE owner_kind='PLATFORM'AND owner_id='00000000-0000-4000-8000-000000000001'AND purpose='CASH_CLEARING'AND currency=d.currency AND decimals=d.decimals;
  INSERT INTO ledger_transactions(source_kind,source_id,reason,currency,decimals)VALUES('FOOD_COMPENSATION_FINALIZED',receipt_uuid,'Verified finalized compensation; no automatic fee release',d.currency,d.decimals)RETURNING id INTO posting;
  INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor)VALUES(posting,1,debit,d.currency,d.decimals,d.amount_minor,0),(posting,2,credit,d.currency,d.decimals,0,d.amount_minor);
 END IF;
 INSERT INTO food_compensation131_receipts(id,attempt_id,outcome,evidence,verification_hash,posting_id)VALUES(receipt_uuid,i.id,terminal,proof,proof_hash,posting);
 IF posting IS NOT NULL THEN INSERT INTO food_compensation131_costs VALUES(i.id,receipt_uuid,fee,rent,f.amount_lamports-fee-rent);END IF;
 RETURN jsonb_build_object('receiptId',receipt_uuid,'postingId',posting,'quarantined',opposite.id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION food_compensation131_record(uuid,text,jsonb,text)FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
CREATE FUNCTION food_compensation131_stop_submission()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN IF EXISTS(SELECT 1 FROM food_compensation131_receipts WHERE attempt_id=NEW.attempt_id)THEN RAISE EXCEPTION 'COMPENSATION_TERMINAL';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION food_compensation131_stop_submission()FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
CREATE TRIGGER compensation131_terminal_submission BEFORE INSERT ON food_compensation130_submissions FOR EACH ROW EXECUTE FUNCTION food_compensation131_stop_submission();
