-- Private candidate113: native fee credits/claims only. No submission admission.
SET search_path=bitpos,public;
ALTER TABLE funding111_references DROP CONSTRAINT funding111_references_purpose_check;
ALTER TABLE funding111_references ADD CHECK(purpose IN('DRIVER_PAYOUT','FOOD_REFUND','REFUND_FEE'));
CREATE TABLE food_refund113_credits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),policy_id uuid NOT NULL REFERENCES food_refund111_policies,
 network text NOT NULL DEFAULT 'solana-devnet' CHECK(network='solana-devnet'),
 external_reference text NOT NULL UNIQUE,recipient_owner text NOT NULL,
 amount_lamports bigint NOT NULL CHECK(amount_lamports BETWEEN 1 AND 9007199254740991),
 verification_hash text NOT NULL CHECK(verification_hash~'^[a-f0-9]{64}$'),evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE food_refund113_claims(
 attempt_id uuid PRIMARY KEY REFERENCES food_refund110_attempts,
 credit_id uuid NOT NULL REFERENCES food_refund113_credits,
 amount_lamports bigint NOT NULL CHECK(amount_lamports>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_refund113_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund113_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund113_credits,food_refund113_claims FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_refund113_credit BEFORE UPDATE OR DELETE ON food_refund113_credits FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund113_claim BEFORE UPDATE OR DELETE ON food_refund113_claims FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_refund113_reference()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN INSERT INTO funding111_references VALUES(NEW.network,NEW.external_reference,'REFUND_FEE',NEW.id,NEW.verification_hash);RETURN NEW;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FUNDING_REFERENCE_ALREADY_ASSIGNED';END$$;
CREATE TRIGGER refund113_reference AFTER INSERT ON food_refund113_credits FOR EACH ROW EXECUTE FUNCTION food_refund113_reference();
CREATE FUNCTION food_refund113_record(policy uuid,proof jsonb,proof_hash text)RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE p food_refund111_policies;c settlement088_provider_configs;e food_refund113_credits;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO p FROM food_refund111_policies WHERE id=policy;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM settlement088_merchant_root((SELECT merchant_id FROM settlement088_provider_configs WHERE id=p.config_id));
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=p.config_id FOR SHARE;
 IF NOT p.enabled OR NOT c.enabled OR p.config_version<>c.version THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF jsonb_typeof(proof)IS DISTINCT FROM 'object'OR proof->>'kind' IS DISTINCT FROM 'FINALIZED_NATIVE_FEE_FUNDING'OR proof->>'version' IS DISTINCT FROM '1'
 OR proof->>'genesisHash' IS DISTINCT FROM c.genesis_hash OR proof->>'recipientOwner' IS DISTINCT FROM c.fee_payer_public_key
 OR NOT coalesce(settlement088_public_key(proof->>'signature',64),false)
 OR coalesce(proof->>'amountLamports','')!~'^[1-9][0-9]{0,15}$'OR(proof->>'amountLamports')::numeric>9007199254740991
 OR coalesce(proof->>'messageSha256','')!~'^[a-f0-9]{64}$'OR coalesce(proof->>'slot','')!~'^(0|[1-9][0-9]{0,15})$'
 OR proof_hash IS NULL OR proof_hash!~'^[a-f0-9]{64}$'THEN RAISE EXCEPTION 'INVALID_FEE_FUNDING_EVIDENCE';END IF;
 SELECT * INTO e FROM food_refund113_credits WHERE external_reference=proof->>'signature';
 IF FOUND THEN IF e.policy_id<>p.id OR e.verification_hash<>proof_hash OR e.evidence<>proof THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN e.id;END IF;
 INSERT INTO food_refund113_credits(policy_id,external_reference,recipient_owner,amount_lamports,verification_hash,evidence)
 VALUES(p.id,proof->>'signature',c.fee_payer_public_key,(proof->>'amountLamports')::bigint,proof_hash,proof)RETURNING * INTO e;RETURN e.id;
END$$;
CREATE FUNCTION food_refund113_reserve(credit uuid,attempt uuid)RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e food_refund113_credits;a food_refund110_attempts;b food_refund110_bindings;p food_refund111_policies;c settlement088_provider_configs;prior food_refund113_claims;used numeric;s food_shipments;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO a FROM food_refund110_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root((SELECT shipment_id FROM food_return108_cases WHERE id=a.case_id));
 SELECT * INTO STRICT a FROM food_refund110_attempts WHERE id=attempt FOR UPDATE;
 SELECT * INTO e FROM food_refund113_credits WHERE id=credit FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT b FROM food_refund110_bindings WHERE id=a.binding_id;
 SELECT * INTO STRICT p FROM food_refund111_policies WHERE id=e.policy_id;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=p.config_id FOR SHARE;
 IF NOT p.enabled OR NOT c.enabled OR p.config_version<>c.version OR c.merchant_id<>s.merchant_id
 OR c.fee_payer_public_key<>b.fee_payer_owner OR c.sender_public_key<>b.source_owner OR e.recipient_owner<>b.fee_payer_owner
 OR NOT EXISTS(SELECT 1 FROM food_refund111_claims t JOIN food_refund111_credits tc ON tc.id=t.credit_id WHERE t.binding_id=b.id AND tc.policy_id=p.id)
 THEN RAISE EXCEPTION 'REFUND_FEE_POLICY_CONFLICT';END IF;
 SELECT * INTO prior FROM food_refund113_claims WHERE attempt_id=a.id;
 IF FOUND THEN IF prior.credit_id<>e.id OR prior.amount_lamports<>b.max_total_lamports THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.amount_lamports;END IF;
 IF a.state<>'SIGNING'THEN RAISE EXCEPTION 'REFUND_FEE_RESERVATION_REQUIRED_BEFORE_SIGNING';END IF;
 SELECT coalesce(sum(amount_lamports),0)INTO used FROM food_refund113_claims WHERE credit_id=e.id;
 IF used+b.max_total_lamports>e.amount_lamports THEN RAISE EXCEPTION 'REFUND_FEE_FUNDING_INSUFFICIENT';END IF;
 INSERT INTO food_refund113_claims(attempt_id,credit_id,amount_lamports)VALUES(a.id,e.id,b.max_total_lamports);RETURN b.max_total_lamports;
END$$;
REVOKE ALL ON FUNCTION food_refund113_reference(),food_refund113_record(uuid,jsonb,text),food_refund113_reserve(uuid,uuid) FROM PUBLIC,bitpos_app,bitpos_refund_worker;
-- Claims remain held through unknown/failure; no auto release or replacement.
CREATE FUNCTION food_refund113_config(policy uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE p food_refund111_policies;c settlement088_provider_configs;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO p FROM food_refund111_policies WHERE id=policy;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=p.config_id;
 RETURN jsonb_build_object('policyId',p.id,'configVersion',p.config_version::text,'enabled',p.enabled AND c.enabled AND p.config_version=c.version,'feePayerOwner',c.fee_payer_public_key,'genesisHash',c.genesis_hash);
END$$;
CREATE FUNCTION food_refund113_lookup(policy uuid,signature text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE cfg jsonb;e food_refund113_credits;
BEGIN
 cfg:=food_refund113_config(policy);IF(cfg->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 SELECT * INTO e FROM food_refund113_credits WHERE external_reference=signature;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF e.policy_id<>policy THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 RETURN jsonb_build_object('creditId',e.id,'policyId',e.policy_id,'signature',e.external_reference,'amountLamports',e.amount_lamports::text,'verificationHash',e.verification_hash);
END$$;
REVOKE ALL ON FUNCTION food_refund113_config(uuid),food_refund113_lookup(uuid,text)FROM PUBLIC,bitpos_app,bitpos_refund_worker;
