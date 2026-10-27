-- Private candidate: exclusive liability reservation, not proof of token funding.
SET search_path=bitpos,public;
CREATE TABLE food_compensation124_reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL UNIQUE REFERENCES food_compensation120_decisions,
 actor_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,request_hash text NOT NULL,
 beneficiary_id uuid NOT NULL REFERENCES settlement088_beneficiaries,beneficiary_version bigint NOT NULL,beneficiary_owner text NOT NULL,
 fact jsonb NOT NULL,posting_id uuid NOT NULL UNIQUE REFERENCES ledger_transactions,
 reason text NOT NULL,receipt jsonb NOT NULL,state text NOT NULL DEFAULT 'HELD'CHECK(state='HELD'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(actor_id,command_id)
);
ALTER TABLE food_compensation124_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation124_reservations FROM PUBLIC,bitpos_app;
CREATE TRIGGER immutable_compensation124_reservation BEFORE UPDATE OR DELETE ON food_compensation124_reservations FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation124_reserve(return_case uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;d food_compensation120_decisions;b settlement088_beneficiaries;
 prior food_compensation124_reservations;actor uuid;key uuid;digest text;fact jsonb;reservation uuid:=gen_random_uuid();posting uuid;debit uuid;credit uuid;result jsonb;
BEGIN
 PERFORM food_return109_snapshot(return_case);SELECT * INTO STRICT c FROM food_return108_cases WHERE id=return_case;SELECT * INTO STRICT s FROM food_shipments WHERE id=c.shipment_id;
 actor:=dispatch_live_actor();key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','beneficiaryId','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'beneficiaryId')IS DISTINCT FROM 'string'OR jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(return_case,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('compensation124:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_compensation124_reservations WHERE actor_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM food_compensation124_reservations WHERE case_id=return_case)THEN RAISE EXCEPTION 'COMPENSATION_ALREADY_RESERVED';END IF;
 SELECT * INTO STRICT d FROM food_compensation120_decisions WHERE case_id=return_case;
 SELECT * INTO b FROM settlement088_beneficiaries WHERE id=(payload->>'beneficiaryId')::uuid AND merchant_id=s.merchant_id AND driver_id=d.driver_id FOR SHARE;
 IF NOT FOUND OR b.state<>'VERIFIED'OR b.ownership_proof_hash IS NULL OR b.verified_at IS NULL THEN RAISE EXCEPTION 'COMPENSATION_BENEFICIARY_REQUIRED';END IF;
 fact:=food_compensation123_payout_fact(return_case);
 IF b.provider<>'solana-devnet'OR b.public_key!~'^[1-9A-HJ-NP-Za-km-z]{32,44}$'THEN RAISE EXCEPTION 'COMPENSATION_BENEFICIARY_REQUIRED';END IF;
 INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals)VALUES('DRIVER',d.driver_id,'PAYOUT_RESERVE',d.currency,d.decimals)ON CONFLICT DO NOTHING;
 SELECT id INTO STRICT debit FROM ledger_accounts WHERE owner_kind='DRIVER'AND owner_id=d.driver_id AND purpose='PAYABLE'AND currency=d.currency AND decimals=d.decimals;
 SELECT id INTO STRICT credit FROM ledger_accounts WHERE owner_kind='DRIVER'AND owner_id=d.driver_id AND purpose='PAYOUT_RESERVE'AND currency=d.currency AND decimals=d.decimals;
 INSERT INTO ledger_transactions(source_kind,source_id,reason,currency,decimals)VALUES('FOOD_COMPENSATION_RESERVE',reservation,payload->>'reason',d.currency,d.decimals)RETURNING id INTO posting;
 INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor)VALUES(posting,1,debit,d.currency,d.decimals,d.amount_minor,0),(posting,2,credit,d.currency,d.decimals,0,d.amount_minor);
 result:=jsonb_build_object('caseId',return_case,'reservationId',reservation,'state','HELD','fundingConfirmed',false,'fundsTransferred',false);
 INSERT INTO food_compensation124_reservations(id,case_id,actor_id,command_id,request_hash,beneficiary_id,beneficiary_version,beneficiary_owner,fact,posting_id,reason,receipt)VALUES(reservation,return_case,actor,key,digest,b.id,b.version,b.public_key,fact,posting,payload->>'reason',result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION food_compensation124_reserve(uuid,jsonb)FROM PUBLIC,bitpos_app;
