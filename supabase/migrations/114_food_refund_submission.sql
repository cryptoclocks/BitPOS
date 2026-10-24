-- Private candidate114; explicit token+native fee reservations and immutable
-- signed payload must exist before this CAS barrier. No runtime grants.
SET search_path=bitpos,public;
CREATE TABLE food_refund114_submissions(
 attempt_id uuid NOT NULL REFERENCES food_refund110_attempts,attempt_version bigint NOT NULL,
 signature text NOT NULL,signed_bytes_hash text NOT NULL CHECK(signed_bytes_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(attempt_id,attempt_version)
);
ALTER TABLE food_refund114_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund114_submissions FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_refund114_submission BEFORE UPDATE OR DELETE ON food_refund114_submissions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_refund114_snapshot(attempt uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE value jsonb;ready boolean;
BEGIN
 value:=food_refund112_snapshot(attempt);
 SELECT EXISTS(SELECT 1 FROM food_refund110_attempts a JOIN food_refund110_bindings b ON b.id=a.binding_id
 JOIN food_refund111_claims token ON token.binding_id=b.id JOIN food_refund111_credits tc ON tc.id=token.credit_id
 JOIN food_refund111_policies p ON p.id=tc.policy_id JOIN settlement088_provider_configs c ON c.id=p.config_id
 JOIN food_refund113_claims fee ON fee.attempt_id=a.id JOIN food_refund113_credits fc ON fc.id=fee.credit_id
 JOIN food_refund112_claim_postings ledger ON ledger.binding_id=b.id
 JOIN food_return109_allocations allocation ON(allocation.case_id,allocation.payment_id)=(a.case_id,a.payment_id)
 WHERE a.id=attempt AND p.enabled AND c.enabled AND c.version=p.config_version
 AND fc.policy_id=p.id AND fc.recipient_owner=b.fee_payer_owner AND c.fee_payer_public_key=b.fee_payer_owner AND c.sender_public_key=b.source_owner
 AND c.asset_descriptor=allocation.asset_descriptor AND token.amount_minor=allocation.amount_minor AND fee.amount_lamports>=b.max_total_lamports
 AND NOT EXISTS(SELECT 1 FROM refunds WHERE payment_id=a.payment_id)
 AND NOT EXISTS(SELECT 1 FROM food_refund112_receipts WHERE attempt_id=a.id)
 AND EXISTS(SELECT 1 FROM payment_assets WHERE asset_id=c.asset_descriptor->>'assetId'AND descriptor=c.asset_descriptor AND enabled AND verified_at IS NOT NULL))INTO ready;
 RETURN value||jsonb_build_object('fundingAvailable',ready);
END$$;
CREATE FUNCTION food_refund114_submit(attempt uuid,expected bigint,bytes_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_refund110_attempts;s food_shipments;value jsonb;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO a FROM food_refund110_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root((SELECT shipment_id FROM food_return108_cases WHERE id=a.case_id));
 SELECT * INTO STRICT a FROM food_refund110_attempts WHERE id=attempt FOR UPDATE;
 IF a.version<>expected THEN RETURN NULL;END IF;
 PERFORM 1 FROM food_refund111_claims cl JOIN food_refund111_credits e ON e.id=cl.credit_id JOIN food_refund111_policies p ON p.id=e.policy_id JOIN settlement088_provider_configs cfg ON cfg.id=p.config_id WHERE cl.binding_id=a.binding_id FOR SHARE OF cfg;
 value:=food_refund114_snapshot(a.id);
 IF a.state NOT IN('PREPARED','UNKNOWN')OR(value->>'fundingAvailable')::boolean IS DISTINCT FROM true OR a.prepared IS NULL
 OR a.prepared->>'signedBytesSha256' IS DISTINCT FROM bytes_hash
 OR encode(sha256(decode(a.prepared->>'signedBase64','base64')),'hex')IS DISTINCT FROM bytes_hash
 OR(a.prepared->>'feeLamports')::numeric+(a.prepared->>'rentLamports')::numeric>(SELECT amount_lamports FROM food_refund113_claims WHERE attempt_id=a.id)
 THEN RAISE EXCEPTION 'REFUND_SUBMISSION_NOT_READY';END IF;
 -- All statuses remain UNKNOWN until verified finality; absence is not failure.
 UPDATE food_refund110_attempts SET state='UNKNOWN',version=version+1 WHERE id=a.id RETURNING * INTO a;
 INSERT INTO food_refund114_submissions(attempt_id,attempt_version,signature,signed_bytes_hash)VALUES(a.id,a.version,a.prepared->>'signature',bytes_hash);
 RETURN food_refund114_snapshot(a.id);
END$$;
REVOKE ALL ON FUNCTION food_refund114_snapshot(uuid),food_refund114_submit(uuid,bigint,text)FROM PUBLIC,bitpos_app,bitpos_refund_worker;
