-- Private journal only. Payload must also pass cryptographic worker validation
-- before use; this migration confers no broadcast or completion authority.
SET search_path=bitpos,public;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bitpos_compensation_worker')THEN CREATE ROLE bitpos_compensation_worker NOLOGIN;END IF;END $$;
CREATE TABLE food_compensation128_prepared(
 attempt_id uuid PRIMARY KEY REFERENCES food_compensation126_intents,
 payload jsonb NOT NULL,signed_bytes bytea NOT NULL CHECK(octet_length(signed_bytes)BETWEEN 1 AND 1232),
 bytes_sha256 text NOT NULL,signature text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_compensation128_prepared ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation128_prepared FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
CREATE TRIGGER immutable_compensation128_prepared BEFORE UPDATE OR DELETE ON food_compensation128_prepared FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation128_prepare(attempt uuid,payload jsonb)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_compensation126_intents;r food_compensation124_reservations;f food_compensation127_fee_claims;c settlement088_provider_configs;b settlement088_beneficiaries;prior food_compensation128_prepared;raw bytea;
BEGIN
 IF NOT pg_has_role(session_user,'bitpos_compensation_worker','MEMBER')OR pg_has_role(session_user,'bitpos_app','MEMBER')THEN RAISE EXCEPTION 'COMPENSATION_WORKER_REQUIRED';END IF;
 SELECT * INTO i FROM food_compensation126_intents WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT r FROM food_compensation124_reservations WHERE id=i.reservation_id;
 PERFORM dispatch_lock_root((SELECT shipment_id FROM food_return108_cases WHERE id=r.case_id));
 SELECT * INTO STRICT i FROM food_compensation126_intents WHERE id=attempt FOR UPDATE;
 SELECT * INTO f FROM food_compensation127_fee_claims WHERE attempt_id=i.id;IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_FEE_FUNDING_REQUIRED';END IF;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=i.config_id FOR SHARE;
 SELECT * INTO STRICT b FROM settlement088_beneficiaries WHERE id=r.beneficiary_id FOR SHARE;
 IF NOT c.enabled OR c.version<>i.config_version OR b.state<>'VERIFIED'OR b.version<>r.beneficiary_version
 OR NOT EXISTS(SELECT 1 FROM food_compensation125_claims WHERE reservation_id=r.id AND config_id=i.config_id AND config_version=i.config_version AND amount_minor=i.amount_minor)
 OR NOT EXISTS(SELECT 1 FROM payment_assets WHERE descriptor=i.asset AND enabled AND verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF jsonb_typeof(payload)IS DISTINCT FROM 'object'OR payload->>'attemptId'IS DISTINCT FROM i.id::text OR payload->>'batchId'IS DISTINCT FROM r.id::text
 OR payload->>'amountMinor'IS DISTINCT FROM i.amount_minor::text OR payload->'asset'IS DISTINCT FROM i.asset
 OR payload->>'recipientOwner'IS DISTINCT FROM i.recipient_owner OR payload->>'sourceOwner'IS DISTINCT FROM i.source_owner
 OR payload->>'feePayerOwner'IS DISTINCT FROM i.fee_payer_owner OR payload->>'genesisHash'IS DISTINCT FROM i.asset->>'genesisHash'
 OR coalesce(payload->>'signedBytesSha256','')!~'^[a-f0-9]{64}$'OR coalesce(payload->>'intentDigest','')!~'^[a-f0-9]{64}$'
 OR coalesce(payload->>'signature','')=''OR coalesce(payload->>'signedBase64','')=''THEN RAISE EXCEPTION 'COMPENSATION_PREPARED_IDENTITY_CONFLICT';END IF;
 raw:=decode(payload->>'signedBase64','base64');
 IF octet_length(raw)NOT BETWEEN 1 AND 1232 OR encode(sha256(raw),'hex')<>payload->>'signedBytesSha256' THEN RAISE EXCEPTION 'COMPENSATION_PREPARED_IDENTITY_CONFLICT';END IF;
 IF jsonb_typeof(payload->'feeLamports')IS DISTINCT FROM 'number'OR jsonb_typeof(payload->'rentLamports')IS DISTINCT FROM 'number'
 OR(payload->>'feeLamports')!~'^[0-9]+$'OR(payload->>'rentLamports')!~'^[0-9]+$'
 OR(payload->>'feeLamports')::numeric>f.max_fee_lamports OR(payload->>'feeLamports')::numeric+(payload->>'rentLamports')::numeric>f.amount_lamports THEN RAISE EXCEPTION 'COMPENSATION_PREPARED_FEE_CONFLICT';END IF;
 SELECT * INTO prior FROM food_compensation128_prepared WHERE attempt_id=i.id;
 IF FOUND THEN IF prior.payload<>payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN false;END IF;
 INSERT INTO food_compensation128_prepared(attempt_id,payload,signed_bytes,bytes_sha256,signature)VALUES(i.id,payload,raw,payload->>'signedBytesSha256',payload->>'signature');RETURN true;
END $$;
REVOKE ALL ON FUNCTION food_compensation128_prepare(uuid,jsonb)FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
