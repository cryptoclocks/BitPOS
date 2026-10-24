-- Private candidate: share verified native credits with refund fee claims.
SET search_path=bitpos,public;
CREATE TABLE food_compensation127_fee_claims(
 attempt_id uuid PRIMARY KEY REFERENCES food_compensation126_intents,
 credit_id uuid NOT NULL REFERENCES food_refund113_credits,
 policy_id uuid NOT NULL REFERENCES food_refund111_policies,
 amount_lamports bigint NOT NULL CHECK(amount_lamports>0),max_fee_lamports bigint NOT NULL CHECK(max_fee_lamports>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_compensation127_fee_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation127_fee_claims FROM PUBLIC,bitpos_app,bitpos_settlement_worker,bitpos_refund_worker;
CREATE TRIGGER immutable_compensation127_claim BEFORE UPDATE OR DELETE ON food_compensation127_fee_claims FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation127_capacity_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE capacity bigint;used numeric;
BEGIN
 SELECT amount_lamports INTO STRICT capacity FROM food_refund113_credits WHERE id=NEW.credit_id FOR UPDATE;
 SELECT coalesce(sum(amount_lamports),0)INTO used FROM food_refund113_claims WHERE credit_id=NEW.credit_id;
 used:=used+(SELECT coalesce(sum(amount_lamports),0)FROM food_compensation127_fee_claims WHERE credit_id=NEW.credit_id);
 IF used+NEW.amount_lamports>capacity THEN RAISE EXCEPTION 'VERIFIED_FEE_FUNDING_INSUFFICIENT';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION food_compensation127_capacity_guard()FROM PUBLIC,bitpos_app,bitpos_settlement_worker,bitpos_refund_worker;
CREATE TRIGGER compensation127_shared_fee BEFORE INSERT ON food_compensation127_fee_claims FOR EACH ROW EXECUTE FUNCTION food_compensation127_capacity_guard();
CREATE TRIGGER refund127_shared_fee BEFORE INSERT ON food_refund113_claims FOR EACH ROW EXECUTE FUNCTION food_compensation127_capacity_guard();
CREATE FUNCTION food_compensation127_reserve(attempt uuid,credit uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_compensation126_intents;e food_refund113_credits;p food_refund111_policies;c settlement088_provider_configs;prior food_compensation127_fee_claims;
BEGIN
 SELECT * INTO i FROM food_compensation126_intents WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM food_compensation126_allocate(i.reservation_id);
 SELECT * INTO e FROM food_refund113_credits WHERE id=credit FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_FEE_FUNDING_REQUIRED';END IF;
 SELECT * INTO STRICT p FROM food_refund111_policies WHERE id=e.policy_id;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=i.config_id FOR SHARE;
 IF NOT p.enabled OR NOT c.enabled OR(p.config_id,p.config_version)IS DISTINCT FROM(i.config_id,i.config_version)
 OR c.version<>i.config_version OR e.recipient_owner<>i.fee_payer_owner OR c.fee_payer_public_key<>i.fee_payer_owner
 OR e.network<>'solana-devnet' THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 SELECT * INTO prior FROM food_compensation127_fee_claims WHERE attempt_id=i.id;
 IF FOUND THEN IF prior.credit_id<>credit THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 ELSE INSERT INTO food_compensation127_fee_claims(attempt_id,credit_id,policy_id,amount_lamports,max_fee_lamports)VALUES(i.id,e.id,p.id,p.max_total_lamports,p.max_fee_lamports);END IF;
 RETURN jsonb_build_object('attemptId',i.id,'feeHeld',true,'signingReady',false,'fundsTransferred',false);
END $$;
REVOKE ALL ON FUNCTION food_compensation127_reserve(uuid,uuid)FROM PUBLIC,bitpos_app,bitpos_settlement_worker,bitpos_refund_worker;
