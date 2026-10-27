-- Private candidate: immutable one-attempt intent. No signing/submission authority.
SET search_path=bitpos,public;
CREATE TABLE food_compensation126_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_id uuid NOT NULL UNIQUE REFERENCES food_compensation124_reservations,
 config_id uuid NOT NULL REFERENCES settlement088_provider_configs,config_version bigint NOT NULL,
 recipient_owner text NOT NULL,source_owner text NOT NULL,fee_payer_owner text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),asset jsonb NOT NULL,
 fact jsonb NOT NULL,state text NOT NULL DEFAULT 'ALLOCATED'CHECK(state='ALLOCATED'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_compensation126_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation126_intents FROM PUBLIC,bitpos_app,bitpos_settlement_worker;
CREATE TRIGGER immutable_compensation126_intent BEFORE UPDATE OR DELETE ON food_compensation126_intents FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation126_allocate(reservation uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_compensation124_reservations;claim food_compensation125_claims;c settlement088_provider_configs;i food_compensation126_intents;
BEGIN
 SELECT * INTO r FROM food_compensation124_reservations WHERE id=reservation;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM food_return109_snapshot(r.case_id);
 SELECT * INTO STRICT r FROM food_compensation124_reservations WHERE id=reservation FOR UPDATE;
 SELECT * INTO claim FROM food_compensation125_claims WHERE reservation_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_FUNDING_REQUIRED';END IF;
 -- Rechecks live actor/beneficiary/config/asset and credit reconciliation even on retry.
 PERFORM food_compensation125_claim(r.id,claim.evidence_id);
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=claim.config_id FOR SHARE;
 SELECT * INTO i FROM food_compensation126_intents WHERE reservation_id=r.id;
 IF NOT FOUND THEN
  INSERT INTO food_compensation126_intents(reservation_id,config_id,config_version,recipient_owner,source_owner,fee_payer_owner,amount_minor,asset,fact)
  VALUES(r.id,c.id,c.version,r.beneficiary_owner,c.sender_public_key,c.fee_payer_public_key,claim.amount_minor,c.asset_descriptor,r.fact)RETURNING * INTO i;
 END IF;
 IF(i.config_id,i.config_version,i.recipient_owner,i.source_owner,i.fee_payer_owner,i.amount_minor,i.asset,i.fact)
 IS DISTINCT FROM(c.id,c.version,r.beneficiary_owner,c.sender_public_key,c.fee_payer_public_key,claim.amount_minor,c.asset_descriptor,r.fact)THEN RAISE EXCEPTION 'COMPENSATION_INTENT_CHANGED';END IF;
 RETURN jsonb_build_object('attemptId',i.id,'reservationId',r.id,'state','ALLOCATED','signingReady',false,'fundsTransferred',false);
END $$;
REVOKE ALL ON FUNCTION food_compensation126_allocate(uuid)FROM PUBLIC,bitpos_app,bitpos_settlement_worker;
