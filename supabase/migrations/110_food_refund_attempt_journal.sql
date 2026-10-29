-- Private candidate110: durable exact-byte execution journal, not funding admission
-- or ledger finalization. Requires109. No application grants / worker lane.
SET search_path=bitpos,public;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bitpos_refund_worker')THEN CREATE ROLE bitpos_refund_worker NOLOGIN;END IF;END$$;
GRANT USAGE ON SCHEMA bitpos TO bitpos_refund_worker;
-- Verified funding admission must populate this immutable binding via a separate
-- audited verifier. No public or worker insert grant, no inferred wallet balance.
CREATE TABLE food_refund110_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,payment_id uuid NOT NULL UNIQUE,
 source_owner text NOT NULL,fee_payer_owner text NOT NULL,
 funding_verification_hash text NOT NULL UNIQUE CHECK(funding_verification_hash~'^[a-f0-9]{64}$'),
 max_fee_lamports bigint NOT NULL CHECK(max_fee_lamports BETWEEN 1 AND 1000000),
 max_total_lamports bigint NOT NULL CHECK(max_total_lamports BETWEEN max_fee_lamports AND 10000000),
 FOREIGN KEY(case_id,payment_id) REFERENCES food_return109_allocations(case_id,payment_id),
 UNIQUE(id,case_id,payment_id)
);
CREATE TABLE food_refund110_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),binding_id uuid NOT NULL UNIQUE,
 case_id uuid NOT NULL,payment_id uuid NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'SIGNING' CHECK(state IN('SIGNING','PREPARED','UNKNOWN')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),prepared jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(binding_id,case_id,payment_id) REFERENCES food_refund110_bindings(id,case_id,payment_id),
 CHECK((state='SIGNING')=(prepared IS NULL))
);
CREATE TABLE food_refund110_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES food_refund110_attempts,
 attempt_version bigint NOT NULL,reason text NOT NULL CHECK(length(reason)BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(attempt_id,attempt_version,reason)
);
ALTER TABLE food_refund110_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund110_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_refund110_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund110_bindings,food_refund110_attempts,food_refund110_observations FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_refund110_binding BEFORE UPDATE OR DELETE ON food_refund110_bindings FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_refund110_observation BEFORE UPDATE OR DELETE ON food_refund110_observations FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_refund110_guard()RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_REFUND_ATTEMPT';END IF;
 IF (NEW.id,NEW.binding_id,NEW.case_id,NEW.payment_id,NEW.created_at)IS DISTINCT FROM(OLD.id,OLD.binding_id,OLD.case_id,OLD.payment_id,OLD.created_at)
 OR NEW.version<>OLD.version+1 OR (OLD.prepared IS NOT NULL AND NEW.prepared IS DISTINCT FROM OLD.prepared)
 OR NOT((OLD.state='SIGNING' AND NEW.state='PREPARED')OR(OLD.state IN('PREPARED','UNKNOWN')AND NEW.state='UNKNOWN'))THEN RAISE EXCEPTION 'IMMUTABLE_REFUND_ATTEMPT';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER guard_refund110_attempt BEFORE UPDATE OR DELETE ON food_refund110_attempts FOR EACH ROW EXECUTE FUNCTION food_refund110_guard();
