-- Candidate for supabase/migrations/088_driver_settlement.sql. NOT APPLIED.
-- Dependency: actual runtime migrations001-087, never the colliding finance drafts.
-- No provider is provisioned here. Empty configuration/funding is deliberately unavailable.
BEGIN;
SET LOCAL search_path=bitpos,public;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bitpos_settlement_worker') THEN
  CREATE ROLE bitpos_settlement_worker NOLOGIN;
 END IF;
END $$;
GRANT USAGE ON SCHEMA bitpos TO bitpos_settlement_worker;

-- An operator provisions only audited, externally approved public adapter facts.
-- No URLs, credentials, signing keys or private wallet material belong in SQL.
CREATE TABLE settlement088_provider_configs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,
 provider text NOT NULL CHECK(provider~'^[a-z][a-z0-9_-]{0,39}$'),
 network text NOT NULL CHECK(network='solana-devnet'),genesis_hash text NOT NULL,
 mint_public_key text NOT NULL,token_program_public_key text NOT NULL,sender_public_key text NOT NULL,
 fee_payer_public_key text NOT NULL,
 currency text NOT NULL CHECK(currency IN('USDG','USDC','USDT')),decimals smallint NOT NULL CHECK(decimals=6),
 asset_descriptor jsonb NOT NULL CHECK(jsonb_typeof(asset_descriptor)='object'),
 adapter_version text NOT NULL CHECK(length(btrim(adapter_version)) BETWEEN 1 AND 100),
 enabled boolean NOT NULL DEFAULT false,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(merchant_id,provider,currency,decimals)
);
CREATE TABLE settlement088_beneficiaries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,driver_id uuid NOT NULL REFERENCES driver_occupancy,
 provider text NOT NULL CHECK(provider~'^[a-z][a-z0-9_-]{0,39}$'),public_key text NOT NULL,
 enrollment_challenge uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 enrollment_device_id uuid NOT NULL,challenge_nonce text NOT NULL DEFAULT encode(gen_random_bytes(32),'hex') CHECK(challenge_nonce~'^[0-9a-f]{64}$'),
 challenge_domain text NOT NULL DEFAULT 'bitpos.driver-settlement.v1',
 challenge_issued_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',statement_timestamp()),
 challenge_expires_at timestamptz NOT NULL DEFAULT (date_trunc('milliseconds',statement_timestamp())+interval '10 minutes'),
 CHECK(challenge_expires_at>challenge_issued_at AND challenge_expires_at<=challenge_issued_at+interval '10 minutes'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','VERIFIED','SUSPENDED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),enrolled_by uuid NOT NULL REFERENCES mobile_accounts,
 enrollment_session_id uuid NOT NULL REFERENCES mobile_sessions,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ownership_proof_hash text CHECK(ownership_proof_hash~'^[0-9a-f]{64}$'),verified_at timestamptz,
 CHECK((ownership_proof_hash IS NULL)=(verified_at IS NULL)),
 CHECK(state<>'VERIFIED' OR ownership_proof_hash IS NOT NULL)
);
CREATE TABLE settlement088_eligibility_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),accrual_id uuid NOT NULL REFERENCES earning_accruals,
 merchant_id uuid NOT NULL REFERENCES merchants,actor_account_id uuid NOT NULL REFERENCES mobile_accounts,
 session_id uuid NOT NULL REFERENCES mobile_sessions,grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,
 decision text NOT NULL CHECK(decision IN('RELEASE','HOLD')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 previous_version bigint NOT NULL,resulting_version bigint NOT NULL CHECK(resulting_version=previous_version+1),
 previous_state text NOT NULL CHECK(previous_state IN('ACCRUED','HELD','AVAILABLE')),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(accrual_id,resulting_version)
);
CREATE TABLE settlement088_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,
 driver_id uuid NOT NULL REFERENCES driver_occupancy,beneficiary_id uuid NOT NULL REFERENCES settlement088_beneficiaries,
 beneficiary_version bigint NOT NULL CHECK(beneficiary_version>0),provider text NOT NULL,
 currency text NOT NULL CHECK(currency IN('USD','USDG')),decimals smallint NOT NULL CHECK(decimals IN(2,4,6)),
 total_minor bigint NOT NULL CHECK(total_minor>0),state text NOT NULL DEFAULT 'DRAFT'
 CHECK(state IN('DRAFT','RESERVED','SIGNING','PREPARED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','CANCELLED')),
 payout_minor bigint NOT NULL CHECK(payout_minor BETWEEN 1 AND 999999999999999999),
 payout_currency text NOT NULL CHECK(payout_currency IN('USDG','USDC','USDT')),payout_decimals smallint NOT NULL CHECK(payout_decimals=6),
 asset_descriptor jsonb NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES mobile_accounts,
 created_session_id uuid NOT NULL REFERENCES mobile_sessions,created_grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,
 approved_by uuid REFERENCES mobile_accounts,approved_session_id uuid REFERENCES mobile_sessions,
 approved_grant_id uuid REFERENCES platform_staff_role_grants,approval_reason text,
 reserve_transaction_id uuid UNIQUE REFERENCES ledger_transactions,release_transaction_id uuid UNIQUE REFERENCES ledger_transactions,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(currency<>'USDG' OR decimals=6)
);
CREATE INDEX settlement088_batches_merchant ON settlement088_batches(merchant_id,id);
CREATE INDEX settlement088_batches_driver ON settlement088_batches(driver_id,id);
CREATE TABLE settlement088_items(
 batch_id uuid NOT NULL REFERENCES settlement088_batches,accrual_id uuid NOT NULL REFERENCES earning_accruals,
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,assignment_id uuid NOT NULL REFERENCES food_assignments,
 driver_id uuid NOT NULL REFERENCES driver_occupancy,earning_transaction_id uuid NOT NULL REFERENCES ledger_transactions,
 source_version bigint NOT NULL CHECK(source_version>0),amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL,decimals smallint NOT NULL,available_at timestamptz NOT NULL,
 payment_id uuid NOT NULL REFERENCES payments,payment_quote_id uuid NOT NULL REFERENCES payment_quotes,
 original_quote_id uuid NOT NULL,payout_minor bigint NOT NULL CHECK(payout_minor BETWEEN 1 AND 999999999999999999),
 payout_currency text NOT NULL,payout_decimals smallint NOT NULL CHECK(payout_decimals=6),
 asset_descriptor jsonb NOT NULL,denomination_policy jsonb NOT NULL,
 PRIMARY KEY(batch_id,accrual_id),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
-- History is never unique for the lifetime of an earning. Only an unreleased
-- claim is exclusive, including a CONFIRMED claim. A failed batch remains history.
CREATE TABLE settlement088_active_claims(
 batch_id uuid NOT NULL,accrual_id uuid NOT NULL,claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz,release_transaction_id uuid REFERENCES ledger_transactions,
 PRIMARY KEY(batch_id,accrual_id),FOREIGN KEY(batch_id,accrual_id) REFERENCES settlement088_items(batch_id,accrual_id),
 CHECK((released_at IS NULL)=(release_transaction_id IS NULL))
);
CREATE UNIQUE INDEX settlement088_one_active_source ON settlement088_active_claims(accrual_id) WHERE released_at IS NULL;

-- Each row is an independently verified deposit, NOT a receivable, payable,
-- balance snapshot, incoming customer sale or self-declared finance approval.
-- The verifier must prove a unique inbound transfer to this exact configured
-- sender; verified deposit identities are globally exclusive per network.
CREATE TABLE settlement088_funding_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),config_id uuid NOT NULL REFERENCES settlement088_provider_configs,
 config_version bigint NOT NULL CHECK(config_version>0),network text NOT NULL,external_reference text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL,decimals smallint NOT NULL,
 verification_hash text NOT NULL CHECK(verification_hash~'^[0-9a-f]{64}$'),verified_at timestamptz NOT NULL,
 provider_evidence jsonb NOT NULL CHECK(jsonb_typeof(provider_evidence)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(network,external_reference)
);
CREATE TABLE settlement088_funding_claims(
 batch_id uuid PRIMARY KEY REFERENCES settlement088_batches,evidence_id uuid NOT NULL REFERENCES settlement088_funding_evidence,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),state text NOT NULL CHECK(state IN('HELD','CONSUMED','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX settlement088_funding_claims_evidence ON settlement088_funding_claims(evidence_id,state,batch_id);
CREATE TABLE settlement088_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL UNIQUE REFERENCES settlement088_batches,
 config_id uuid NOT NULL REFERENCES settlement088_provider_configs,config_version bigint NOT NULL,
 provider text NOT NULL,network text NOT NULL,genesis_hash text NOT NULL,mint_public_key text NOT NULL,
 token_program_public_key text NOT NULL,sender_public_key text NOT NULL,recipient_public_key text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL,decimals smallint NOT NULL,
 transaction_id text,signed_bytes bytea CHECK(octet_length(signed_bytes) BETWEEN 1 AND 1232),
 signed_bytes_hash text CHECK(signed_bytes_hash~'^[0-9a-f]{64}$'),
 signed_verification_hash text CHECK(signed_verification_hash~'^[0-9a-f]{64}$'),prepared_payload jsonb,
 asset_descriptor jsonb NOT NULL,
 state text NOT NULL CHECK(state IN('SIGNING','PREPARED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 submitted_at timestamptz,UNIQUE(network,transaction_id),
 CHECK((state='SIGNING' AND transaction_id IS NULL AND signed_bytes IS NULL AND signed_bytes_hash IS NULL AND signed_verification_hash IS NULL AND prepared_payload IS NULL)
 OR (state<>'SIGNING' AND transaction_id IS NOT NULL AND signed_bytes IS NOT NULL AND signed_bytes_hash IS NOT NULL AND signed_verification_hash IS NOT NULL AND prepared_payload IS NOT NULL))
);
CREATE INDEX settlement088_attempts_reconcile ON settlement088_attempts(id) WHERE state IN('SIGNING','PREPARED','SUBMITTED','UNKNOWN');
-- One immutable verifier observation per outcome. A contradictory late success
-- after verified failure is evidence plus an incident, never another settlement.
CREATE TABLE settlement088_verified_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES settlement088_attempts,
 outcome text NOT NULL CHECK(outcome IN('CONFIRMED','FAILED')),provider text NOT NULL,network text NOT NULL,
 transaction_id text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL,decimals smallint NOT NULL,
 recipient_public_key text NOT NULL,signed_bytes_hash text NOT NULL,
 verification_hash text NOT NULL CHECK(verification_hash~'^[0-9a-f]{64}$'),verified_at timestamptz NOT NULL,
 provider_evidence jsonb NOT NULL CHECK(jsonb_typeof(provider_evidence)='object'),
 reason_code text NOT NULL CHECK(length(btrim(reason_code)) BETWEEN 1 AND 100),
 ledger_transaction_id uuid UNIQUE REFERENCES ledger_transactions,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(attempt_id,outcome),UNIQUE(network,transaction_id,outcome),
 CHECK(outcome<>'FAILED' OR ledger_transaction_id IS NULL)
);
CREATE TABLE settlement088_reconciliation_incidents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES settlement088_batches,
 attempt_id uuid NOT NULL REFERENCES settlement088_attempts,receipt_id uuid NOT NULL UNIQUE REFERENCES settlement088_verified_receipts,
 kind text NOT NULL CHECK(kind IN('LATE_SUCCESS_AFTER_RELEASE','CONTRADICTORY_FAILURE_AFTER_CONFIRMATION')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(attempt_id,kind)
);
CREATE TABLE settlement088_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES mobile_sessions,merchant_id uuid REFERENCES merchants,grant_id uuid REFERENCES platform_staff_role_grants,
 operation text NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,idempotency_key)
);
CREATE TABLE settlement088_worker_commands(
 idempotency_key uuid PRIMARY KEY,operation text NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Single strict wire boundary. Money and versions never travel as JSON floats.
CREATE FUNCTION settlement088_shape(doc jsonb,fields text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF jsonb_typeof(doc) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF NOT doc?&fields OR (SELECT count(*) FROM jsonb_object_keys(doc))<>cardinality(fields) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
END $$;
CREATE FUNCTION settlement088_integer(value jsonb,allow_zero boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value#>>'{}')!~'^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION 'INVALID_INTEGER';END IF;
 n:=(value#>>'{}')::numeric;
 IF n>9223372036854775807 OR (NOT allow_zero AND n=0) THEN RAISE EXCEPTION 'INVALID_INTEGER';END IF;RETURN n::bigint;
END $$;
CREATE FUNCTION settlement088_uuid(value jsonb) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR NOT coalesce(canonical_online_option_uuid(value#>>'{}'),false) THEN RAISE EXCEPTION 'INVALID_UUID';END IF;
 RETURN (value#>>'{}')::uuid;
END $$;
CREATE FUNCTION settlement088_text(value jsonb,minimum integer,maximum integer) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR length(btrim(value#>>'{}')) NOT BETWEEN minimum AND maximum THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 RETURN value#>>'{}';
END $$;
CREATE FUNCTION settlement088_hash(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE h text:=settlement088_text(value,64,64);
BEGIN IF h!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_HASH';END IF;RETURN h;END $$;
CREATE FUNCTION settlement088_public_key(key_text text,byte_count integer DEFAULT 32) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE alphabet constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';n numeric:=0;digit integer;i integer;leading_zeroes integer:=0;size integer:=0;
BEGIN
 IF key_text IS NULL OR length(key_text) NOT BETWEEN 1 AND 90 OR byte_count NOT IN(32,64) THEN RETURN false;END IF;
 FOR i IN 1..length(key_text) LOOP
  digit:=strpos(alphabet,substr(key_text,i,1))-1;IF digit<0 THEN RETURN false;END IF;
  IF n=0 AND digit=0 THEN leading_zeroes:=leading_zeroes+1;END IF;n:=n*58+digit;
 END LOOP;
 WHILE n>0 LOOP size:=size+1;n:=trunc(n/256);END LOOP;
 RETURN size+leading_zeroes=byte_count;
END $$;
CREATE FUNCTION settlement088_money(amount bigint,denomination text,scale smallint) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('amountMinor',amount::text,'currency',denomination,'decimals',scale)
$$;
CREATE FUNCTION settlement088_read_money(doc jsonb) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE amount bigint;
BEGIN
 PERFORM settlement088_shape(doc,ARRAY['amountMinor','currency','decimals']);amount:=settlement088_integer(doc->'amountMinor');
 IF jsonb_typeof(doc->'currency') IS DISTINCT FROM 'string' OR doc->>'currency' NOT IN('USD','USDG','USDC','USDT')
 OR jsonb_typeof(doc->'decimals') IS DISTINCT FROM 'number' OR doc->>'decimals' NOT IN('2','4','6')
 OR (doc->>'currency'<>'USD' AND doc->>'decimals'<>'6') THEN RAISE EXCEPTION 'INVALID_MONEY';END IF;RETURN amount;
END $$;
CREATE FUNCTION settlement088_mode() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'SETTLEMENT_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;END $$;
CREATE FUNCTION settlement088_merchant_root(merchant uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM settlement088_mode();PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
END $$;
CREATE FUNCTION settlement088_live_actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM mobile_sessions WHERE id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid
 AND account_id=actor AND device_id=nullif(current_setting('bitpos.mobile_device',true),'')::uuid) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN actor;
END $$;
-- All financial/source roots have already been acquired when this runs.
-- NOWAIT identity/scope locks cannot retain an inverse identity->root wait.
CREATE FUNCTION settlement088_finance_actor(merchant uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;chosen uuid;
BEGIN
 actor:=settlement088_live_actor();
 BEGIN
  SELECT g.id INTO chosen FROM platform_staff_role_grants g JOIN platform_role_scopes s ON s.grant_id=g.id
  WHERE g.account_id=actor AND g.role IN('finance','administrator') AND s.merchant_id=merchant
  AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() ORDER BY g.id LIMIT 1 FOR SHARE OF g,s NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'SETTLEMENT_AUTH_RETRY' USING ERRCODE='40001';END;
 PERFORM settlement088_live_actor();
 IF chosen IS NULL OR NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes s ON s.grant_id=g.id
  WHERE g.id=chosen AND g.account_id=actor AND g.role IN('finance','administrator') AND s.merchant_id=merchant
  AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN chosen;
END $$;
CREATE FUNCTION settlement088_payable_root(driver uuid,denomination text,scale smallint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE payable uuid;
BEGIN
 -- No FOR UPDATE: FK KEY SHARE must remain compatible with this balance fence.
 PERFORM 1 FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=driver AND purpose='PAYABLE'
 AND currency=denomination AND decimals=scale ORDER BY id FOR NO KEY UPDATE;
 SELECT id INTO payable FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=driver AND purpose='PAYABLE' AND currency=denomination AND decimals=scale;
 IF payable IS NULL THEN RAISE EXCEPTION 'PAYABLE_NOT_FOUND';END IF;RETURN payable;
END $$;
CREATE FUNCTION settlement088_lock_batch(batch uuid) RETURNS settlement088_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_batches;i record;
BEGIN
 SELECT * INTO b FROM settlement088_batches WHERE id=batch;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM settlement088_merchant_root(b.merchant_id);PERFORM settlement088_payable_root(b.driver_id,b.currency,b.decimals);
 -- Freeze canonical order/assignment parties before any mutable source state.
 FOR i IN SELECT DISTINCT order_id FROM settlement088_items WHERE batch_id=batch ORDER BY order_id LOOP
  PERFORM 1 FROM orders WHERE merchant_id=b.merchant_id AND id=i.order_id FOR UPDATE;
 END LOOP;
 FOR i IN SELECT assignment_id,accrual_id FROM settlement088_items WHERE batch_id=batch ORDER BY accrual_id LOOP
  PERFORM 1 FROM food_assignments WHERE id=i.assignment_id FOR NO KEY UPDATE;
  PERFORM 1 FROM earning_accruals WHERE id=i.accrual_id FOR NO KEY UPDATE;
 END LOOP;
 PERFORM 1 FROM settlement088_beneficiaries WHERE id=b.beneficiary_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT b FROM settlement088_batches WHERE id=batch FOR NO KEY UPDATE;RETURN b;
END $$;
CREATE FUNCTION settlement088_request_hash(operation text,target uuid,payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(operation,target,payload)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION settlement088_replay(actor uuid,key uuid,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE old settlement088_commands;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,88));
 SELECT * INTO old FROM settlement088_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF old.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN old.response;END IF;RETURN NULL;
END $$;
CREATE FUNCTION settlement088_worker_replay(key uuid,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE old settlement088_worker_commands;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(key::text,880));
 SELECT * INTO old FROM settlement088_worker_commands WHERE idempotency_key=key;
 IF FOUND THEN IF old.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN old.response;END IF;RETURN NULL;
END $$;
CREATE FUNCTION settlement088_record_command(actor uuid,key uuid,merchant uuid,grant_uuid uuid,operation text,digest text,response jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 INSERT INTO settlement088_commands(actor_account_id,idempotency_key,session_id,merchant_id,grant_id,operation,request_hash,response)
 VALUES(actor,key,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,merchant,grant_uuid,operation,digest,response)
$$;
CREATE FUNCTION settlement088_challenge(b settlement088_beneficiaries) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('version',1,'domain',(b).challenge_domain,'tenantId',(b).merchant_id,'accountId',(b).enrolled_by,'deviceId',(b).enrollment_device_id,
 'enrollmentId',(b).id,'challengeId',(b).enrollment_challenge,'nonce',(b).challenge_nonce,'destinationOwner',(b).public_key,
 'genesisHash','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
 'issuedAt',to_char((b).challenge_issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'expiresAt',to_char((b).challenge_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

-- A reusable invariant checker is also the parent integration's SQL proof lever.
-- It compares exact two-line postings, immutable whole facts and all state edges.
CREATE FUNCTION settlement088_assert_posting(posting uuid,source_type text,source_uuid uuid,debit_account uuid,credit_account uuid,amount bigint,denomination text,scale smallint,reversal uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ledger_transactions t WHERE t.id=posting AND (t.source_kind,t.source_id,t.currency,t.decimals)=(source_type,source_uuid,denomination,scale) AND t.reverses_id IS NOT DISTINCT FROM reversal)
 OR (SELECT count(*) FROM ledger_entries WHERE transaction_id=posting)<>2
 OR NOT EXISTS(SELECT 1 FROM ledger_entries WHERE transaction_id=posting AND line=1 AND account_id=debit_account AND currency=denomination AND decimals=scale AND debit_minor=amount AND credit_minor=0)
 OR NOT EXISTS(SELECT 1 FROM ledger_entries WHERE transaction_id=posting AND line=2 AND account_id=credit_account AND currency=denomination AND decimals=scale AND credit_minor=amount AND debit_minor=0)
 THEN RAISE EXCEPTION 'SETTLEMENT_EXACT_POSTING_REQUIRED' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION settlement088_assert_earning(accrual uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e earning_accruals;f earning_accrual_facts;a food_assignments;s food_shipments;d quote_delivery_snapshots;payable uuid;receivable uuid;
BEGIN
 SELECT * INTO STRICT e FROM earning_accruals WHERE id=accrual;
 SELECT * INTO STRICT f FROM earning_accrual_facts WHERE accrual_id=accrual;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=e.food_assignment_id;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
 SELECT * INTO STRICT d FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 IF a.driver_id<>e.driver_id OR a.state<>'DELIVERED' OR s.state<>'DELIVERED' OR a.closed_at IS NULL OR e.available_at<>a.closed_at
 OR (f.amount_minor,f.currency,f.decimals) IS DISTINCT FROM (d.driver_minor,d.currency,d.decimals)
 OR NOT EXISTS(SELECT 1 FROM order_allocation_finalizations WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND quote_id=s.quote_id)
 THEN RAISE EXCEPTION 'SETTLEMENT_WHOLE_EARNING_FACT_REQUIRED' USING ERRCODE='23514';END IF;
 IF f.amount_minor=0 THEN
  IF e.ledger_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'ZERO_EARNING_POSTING_REFUSED';END IF;RETURN;
 END IF;
 SELECT id INTO STRICT payable FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=e.driver_id AND purpose='PAYABLE' AND currency=f.currency AND decimals=f.decimals;
 SELECT id INTO STRICT receivable FROM ledger_accounts WHERE owner_kind='PLATFORM' AND owner_id='00000000-0000-4000-8000-000000000001' AND purpose='RECEIVABLE' AND currency=f.currency AND decimals=f.decimals;
 PERFORM settlement088_assert_posting(e.ledger_transaction_id,'EARNING_ACCRUAL',e.id,receivable,payable,f.amount_minor,f.currency,f.decimals);
 IF EXISTS(SELECT 1 FROM ledger_transactions WHERE reverses_id=e.ledger_transaction_id) THEN RAISE EXCEPTION 'EARNING_REVERSED';END IF;
END $$;
-- Conversion is exclusively from the originally received, immutable payment
-- sidecar's precision-adjusted policy, never today's merchant policy or a peg.
CREATE FUNCTION settlement088_payout_fact(accrual uuid,received_payment uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e earning_accruals;f earning_accrual_facts;s food_shipments;oa order_authority;p payments;side payment_attempt_assets;q payment_quotes;
 policy jsonb;asset jsonb;n numeric;den numeric;product numeric;atoms numeric;received bigint;
BEGIN
 SELECT * INTO STRICT e FROM earning_accruals WHERE id=accrual;SELECT * INTO STRICT f FROM earning_accrual_facts WHERE accrual_id=accrual;
 SELECT sh.* INTO STRICT s FROM food_shipments sh JOIN food_assignments a ON a.shipment_id=sh.id WHERE a.id=e.food_assignment_id;
 SELECT * INTO STRICT oa FROM order_authority WHERE merchant_id=s.merchant_id AND order_id=s.order_id;
 IF received_payment IS NULL THEN
  IF (SELECT count(*) FROM payments WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND state='SETTLED')<>1 THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_RECEIPT';END IF;
  SELECT * INTO STRICT p FROM payments WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND state='SETTLED';
 ELSE
  SELECT * INTO p FROM payments WHERE id=received_payment AND merchant_id=s.merchant_id AND order_id=s.order_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_RECEIPT';END IF;
 END IF;
 SELECT * INTO side FROM payment_attempt_assets WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND attempt_id=p.attempt_id;
 IF side.attempt_id IS NULL THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_ASSET';END IF;
 SELECT * INTO STRICT q FROM payment_quotes WHERE id=side.quote_id AND merchant_id=s.merchant_id AND order_id=s.order_id;
 asset:=side.descriptor;policy:=side.settlement->'denominationPolicy';
 IF (q.original_quote_id,q.price_currency,q.price_total_minor,q.descriptor,q.settlement)
 IS DISTINCT FROM (oa.quote_id,oa.catalog_currency,oa.total_minor::numeric,side.descriptor,side.settlement)
 OR (f.currency,f.decimals) IS DISTINCT FROM (oa.catalog_currency,oa.catalog_decimals)
 OR jsonb_typeof(asset) IS DISTINCT FROM 'object' OR asset->>'cluster' IS DISTINCT FROM 'devnet'
 OR asset->>'genesisHash' IS DISTINCT FROM 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
 OR asset->>'decimals' IS DISTINCT FROM '6' OR coalesce(asset->>'symbol','') NOT IN('USDG','USDC','USDT')
 OR side.settlement->>'currency' IS DISTINCT FROM asset->>'symbol' OR side.settlement->>'decimals' IS DISTINCT FROM '6'
 OR side.settlement->>'mint' IS DISTINCT FROM asset->>'mint' OR side.settlement->>'tokenProgram' IS DISTINCT FROM asset->>'tokenProgram'
 OR side.settlement->>'genesisHash' IS DISTINCT FROM asset->>'genesisHash'
 THEN RAISE EXCEPTION 'SETUP_REQUIRED_FROZEN_DENOMINATION';END IF;
 IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR jsonb_typeof(policy->'id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(policy->'numerator') IS DISTINCT FROM 'string' OR jsonb_typeof(policy->'denominator') IS DISTINCT FROM 'string'
 OR coalesce(policy->>'numerator','')!~'^[1-9][0-9]{0,19}$' OR coalesce(policy->>'denominator','')!~'^[1-9][0-9]{0,19}$'
 THEN RAISE EXCEPTION 'SETUP_REQUIRED_FROZEN_POLICY';END IF;
 n:=(policy->>'numerator')::numeric;den:=(policy->>'denominator')::numeric;
 IF n>18446744073709551615 OR den>18446744073709551615 OR (f.currency='USDG' AND (f.decimals<>6 OR n<>1 OR den<>1 OR asset->>'symbol'<>'USDG'))
 THEN RAISE EXCEPTION 'SETUP_REQUIRED_FROZEN_POLICY';END IF;
 IF coalesce(side.settlement->>'amountMinor','')!~'^[1-9][0-9]{0,17}$' OR jsonb_typeof(side.settlement->'amountMinor') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'SETUP_REQUIRED_ORIGINAL_AMOUNT';END IF;
 received:=(side.settlement->>'amountMinor')::bigint;
 IF p.amount_minor<>received OR mod(oa.total_minor::numeric*n,den)<>0 OR oa.total_minor::numeric*n/den<>received THEN RAISE EXCEPTION 'SETUP_REQUIRED_POLICY_RECEIPT_MISMATCH';END IF;
 product:=f.amount_minor::numeric*n;
 IF mod(product,den)<>0 THEN RAISE EXCEPTION 'SETUP_REQUIRED_NONDIVISIBLE_PAYOUT';END IF;
 atoms:=product/den;
 IF atoms<=0 OR atoms>999999999999999999 THEN RAISE EXCEPTION 'SETUP_REQUIRED_PAYOUT_AMOUNT';END IF;
 RETURN jsonb_build_object('paymentId',p.id,'paymentQuoteId',q.id,'originalQuoteId',oa.quote_id,'payoutMinor',atoms::bigint::text,
 'payoutCurrency',asset->>'symbol','payoutDecimals',6,'asset',asset,'denominationPolicy',policy);
END $$;
CREATE FUNCTION settlement088_assert_batch(batch uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 #variable_conflict use_column
DECLARE b settlement088_batches;ben settlement088_beneficiaries;a settlement088_attempts;r settlement088_verified_receipts;fund settlement088_funding_claims;i settlement088_items;fact jsonb;
 payable uuid;reserve uuid;clearing uuid;total numeric;payout_total numeric;item_count integer;
BEGIN
 SELECT * INTO STRICT b FROM settlement088_batches WHERE id=batch;
 SELECT * INTO STRICT ben FROM settlement088_beneficiaries WHERE id=b.beneficiary_id;
 SELECT count(*),coalesce(sum(amount_minor),0),coalesce(sum(payout_minor),0) INTO item_count,total,payout_total FROM settlement088_items WHERE batch_id=batch;
 IF item_count NOT BETWEEN 1 AND 50 OR total<>b.total_minor OR payout_total<>b.payout_minor
 OR (b.merchant_id,b.driver_id,b.provider) IS DISTINCT FROM (ben.merchant_id,ben.driver_id,ben.provider)
 THEN RAISE EXCEPTION 'SETTLEMENT_BATCH_IDENTITY' USING ERRCODE='23514';END IF;
 FOR i IN SELECT * FROM settlement088_items WHERE batch_id=batch ORDER BY accrual_id LOOP
  PERFORM settlement088_assert_earning(i.accrual_id);fact:=settlement088_payout_fact(i.accrual_id,i.payment_id);
  IF (i.payment_id,i.payment_quote_id,i.original_quote_id,i.payout_minor,i.payout_currency,i.payout_decimals,i.asset_descriptor,i.denomination_policy)
  IS DISTINCT FROM ((fact->>'paymentId')::uuid,(fact->>'paymentQuoteId')::uuid,(fact->>'originalQuoteId')::uuid,(fact->>'payoutMinor')::bigint,fact->>'payoutCurrency',(fact->>'payoutDecimals')::smallint,fact->'asset',fact->'denominationPolicy')
  OR (i.payout_currency,i.payout_decimals,i.asset_descriptor) IS DISTINCT FROM (b.payout_currency,b.payout_decimals,b.asset_descriptor)
  THEN RAISE EXCEPTION 'SETTLEMENT_FROZEN_PAYOUT_FACT_REQUIRED' USING ERRCODE='23514';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM settlement088_items i JOIN earning_accruals e ON e.id=i.accrual_id
  JOIN earning_accrual_facts f ON f.accrual_id=e.id JOIN food_assignments a ON a.id=e.food_assignment_id JOIN food_shipments s ON s.id=a.shipment_id
  WHERE i.batch_id=batch AND ((i.merchant_id,i.order_id,i.assignment_id,i.driver_id,i.earning_transaction_id,i.amount_minor,i.currency,i.decimals,i.available_at)
   IS DISTINCT FROM (s.merchant_id,s.order_id,a.id,e.driver_id,e.ledger_transaction_id,f.amount_minor,f.currency,f.decimals,e.available_at)
   OR (i.merchant_id,i.driver_id,i.currency,i.decimals) IS DISTINCT FROM (b.merchant_id,b.driver_id,b.currency,b.decimals)
   OR a.driver_id<>e.driver_id OR a.state<>'DELIVERED' OR s.state<>'DELIVERED' OR a.closed_at IS NULL OR e.available_at<>a.closed_at
   OR NOT EXISTS(SELECT 1 FROM order_allocation_finalizations z WHERE (z.merchant_id,z.order_id)=(s.merchant_id,s.order_id))))
 THEN RAISE EXCEPTION 'SETTLEMENT_WHOLE_EARNING_FACT_REQUIRED' USING ERRCODE='23514';END IF;
 IF b.state IN('DRAFT','CANCELLED') THEN
  IF b.reserve_transaction_id IS NOT NULL OR b.release_transaction_id IS NOT NULL OR b.approved_by IS NOT NULL
  OR EXISTS(SELECT 1 FROM settlement088_active_claims WHERE batch_id=batch)
  OR EXISTS(SELECT 1 FROM settlement088_attempts WHERE batch_id=batch) THEN RAISE EXCEPTION 'SETTLEMENT_UNRESERVED_STATE' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 IF b.approved_by IS NULL OR b.approved_session_id IS NULL OR b.approved_grant_id IS NULL OR b.approval_reason IS NULL
 THEN RAISE EXCEPTION 'SETTLEMENT_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
 payable:=settlement088_payable_root(b.driver_id,b.currency,b.decimals);
 SELECT id INTO STRICT reserve FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=b.driver_id AND purpose='PAYOUT_RESERVE' AND currency=b.currency AND decimals=b.decimals;
 PERFORM settlement088_assert_posting(b.reserve_transaction_id,'PAYOUT_RESERVE',batch,payable,reserve,b.total_minor,b.currency,b.decimals);
 IF (SELECT coalesce(sum(credit_minor-debit_minor),0) FROM ledger_entries WHERE account_id=payable)<0 THEN RAISE EXCEPTION 'PAYOUT_PAYABLE_BALANCE' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM settlement088_active_claims WHERE batch_id=batch)<>item_count THEN RAISE EXCEPTION 'SETTLEMENT_CLAIM_REQUIRED' USING ERRCODE='23514';END IF;
 IF b.state='FAILED' THEN
  PERFORM settlement088_assert_posting(b.release_transaction_id,'PAYOUT_RELEASE',batch,reserve,payable,b.total_minor,b.currency,b.decimals,b.reserve_transaction_id);
  IF EXISTS(SELECT 1 FROM settlement088_active_claims WHERE batch_id=batch AND (released_at IS NULL OR release_transaction_id IS DISTINCT FROM b.release_transaction_id))
  OR NOT EXISTS(SELECT 1 FROM settlement088_attempts a JOIN settlement088_verified_receipts r ON r.attempt_id=a.id AND r.outcome='FAILED' WHERE a.batch_id=batch AND a.state='FAILED')
  THEN RAISE EXCEPTION 'SETTLEMENT_VERIFIED_RELEASE_REQUIRED' USING ERRCODE='23514';END IF;
 ELSE
  IF b.release_transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM settlement088_active_claims WHERE batch_id=batch AND released_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM settlement088_items i JOIN earning_accruals e ON e.id=i.accrual_id WHERE i.batch_id=batch AND e.state<>(CASE WHEN b.state='CONFIRMED' THEN 'SETTLED' ELSE 'RESERVED' END))
  THEN RAISE EXCEPTION 'SETTLEMENT_SOURCE_STATE' USING ERRCODE='23514';END IF;
 END IF;
 SELECT * INTO a FROM settlement088_attempts WHERE batch_id=batch;
 IF b.state='RESERVED' THEN
  IF a.id IS NOT NULL OR EXISTS(SELECT 1 FROM settlement088_funding_claims WHERE batch_id=batch) THEN RAISE EXCEPTION 'SETTLEMENT_RESERVED_STATE' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 IF a.id IS NULL OR a.state<>b.state OR (a.provider,a.recipient_public_key,a.amount_minor,a.currency,a.decimals,a.asset_descriptor)
 IS DISTINCT FROM (b.provider,ben.public_key,b.payout_minor,b.payout_currency,b.payout_decimals,b.asset_descriptor)
 OR (a.state<>'SIGNING' AND a.signed_bytes_hash IS DISTINCT FROM encode(sha256(a.signed_bytes),'hex'))
 THEN RAISE EXCEPTION 'SETTLEMENT_ATTEMPT_IDENTITY' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM settlement088_verified_receipts vr WHERE vr.attempt_id=a.id AND
 (vr.provider,vr.network,vr.transaction_id,vr.amount_minor,vr.currency,vr.decimals,vr.recipient_public_key,vr.signed_bytes_hash)
 IS DISTINCT FROM (a.provider,a.network,a.transaction_id,a.amount_minor,a.currency,a.decimals,a.recipient_public_key,a.signed_bytes_hash))
 THEN RAISE EXCEPTION 'SETTLEMENT_RECEIPT_IDENTITY' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT fund FROM settlement088_funding_claims WHERE batch_id=batch;
 PERFORM 1 FROM settlement088_funding_evidence WHERE id=fund.evidence_id FOR NO KEY UPDATE;
 IF fund.amount_minor<>b.payout_minor OR fund.state<>(CASE b.state WHEN 'FAILED' THEN 'RELEASED' WHEN 'CONFIRMED' THEN 'CONSUMED' ELSE 'HELD' END)
 OR NOT EXISTS(SELECT 1 FROM settlement088_funding_evidence e WHERE e.id=fund.evidence_id AND (e.config_id,e.config_version,e.currency,e.decimals)=(a.config_id,a.config_version,a.currency,a.decimals))
 THEN RAISE EXCEPTION 'SETTLEMENT_VERIFIED_FUNDING_REQUIRED' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM settlement088_funding_evidence e WHERE e.id=fund.evidence_id AND e.amount_minor<(SELECT coalesce(sum(c.amount_minor),0) FROM settlement088_funding_claims c WHERE c.evidence_id=e.id AND c.state IN('HELD','CONSUMED')))
 THEN RAISE EXCEPTION 'SETTLEMENT_FUNDING_EXHAUSTED' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM settlement088_verified_receipts WHERE attempt_id=a.id AND outcome='CONFIRMED';
 IF b.state='CONFIRMED' THEN
  SELECT id INTO STRICT clearing FROM ledger_accounts WHERE owner_kind='PLATFORM' AND owner_id='00000000-0000-4000-8000-000000000001' AND purpose='CASH_CLEARING' AND currency=b.currency AND decimals=b.decimals;
  IF r.id IS NULL THEN RAISE EXCEPTION 'SETTLEMENT_RECEIPT_REQUIRED' USING ERRCODE='23514';END IF;
  PERFORM settlement088_assert_posting(r.ledger_transaction_id,'PAYOUT_RECEIPT',r.id,reserve,clearing,b.total_minor,b.currency,b.decimals);
 ELSIF r.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM settlement088_reconciliation_incidents WHERE receipt_id=r.id AND kind='LATE_SUCCESS_AFTER_RELEASE')
 THEN RAISE EXCEPTION 'SETTLEMENT_LATE_SUCCESS_INCIDENT_REQUIRED' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION settlement088_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a settlement088_attempts;
BEGIN
 SELECT * INTO STRICT a FROM settlement088_attempts WHERE id=NEW.attempt_id;
 IF a.state='SIGNING' OR (NEW.provider,NEW.network,NEW.transaction_id,NEW.amount_minor,NEW.currency,NEW.decimals,NEW.recipient_public_key,NEW.signed_bytes_hash)
 IS DISTINCT FROM (a.provider,a.network,a.transaction_id,a.amount_minor,a.currency,a.decimals,a.recipient_public_key,a.signed_bytes_hash)
 OR NEW.provider_evidence->>'genesisHash' IS DISTINCT FROM a.genesis_hash
 OR NEW.provider_evidence->>'intentDigest' IS DISTINCT FROM a.prepared_payload->>'intentDigest'
 OR NEW.provider_evidence->>'signedBytesSha256' IS DISTINCT FROM a.signed_bytes_hash
 OR (NEW.outcome='CONFIRMED' AND (NEW.provider_evidence->>'commitment' IS DISTINCT FROM 'finalized'
 OR NEW.provider_evidence->>'signature' IS DISTINCT FROM a.transaction_id OR NEW.provider_evidence->'asset' IS DISTINCT FROM a.asset_descriptor
 OR NEW.provider_evidence->>'amountMinor' IS DISTINCT FROM a.amount_minor::text))
 OR (NEW.outcome='FAILED' AND (NEW.provider_evidence->>'kind' IS DISTINCT FROM 'FINALIZED_CHAIN_FAILURE'
 OR NOT NEW.provider_evidence?'transactionError' OR NEW.provider_evidence->'transactionError'='null'::jsonb))
 THEN RAISE EXCEPTION 'SETTLEMENT_VERIFIED_RECEIPT_REQUIRED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_receipt_guard BEFORE INSERT ON settlement088_verified_receipts FOR EACH ROW EXECUTE FUNCTION settlement088_receipt_guard();
CREATE FUNCTION settlement088_receipt_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE batch uuid;
BEGIN SELECT batch_id INTO STRICT batch FROM settlement088_attempts WHERE id=NEW.attempt_id;PERFORM settlement088_assert_batch(batch);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER settlement088_receipt_event AFTER INSERT ON settlement088_verified_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_receipt_event();

-- Existing accrual identity cannot change underneath frozen settlement items.
CREATE FUNCTION settlement088_earning_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EARNING_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF (NEW.id,NEW.food_assignment_id,NEW.ride_assignment_id,NEW.driver_id,NEW.ledger_transaction_id,NEW.available_at,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.food_assignment_id,OLD.ride_assignment_id,OLD.driver_id,OLD.ledger_transaction_id,OLD.available_at,OLD.created_at)
 OR NEW.version<>OLD.version+1 OR NOT ((OLD.state IN('ACCRUED','HELD','AVAILABLE') AND NEW.state IN('HELD','AVAILABLE'))
 OR (OLD.state='AVAILABLE' AND NEW.state='RESERVED') OR (OLD.state='RESERVED' AND NEW.state IN('AVAILABLE','SETTLED')))
 THEN RAISE EXCEPTION 'EARNING_TRANSITION_REFUSED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_earning_guard BEFORE UPDATE OR DELETE ON earning_accruals FOR EACH ROW EXECUTE FUNCTION settlement088_earning_guard();
CREATE FUNCTION settlement088_source_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e earning_accruals;decision text;claim settlement088_active_claims;b settlement088_batches;
BEGIN
 SELECT * INTO STRICT e FROM earning_accruals WHERE id=NEW.id;
 SELECT d.decision INTO decision FROM settlement088_eligibility_decisions d WHERE d.accrual_id=e.id ORDER BY resulting_version DESC LIMIT 1;
 SELECT * INTO claim FROM settlement088_active_claims WHERE accrual_id=e.id AND released_at IS NULL;
 IF e.state IN('HELD','AVAILABLE') AND (decision IS DISTINCT FROM (CASE e.state WHEN 'HELD' THEN 'HOLD' ELSE 'RELEASE' END) OR claim.batch_id IS NOT NULL)
 THEN RAISE EXCEPTION 'EARNING_FINANCE_DECISION_REQUIRED' USING ERRCODE='23514';END IF;
 IF e.state IN('RESERVED','SETTLED') THEN
  IF claim.batch_id IS NULL THEN RAISE EXCEPTION 'EARNING_ACTIVE_CLAIM_REQUIRED' USING ERRCODE='23514';END IF;
  SELECT * INTO STRICT b FROM settlement088_batches WHERE id=claim.batch_id;
  IF (e.state='SETTLED') IS DISTINCT FROM (b.state='CONFIRMED') THEN RAISE EXCEPTION 'EARNING_SETTLEMENT_STATE' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER settlement088_source_event AFTER UPDATE ON earning_accruals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_source_event();
CREATE FUNCTION settlement088_claim_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_batches;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_CLAIM_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.released_at IS NOT NULL OR NEW.release_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'SETTLEMENT_CLAIM_STARTS_ACTIVE';END IF;
 ELSE
  SELECT * INTO STRICT b FROM settlement088_batches WHERE id=NEW.batch_id;
  IF (NEW.batch_id,NEW.accrual_id,NEW.claimed_at) IS DISTINCT FROM (OLD.batch_id,OLD.accrual_id,OLD.claimed_at)
  OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NEW.release_transaction_id IS DISTINCT FROM b.release_transaction_id OR b.state<>'FAILED'
  THEN RAISE EXCEPTION 'SETTLEMENT_VERIFIED_RELEASE_REQUIRED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON settlement088_active_claims FOR EACH ROW EXECUTE FUNCTION settlement088_claim_guard();
CREATE FUNCTION settlement088_batch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_BATCH_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['state','version','approved_by','approved_session_id','approved_grant_id','approval_reason','reserve_transaction_id','release_transaction_id'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','approved_by','approved_session_id','approved_grant_id','approval_reason','reserve_transaction_id','release_transaction_id'])
 OR NEW.version<>OLD.version+1 OR NOT ((OLD.state='DRAFT' AND NEW.state IN('RESERVED','CANCELLED')) OR (OLD.state='RESERVED' AND NEW.state='SIGNING') OR (OLD.state='SIGNING' AND NEW.state='PREPARED')
 OR (OLD.state='PREPARED' AND NEW.state IN('SUBMITTED','UNKNOWN','CONFIRMED','FAILED')) OR (OLD.state IN('SUBMITTED','UNKNOWN') AND NEW.state IN('UNKNOWN','CONFIRMED','FAILED')))
 OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by,NEW.approved_session_id,NEW.approved_grant_id,NEW.approval_reason,NEW.reserve_transaction_id)
 IS DISTINCT FROM (OLD.approved_by,OLD.approved_session_id,OLD.approved_grant_id,OLD.approval_reason,OLD.reserve_transaction_id))
 OR (OLD.release_transaction_id IS NOT NULL AND NEW.release_transaction_id IS DISTINCT FROM OLD.release_transaction_id)
 THEN RAISE EXCEPTION 'SETTLEMENT_BATCH_TRANSITION_REFUSED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_batch_guard BEFORE UPDATE OR DELETE ON settlement088_batches FOR EACH ROW EXECUTE FUNCTION settlement088_batch_guard();
CREATE FUNCTION settlement088_attempt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_ATTEMPT_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF ((OLD.state='SIGNING' AND (to_jsonb(NEW)-ARRAY['state','version','transaction_id','signed_bytes','signed_bytes_hash','signed_verification_hash','prepared_payload'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','transaction_id','signed_bytes','signed_bytes_hash','signed_verification_hash','prepared_payload']))
 OR (OLD.state<>'SIGNING' AND (to_jsonb(NEW)-ARRAY['state','version','submitted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','submitted_at'])))
 OR NEW.version<>OLD.version+1 OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
 OR NOT ((OLD.state='SIGNING' AND NEW.state='PREPARED') OR (OLD.state='PREPARED' AND NEW.state IN('SUBMITTED','UNKNOWN','CONFIRMED','FAILED'))
 OR (OLD.state IN('SUBMITTED','UNKNOWN') AND NEW.state IN('UNKNOWN','CONFIRMED','FAILED')))
 THEN RAISE EXCEPTION 'SETTLEMENT_ATTEMPT_TRANSITION_REFUSED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_attempt_guard BEFORE UPDATE OR DELETE ON settlement088_attempts FOR EACH ROW EXECUTE FUNCTION settlement088_attempt_guard();
CREATE FUNCTION settlement088_beneficiary_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_BENEFICIARY_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['state','version','ownership_proof_hash','verified_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','ownership_proof_hash','verified_at'])
 OR NEW.version<>OLD.version+1 OR NOT ((OLD.state='PENDING' AND NEW.state='VERIFIED' AND NEW.ownership_proof_hash IS NOT NULL AND NEW.verified_at IS NOT NULL)
 OR (OLD.state='VERIFIED' AND NEW.state='SUSPENDED' AND (NEW.ownership_proof_hash,NEW.verified_at) IS NOT DISTINCT FROM (OLD.ownership_proof_hash,OLD.verified_at)))
 THEN RAISE EXCEPTION 'SETTLEMENT_BENEFICIARY_TRANSITION_REFUSED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_beneficiary_guard BEFORE UPDATE OR DELETE ON settlement088_beneficiaries FOR EACH ROW EXECUTE FUNCTION settlement088_beneficiary_guard();
CREATE FUNCTION settlement088_funding_claim_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_FUNDING_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF (NEW.batch_id,NEW.evidence_id,NEW.amount_minor,NEW.created_at) IS DISTINCT FROM (OLD.batch_id,OLD.evidence_id,OLD.amount_minor,OLD.created_at)
 OR OLD.state<>'HELD' OR NEW.state NOT IN('CONSUMED','RELEASED') THEN RAISE EXCEPTION 'SETTLEMENT_FUNDING_TRANSITION_REFUSED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_funding_claim_guard BEFORE UPDATE OR DELETE ON settlement088_funding_claims FOR EACH ROW EXECUTE FUNCTION settlement088_funding_claim_guard();
CREATE FUNCTION settlement088_batch_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='settlement088_batches' THEN PERFORM settlement088_assert_batch(NEW.id);
 ELSE PERFORM settlement088_assert_batch(NEW.batch_id);END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER settlement088_batch_event AFTER INSERT OR UPDATE ON settlement088_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_batch_event();
CREATE CONSTRAINT TRIGGER settlement088_item_event AFTER INSERT ON settlement088_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_batch_event();
CREATE CONSTRAINT TRIGGER settlement088_claim_event AFTER INSERT OR UPDATE ON settlement088_active_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_batch_event();
CREATE CONSTRAINT TRIGGER settlement088_attempt_event AFTER INSERT OR UPDATE ON settlement088_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_batch_event();
CREATE CONSTRAINT TRIGGER settlement088_funding_event AFTER INSERT OR UPDATE ON settlement088_funding_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement088_batch_event();

CREATE FUNCTION settlement088_eligibility(accrual uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE e earning_accruals;a food_assignments;s food_shipments;f earning_accrual_facts;actor uuid;grant_uuid uuid;key uuid;digest text;reply jsonb;expected bigint;reason text;decision_uuid uuid;
BEGIN
 PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','decision','reason']);
 key:=settlement088_uuid(payload->'idempotencyKey');expected:=settlement088_integer(payload->'expectedVersion');reason:=settlement088_text(payload->'reason',1,1000);
 IF jsonb_typeof(payload->'decision') IS DISTINCT FROM 'string' OR payload->>'decision' NOT IN('RELEASE','HOLD') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO e FROM earning_accruals WHERE id=accrual;IF NOT FOUND OR e.food_assignment_id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=e.food_assignment_id;SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
 PERFORM settlement088_merchant_root(s.merchant_id);
 SELECT * INTO STRICT f FROM earning_accrual_facts WHERE accrual_id=accrual;
 -- Zero earnings have no payable account and cannot be reserved, but can be reviewed.
 IF f.amount_minor>0 THEN PERFORM settlement088_payable_root(e.driver_id,f.currency,f.decimals);END IF;
 PERFORM 1 FROM orders WHERE merchant_id=s.merchant_id AND id=s.order_id FOR UPDATE;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=e.food_assignment_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT e FROM earning_accruals WHERE id=accrual FOR NO KEY UPDATE;
 grant_uuid:=settlement088_finance_actor(s.merchant_id);actor:=dispatch_live_actor();digest:=settlement088_request_hash('eligibility',accrual,payload);
 reply:=settlement088_replay(actor,key,digest);PERFORM settlement088_finance_actor(s.merchant_id);
 IF reply IS NOT NULL THEN RETURN reply;END IF;
 PERFORM settlement088_assert_earning(accrual);
 IF e.version<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF e.state NOT IN('ACCRUED','HELD','AVAILABLE') OR EXISTS(SELECT 1 FROM settlement088_active_claims WHERE accrual_id=accrual AND released_at IS NULL)
 THEN RAISE EXCEPTION 'EARNING_NOT_REVIEWABLE';END IF;
 IF a.state<>'DELIVERED' OR a.closed_at IS NULL OR e.available_at<>a.closed_at OR NOT EXISTS(SELECT 1 FROM food_shipments WHERE id=s.id AND state='DELIVERED')
 OR a.driver_id<>e.driver_id THEN RAISE EXCEPTION 'EARNING_REQUIRES_DELIVERY';END IF;
 INSERT INTO settlement088_eligibility_decisions(accrual_id,merchant_id,actor_account_id,session_id,grant_id,decision,reason,previous_version,resulting_version,previous_state)
 VALUES(accrual,s.merchant_id,actor,current_setting('bitpos.mobile_session')::uuid,grant_uuid,payload->>'decision',reason,e.version,e.version+1,e.state) RETURNING id INTO decision_uuid;
 UPDATE earning_accruals SET state=CASE payload->>'decision' WHEN 'RELEASE' THEN 'AVAILABLE' ELSE 'HELD' END,version=version+1 WHERE id=accrual RETURNING * INTO e;
 reply:=jsonb_build_object('kind','ELIGIBILITY_DECIDED','accrualId',accrual,'decisionId',decision_uuid,'state',e.state,'version',e.version::text,'availableAt',e.available_at,'fundsTransferred',false);
 PERFORM settlement088_finance_actor(s.merchant_id);PERFORM settlement088_record_command(actor,key,s.merchant_id,grant_uuid,'eligibility',digest,reply);RETURN reply;
END $$;

CREATE FUNCTION settlement088_beneficiary_enroll(payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE driver uuid;actor uuid;merchant uuid;key uuid;expected bigint;provider_name text;public_key_text text;b settlement088_beneficiaries;digest text;reply jsonb;
BEGIN
 PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','merchantId','provider','publicKey']);
 merchant:=settlement088_uuid(payload->'merchantId');key:=settlement088_uuid(payload->'idempotencyKey');expected:=settlement088_integer(payload->'expectedVersion',true);
 provider_name:=settlement088_text(payload->'provider',1,40);public_key_text:=settlement088_text(payload->'publicKey',32,44);
 IF expected<>0 OR provider_name!~'^[a-z][a-z0-9_-]{0,39}$' OR NOT settlement088_public_key(public_key_text) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 PERFORM settlement088_merchant_root(merchant);
 actor:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL OR NOT EXISTS(SELECT 1 FROM food_assignments a JOIN food_shipments s ON s.id=a.shipment_id WHERE a.driver_id=driver AND s.merchant_id=merchant) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(driver::text||merchant::text||provider_name||public_key_text,881));
 IF settlement088_live_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 digest:=settlement088_request_hash('beneficiary-enroll',driver,payload);reply:=settlement088_replay(actor,key,digest);PERFORM settlement088_live_actor();
 IF reply IS NOT NULL THEN RETURN reply;END IF;
 -- A fresh enrollment may replace an expired challenge without mutating it.
 INSERT INTO settlement088_beneficiaries(merchant_id,driver_id,provider,public_key,enrolled_by,enrollment_session_id,enrollment_device_id)
 VALUES(merchant,driver,provider_name,public_key_text,actor,current_setting('bitpos.mobile_session')::uuid,current_setting('bitpos.mobile_device')::uuid) RETURNING * INTO b;
 reply:=jsonb_build_object('kind','BENEFICIARY_PENDING','beneficiaryId',b.id,'state',b.state,'version',b.version::text,'challenge',settlement088_challenge(b),'outwardReady',false);
 PERFORM settlement088_live_actor();PERFORM settlement088_record_command(actor,key,merchant,NULL,'beneficiary-enroll',digest,reply);RETURN reply;
END $$;

CREATE FUNCTION settlement088_batch_prepare(payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 #variable_conflict use_column
DECLARE merchant uuid;driver uuid;beneficiary uuid;ben settlement088_beneficiaries;key uuid;expected_ben bigint;source uuid;last_source uuid;
 source_ids uuid[]:='{}';versions bigint[]:='{}';n integer;i integer;f earning_accrual_facts;e earning_accruals;a food_assignments;s food_shipments;
 denomination text;scale smallint;total numeric:=0;payout_total numeric:=0;fact jsonb;asset jsonb;actor uuid;grant_uuid uuid;digest text;reply jsonb;b settlement088_batches;r record;
BEGIN
 PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','merchantId','driverId','beneficiaryId','beneficiaryVersion','sourceIds','sourceVersions']);
 key:=settlement088_uuid(payload->'idempotencyKey');IF settlement088_integer(payload->'expectedVersion',true)<>0 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 merchant:=settlement088_uuid(payload->'merchantId');driver:=settlement088_uuid(payload->'driverId');beneficiary:=settlement088_uuid(payload->'beneficiaryId');expected_ben:=settlement088_integer(payload->'beneficiaryVersion');
 IF jsonb_typeof(payload->'sourceIds') IS DISTINCT FROM 'array' OR jsonb_typeof(payload->'sourceVersions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 n:=jsonb_array_length(payload->'sourceIds');IF n NOT BETWEEN 1 AND 50 OR jsonb_array_length(payload->'sourceVersions')<>n THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR i IN 0..n-1 LOOP
  source:=settlement088_uuid(payload->'sourceIds'->i);IF last_source IS NOT NULL AND source<=last_source THEN RAISE EXCEPTION 'SOURCE_IDS_MUST_BE_SORTED_UNIQUE';END IF;
  source_ids:=array_append(source_ids,source);versions:=array_append(versions,settlement088_integer(payload->'sourceVersions'->i));last_source:=source;
 END LOOP;
 PERFORM settlement088_merchant_root(merchant);
 SELECT * INTO f FROM earning_accrual_facts WHERE accrual_id=source_ids[1];IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 denomination:=f.currency;scale:=f.decimals;PERFORM settlement088_payable_root(driver,denomination,scale);
 -- Refuse foreign-source identities BEFORE attempting foreign order locks.
 IF (SELECT count(*) FROM earning_accruals e JOIN food_assignments a ON a.id=e.food_assignment_id JOIN food_shipments s ON s.id=a.shipment_id
  WHERE e.id=ANY(source_ids) AND e.driver_id=driver AND s.merchant_id=merchant)<>n THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 FOR r IN SELECT DISTINCT s.order_id FROM earning_accruals e JOIN food_assignments a ON a.id=e.food_assignment_id JOIN food_shipments s ON s.id=a.shipment_id WHERE e.id=ANY(source_ids) ORDER BY s.order_id LOOP
  PERFORM 1 FROM orders WHERE merchant_id=merchant AND id=r.order_id FOR UPDATE;
 END LOOP;
 FOR i IN 1..n LOOP
  SELECT * INTO STRICT e FROM earning_accruals WHERE id=source_ids[i];
  PERFORM 1 FROM food_assignments WHERE id=e.food_assignment_id FOR NO KEY UPDATE;
  PERFORM 1 FROM earning_accruals WHERE id=e.id FOR NO KEY UPDATE;
 END LOOP;
 SELECT * INTO ben FROM settlement088_beneficiaries WHERE id=beneficiary FOR NO KEY UPDATE;
 grant_uuid:=settlement088_finance_actor(merchant);actor:=dispatch_live_actor();digest:=settlement088_request_hash('batch-prepare',merchant,payload);
 reply:=settlement088_replay(actor,key,digest);PERFORM settlement088_finance_actor(merchant);IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF ben.id IS NULL OR (ben.merchant_id,ben.driver_id) IS DISTINCT FROM (merchant,driver) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF ben.version<>expected_ben THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF ben.state='SUSPENDED' THEN RAISE EXCEPTION 'BENEFICIARY_SUSPENDED';END IF;
 FOR i IN 1..n LOOP
  SELECT * INTO STRICT e FROM earning_accruals WHERE id=source_ids[i];SELECT * INTO STRICT f FROM earning_accrual_facts WHERE accrual_id=e.id;
  SELECT * INTO STRICT a FROM food_assignments WHERE id=e.food_assignment_id;SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
  IF e.version<>versions[i] THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  IF e.driver_id<>driver OR s.merchant_id<>merchant OR a.driver_id<>driver THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  IF e.state<>'AVAILABLE' OR e.available_at>clock_timestamp() OR a.state<>'DELIVERED' OR s.state<>'DELIVERED' OR a.closed_at IS NULL OR e.available_at<>a.closed_at
  OR f.amount_minor<=0 OR e.ledger_transaction_id IS NULL OR (f.currency,f.decimals) IS DISTINCT FROM (denomination,scale)
  OR NOT EXISTS(SELECT 1 FROM order_allocation_finalizations WHERE merchant_id=merchant AND order_id=s.order_id)
  OR EXISTS(SELECT 1 FROM settlement088_active_claims WHERE accrual_id=e.id AND released_at IS NULL) THEN RAISE EXCEPTION 'EARNING_NOT_AVAILABLE';END IF;
  PERFORM settlement088_assert_earning(e.id);fact:=settlement088_payout_fact(e.id);
  IF asset IS NULL THEN asset:=fact->'asset';ELSIF asset IS DISTINCT FROM fact->'asset' THEN RAISE EXCEPTION 'SETUP_REQUIRED_MIXED_PAYOUT_ASSETS';END IF;
  payout_total:=payout_total+(fact->>'payoutMinor')::bigint;
  total:=total+f.amount_minor;
 END LOOP;
 IF total>9223372036854775807 OR payout_total>999999999999999999 THEN RAISE EXCEPTION 'AMOUNT_OVERFLOW';END IF;
 INSERT INTO settlement088_batches(merchant_id,driver_id,beneficiary_id,beneficiary_version,provider,currency,decimals,total_minor,payout_minor,payout_currency,payout_decimals,asset_descriptor,created_by,created_session_id,created_grant_id)
 VALUES(merchant,driver,ben.id,ben.version,ben.provider,denomination,scale,total::bigint,payout_total::bigint,asset->>'symbol',6,asset,actor,current_setting('bitpos.mobile_session')::uuid,grant_uuid) RETURNING * INTO b;
 FOR i IN 1..n LOOP
  SELECT * INTO STRICT e FROM earning_accruals WHERE id=source_ids[i];SELECT * INTO STRICT f FROM earning_accrual_facts WHERE accrual_id=e.id;
  SELECT * INTO STRICT a FROM food_assignments WHERE id=e.food_assignment_id;SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
  fact:=settlement088_payout_fact(e.id);
  INSERT INTO settlement088_items(batch_id,accrual_id,merchant_id,order_id,assignment_id,driver_id,earning_transaction_id,source_version,amount_minor,currency,decimals,available_at,payment_id,payment_quote_id,original_quote_id,payout_minor,payout_currency,payout_decimals,asset_descriptor,denomination_policy)
  VALUES(b.id,e.id,merchant,s.order_id,a.id,driver,e.ledger_transaction_id,e.version,f.amount_minor,f.currency,f.decimals,e.available_at,(fact->>'paymentId')::uuid,(fact->>'paymentQuoteId')::uuid,(fact->>'originalQuoteId')::uuid,(fact->>'payoutMinor')::bigint,fact->>'payoutCurrency',6,fact->'asset',fact->'denominationPolicy');
 END LOOP;
 PERFORM settlement088_assert_batch(b.id);
 reply:=jsonb_build_object('kind','BATCH_DRAFT','batchId',b.id,'state',b.state,'version',b.version::text,'beneficiaryId',ben.id,'beneficiaryVersion',ben.version::text,
 'sourceIds',to_jsonb(source_ids),'sourceVersions',payload->'sourceVersions','money',settlement088_money(b.total_minor,b.currency,b.decimals),
 'payoutMoney',settlement088_money(b.payout_minor,b.payout_currency,b.payout_decimals),'asset',b.asset_descriptor,'outwardReady',false,'fundsTransferred',false);
 PERFORM settlement088_finance_actor(merchant);PERFORM settlement088_record_command(actor,key,merchant,grant_uuid,'batch-prepare',digest,reply);RETURN reply;
END $$;

-- A late success taints the original earning, not only the old funding bucket.
-- Mutating callers hold the same merchant root as reconciliation before acting.
CREATE FUNCTION settlement088_source_blocked(batch uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM settlement088_items current_item
 JOIN settlement088_items prior_item ON prior_item.accrual_id=current_item.accrual_id
 JOIN settlement088_reconciliation_incidents incident ON incident.batch_id=prior_item.batch_id
 WHERE current_item.batch_id=batch AND incident.kind='LATE_SUCCESS_AFTER_RELEASE')
$$;

CREATE FUNCTION settlement088_batch_command(batch uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_batches;ben settlement088_beneficiaries;key uuid;expected bigint;actor uuid;grant_uuid uuid;digest text;reply jsonb;reason text;
 payable uuid;reserve uuid;posting uuid:=gen_random_uuid();ids jsonb;versions jsonb;balance numeric;cfg settlement088_provider_configs;
BEGIN
 IF payload->>'kind'='APPROVE_RESERVE' THEN
  PERFORM settlement088_shape(payload,ARRAY['kind','idempotencyKey','expectedVersion','beneficiaryId','beneficiaryVersion','sourceIds','sourceVersions','reason']);
 ELSIF payload->>'kind'='CANCEL_DRAFT' THEN PERFORM settlement088_shape(payload,ARRAY['kind','idempotencyKey','expectedVersion','reason']);
 ELSE RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=settlement088_uuid(payload->'idempotencyKey');expected:=settlement088_integer(payload->'expectedVersion');reason:=settlement088_text(payload->'reason',1,1000);
 b:=settlement088_lock_batch(batch);grant_uuid:=settlement088_finance_actor(b.merchant_id);actor:=dispatch_live_actor();digest:=settlement088_request_hash('batch-command',batch,payload);
 reply:=settlement088_replay(actor,key,digest);PERFORM settlement088_finance_actor(b.merchant_id);IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF b.version<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF b.state<>'DRAFT' THEN RAISE EXCEPTION 'BATCH_NOT_DRAFT';END IF;
 IF payload->>'kind'='CANCEL_DRAFT' THEN
  UPDATE settlement088_batches SET state='CANCELLED',version=version+1 WHERE id=batch RETURNING * INTO b;
 ELSE
  IF settlement088_source_blocked(batch) THEN RAISE EXCEPTION 'SOURCE_RECONCILIATION_REQUIRED';END IF;
  SELECT * INTO STRICT ben FROM settlement088_beneficiaries WHERE id=b.beneficiary_id;
  IF settlement088_uuid(payload->'beneficiaryId')<>b.beneficiary_id OR settlement088_integer(payload->'beneficiaryVersion')<>b.beneficiary_version OR ben.version<>b.beneficiary_version THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  IF ben.state<>'VERIFIED' THEN RAISE EXCEPTION 'BENEFICIARY_PENDING';END IF;
  SELECT jsonb_agg(to_jsonb(i.accrual_id::text) ORDER BY i.accrual_id),jsonb_agg(to_jsonb(i.source_version::text) ORDER BY i.accrual_id) INTO ids,versions FROM settlement088_items i WHERE i.batch_id=batch;
  IF payload->'sourceIds' IS DISTINCT FROM ids OR payload->'sourceVersions' IS DISTINCT FROM versions THEN RAISE EXCEPTION 'SOURCE_FACTS_CONFLICT';END IF;
  IF EXISTS(SELECT 1 FROM settlement088_items i JOIN earning_accruals e ON e.id=i.accrual_id WHERE i.batch_id=batch AND (e.version<>i.source_version OR e.state<>'AVAILABLE' OR e.available_at>clock_timestamp())) THEN RAISE EXCEPTION 'EARNING_NOT_AVAILABLE';END IF;
  SELECT * INTO cfg FROM settlement088_provider_configs WHERE merchant_id=b.merchant_id AND provider=b.provider AND currency=b.payout_currency AND decimals=b.payout_decimals;
  IF cfg.id IS NULL OR NOT cfg.enabled OR cfg.asset_descriptor IS DISTINCT FROM b.asset_descriptor THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
  payable:=settlement088_payable_root(b.driver_id,b.currency,b.decimals);
  SELECT coalesce(sum(credit_minor-debit_minor),0) INTO balance FROM ledger_entries WHERE account_id=payable;
  IF balance<b.total_minor THEN RAISE EXCEPTION 'PAYOUT_PAYABLE_BALANCE' USING ERRCODE='23514';END IF;
  INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals) VALUES('DRIVER',b.driver_id,'PAYOUT_RESERVE',b.currency,b.decimals) ON CONFLICT DO NOTHING;
  SELECT id INTO STRICT reserve FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=b.driver_id AND purpose='PAYOUT_RESERVE' AND currency=b.currency AND decimals=b.decimals;
  INSERT INTO settlement088_active_claims(batch_id,accrual_id) SELECT batch,accrual_id FROM settlement088_items WHERE batch_id=batch ORDER BY accrual_id;
  SET CONSTRAINTS ledger_transaction_balanced,ledger_entries_balanced DEFERRED;
  INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals) VALUES(posting,'PAYOUT_RESERVE',batch,reason,b.currency,b.decimals);
  INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES(posting,1,payable,b.currency,b.decimals,b.total_minor,0),(posting,2,reserve,b.currency,b.decimals,0,b.total_minor);
  UPDATE earning_accruals SET state='RESERVED',version=version+1 WHERE id IN(SELECT accrual_id FROM settlement088_items WHERE batch_id=batch);
  UPDATE settlement088_batches SET state='RESERVED',version=version+1,approved_by=actor,approved_session_id=current_setting('bitpos.mobile_session')::uuid,
   approved_grant_id=grant_uuid,approval_reason=reason,reserve_transaction_id=posting WHERE id=batch RETURNING * INTO b;
 END IF;
 PERFORM settlement088_assert_batch(batch);
 reply:=jsonb_build_object('kind',CASE b.state WHEN 'RESERVED' THEN 'BATCH_RESERVED' ELSE 'BATCH_CANCELLED' END,'batchId',b.id,'state',b.state,'version',b.version::text,
 'money',settlement088_money(b.total_minor,b.currency,b.decimals),'payoutMoney',settlement088_money(b.payout_minor,b.payout_currency,b.payout_decimals),
 'asset',b.asset_descriptor,'reserveTransactionId',b.reserve_transaction_id,'outwardReady',false,'fundsTransferred',false);
 PERFORM settlement088_finance_actor(b.merchant_id);PERFORM settlement088_record_command(actor,key,b.merchant_id,grant_uuid,'batch-command',digest,reply);RETURN reply;
END $$;

-- Worker trust boundary: verify the provider's fixed-position ownership message
-- tuple against the stored challenge BEFORE attesting a signature-proof hash.
-- The authenticated original session/device and one-use challenge are rechecked.
CREATE FUNCTION settlement088_worker_beneficiary_verify(beneficiary uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_beneficiaries;key uuid;digest text;reply jsonb;expected bigint;proof_hash text;challenge uuid;
BEGIN
 PERFORM settlement088_mode();PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','enrollmentChallenge','ownershipProofHash','challenge']);
 key:=settlement088_uuid(payload->'idempotencyKey');expected:=settlement088_integer(payload->'expectedVersion');challenge:=settlement088_uuid(payload->'enrollmentChallenge');proof_hash:=settlement088_hash(payload->'ownershipProofHash');
 SELECT * INTO b FROM settlement088_beneficiaries WHERE id=beneficiary;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM settlement088_merchant_root(b.merchant_id);SELECT * INTO STRICT b FROM settlement088_beneficiaries WHERE id=beneficiary FOR NO KEY UPDATE;
 IF payload->'challenge' IS DISTINCT FROM settlement088_challenge(b) OR b.enrollment_challenge<>challenge THEN RAISE EXCEPTION 'BENEFICIARY_CHALLENGE_CONFLICT';END IF;
 BEGIN
  PERFORM 1 FROM mobile_accounts WHERE id=b.enrolled_by FOR SHARE NOWAIT;
  PERFORM 1 FROM mobile_sessions WHERE id=b.enrollment_session_id FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'SETTLEMENT_AUTH_RETRY' USING ERRCODE='40001';END;
 IF NOT EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts a ON a.id=s.account_id WHERE s.id=b.enrollment_session_id AND s.account_id=b.enrolled_by
 AND s.device_id=b.enrollment_device_id AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.refresh_expires_at>clock_timestamp() AND a.disabled_at IS NULL)
 THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 -- The private signature adapter carries the current authenticated mobile scope;
 -- possession of a signature never bypasses token rotation/session/device fencing.
 IF settlement088_live_actor()<>b.enrolled_by
 OR current_setting('bitpos.mobile_session')::uuid<>b.enrollment_session_id
 OR current_setting('bitpos.mobile_device')::uuid<>b.enrollment_device_id
 THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 digest:=settlement088_request_hash('beneficiary-verify',beneficiary,payload);reply:=settlement088_worker_replay(key,digest);
 IF NOT EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts a ON a.id=s.account_id WHERE s.id=b.enrollment_session_id AND s.account_id=b.enrolled_by
 AND s.device_id=b.enrollment_device_id AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.refresh_expires_at>clock_timestamp() AND a.disabled_at IS NULL)
 THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF b.version<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF b.state<>'PENDING' THEN RAISE EXCEPTION 'BENEFICIARY_NOT_PENDING';END IF;
 IF clock_timestamp()<b.challenge_issued_at OR clock_timestamp()>=b.challenge_expires_at THEN RAISE EXCEPTION 'BENEFICIARY_CHALLENGE_EXPIRED';END IF;
 UPDATE settlement088_beneficiaries SET state='VERIFIED',version=version+1,ownership_proof_hash=proof_hash,verified_at=clock_timestamp() WHERE id=beneficiary RETURNING * INTO b;
 reply:=jsonb_build_object('kind','BENEFICIARY_VERIFIED','beneficiaryId',b.id,'state',b.state,'version',b.version::text);
 INSERT INTO settlement088_worker_commands VALUES(key,'beneficiary-verify',digest,reply,clock_timestamp());RETURN reply;
END $$;
CREATE FUNCTION settlement088_worker_funding_record(config uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c settlement088_provider_configs;key uuid;digest text;reply jsonb;amount bigint;reference text;proof_hash text;e settlement088_funding_evidence;at timestamptz;
BEGIN
 PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedConfigVersion','externalReference','money','verificationHash','verifiedAt','providerEvidence']);
 key:=settlement088_uuid(payload->'idempotencyKey');amount:=settlement088_read_money(payload->'money');reference:=settlement088_text(payload->'externalReference',64,90);
 proof_hash:=settlement088_hash(payload->'verificationHash');at:=settlement088_text(payload->'verifiedAt',1,80)::timestamptz;
 IF NOT isfinite(at) OR at>clock_timestamp() OR NOT settlement088_public_key(reference,64) THEN RAISE EXCEPTION 'INVALID_FUNDING_EVIDENCE';END IF;
 SELECT * INTO c FROM settlement088_provider_configs WHERE id=config;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM settlement088_merchant_root(c.merchant_id);SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=config FOR SHARE;
 digest:=settlement088_request_hash('funding-record',config,payload);reply:=settlement088_worker_replay(key,digest);IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF c.version<>settlement088_integer(payload->'expectedConfigVersion') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF NOT c.enabled OR (c.currency,c.decimals) IS DISTINCT FROM (payload->'money'->>'currency',(payload->'money'->>'decimals')::smallint) THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF payload->'providerEvidence'->>'kind' IS DISTINCT FROM 'FINALIZED_INBOUND_FUNDING'
 OR payload->'providerEvidence'->>'genesisHash' IS DISTINCT FROM c.genesis_hash
 OR payload->'providerEvidence'->>'signature' IS DISTINCT FROM reference
 OR payload->'providerEvidence'->>'recipientOwner' IS DISTINCT FROM c.sender_public_key
 OR payload->'providerEvidence'->'asset' IS DISTINCT FROM c.asset_descriptor
 OR payload->'providerEvidence'->>'amountMinor' IS DISTINCT FROM amount::text
 OR coalesce(payload->'providerEvidence'->>'slot','')!~'^(0|[1-9][0-9]{0,15})$'
 THEN RAISE EXCEPTION 'INVALID_FUNDING_EVIDENCE';END IF;
 INSERT INTO settlement088_funding_evidence(config_id,config_version,network,external_reference,amount_minor,currency,decimals,verification_hash,verified_at,provider_evidence)
 VALUES(config,c.version,c.network,reference,amount,c.currency,c.decimals,proof_hash,at,payload->'providerEvidence') RETURNING * INTO e;
 reply:=jsonb_build_object('kind','FUNDING_EVIDENCE_RECORDED','evidenceId',e.id,'money',settlement088_money(e.amount_minor,e.currency,e.decimals));
 INSERT INTO settlement088_worker_commands VALUES(key,'funding-record',digest,reply,clock_timestamp());RETURN reply;
END $$;

-- ALLOCATE commits the exclusive attempt UUID and verified liquidity claim before
-- any signing. PERSIST_SIGNED chooses one exact signed result for that identity.
-- A crash before persistence may rebuild UNSENT bytes; only persisted bytes can
-- pass submission. A crash afterwards must reload, never invoke signing again.
CREATE FUNCTION settlement088_worker_prepare(batch uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_batches;ben settlement088_beneficiaries;c settlement088_provider_configs;e settlement088_funding_evidence;a settlement088_attempts;
 key uuid;digest text;reply jsonb;raw bytea;txid text;proof_hash text;capacity numeric;prepared jsonb;fund settlement088_funding_claims;
BEGIN
 IF payload->>'kind'='ALLOCATE' THEN
  PERFORM settlement088_shape(payload,ARRAY['kind','idempotencyKey','expectedVersion','beneficiaryVersion','configId','configVersion','fundingEvidenceId']);
 ELSIF payload->>'kind'='PERSIST_SIGNED' THEN
  PERFORM settlement088_shape(payload,ARRAY['kind','idempotencyKey','expectedVersion','attemptId','expectedAttemptVersion','prepared','signedVerificationHash']);
 ELSE RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=settlement088_uuid(payload->'idempotencyKey');b:=settlement088_lock_batch(batch);
 IF settlement088_source_blocked(batch) THEN RAISE EXCEPTION 'SOURCE_RECONCILIATION_REQUIRED';END IF;
 IF payload->>'kind'='ALLOCATE' THEN
  SELECT * INTO c FROM settlement088_provider_configs WHERE id=settlement088_uuid(payload->'configId') FOR SHARE;
  SELECT * INTO e FROM settlement088_funding_evidence WHERE id=settlement088_uuid(payload->'fundingEvidenceId') FOR NO KEY UPDATE;
 ELSE
  SELECT * INTO a FROM settlement088_attempts WHERE id=settlement088_uuid(payload->'attemptId') AND batch_id=batch FOR NO KEY UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=a.config_id FOR SHARE;
  SELECT * INTO STRICT fund FROM settlement088_funding_claims WHERE batch_id=batch;
  SELECT * INTO STRICT e FROM settlement088_funding_evidence WHERE id=fund.evidence_id FOR NO KEY UPDATE;
 END IF;
 digest:=settlement088_request_hash('worker-prepare',batch,payload);reply:=settlement088_worker_replay(key,digest);
 IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF b.version<>settlement088_integer(payload->'expectedVersion') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 SELECT * INTO STRICT ben FROM settlement088_beneficiaries WHERE id=b.beneficiary_id;
 IF ben.version<>b.beneficiary_version THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF ben.state<>'VERIFIED' THEN RAISE EXCEPTION 'BENEFICIARY_PENDING';END IF;
 IF c.id IS NULL OR NOT c.enabled OR (c.merchant_id,c.provider,c.currency,c.decimals,c.asset_descriptor)
 IS DISTINCT FROM (b.merchant_id,b.provider,b.payout_currency,b.payout_decimals,b.asset_descriptor) THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF e.id IS NULL OR (e.config_id,e.config_version,e.currency,e.decimals) IS DISTINCT FROM (c.id,c.version,b.payout_currency,b.payout_decimals) THEN RAISE EXCEPTION 'VERIFIED_FUNDING_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM settlement088_reconciliation_incidents x JOIN settlement088_funding_claims fc ON fc.batch_id=x.batch_id WHERE fc.evidence_id=e.id AND x.kind='LATE_SUCCESS_AFTER_RELEASE') THEN RAISE EXCEPTION 'FUNDING_RECONCILIATION_REQUIRED';END IF;
 IF payload->>'kind'='ALLOCATE' THEN
  IF b.state<>'RESERVED' OR EXISTS(SELECT 1 FROM settlement088_attempts WHERE batch_id=batch) THEN RAISE EXCEPTION 'ATTEMPT_ALREADY_EXISTS_OR_BATCH_NOT_RESERVED';END IF;
  IF ben.version<>settlement088_integer(payload->'beneficiaryVersion') OR c.version<>settlement088_integer(payload->'configVersion') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT e.amount_minor-coalesce(sum(amount_minor),0) INTO capacity FROM settlement088_funding_claims WHERE evidence_id=e.id AND state IN('HELD','CONSUMED');
  IF capacity<b.payout_minor THEN RAISE EXCEPTION 'VERIFIED_FUNDING_INSUFFICIENT';END IF;
  INSERT INTO settlement088_attempts(batch_id,config_id,config_version,provider,network,genesis_hash,mint_public_key,token_program_public_key,sender_public_key,recipient_public_key,amount_minor,currency,decimals,asset_descriptor,state)
  VALUES(batch,c.id,c.version,c.provider,c.network,c.genesis_hash,c.mint_public_key,c.token_program_public_key,c.sender_public_key,ben.public_key,b.payout_minor,b.payout_currency,b.payout_decimals,b.asset_descriptor,'SIGNING') RETURNING * INTO a;
  INSERT INTO settlement088_funding_claims(batch_id,evidence_id,amount_minor,state) VALUES(batch,e.id,b.payout_minor,'HELD');
  UPDATE settlement088_batches SET state='SIGNING',version=version+1 WHERE id=batch RETURNING * INTO b;
  reply:=jsonb_build_object('kind','ATTEMPT_ALLOCATED','batchId',batch,'batchVersion',b.version::text,'attemptId',a.id,'attemptVersion',a.version::text,
  'state',a.state,'recipientPublicKey',a.recipient_public_key,'senderPublicKey',a.sender_public_key,'feePayerPublicKey',c.fee_payer_public_key,
  'payoutMoney',settlement088_money(a.amount_minor,a.currency,a.decimals),'asset',a.asset_descriptor,'signOnlyAfterCommit',true,'fundsTransferred',false);
 ELSE
  IF b.state<>'SIGNING' OR a.state<>'SIGNING' THEN RAISE EXCEPTION 'ATTEMPT_ALREADY_SIGNED';END IF;
  IF a.version<>settlement088_integer(payload->'expectedAttemptVersion') OR a.config_version<>c.version THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  prepared:=payload->'prepared';
  PERFORM settlement088_shape(prepared,ARRAY['version','attemptId','batchId','amountMinor','asset','genesisHash','recipientOwner','recipientTokenAccount','sourceOwner','sourceTokenAccount','feePayerOwner','blockhash','lastValidBlockHeight','preparedAtSlot','createRecipientAccount','feeLamports','rentLamports','signedBase64','signature','signedBytesSha256','intentDigest','memo','reference']);
  txid:=settlement088_text(prepared->'signature',64,90);
  IF NOT settlement088_public_key(txid,64) THEN RAISE EXCEPTION 'INVALID_TRANSACTION_ID';END IF;
  raw:=decode(settlement088_text(prepared->'signedBase64',4,2000),'base64');
  IF octet_length(raw) NOT BETWEEN 1 AND 1232 THEN RAISE EXCEPTION 'INVALID_SIGNED_BYTES';END IF;
  IF jsonb_typeof(prepared->'createRecipientAccount') IS DISTINCT FROM 'boolean'
  OR EXISTS(SELECT 1 FROM jsonb_each(prepared) v WHERE v.key IN('lastValidBlockHeight','preparedAtSlot','feeLamports','rentLamports')
  AND (jsonb_typeof(v.value)<>'number' OR (v.value#>>'{}')!~'^(0|[1-9][0-9]{0,15})$' OR (v.value#>>'{}')::numeric>9007199254740991))
  THEN RAISE EXCEPTION 'INVALID_PREPARED_METADATA';END IF;
  proof_hash:=settlement088_hash(payload->'signedVerificationHash');
  IF prepared->'version' IS DISTINCT FROM '1'::jsonb OR settlement088_uuid(prepared->'attemptId')<>a.id OR settlement088_uuid(prepared->'batchId')<>b.id
  OR settlement088_integer(prepared->'amountMinor')<>a.amount_minor OR prepared->'asset' IS DISTINCT FROM a.asset_descriptor
  OR prepared->>'genesisHash' IS DISTINCT FROM a.genesis_hash OR prepared->>'recipientOwner' IS DISTINCT FROM a.recipient_public_key
  OR prepared->>'sourceOwner' IS DISTINCT FROM a.sender_public_key OR prepared->>'feePayerOwner' IS DISTINCT FROM c.fee_payer_public_key
  OR settlement088_hash(prepared->'signedBytesSha256')<>encode(sha256(raw),'hex')
  OR prepared->>'memo' IS DISTINCT FROM 'bitpos:payout:v1:'||settlement088_hash(prepared->'intentDigest')
  OR NOT settlement088_public_key(prepared->>'reference') OR NOT settlement088_public_key(prepared->>'blockhash')
  OR NOT settlement088_public_key(prepared->>'recipientTokenAccount') OR NOT settlement088_public_key(prepared->>'sourceTokenAccount')
  THEN RAISE EXCEPTION 'SIGNED_INTENT_CONFLICT';END IF;
  -- The private adapter attestation additionally verifies complete signatures,
  -- instruction allowlist, exact ATAs, blockhash, fee/rent caps and canonical bytes.
  UPDATE settlement088_attempts SET state='PREPARED',version=version+1,transaction_id=txid,signed_bytes=raw,
  signed_bytes_hash=encode(sha256(raw),'hex'),signed_verification_hash=proof_hash,prepared_payload=prepared WHERE id=a.id RETURNING * INTO a;
  UPDATE settlement088_batches SET state='PREPARED',version=version+1 WHERE id=batch RETURNING * INTO b;
  reply:=jsonb_build_object('kind','ATTEMPT_PREPARED','batchId',batch,'batchVersion',b.version::text,'attemptId',a.id,'attemptVersion',a.version::text,'state',a.state,'transactionId',a.transaction_id,'signedBytesHash',a.signed_bytes_hash,'fundsTransferred',false);
 END IF;
 PERFORM settlement088_assert_batch(batch);INSERT INTO settlement088_worker_commands VALUES(key,'worker-prepare',digest,reply,clock_timestamp());RETURN reply;
END $$;

-- Commit SUBMITTED before network I/O. PREPARED can be recovered after process
-- death; SUBMITTED/UNKNOWN can only return the already stored bytes, never sign.
CREATE FUNCTION settlement088_worker_submission(attempt uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a settlement088_attempts;b settlement088_batches;c settlement088_provider_configs;ben settlement088_beneficiaries;key uuid;digest text;reply jsonb;
BEGIN
 PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','signedBytesHash']);key:=settlement088_uuid(payload->'idempotencyKey');
 SELECT * INTO a FROM settlement088_attempts WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 b:=settlement088_lock_batch(a.batch_id);SELECT * INTO STRICT a FROM settlement088_attempts WHERE id=attempt FOR NO KEY UPDATE;
 IF settlement088_source_blocked(b.id) THEN RAISE EXCEPTION 'SOURCE_RECONCILIATION_REQUIRED';END IF;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=a.config_id FOR SHARE;SELECT * INTO STRICT ben FROM settlement088_beneficiaries WHERE id=b.beneficiary_id;
 -- Fresh gates also apply to a replay; an old command receipt must never make a
 -- disabled/suspended/confirmed/failed transfer eligible for another send.
 IF a.state NOT IN('PREPARED','SUBMITTED','UNKNOWN') OR b.state<>a.state THEN RAISE EXCEPTION 'ATTEMPT_NOT_SENDABLE';END IF;
 IF NOT c.enabled OR c.version<>a.config_version THEN RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';END IF;
 IF ben.state<>'VERIFIED' OR ben.version<>b.beneficiary_version THEN RAISE EXCEPTION 'BENEFICIARY_PENDING';END IF;
 IF EXISTS(SELECT 1 FROM settlement088_funding_claims f JOIN settlement088_funding_claims oldf ON oldf.evidence_id=f.evidence_id
 JOIN settlement088_reconciliation_incidents x ON x.batch_id=oldf.batch_id WHERE f.batch_id=b.id AND x.kind='LATE_SUCCESS_AFTER_RELEASE') THEN RAISE EXCEPTION 'FUNDING_RECONCILIATION_REQUIRED';END IF;
 IF settlement088_hash(payload->'signedBytesHash')<>a.signed_bytes_hash THEN RAISE EXCEPTION 'SIGNED_BYTES_CONFLICT';END IF;
 digest:=settlement088_request_hash('worker-submission',attempt,payload);reply:=settlement088_worker_replay(key,digest);
 IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF a.version<>settlement088_integer(payload->'expectedVersion') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF a.state='PREPARED' THEN
  UPDATE settlement088_attempts SET state='SUBMITTED',version=version+1,submitted_at=clock_timestamp() WHERE id=attempt RETURNING * INTO a;
  UPDATE settlement088_batches SET state='SUBMITTED',version=version+1 WHERE id=b.id RETURNING * INTO b;
 END IF;
 PERFORM settlement088_assert_batch(b.id);
 reply:=jsonb_build_object('kind','EXACT_BYTES_READY','attemptId',a.id,'attemptVersion',a.version::text,'batchId',b.id,'batchVersion',b.version::text,
 'state',a.state,'transactionId',a.transaction_id,'signedBytesHash',a.signed_bytes_hash,'signedBytesBase64',encode(a.signed_bytes,'base64'),'prepared',a.prepared_payload,'broadcastOnlyAfterCommit',true,'fundsTransferred',false);
 INSERT INTO settlement088_worker_commands VALUES(key,'worker-submission',digest,reply,clock_timestamp());RETURN reply;
END $$;

-- CONFIRMED is terminal SQL history and REQUIRES finalized chain evidence.
-- The adapter's merely confirmed observation maps to UNKNOWN/NOT_FINALIZED.
CREATE FUNCTION settlement088_worker_reconcile(attempt uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a settlement088_attempts;b settlement088_batches;key uuid;digest text;reply jsonb;result_state text;proof_hash text;at timestamptz;reason text;proof jsonb;
 reserve uuid;payable uuid;clearing uuid;posting uuid:=gen_random_uuid();receipt_uuid uuid:=gen_random_uuid();incident_uuid uuid;fund settlement088_funding_claims;
BEGIN
 IF payload->>'outcome'='UNKNOWN' THEN PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','outcome','reasonCode']);
 ELSE PERFORM settlement088_shape(payload,ARRAY['idempotencyKey','expectedVersion','outcome','provider','network','transactionId','signedBytesHash','recipientPublicKey','money','verificationHash','verifiedAt','reasonCode','providerEvidence']);END IF;
 key:=settlement088_uuid(payload->'idempotencyKey');result_state:=settlement088_text(payload->'outcome',1,20);reason:=settlement088_text(payload->'reasonCode',1,100);
 IF result_state NOT IN('UNKNOWN','CONFIRMED','FAILED') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO a FROM settlement088_attempts WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 b:=settlement088_lock_batch(a.batch_id);SELECT * INTO STRICT a FROM settlement088_attempts WHERE id=attempt FOR NO KEY UPDATE;
 SELECT * INTO STRICT fund FROM settlement088_funding_claims WHERE batch_id=b.id;
 PERFORM 1 FROM settlement088_funding_evidence WHERE id=fund.evidence_id FOR NO KEY UPDATE;
 digest:=settlement088_request_hash('worker-reconcile',attempt,payload);reply:=settlement088_worker_replay(key,digest);IF reply IS NOT NULL THEN RETURN reply;END IF;
 IF a.version<>settlement088_integer(payload->'expectedVersion') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF result_state='UNKNOWN' THEN
  IF a.state NOT IN('PREPARED','SUBMITTED','UNKNOWN') THEN RAISE EXCEPTION 'ATTEMPT_NOT_SIGNED_OR_TERMINAL';END IF;
  UPDATE settlement088_attempts SET state='UNKNOWN',version=version+1 WHERE id=attempt RETURNING * INTO a;
  UPDATE settlement088_batches SET state='UNKNOWN',version=version+1 WHERE id=b.id RETURNING * INTO b;
  reply:=jsonb_build_object('kind','ATTEMPT_UNKNOWN','attemptId',a.id,'attemptVersion',a.version::text,'batchId',b.id,'batchVersion',b.version::text,'state',a.state,'replacementAllowed',false,'fundsTransferred',false);
 ELSE
  proof_hash:=settlement088_hash(payload->'verificationHash');at:=settlement088_text(payload->'verifiedAt',1,80)::timestamptz;proof:=payload->'providerEvidence';
  IF NOT isfinite(at) OR at>clock_timestamp() OR jsonb_typeof(proof) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_VERIFIED_EVIDENCE';END IF;
  IF (settlement088_text(payload->'provider',1,40),settlement088_text(payload->'network',1,80),settlement088_text(payload->'transactionId',64,90),settlement088_hash(payload->'signedBytesHash'),settlement088_text(payload->'recipientPublicKey',32,44),settlement088_read_money(payload->'money'),payload->'money'->>'currency',(payload->'money'->>'decimals')::smallint)
  IS DISTINCT FROM (a.provider,a.network,a.transaction_id,a.signed_bytes_hash,a.recipient_public_key,a.amount_minor,a.currency,a.decimals) THEN RAISE EXCEPTION 'VERIFIED_RECEIPT_IDENTITY_CONFLICT';END IF;
  IF a.state='SIGNING' OR proof->>'genesisHash' IS DISTINCT FROM a.genesis_hash OR proof->>'intentDigest' IS DISTINCT FROM a.prepared_payload->>'intentDigest'
  OR proof->>'signedBytesSha256' IS DISTINCT FROM a.signed_bytes_hash OR jsonb_typeof(proof->'slot') IS DISTINCT FROM 'number'
  OR coalesce(proof->>'slot','')!~'^(0|[1-9][0-9]{0,15})$' THEN RAISE EXCEPTION 'VERIFIED_RECEIPT_IDENTITY_CONFLICT';END IF;
  IF result_state='CONFIRMED' THEN
   IF reason<>'FINALIZED_TRANSFER' OR proof->>'commitment' IS DISTINCT FROM 'finalized' OR proof->>'signature' IS DISTINCT FROM a.transaction_id
   OR proof->>'attemptId' IS DISTINCT FROM a.id::text OR proof->>'batchId' IS DISTINCT FROM b.id::text
   OR proof->>'amountMinor' IS DISTINCT FROM a.amount_minor::text OR proof->'asset' IS DISTINCT FROM a.asset_descriptor
   OR proof->>'sourceOwner' IS DISTINCT FROM a.sender_public_key OR proof->>'recipientOwner' IS DISTINCT FROM a.recipient_public_key
   OR proof->>'sourceTokenAccount' IS DISTINCT FROM a.prepared_payload->>'sourceTokenAccount'
   OR proof->>'recipientTokenAccount' IS DISTINCT FROM a.prepared_payload->>'recipientTokenAccount'
   OR proof->>'memo' IS DISTINCT FROM a.prepared_payload->>'memo' OR proof->>'reference' IS DISTINCT FROM a.prepared_payload->>'reference'
   THEN RAISE EXCEPTION 'FINALIZED_EXACT_TRANSFER_REQUIRED';END IF;
  ELSE
   IF reason<>'FINALIZED_CHAIN_FAILURE' OR proof->>'kind' IS DISTINCT FROM 'FINALIZED_CHAIN_FAILURE'
   OR NOT proof?'transactionError' OR proof->'transactionError'='null'::jsonb
   THEN RAISE EXCEPTION 'CONCLUSIVE_FINALIZED_FAILURE_REQUIRED';END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM settlement088_verified_receipts WHERE attempt_id=attempt AND outcome=result_state) THEN RAISE EXCEPTION 'RECEIPT_ALREADY_RECORDED_USE_ORIGINAL_COMMAND';END IF;
  IF (a.state='FAILED' AND result_state='CONFIRMED') OR (a.state='CONFIRMED' AND result_state='FAILED') THEN
   INSERT INTO settlement088_verified_receipts(id,attempt_id,outcome,provider,network,transaction_id,amount_minor,currency,decimals,recipient_public_key,signed_bytes_hash,verification_hash,verified_at,provider_evidence,reason_code)
   VALUES(receipt_uuid,attempt,result_state,a.provider,a.network,a.transaction_id,a.amount_minor,a.currency,a.decimals,a.recipient_public_key,a.signed_bytes_hash,proof_hash,at,proof,reason);
   INSERT INTO settlement088_reconciliation_incidents(batch_id,attempt_id,receipt_id,kind)
   VALUES(b.id,attempt,receipt_uuid,CASE result_state WHEN 'CONFIRMED' THEN 'LATE_SUCCESS_AFTER_RELEASE' ELSE 'CONTRADICTORY_FAILURE_AFTER_CONFIRMATION' END) RETURNING id INTO incident_uuid;
   reply:=jsonb_build_object('kind','RECONCILIATION_INCIDENT','incidentId',incident_uuid,'receiptId',receipt_uuid,'attemptId',attempt,'state',a.state,'batchId',b.id,'batchVersion',b.version::text,'secondSettlementCreated',false);
  ELSE
   IF a.state NOT IN('PREPARED','SUBMITTED','UNKNOWN') OR fund.state<>'HELD' THEN RAISE EXCEPTION 'ATTEMPT_TERMINAL_OR_UNFUNDED';END IF;
   payable:=settlement088_payable_root(b.driver_id,b.currency,b.decimals);
   SELECT id INTO STRICT reserve FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=b.driver_id AND purpose='PAYOUT_RESERVE' AND currency=b.currency AND decimals=b.decimals;
   SET CONSTRAINTS ledger_transaction_balanced,ledger_entries_balanced DEFERRED;
   IF result_state='FAILED' THEN
    INSERT INTO settlement088_verified_receipts(id,attempt_id,outcome,provider,network,transaction_id,amount_minor,currency,decimals,recipient_public_key,signed_bytes_hash,verification_hash,verified_at,provider_evidence,reason_code)
    VALUES(receipt_uuid,attempt,result_state,a.provider,a.network,a.transaction_id,a.amount_minor,a.currency,a.decimals,a.recipient_public_key,a.signed_bytes_hash,proof_hash,at,proof,reason);
    INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals,reverses_id)
    VALUES(posting,'PAYOUT_RELEASE',b.id,'Finalized chain failure: exact reserve inverse',b.currency,b.decimals,b.reserve_transaction_id);
    INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor)
    VALUES(posting,1,reserve,b.currency,b.decimals,b.total_minor,0),(posting,2,payable,b.currency,b.decimals,0,b.total_minor);
    UPDATE settlement088_attempts SET state='FAILED',version=version+1 WHERE id=attempt RETURNING * INTO a;
    UPDATE settlement088_batches SET state='FAILED',version=version+1,release_transaction_id=posting WHERE id=b.id RETURNING * INTO b;
    UPDATE settlement088_active_claims SET released_at=clock_timestamp(),release_transaction_id=posting WHERE batch_id=b.id AND released_at IS NULL;
    UPDATE earning_accruals SET state='AVAILABLE',version=version+1 WHERE id IN(SELECT accrual_id FROM settlement088_items WHERE batch_id=b.id);
    UPDATE settlement088_funding_claims SET state='RELEASED' WHERE batch_id=b.id;
    reply:=jsonb_build_object('kind','BATCH_FAILED_RELEASED','batchId',b.id,'batchVersion',b.version::text,'attemptId',attempt,'attemptVersion',a.version::text,'state',b.state,'receiptId',receipt_uuid,'releaseTransactionId',posting,'replacementAllowed',true,'fundsTransferred',false);
   ELSE
    -- The ledger discharge is EARNING money; the provider receipt/funding claim
    -- is token atoms. The immutable per-item rational policy connects the two.
    INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals) VALUES('PLATFORM','00000000-0000-4000-8000-000000000001','CASH_CLEARING',b.currency,b.decimals) ON CONFLICT DO NOTHING;
    SELECT id INTO STRICT clearing FROM ledger_accounts WHERE owner_kind='PLATFORM' AND owner_id='00000000-0000-4000-8000-000000000001' AND purpose='CASH_CLEARING' AND currency=b.currency AND decimals=b.decimals;
    INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals) VALUES(posting,'PAYOUT_RECEIPT',receipt_uuid,'Finalized outbound transfer: exact earning reserve discharge',b.currency,b.decimals);
    INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor)
    VALUES(posting,1,reserve,b.currency,b.decimals,b.total_minor,0),(posting,2,clearing,b.currency,b.decimals,0,b.total_minor);
    INSERT INTO settlement088_verified_receipts(id,attempt_id,outcome,provider,network,transaction_id,amount_minor,currency,decimals,recipient_public_key,signed_bytes_hash,verification_hash,verified_at,provider_evidence,reason_code,ledger_transaction_id)
    VALUES(receipt_uuid,attempt,result_state,a.provider,a.network,a.transaction_id,a.amount_minor,a.currency,a.decimals,a.recipient_public_key,a.signed_bytes_hash,proof_hash,at,proof,reason,posting);
    UPDATE settlement088_attempts SET state='CONFIRMED',version=version+1 WHERE id=attempt RETURNING * INTO a;
    UPDATE settlement088_batches SET state='CONFIRMED',version=version+1 WHERE id=b.id RETURNING * INTO b;
    UPDATE earning_accruals SET state='SETTLED',version=version+1 WHERE id IN(SELECT accrual_id FROM settlement088_items WHERE batch_id=b.id);
    UPDATE settlement088_funding_claims SET state='CONSUMED' WHERE batch_id=b.id;
    reply:=jsonb_build_object('kind','BATCH_CONFIRMED','batchId',b.id,'batchVersion',b.version::text,'attemptId',attempt,'attemptVersion',a.version::text,'state',b.state,'receiptId',receipt_uuid,'ledgerTransactionId',posting,
    'money',settlement088_money(b.total_minor,b.currency,b.decimals),'payoutMoney',settlement088_money(b.payout_minor,b.payout_currency,b.payout_decimals),'replacementAllowed',false,'fundsTransferred',true);
   END IF;
  END IF;
 END IF;
 PERFORM settlement088_assert_batch(b.id);INSERT INTO settlement088_worker_commands VALUES(key,'worker-reconcile',digest,reply,clock_timestamp());RETURN reply;
END $$;

-- Narrow projections: no addresses, contacts, payment facts, signed bytes,
-- provider destination keys, proof hashes, sessions or private operator detail.
CREATE FUNCTION settlement088_readiness(batch uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_batches;ben settlement088_beneficiaries;c settlement088_provider_configs;a settlement088_attempts;
BEGIN
 SELECT * INTO STRICT b FROM settlement088_batches WHERE id=batch;
 IF b.state IN('CONFIRMED','FAILED','CANCELLED') THEN RETURN 'CLOSED';END IF;
 IF settlement088_source_blocked(batch) THEN RETURN 'SOURCE_RECONCILIATION_REQUIRED';END IF;
 SELECT * INTO STRICT ben FROM settlement088_beneficiaries WHERE id=b.beneficiary_id;
 IF ben.state<>'VERIFIED' OR ben.version<>b.beneficiary_version THEN RETURN 'BENEFICIARY_PENDING';END IF;
 SELECT * INTO c FROM settlement088_provider_configs WHERE merchant_id=b.merchant_id AND provider=b.provider AND currency=b.payout_currency AND decimals=b.payout_decimals;
 IF c.id IS NULL OR NOT c.enabled OR c.asset_descriptor IS DISTINCT FROM b.asset_descriptor THEN RETURN 'PROVIDER_UNAVAILABLE';END IF;
 IF b.state='DRAFT' THEN RETURN 'AWAITING_APPROVAL';END IF;
 IF b.state='RESERVED' THEN RETURN 'VERIFIED_FUNDING_REQUIRED';END IF;
 SELECT * INTO STRICT a FROM settlement088_attempts WHERE batch_id=batch;
 IF c.id<>a.config_id OR c.version<>a.config_version THEN RETURN 'PROVIDER_UNAVAILABLE';END IF;
 IF NOT EXISTS(SELECT 1 FROM settlement088_funding_claims f JOIN settlement088_funding_evidence e ON e.id=f.evidence_id
 WHERE f.batch_id=batch AND f.state='HELD' AND f.amount_minor=b.payout_minor AND e.config_id=a.config_id AND e.config_version=a.config_version)
 THEN RETURN 'VERIFIED_FUNDING_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM settlement088_funding_claims f JOIN settlement088_funding_claims oldf ON oldf.evidence_id=f.evidence_id
 JOIN settlement088_reconciliation_incidents x ON x.batch_id=oldf.batch_id WHERE f.batch_id=batch AND x.kind='LATE_SUCCESS_AFTER_RELEASE') THEN RETURN 'FUNDING_RECONCILIATION_REQUIRED';END IF;
 IF b.state='SIGNING' THEN RETURN 'AWAITING_SIGNATURE';END IF;
 IF b.state='PREPARED' THEN RETURN 'READY_FOR_INITIAL_BROADCAST';END IF;
 RETURN 'EXACT_REBROADCAST_OR_RECONCILIATION_ONLY';
END $$;
CREATE FUNCTION settlement088_payout_projection(accrual uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE fact jsonb;minor bigint;message text;
BEGIN
 SELECT amount_minor INTO STRICT minor FROM earning_accrual_facts WHERE accrual_id=accrual;
 IF minor=0 THEN RETURN jsonb_build_object('status','ZERO_EARNING','payoutMoney',NULL,'asset',NULL);END IF;
 fact:=settlement088_payout_fact(accrual);
 RETURN jsonb_build_object('status','FROZEN_POLICY_AVAILABLE','payoutMoney',settlement088_money((fact->>'payoutMinor')::bigint,fact->>'payoutCurrency',6::smallint),'asset',fact->'asset');
EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message LIKE 'SETUP_REQUIRED_%' THEN RETURN jsonb_build_object('status','SETUP_REQUIRED','reasonCode',message,'payoutMoney',NULL,'asset',NULL);END IF;RAISE;
END $$;
CREATE FUNCTION settlement088_worker_beneficiary_challenge(beneficiary uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b settlement088_beneficiaries;
BEGIN
 PERFORM settlement088_mode();SELECT * INTO b FROM settlement088_beneficiaries WHERE id=beneficiary;
 IF b.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 RETURN jsonb_build_object('beneficiaryId',b.id,'state',b.state,'version',b.version::text,'challenge',settlement088_challenge(b));
END $$;
-- Recovery reads use the immutable intent, not today's preparation readiness.
CREATE FUNCTION settlement088_worker_attempt_snapshot(attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a settlement088_attempts;b settlement088_batches;
BEGIN
 SELECT * INTO a FROM settlement088_attempts WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 b:=settlement088_lock_batch(a.batch_id);SELECT * INTO STRICT a FROM settlement088_attempts WHERE id=attempt;
 RETURN jsonb_build_object('attemptId',a.id,'attemptVersion',a.version::text,'batchId',b.id,'batchVersion',b.version::text,'state',a.state,
 'money',settlement088_money(b.total_minor,b.currency,b.decimals),'payoutMoney',settlement088_money(a.amount_minor,a.currency,a.decimals),
 'asset',a.asset_descriptor,'recipientPublicKey',a.recipient_public_key,'senderPublicKey',a.sender_public_key,'prepared',a.prepared_payload,
 'receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('receiptId',r.id,'outcome',r.outcome,'verificationHash',r.verification_hash,'providerEvidence',r.provider_evidence,'ledgerTransactionId',r.ledger_transaction_id) ORDER BY r.id),'[]'::jsonb) FROM settlement088_verified_receipts r WHERE r.attempt_id=attempt));
END $$;

CREATE FUNCTION settlement088_earning_value(accrual uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('accrualId',e.id,'driverId',e.driver_id,'merchantId',s.merchant_id,'orderId',s.order_id,'assignmentId',a.id,
 'state',e.state,'version',e.version::text,'availableAt',e.available_at,'createdAt',e.created_at,'money',settlement088_money(f.amount_minor,f.currency,f.decimals),
 'payout',settlement088_payout_projection(e.id),
 'eligibilityDecision',(SELECT jsonb_build_object('decision',d.decision,'decidedAt',d.decided_at) FROM settlement088_eligibility_decisions d WHERE d.accrual_id=e.id ORDER BY d.resulting_version DESC LIMIT 1),
 'settlement',(SELECT jsonb_build_object('batchId',b.id,'state',b.state,'version',b.version::text,'beneficiaryId',b.beneficiary_id,'beneficiaryVersion',b.beneficiary_version::text,
 'attemptState',a.state,'receiptId',r.id,'confirmedAt',r.verified_at,'money',settlement088_money(b.total_minor,b.currency,b.decimals),
 'payoutMoney',settlement088_money(b.payout_minor,b.payout_currency,b.payout_decimals),'asset',b.asset_descriptor,'readiness',settlement088_readiness(b.id),
 'outwardReady',settlement088_readiness(b.id) IN('READY_FOR_INITIAL_BROADCAST','EXACT_REBROADCAST_OR_RECONCILIATION_ONLY'))
 FROM settlement088_items i JOIN settlement088_batches b ON b.id=i.batch_id LEFT JOIN settlement088_attempts a ON a.batch_id=b.id
 LEFT JOIN settlement088_verified_receipts r ON r.attempt_id=a.id AND r.outcome='CONFIRMED' AND r.ledger_transaction_id IS NOT NULL
 WHERE i.accrual_id=e.id ORDER BY EXISTS(SELECT 1 FROM settlement088_active_claims c WHERE c.batch_id=b.id AND c.accrual_id=e.id AND c.released_at IS NULL) DESC,
 b.created_at DESC,b.id DESC LIMIT 1))
 FROM earning_accruals e JOIN earning_accrual_facts f ON f.accrual_id=e.id JOIN food_assignments a ON a.id=e.food_assignment_id JOIN food_shipments s ON s.id=a.shipment_id WHERE e.id=accrual
$$;
CREATE FUNCTION settlement088_driver_snapshot(afteruuid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;items jsonb;more boolean;next_id uuid;beneficiaries jsonb;
BEGIN
 PERFORM settlement088_mode();actor:=settlement088_live_actor();SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF afteruuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM earning_accruals WHERE id=afteruuid AND driver_id=driver AND food_assignment_id IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
 WITH page AS MATERIALIZED(SELECT id FROM earning_accruals WHERE driver_id=driver AND food_assignment_id IS NOT NULL AND (afteruuid IS NULL OR id>afteruuid) ORDER BY id LIMIT 51),
 visible AS(SELECT id FROM page ORDER BY id LIMIT 50)
 SELECT coalesce(jsonb_agg(settlement088_earning_value(id) ORDER BY id),'[]'::jsonb),(SELECT count(*)>50 FROM page),(SELECT id FROM visible ORDER BY id DESC LIMIT 1) INTO items,more,next_id FROM visible;
 SELECT coalesce(jsonb_agg(jsonb_build_object('beneficiaryId',b.id,'merchantId',b.merchant_id,'provider',b.provider,'state',b.state,'version',b.version::text,
 'challenge',CASE WHEN b.state='PENDING' AND b.enrollment_session_id=current_setting('bitpos.mobile_session')::uuid
 AND b.enrollment_device_id=current_setting('bitpos.mobile_device')::uuid AND b.challenge_expires_at>clock_timestamp() THEN settlement088_challenge(b) ELSE NULL END) ORDER BY b.created_at DESC,b.id DESC),'[]'::jsonb) INTO beneficiaries
 FROM(SELECT * FROM settlement088_beneficiaries WHERE driver_id=driver ORDER BY created_at DESC,id DESC LIMIT 50)b;
 PERFORM settlement088_live_actor();
 RETURN jsonb_build_object('kind','DRIVER_EARNINGS','driverId',driver,'items',items,'nextAfterId',CASE WHEN more THEN next_id ELSE NULL END,'beneficiaries',beneficiaries,
 'beneficiaryHistoryLimit',50,'snapshotAt',clock_timestamp(),'availabilityIsLiquidity',false);
END $$;
CREATE FUNCTION settlement088_finance_snapshot(merchant uuid,afteruuid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE grant_uuid uuid;items jsonb;more boolean;next_id uuid;
BEGIN
 PERFORM settlement088_merchant_root(merchant);grant_uuid:=settlement088_finance_actor(merchant);
 IF afteruuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM earning_accruals e JOIN food_assignments a ON a.id=e.food_assignment_id JOIN food_shipments s ON s.id=a.shipment_id WHERE e.id=afteruuid AND s.merchant_id=merchant) THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
 WITH page AS MATERIALIZED(SELECT e.id FROM earning_accruals e JOIN food_assignments a ON a.id=e.food_assignment_id JOIN food_shipments s ON s.id=a.shipment_id
 WHERE s.merchant_id=merchant AND (afteruuid IS NULL OR e.id>afteruuid) ORDER BY e.id LIMIT 51),visible AS(SELECT id FROM page ORDER BY id LIMIT 50)
 SELECT coalesce(jsonb_agg(settlement088_earning_value(id) ORDER BY id),'[]'::jsonb),(SELECT count(*)>50 FROM page),(SELECT id FROM visible ORDER BY id DESC LIMIT 1) INTO items,more,next_id FROM visible;
 IF settlement088_finance_actor(merchant)<>grant_uuid THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN jsonb_build_object('kind','FINANCE_EARNINGS','merchantId',merchant,'items',items,'nextAfterId',CASE WHEN more THEN next_id ELSE NULL END,
 'snapshotAt',clock_timestamp(),'availabilityIsLiquidity',false);
END $$;
-- Bounded worker discovery is not client financial read authority.
CREATE FUNCTION settlement088_worker_queue(afteruuid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE items jsonb;more boolean;next_id uuid;
BEGIN
 PERFORM settlement088_mode();
 WITH page AS MATERIALIZED(SELECT b.* FROM settlement088_batches b WHERE b.state IN('RESERVED','SIGNING','PREPARED','SUBMITTED','UNKNOWN') AND (afteruuid IS NULL OR b.id>afteruuid) ORDER BY b.id LIMIT 51),visible AS(SELECT * FROM page ORDER BY id LIMIT 50)
 SELECT coalesce(jsonb_agg(jsonb_build_object('batchId',b.id,'merchantId',b.merchant_id,'batchVersion',b.version::text,'state',b.state,'beneficiaryId',b.beneficiary_id,'beneficiaryVersion',b.beneficiary_version::text,
 'recipientPublicKey',ben.public_key,'beneficiaryState',ben.state,'money',settlement088_money(b.total_minor,b.currency,b.decimals),
 'payoutMoney',settlement088_money(b.payout_minor,b.payout_currency,b.payout_decimals),'asset',b.asset_descriptor,'readiness',settlement088_readiness(b.id),
 'configId',c.id,'configVersion',c.version::text,'adapterVersion',c.adapter_version,'providerAvailable',coalesce(c.enabled,false),'provider',c.provider,'network',c.network,'genesisHash',c.genesis_hash,'mintPublicKey',c.mint_public_key,'tokenProgramPublicKey',c.token_program_public_key,'senderPublicKey',c.sender_public_key,'feePayerPublicKey',c.fee_payer_public_key,
 'attemptId',a.id,'attemptVersion',a.version::text,'transactionId',a.transaction_id,'signedBytesHash',a.signed_bytes_hash,
 'fundingEvidence',(SELECT coalesce(jsonb_agg(jsonb_build_object('evidenceId',z.id,'remaining',settlement088_money(z.remaining::bigint,z.currency,z.decimals)) ORDER BY z.id),'[]'::jsonb)
 FROM(SELECT e.id,e.currency,e.decimals,e.amount_minor-(SELECT coalesce(sum(f.amount_minor),0) FROM settlement088_funding_claims f WHERE f.evidence_id=e.id AND f.state IN('HELD','CONSUMED')) AS remaining
 FROM settlement088_funding_evidence e WHERE e.config_id=c.id AND e.config_version=c.version
 AND e.amount_minor-(SELECT coalesce(sum(f.amount_minor),0) FROM settlement088_funding_claims f WHERE f.evidence_id=e.id AND f.state IN('HELD','CONSUMED'))>=b.payout_minor
 AND NOT EXISTS(SELECT 1 FROM settlement088_reconciliation_incidents x JOIN settlement088_funding_claims fc ON fc.batch_id=x.batch_id WHERE fc.evidence_id=e.id AND x.kind='LATE_SUCCESS_AFTER_RELEASE')
 ORDER BY e.id LIMIT 50)z)) ORDER BY b.id),'[]'::jsonb),
 (SELECT count(*)>50 FROM page),(SELECT id FROM visible ORDER BY id DESC LIMIT 1) INTO items,more,next_id
 FROM visible b JOIN settlement088_beneficiaries ben ON ben.id=b.beneficiary_id
 LEFT JOIN settlement088_provider_configs c ON (c.merchant_id,c.provider,c.currency,c.decimals)=(b.merchant_id,b.provider,b.payout_currency,b.payout_decimals)
 LEFT JOIN settlement088_attempts a ON a.batch_id=b.id;
 RETURN jsonb_build_object('items',items,'nextAfterId',CASE WHEN more THEN next_id ELSE NULL END);
END $$;

CREATE FUNCTION settlement088_worker_funding_config(configuuid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('configId',id,'version',version::text,'provider',provider,'network',network,'enabled',enabled,'genesisHash',genesis_hash,
 'senderPublicKey',sender_public_key,'asset',asset_descriptor) FROM settlement088_provider_configs WHERE id=configuuid
$$;
CREATE FUNCTION settlement088_worker_funding_lookup(configuuid uuid,reference text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('kind','FUNDING_EVIDENCE_RECORDED','evidenceId',id,'money',settlement088_money(amount_minor,currency,decimals))
 FROM settlement088_funding_evidence WHERE config_id=configuuid AND external_reference=reference
$$;
-- Private verifier/worker registry access exposes no credentials or balances.
CREATE FUNCTION settlement088_worker_asset(assetid text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT descriptor FROM payment_assets WHERE asset_id=assetid AND enabled AND verified_at IS NOT NULL
$$;
-- Terminal attempts remain discoverable: contradictory late proof is an incident,
-- never a second discharge. Cursor scans restart from NULL after each full sweep.
CREATE FUNCTION settlement088_worker_terminal_queue(afteruuid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 WITH page AS MATERIALIZED(SELECT id FROM settlement088_attempts WHERE state IN('FAILED','CONFIRMED') AND (afteruuid IS NULL OR id>afteruuid) ORDER BY id LIMIT 51),
 visible AS(SELECT id FROM page ORDER BY id LIMIT 50)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('attemptId',id) ORDER BY id) FROM visible),'[]'::jsonb),
 'nextAfterId',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END)
$$;

-- Configuration is immutable except a deliberate enabled/version transition.
-- Changing a destination/denomination requires a separately reviewed migration;
-- never mutate a signed attempt's instructions through ambient configuration.
CREATE FUNCTION settlement088_config_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT settlement088_public_key(NEW.genesis_hash) OR NOT settlement088_public_key(NEW.mint_public_key)
  OR NOT settlement088_public_key(NEW.token_program_public_key) OR NOT settlement088_public_key(NEW.sender_public_key) OR NOT settlement088_public_key(NEW.fee_payer_public_key)
  OR NEW.genesis_hash<>'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' OR NEW.provider<>'solana-devnet'
  OR NEW.asset_descriptor->>'cluster' IS DISTINCT FROM 'devnet' OR NEW.asset_descriptor->>'genesisHash' IS DISTINCT FROM NEW.genesis_hash
  OR NEW.asset_descriptor->>'mint' IS DISTINCT FROM NEW.mint_public_key OR NEW.asset_descriptor->>'tokenProgram' IS DISTINCT FROM NEW.token_program_public_key
  OR NEW.asset_descriptor->>'symbol' IS DISTINCT FROM NEW.currency OR NEW.asset_descriptor->>'decimals' IS DISTINCT FROM '6'
  OR NOT EXISTS(SELECT 1 FROM payment_assets WHERE asset_id=NEW.asset_descriptor->>'assetId' AND descriptor=NEW.asset_descriptor AND enabled AND verified_at IS NOT NULL)
  THEN RAISE EXCEPTION 'INVALID_PROVIDER_CONFIG';END IF;
 ELSE
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_CONFIG_HISTORY_IMMUTABLE';END IF;
  IF (to_jsonb(NEW)-ARRAY['enabled','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['enabled','version']) OR NEW.version<>OLD.version+1
  THEN RAISE EXCEPTION 'SETTLEMENT_CONFIG_IDENTITY_IMMUTABLE';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER settlement088_config_guard BEFORE INSERT OR UPDATE OR DELETE ON settlement088_provider_configs FOR EACH ROW EXECUTE FUNCTION settlement088_config_guard();
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['settlement088_items','settlement088_eligibility_decisions','settlement088_funding_evidence','settlement088_verified_receipts','settlement088_reconciliation_incidents','settlement088_commands','settlement088_worker_commands'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_authority_row()',name||'_immutable',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['settlement088_provider_configs','settlement088_beneficiaries','settlement088_eligibility_decisions','settlement088_batches','settlement088_items','settlement088_active_claims','settlement088_funding_evidence','settlement088_funding_claims','settlement088_attempts','settlement088_verified_receipts','settlement088_reconciliation_incidents','settlement088_commands','settlement088_worker_commands'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,bitpos_app,bitpos_settlement_worker',name);
 END LOOP;
END $$;
-- Revoke every helper as well as every public/worker entry before exact grants.
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bitpos' AND p.proname LIKE 'settlement088\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,bitpos_app,bitpos_settlement_worker',f);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION settlement088_driver_snapshot(uuid),settlement088_finance_snapshot(uuid,uuid),settlement088_eligibility(uuid,jsonb),settlement088_beneficiary_enroll(jsonb),settlement088_batch_prepare(jsonb),settlement088_batch_command(uuid,jsonb) TO bitpos_app;
GRANT EXECUTE ON FUNCTION settlement088_worker_beneficiary_verify(uuid,jsonb),settlement088_worker_beneficiary_challenge(uuid),settlement088_worker_funding_record(uuid,jsonb),settlement088_worker_prepare(uuid,jsonb),settlement088_worker_submission(uuid,jsonb),settlement088_worker_reconcile(uuid,jsonb),settlement088_worker_queue(uuid),settlement088_worker_attempt_snapshot(uuid),settlement088_worker_asset(text),settlement088_worker_terminal_queue(uuid),settlement088_worker_funding_config(uuid),settlement088_worker_funding_lookup(uuid,text) TO bitpos_settlement_worker;
COMMIT;
