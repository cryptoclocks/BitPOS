-- Rollback before COMMIT: ROLLBACK. After COMMIT disable new customer-auth routes
-- and roll forward; retain consent/session evidence, profiles, history and all payment permissions.
SET search_path TO bitpos,extensions,public;
-- The additional key prevents a verified session from referencing another wallet's profile.
ALTER TABLE customer_wallets ADD CONSTRAINT customer_wallets_verified_identity
 UNIQUE(merchant_id,chain,address,customer_id);
CREATE TABLE customer_auth_challenges(
 merchant_id uuid NOT NULL,id uuid NOT NULL,order_id uuid NOT NULL,wallet_address text NOT NULL,
 origin text NOT NULL,order_context jsonb NOT NULL,nonce text NOT NULL,issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,consent_version text NOT NULL,message text NOT NULL,consumed_at timestamptz,invalidated_at timestamptz,
 PRIMARY KEY(merchant_id,id),UNIQUE(nonce),
 UNIQUE(merchant_id,id,wallet_address,origin,consent_version),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 CHECK(nonce ~ '^[A-Za-z0-9_-]{43}$'),CHECK(length(wallet_address) BETWEEN 32 AND 44),
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes'),
 CHECK(consumed_at IS NULL OR consumed_at BETWEEN issued_at AND expires_at),
 CHECK(consent_version='bitpos-personal-offers-v1'),
 CHECK(invalidated_at IS NULL OR (consumed_at IS NULL AND invalidated_at>=issued_at)),
 CHECK(jsonb_typeof(order_context)='object' AND (order_context->>'orderId') IS NOT DISTINCT FROM order_id::text)
);
CREATE TABLE customer_auth_sessions(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),challenge_id uuid NOT NULL,
 customer_id uuid NOT NULL,wallet_address text NOT NULL,chain text NOT NULL DEFAULT 'solana:devnet',
 origin text NOT NULL,token_hash text NOT NULL,consent_version text NOT NULL,
 consent_profile boolean NOT NULL,consent_purchase_history boolean NOT NULL,
 consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 PRIMARY KEY(merchant_id,id),UNIQUE(token_hash),UNIQUE(merchant_id,challenge_id),
 FOREIGN KEY(merchant_id,challenge_id,wallet_address,origin,consent_version)
  REFERENCES customer_auth_challenges(merchant_id,id,wallet_address,origin,consent_version),
 FOREIGN KEY(merchant_id,chain,wallet_address,customer_id)
  REFERENCES customer_wallets(merchant_id,chain,address,customer_id),
 CHECK(chain='solana:devnet'),CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 CHECK(consent_profile AND consent_purchase_history),CHECK(consent_version='bitpos-personal-offers-v1'),
 CHECK(expires_at>consented_at AND expires_at<=consented_at+interval '7 days'),
 CHECK(revoked_at IS NULL OR revoked_at>=consented_at)
);
CREATE INDEX customer_auth_active_wallet ON customer_auth_sessions(merchant_id,wallet_address) WHERE revoked_at IS NULL;
CREATE FUNCTION guard_customer_auth_challenge() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable customer auth challenge' USING ERRCODE='23514'; END IF;
 IF OLD.consumed_at IS NOT NULL OR OLD.invalidated_at IS NOT NULL OR (NEW.consumed_at IS NULL AND NEW.invalidated_at IS NULL)
  OR (to_jsonb(NEW)-'consumed_at'-'invalidated_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at'-'invalidated_at') THEN
  RAISE EXCEPTION 'immutable customer auth challenge' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_auth_challenge_identity BEFORE UPDATE OR DELETE ON customer_auth_challenges
 FOR EACH ROW EXECUTE FUNCTION guard_customer_auth_challenge();
CREATE FUNCTION guard_customer_auth_session() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable customer auth identity/consent' USING ERRCODE='23514'; END IF;
 IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
  OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') THEN
  RAISE EXCEPTION 'immutable customer auth identity/consent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_auth_session_identity BEFORE UPDATE OR DELETE ON customer_auth_sessions
 FOR EACH ROW EXECUTE FUNCTION guard_customer_auth_session();
CREATE FUNCTION require_customer_auth_consumption() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM customer_auth_challenges c WHERE c.merchant_id=NEW.merchant_id
  AND c.id=NEW.challenge_id AND c.consumed_at IS NOT NULL AND c.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'customer auth challenge not consumed or expired' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_auth_consumed BEFORE INSERT ON customer_auth_sessions
 FOR EACH ROW EXECUTE FUNCTION require_customer_auth_consumption();
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['customer_auth_challenges','customer_auth_sessions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',relation);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',relation);
 END LOOP;
END $$;