CREATE FUNCTION food_refund110_worker()RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT pg_has_role(session_user,'bitpos_refund_worker','MEMBER')OR pg_has_role(session_user,'bitpos_app','MEMBER')THEN RAISE EXCEPTION 'REFUND_WORKER_ROLE_REQUIRED';END IF;
END$$;
CREATE FUNCTION food_refund110_snapshot(attempt uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_refund110_attempts;b food_refund110_bindings;r food_return109_allocations;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO a FROM food_refund110_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT b FROM food_refund110_bindings WHERE id=a.binding_id;
 SELECT * INTO STRICT r FROM food_return109_allocations WHERE(case_id,payment_id)=(a.case_id,a.payment_id);
 RETURN jsonb_build_object('attemptId',a.id,'caseId',a.case_id,'paymentId',a.payment_id,'version',a.version::text,'state',a.state,'amountMinor',r.amount_minor::text,'asset',r.asset_descriptor,'beneficiaryOwner',r.beneficiary,'sourceOwner',b.source_owner,'feePayerOwner',b.fee_payer_owner,'fundingReservationId',b.id,'fundingAvailable',false,'maxFeeLamports',b.max_fee_lamports,'maxTotalLamports',b.max_total_lamports,'prepared',a.prepared);
END$$;
-- fundingAvailable deliberately false until real funding admission/reconciliation
-- and exclusive source reservations are implemented. No signing/broadcast yet.
CREATE FUNCTION food_refund110_prepare(attempt uuid,expected bigint,payload jsonb)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_refund110_attempts;b food_refund110_bindings;r food_return109_allocations;
BEGIN
 PERFORM food_refund110_worker();SELECT * INTO a FROM food_refund110_attempts WHERE id=attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF a.version<>expected OR a.state<>'SIGNING' THEN RETURN false;END IF;
 SELECT * INTO STRICT b FROM food_refund110_bindings WHERE id=a.binding_id;
 SELECT * INTO STRICT r FROM food_return109_allocations WHERE(case_id,payment_id)=(a.case_id,a.payment_id);
 IF jsonb_typeof(payload)IS DISTINCT FROM 'object' OR payload->>'attemptId' IS DISTINCT FROM a.id::text OR payload->>'batchId' IS DISTINCT FROM a.case_id::text
 OR payload->>'amountMinor' IS DISTINCT FROM r.amount_minor::text OR payload->'asset' IS DISTINCT FROM r.asset_descriptor
 OR payload->>'recipientOwner' IS DISTINCT FROM r.beneficiary OR payload->>'sourceOwner' IS DISTINCT FROM b.source_owner OR payload->>'feePayerOwner' IS DISTINCT FROM b.fee_payer_owner
 OR payload->>'genesisHash' IS DISTINCT FROM r.asset_descriptor->>'genesisHash'
 OR coalesce(payload->>'signedBase64','')='' OR coalesce(payload->>'signature','')='' OR coalesce(payload->>'intentDigest','')!~'^[a-f0-9]{64}$'
 OR encode(sha256(decode(payload->>'signedBase64','base64')),'hex') IS DISTINCT FROM payload->>'signedBytesSha256'
 THEN RAISE EXCEPTION 'REFUND_PREPARED_IDENTITY_CONFLICT';END IF;
 IF jsonb_typeof(payload->'feeLamports')IS DISTINCT FROM 'number' OR jsonb_typeof(payload->'rentLamports')IS DISTINCT FROM 'number'
 OR(payload->>'feeLamports')!~'^[0-9]+$'OR(payload->>'rentLamports')!~'^[0-9]+$'
 OR(payload->>'feeLamports')::numeric>b.max_fee_lamports OR(payload->>'feeLamports')::numeric+(payload->>'rentLamports')::numeric>b.max_total_lamports THEN RAISE EXCEPTION 'REFUND_PREPARED_FEE_CONFLICT';END IF;
 UPDATE food_refund110_attempts SET state='PREPARED',version=version+1,prepared=payload WHERE id=a.id;RETURN true;
END$$;
CREATE FUNCTION food_refund110_unknown(attempt uuid,expected bigint,why text)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_refund110_attempts;
BEGIN
 PERFORM food_refund110_worker();IF length(why)NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO a FROM food_refund110_attempts WHERE id=attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF a.version<>expected OR a.state NOT IN('PREPARED','UNKNOWN')THEN RETURN;END IF;
 INSERT INTO food_refund110_observations(attempt_id,attempt_version,reason)VALUES(a.id,a.version,why)ON CONFLICT DO NOTHING;
 UPDATE food_refund110_attempts SET state='UNKNOWN',version=version+1 WHERE id=a.id;
END$$;
REVOKE ALL ON FUNCTION food_refund110_worker(),food_refund110_guard(),food_refund110_snapshot(uuid),food_refund110_prepare(uuid,bigint,jsonb),food_refund110_unknown(uuid,bigint,text) FROM PUBLIC,bitpos_app,bitpos_refund_worker;
-- No runtime grants, allocation, submission or finalization authority yet.
