-- Private candidate: commit unknown-outcome admission before external broadcast.
SET search_path=bitpos,public;
CREATE TABLE food_compensation130_submissions(
 attempt_id uuid NOT NULL REFERENCES food_compensation126_intents,sequence bigint NOT NULL CHECK(sequence>0),
 bytes_sha256 text NOT NULL,state text NOT NULL DEFAULT 'UNKNOWN'CHECK(state='UNKNOWN'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(attempt_id,sequence)
);
ALTER TABLE food_compensation130_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation130_submissions FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
CREATE TRIGGER immutable_compensation130_submission BEFORE UPDATE OR DELETE ON food_compensation130_submissions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation130_authorize(attempt uuid,expected bigint,bytes_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE snapshot jsonb;i food_compensation126_intents;claim food_compensation125_claims;prepared food_compensation128_prepared;counted bigint;
BEGIN
 snapshot:=food_compensation129_snapshot(attempt);
 IF expected IS NULL OR expected<0 OR expected>=9223372036854775807 OR bytes_hash IS NULL OR bytes_hash!~'^[a-f0-9]{64}$'THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF snapshot->>'fundingAvailable'IS DISTINCT FROM 'true'THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 SELECT * INTO STRICT i FROM food_compensation126_intents WHERE id=attempt FOR UPDATE;
 SELECT * INTO prepared FROM food_compensation128_prepared WHERE attempt_id=i.id;
 IF NOT FOUND OR prepared.bytes_sha256<>bytes_hash THEN RAISE EXCEPTION 'COMPENSATION_PREPARED_IDENTITY_CONFLICT';END IF;
 SELECT * INTO STRICT claim FROM food_compensation125_claims WHERE reservation_id=i.reservation_id;
 PERFORM 1 FROM settlement088_funding_evidence WHERE id=claim.evidence_id FOR NO KEY UPDATE;
 PERFORM 1 FROM food_refund113_credits WHERE id=(SELECT credit_id FROM food_compensation127_fee_claims WHERE attempt_id=i.id)FOR UPDATE;
 IF EXISTS(SELECT 1 FROM settlement088_reconciliation_incidents x JOIN settlement088_funding_claims f ON f.batch_id=x.batch_id WHERE f.evidence_id=claim.evidence_id AND x.kind='LATE_SUCCESS_AFTER_RELEASE')THEN RAISE EXCEPTION 'FUNDING_RECONCILIATION_REQUIRED';END IF;
 SELECT count(*)INTO counted FROM food_compensation130_submissions WHERE attempt_id=i.id;
 IF counted<>expected THEN RETURN NULL;END IF;
 INSERT INTO food_compensation130_submissions(attempt_id,sequence,bytes_sha256)VALUES(i.id,counted+1,prepared.bytes_sha256);
 RETURN jsonb_build_object('attemptId',i.id,'sequence',(counted+1)::text,'state','UNKNOWN','signedBytesSha256',prepared.bytes_sha256,'fundsTransferred',false);
END $$;
REVOKE ALL ON FUNCTION food_compensation130_authorize(uuid,bigint,text)FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
