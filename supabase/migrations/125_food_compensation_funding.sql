-- Private candidate: share existing verified payout credits, never copy credits.
SET search_path=bitpos,public;
CREATE TABLE food_compensation125_claims(
 reservation_id uuid PRIMARY KEY REFERENCES food_compensation124_reservations,
 evidence_id uuid NOT NULL REFERENCES settlement088_funding_evidence,
 config_id uuid NOT NULL REFERENCES settlement088_provider_configs,config_version bigint NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_compensation125_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation125_claims FROM PUBLIC,bitpos_app;
CREATE TRIGGER immutable_compensation125_claim BEFORE UPDATE OR DELETE ON food_compensation125_claims FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
-- Both old payout insertion and compensation insertion lock the same credit row
-- and account for all held/consumed sources; old allocator cannot ignore new use.
CREATE FUNCTION food_compensation125_capacity_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE evidence uuid;capacity bigint;used numeric;
BEGIN
 evidence:=NEW.evidence_id;
 SELECT amount_minor INTO STRICT capacity FROM settlement088_funding_evidence WHERE id=evidence FOR NO KEY UPDATE;
 SELECT coalesce(sum(amount_minor),0)INTO used FROM settlement088_funding_claims WHERE evidence_id=evidence AND state IN('HELD','CONSUMED');
 used:=used+(SELECT coalesce(sum(amount_minor),0)FROM food_compensation125_claims WHERE evidence_id=evidence);
 IF used+NEW.amount_minor>capacity THEN RAISE EXCEPTION 'VERIFIED_FUNDING_INSUFFICIENT';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION food_compensation125_capacity_guard()FROM PUBLIC,bitpos_app;
CREATE TRIGGER compensation125_shared_capacity BEFORE INSERT ON food_compensation125_claims FOR EACH ROW EXECUTE FUNCTION food_compensation125_capacity_guard();
CREATE TRIGGER settlement125_shared_capacity BEFORE INSERT ON settlement088_funding_claims FOR EACH ROW EXECUTE FUNCTION food_compensation125_capacity_guard();
CREATE FUNCTION food_compensation125_claim(reservation uuid,credit uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_compensation124_reservations;e settlement088_funding_evidence;c settlement088_provider_configs;b settlement088_beneficiaries;prior food_compensation125_claims;case_uuid uuid;
BEGIN
 SELECT case_id INTO case_uuid FROM food_compensation124_reservations WHERE id=reservation;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM food_return109_snapshot(case_uuid);
 SELECT * INTO STRICT r FROM food_compensation124_reservations WHERE id=reservation FOR UPDATE;
 SELECT * INTO STRICT b FROM settlement088_beneficiaries WHERE id=r.beneficiary_id FOR SHARE;
 IF b.state<>'VERIFIED'OR b.version<>r.beneficiary_version OR b.public_key<>r.beneficiary_owner THEN RAISE EXCEPTION 'COMPENSATION_BENEFICIARY_REQUIRED';END IF;
 SELECT * INTO e FROM settlement088_funding_evidence WHERE id=credit FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_FUNDING_REQUIRED';END IF;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=e.config_id FOR SHARE;
 IF NOT c.enabled OR c.version<>e.config_version OR c.merchant_id<>b.merchant_id OR c.provider<>b.provider
 OR(c.currency,c.decimals,c.asset_descriptor)IS DISTINCT FROM(r.fact->>'payoutCurrency',(r.fact->>'payoutDecimals')::smallint,r.fact->'asset')
 OR(c.network,c.genesis_hash,c.mint_public_key,c.token_program_public_key)IS DISTINCT FROM('solana-devnet',r.fact->'asset'->>'genesisHash',r.fact->'asset'->>'mint',r.fact->'asset'->>'tokenProgram')
 OR(e.network,e.currency,e.decimals)IS DISTINCT FROM(c.network,c.currency,c.decimals)
 OR NOT EXISTS(SELECT 1 FROM payment_assets WHERE asset_id=c.asset_descriptor->>'assetId'AND descriptor=c.asset_descriptor AND enabled AND verified_at IS NOT NULL)THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM settlement088_reconciliation_incidents x JOIN settlement088_funding_claims f ON f.batch_id=x.batch_id WHERE f.evidence_id=e.id AND x.kind='LATE_SUCCESS_AFTER_RELEASE')THEN RAISE EXCEPTION 'FUNDING_RECONCILIATION_REQUIRED';END IF;
 SELECT * INTO prior FROM food_compensation125_claims WHERE reservation_id=r.id;
 IF FOUND THEN IF prior.evidence_id<>credit THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 ELSE INSERT INTO food_compensation125_claims(reservation_id,evidence_id,config_id,config_version,amount_minor)VALUES(r.id,e.id,c.id,c.version,(r.fact->>'payoutMinor')::bigint);END IF;
 RETURN jsonb_build_object('reservationId',r.id,'fundingHeld',true,'fundsTransferred',false);
END $$;
REVOKE ALL ON FUNCTION food_compensation125_claim(uuid,uuid)FROM PUBLIC,bitpos_app;
