-- Private candidate111. Verified inbound credits and exclusive reservations;
-- no submission/finalization grants or automatically enabled worker.
SET search_path=bitpos,public;
CREATE TABLE funding111_references(
 network text NOT NULL,external_reference text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('DRIVER_PAYOUT','FOOD_REFUND')),record_id uuid NOT NULL,
 verification_hash text NOT NULL CHECK(verification_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(network,external_reference),UNIQUE(purpose,record_id)
);
INSERT INTO funding111_references SELECT network,external_reference,'DRIVER_PAYOUT',id,verification_hash FROM settlement088_funding_evidence;
CREATE TABLE food_refund111_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),config_id uuid NOT NULL REFERENCES settlement088_provider_configs,
 config_version bigint NOT NULL CHECK(config_version>0),enabled boolean NOT NULL DEFAULT false,
 max_fee_lamports bigint NOT NULL CHECK(max_fee_lamports BETWEEN 1 AND 1000000),
 max_total_lamports bigint NOT NULL CHECK(max_total_lamports BETWEEN max_fee_lamports AND 10000000)
);
CREATE TABLE food_refund111_credits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),policy_id uuid NOT NULL REFERENCES food_refund111_policies,
 network text NOT NULL CHECK(network='solana-devnet'),external_reference text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),verification_hash text NOT NULL CHECK(verification_hash~'^[a-f0-9]{64}$'),
 provider_evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(network,external_reference)
);
CREATE TABLE food_refund111_claims(
 binding_id uuid PRIMARY KEY REFERENCES food_refund110_bindings,credit_id uuid NOT NULL REFERENCES food_refund111_credits,
 case_id uuid NOT NULL,payment_id uuid NOT NULL UNIQUE,amount_minor bigint NOT NULL CHECK(amount_minor>0),
 FOREIGN KEY(case_id,payment_id) REFERENCES food_return109_allocations(case_id,payment_id),
 state text NOT NULL DEFAULT 'HELD' CHECK(state='HELD'),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refund111_credit_claims ON food_refund111_claims(credit_id);
ALTER TABLE funding111_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund111_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund111_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund111_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON funding111_references,food_refund111_policies,food_refund111_credits,food_refund111_claims FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_funding111_reference BEFORE UPDATE OR DELETE ON funding111_references FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund111_policy BEFORE UPDATE OR DELETE ON food_refund111_policies FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund111_credit BEFORE UPDATE OR DELETE ON food_refund111_credits FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund111_claim BEFORE UPDATE OR DELETE ON food_refund111_claims FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION funding111_register()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 INSERT INTO funding111_references VALUES(NEW.network,NEW.external_reference,CASE TG_TABLE_NAME WHEN 'settlement088_funding_evidence' THEN 'DRIVER_PAYOUT' ELSE 'FOOD_REFUND' END,NEW.id,NEW.verification_hash);
 RETURN NEW;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FUNDING_REFERENCE_ALREADY_ASSIGNED';
END$$;
CREATE TRIGGER funding111_payout_register AFTER INSERT ON settlement088_funding_evidence FOR EACH ROW EXECUTE FUNCTION funding111_register();
CREATE TRIGGER funding111_refund_register AFTER INSERT ON food_refund111_credits FOR EACH ROW EXECUTE FUNCTION funding111_register();
CREATE FUNCTION food_refund111_record(policy uuid,proof jsonb,proof_hash text)RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE p food_refund111_policies;c settlement088_provider_configs;e food_refund111_credits;amount bigint;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO p FROM food_refund111_policies WHERE id=policy;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM settlement088_merchant_root((SELECT merchant_id FROM settlement088_provider_configs WHERE id=p.config_id));
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=p.config_id FOR SHARE;
 IF NOT p.enabled OR NOT c.enabled OR p.config_version<>c.version THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF jsonb_typeof(proof)IS DISTINCT FROM 'object' OR proof->>'kind' IS DISTINCT FROM 'FINALIZED_INBOUND_FUNDING' OR proof->>'version' IS DISTINCT FROM '1'
 OR proof->>'genesisHash' IS DISTINCT FROM c.genesis_hash OR proof->'asset' IS DISTINCT FROM c.asset_descriptor
 OR proof->>'recipientOwner' IS DISTINCT FROM c.sender_public_key OR NOT coalesce(settlement088_public_key(proof->>'signature',64),false)
 OR coalesce(proof->>'amountMinor','')!~'^[1-9][0-9]{0,17}$' OR coalesce(proof->>'slot','')!~'^(0|[1-9][0-9]{0,15})$'
 OR proof_hash!~'^[a-f0-9]{64}$'OR proof_hash IS NULL
 OR NOT EXISTS(SELECT 1 FROM payment_assets WHERE asset_id=c.asset_descriptor->>'assetId' AND descriptor=c.asset_descriptor AND enabled AND verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'INVALID_FUNDING_EVIDENCE';END IF;
 amount:=(proof->>'amountMinor')::bigint;
 SELECT * INTO e FROM food_refund111_credits WHERE network=c.network AND external_reference=proof->>'signature';
 IF FOUND THEN
 IF e.policy_id<>p.id OR e.verification_hash<>proof_hash OR e.provider_evidence<>proof OR e.amount_minor<>amount THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN e.id;END IF;
 INSERT INTO food_refund111_credits(policy_id,network,external_reference,amount_minor,verification_hash,provider_evidence)VALUES(p.id,c.network,proof->>'signature',amount,proof_hash,proof)RETURNING * INTO e;RETURN e.id;
END$$;
CREATE FUNCTION food_refund111_reserve(credit uuid,case_uuid uuid,payment uuid)RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e food_refund111_credits;p food_refund111_policies;c settlement088_provider_configs;r food_return109_allocations;held numeric;b uuid;a uuid;prior food_refund111_claims;s food_shipments;
BEGIN
 PERFORM food_refund110_worker();
 s:=dispatch_lock_root((SELECT shipment_id FROM food_return108_cases WHERE id=case_uuid));
 SELECT * INTO e FROM food_refund111_credits WHERE id=credit FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT p FROM food_refund111_policies WHERE id=e.policy_id;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=p.config_id FOR SHARE;
 IF NOT p.enabled OR NOT c.enabled OR c.version<>p.config_version OR c.merchant_id<>s.merchant_id THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 SELECT * INTO r FROM food_return109_allocations WHERE(case_id,payment_id)=(case_uuid,payment);
 IF NOT FOUND OR r.merchant_id<>c.merchant_id OR r.asset_descriptor<>c.asset_descriptor OR NOT coalesce(settlement088_public_key(r.beneficiary),false)THEN RAISE EXCEPTION 'REFUND_ALLOCATION_CONFLICT';END IF;
 SELECT * INTO prior FROM food_refund111_claims WHERE payment_id=r.payment_id;
 IF FOUND THEN
 IF prior.case_id<>case_uuid OR prior.credit_id<>credit OR prior.amount_minor<>r.amount_minor THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 SELECT id INTO STRICT a FROM food_refund110_attempts WHERE binding_id=prior.binding_id;RETURN a;END IF;
 IF EXISTS(SELECT 1 FROM refunds WHERE payment_id=r.payment_id)THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT coalesce(sum(amount_minor),0)INTO held FROM food_refund111_claims WHERE credit_id=e.id;
 IF held+r.amount_minor>e.amount_minor THEN RAISE EXCEPTION 'REFUND_FUNDING_INSUFFICIENT';END IF;
 b:=gen_random_uuid();a:=gen_random_uuid();
 INSERT INTO food_refund110_bindings(id,case_id,payment_id,source_owner,fee_payer_owner,funding_verification_hash,max_fee_lamports,max_total_lamports)
 VALUES(b,case_uuid,payment,c.sender_public_key,c.fee_payer_public_key,encode(sha256(convert_to(jsonb_build_array(e.id,e.verification_hash,payment,r.amount_minor)::text,'UTF8')),'hex'),p.max_fee_lamports,p.max_total_lamports);
 INSERT INTO food_refund111_claims(binding_id,credit_id,case_id,payment_id,amount_minor)VALUES(b,e.id,case_uuid,payment,r.amount_minor);
 INSERT INTO food_refund110_attempts(id,binding_id,case_id,payment_id)VALUES(a,b,case_uuid,payment);RETURN a;
END$$;
REVOKE ALL ON FUNCTION funding111_register(),food_refund111_record(uuid,jsonb,text),food_refund111_reserve(uuid,uuid,uuid) FROM PUBLIC,bitpos_app,bitpos_refund_worker;
-- Deliberately no submission admission:110 snapshot remains fundingAvailable=false
-- until verifier configuration, fee funding and atomic ledger effects are joined.
CREATE FUNCTION food_refund111_config(policy uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE p food_refund111_policies;c settlement088_provider_configs;registry jsonb;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO p FROM food_refund111_policies WHERE id=policy;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=p.config_id;
 SELECT descriptor INTO registry FROM payment_assets WHERE asset_id=c.asset_descriptor->>'assetId' AND enabled AND verified_at IS NOT NULL;
 RETURN jsonb_build_object('policyId',p.id,'configVersion',p.config_version::text,'enabled',p.enabled AND c.enabled AND c.version=p.config_version AND registry IS NOT NULL AND registry=c.asset_descriptor,'senderPublicKey',c.sender_public_key,'asset',c.asset_descriptor,'registryAsset',registry);
END$$;
CREATE FUNCTION food_refund111_lookup(policy uuid,signature text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE cfg jsonb;e food_refund111_credits;
BEGIN
 cfg:=food_refund111_config(policy);
 IF(cfg->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 SELECT * INTO e FROM food_refund111_credits WHERE network='solana-devnet'AND external_reference=signature;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF e.policy_id<>policy THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 RETURN jsonb_build_object('creditId',e.id,'policyId',e.policy_id,'signature',e.external_reference,'amountMinor',e.amount_minor::text,'assetId',e.provider_evidence->'asset'->>'assetId','verificationHash',e.verification_hash);
END$$;
REVOKE ALL ON FUNCTION food_refund111_config(uuid),food_refund111_lookup(uuid,text) FROM PUBLIC,bitpos_app,bitpos_refund_worker;
