-- "Regulars" membership badges, step 1 (docs/NFT_LOYALTY_PLAN_TH.md). Rules and consent only: NOTHING here touches the chain.
--  * a merchant defines 1-3 tiers by LIFETIME points (the same points as migration 173/141: one per whole currency unit of a PAID,
--    refund-free online food order of that shop). Redeeming a voucher spends points but never lowers a tier;
--  * a customer binds ONE proven Solana wallet to their account (the API verifies the wallet signature over a challenge, this table
--    stores the result) and gives a per-shop consent for the badge. Withdrawing consent stops any new issue;
--  * loyalty180_mints is the durable record the worker will use in step 2 (one row per shop/account/tier, unique idempotency key).
-- Tiers are shown to customers only through session-checked functions; the badge facts are server-derived, never client-supplied.
-- Rollback: DROP TABLE bitpos.loyalty180_mints,loyalty180_consents,loyalty180_wallet_bindings,loyalty180_tiers; DROP FUNCTION loyalty180_* and mobile_loyalty_*.
SET search_path TO bitpos,extensions,public;
CREATE TABLE loyalty180_tiers(
 merchant_id uuid NOT NULL REFERENCES merchants,
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 3),
 name_th text NOT NULL CHECK(length(btrim(name_th)) BETWEEN 1 AND 40),
 name_en text NOT NULL CHECK(length(btrim(name_en)) BETWEEN 1 AND 40),
 min_points integer NOT NULL CHECK(min_points BETWEEN 1 AND 100000000),
 currency text NOT NULL CHECK(currency IN('THB','USD','USDG')),
 decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 6),
 enabled boolean NOT NULL DEFAULT true,
 -- Set once by the admin script after the Token-2022 mint exists on devnet; never changed afterwards.
 mint_address text CHECK(mint_address IS NULL OR mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 mint_signature text CHECK(mint_signature IS NULL OR mint_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,slot),UNIQUE(merchant_id,min_points),UNIQUE(mint_address)
);
ALTER TABLE loyalty180_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON loyalty180_tiers FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT ON loyalty180_tiers TO bitpos_app;

-- One active wallet per account and one active account per wallet.
CREATE TABLE loyalty180_wallet_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 wallet_address text NOT NULL CHECK(wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 challenge_hash text NOT NULL CHECK(challenge_hash ~ '^[0-9a-f]{64}$'),
 proven_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz
);
CREATE UNIQUE INDEX loyalty180_binding_account ON loyalty180_wallet_bindings(account_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX loyalty180_binding_wallet ON loyalty180_wallet_bindings(wallet_address) WHERE revoked_at IS NULL;
ALTER TABLE loyalty180_wallet_bindings ENABLE ROW LEVEL SECURITY;

CREATE TABLE loyalty180_consents(
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 merchant_id uuid NOT NULL REFERENCES merchants,
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 40),
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 withdrawn_at timestamptz,
 PRIMARY KEY(account_id,merchant_id)
);
ALTER TABLE loyalty180_consents ENABLE ROW LEVEL SECURITY;

CREATE TABLE loyalty180_mints(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchants,
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 tier_slot smallint NOT NULL CHECK(tier_slot BETWEEN 1 AND 3),
 wallet_address text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENT','CONFIRMED','FAILED','REVOKING','REVOKED')),
 signature text CHECK(signature IS NULL OR signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
 idempotency_key text NOT NULL UNIQUE,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error text NOT NULL DEFAULT '' CHECK(length(last_error)<=80),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,account_id,tier_slot),
 FOREIGN KEY(merchant_id,tier_slot) REFERENCES loyalty180_tiers(merchant_id,slot)
);
ALTER TABLE loyalty180_mints ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON loyalty180_mints FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT ON loyalty180_mints TO bitpos_app;

-- Lifetime points in one currency (earned only, not reduced by redemptions).
CREATE FUNCTION loyalty180_lifetime(p_account uuid,p_merchant uuid,p_currency text,p_decimals smallint)RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT coalesce((SELECT sum(div(a.total_minor::numeric,10::numeric^a.catalog_decimals))
  FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id AND o.status='PAID'
  JOIN order_authority a ON a.merchant_id=f.merchant_id AND a.order_id=f.order_id
  WHERE f.account_id=p_account AND f.merchant_id=p_merchant AND a.catalog_currency=p_currency AND a.catalog_decimals=p_decimals
  AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=f.merchant_id AND r.order_id=f.order_id)),0)::bigint
$$;

CREATE FUNCTION loyalty180_tier_view(t loyalty180_tiers)RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('slot',(t).slot,'nameTh',(t).name_th,'nameEn',(t).name_en,'minPoints',(t).min_points,'currency',(t).currency,'decimals',(t).decimals,'enabled',(t).enabled,'mintAddress',(t).mint_address)
$$;

-- Merchant side. apps/api enforces owner/manager before calling; the tenant is the bitpos.merchant setting.
CREATE FUNCTION loyalty180_tier_list()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(loyalty180_tier_view(t)ORDER BY t.slot)FROM loyalty180_tiers t WHERE t.merchant_id=merchant),'[]'::jsonb);
END $$;
-- Thresholds must rise with the slot (slot 1 is the lowest tier). The currency is the shop's active price currency and never mixes.
CREATE FUNCTION loyalty180_tier_save(p_slot integer,p_name_th text,p_name_en text,p_min_points integer,p_enabled boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;price catalog_price_versions;t loyalty180_tiers;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 3 OR p_min_points IS NULL OR p_min_points<1 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM loyalty180_tiers x WHERE x.merchant_id=merchant AND ((x.slot<p_slot AND x.min_points>=p_min_points)OR(x.slot>p_slot AND x.min_points<=p_min_points))) THEN RAISE EXCEPTION 'LOYALTY_THRESHOLD_ORDER';END IF;
 SELECT * INTO t FROM loyalty180_tiers WHERE merchant_id=merchant AND slot=p_slot FOR UPDATE;
 IF FOUND THEN
  -- A tier that already issued a badge keeps its threshold: lowering it would silently change who earned it.
  IF t.min_points<>p_min_points AND EXISTS(SELECT 1 FROM loyalty180_mints m WHERE m.merchant_id=merchant AND m.tier_slot=p_slot) THEN RAISE EXCEPTION 'LOYALTY_TIER_LOCKED';END IF;
  UPDATE loyalty180_tiers SET name_th=p_name_th,name_en=p_name_en,min_points=p_min_points,enabled=p_enabled,updated_at=clock_timestamp() WHERE merchant_id=merchant AND slot=p_slot RETURNING * INTO t;
  RETURN loyalty180_tier_view(t);
 END IF;
 SELECT v.* INTO price FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=merchant;
 IF NOT FOUND THEN RAISE EXCEPTION 'LOYALTY_PRICING_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM loyalty180_tiers x WHERE x.merchant_id=merchant AND (x.currency<>price.currency OR x.decimals<>price.decimals)) THEN RAISE EXCEPTION 'LOYALTY_CURRENCY_MISMATCH';END IF;
 INSERT INTO loyalty180_tiers(merchant_id,slot,name_th,name_en,min_points,currency,decimals,enabled)VALUES(merchant,p_slot,p_name_th,p_name_en,p_min_points,price.currency,price.decimals,p_enabled)RETURNING * INTO t;
 RETURN loyalty180_tier_view(t);
END $$;
REVOKE ALL ON FUNCTION loyalty180_tier_list(),loyalty180_tier_save(integer,text,text,integer,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION loyalty180_tier_list(),loyalty180_tier_save(integer,text,text,integer,boolean)TO bitpos_app;

-- Customer side (session checked like migration 173).
CREATE FUNCTION mobile_loyalty_progress(p_account uuid,p_session uuid,p_merchant uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE cur loyalty180_tiers;nxt loyalty180_tiers;cur_currency text;cur_decimals smallint;points bigint;consent loyalty180_consents;bound text;badge jsonb;
BEGIN
 IF NOT reward173_session_ok(p_account,p_session) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT t.currency,t.decimals INTO cur_currency,cur_decimals FROM loyalty180_tiers t WHERE t.merchant_id=p_merchant AND t.enabled ORDER BY t.slot LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('configured',false,'merchantId',p_merchant);END IF;
 points:=loyalty180_lifetime(p_account,p_merchant,cur_currency,cur_decimals);
 SELECT * INTO cur FROM loyalty180_tiers t WHERE t.merchant_id=p_merchant AND t.enabled AND t.min_points<=points ORDER BY t.min_points DESC LIMIT 1;
 SELECT * INTO nxt FROM loyalty180_tiers t WHERE t.merchant_id=p_merchant AND t.enabled AND t.min_points>points ORDER BY t.min_points LIMIT 1;
 SELECT * INTO consent FROM loyalty180_consents c WHERE c.account_id=p_account AND c.merchant_id=p_merchant;
 SELECT b.wallet_address INTO bound FROM loyalty180_wallet_bindings b WHERE b.account_id=p_account AND b.revoked_at IS NULL;
 SELECT jsonb_build_object('tierSlot',m.tier_slot,'status',m.status,'signature',m.signature,'mintAddress',t.mint_address,'wallet',m.wallet_address)INTO badge
  FROM loyalty180_mints m JOIN loyalty180_tiers t ON t.merchant_id=m.merchant_id AND t.slot=m.tier_slot
  WHERE m.merchant_id=p_merchant AND m.account_id=p_account ORDER BY m.tier_slot DESC LIMIT 1;
 RETURN jsonb_build_object('configured',true,'merchantId',p_merchant,'currency',cur_currency,'decimals',cur_decimals,'lifetimePoints',points,
  'current',CASE WHEN cur.slot IS NULL THEN NULL ELSE loyalty180_tier_view(cur) END,
  'next',CASE WHEN nxt.slot IS NULL THEN NULL ELSE loyalty180_tier_view(nxt) END,
  'pointsToNext',CASE WHEN nxt.slot IS NULL THEN NULL ELSE nxt.min_points-points END,
  'consentGranted',coalesce(consent.account_id IS NOT NULL AND consent.withdrawn_at IS NULL,false),'walletBound',bound IS NOT NULL,'walletAddress',bound,'badge',badge);
END $$;
-- The API verified the wallet's signature over the challenge BEFORE calling this; only a hash of the challenge is kept.
CREATE FUNCTION loyalty180_bind_internal(p_account uuid,p_wallet text,p_challenge_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE existing text;
BEGIN
 IF p_wallet IS NULL OR p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' OR p_challenge_hash IS NULL OR p_challenge_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('loyalty180:'||p_wallet,0));
 IF EXISTS(SELECT 1 FROM loyalty180_wallet_bindings b WHERE b.wallet_address=p_wallet AND b.revoked_at IS NULL AND b.account_id<>p_account) THEN RAISE EXCEPTION 'LOYALTY_WALLET_IN_USE';END IF;
 SELECT b.wallet_address INTO existing FROM loyalty180_wallet_bindings b WHERE b.account_id=p_account AND b.revoked_at IS NULL FOR UPDATE;
 IF existing=p_wallet THEN RETURN jsonb_build_object('wallet',p_wallet,'replayed',true);END IF;
 -- A badge already issued to the previous wallet stays there; new issues go to the new wallet only.
 UPDATE loyalty180_wallet_bindings SET revoked_at=clock_timestamp() WHERE account_id=p_account AND revoked_at IS NULL;
 INSERT INTO loyalty180_wallet_bindings(account_id,wallet_address,challenge_hash)VALUES(p_account,p_wallet,p_challenge_hash);
 RETURN jsonb_build_object('wallet',p_wallet,'replayed',false);
END $$;
CREATE FUNCTION mobile_loyalty_bind_wallet(p_account uuid,p_session uuid,p_wallet text,p_challenge_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT reward173_session_ok(p_account,p_session) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN loyalty180_bind_internal(p_account,p_wallet,p_challenge_hash);
END $$;
CREATE FUNCTION mobile_loyalty_consent(p_account uuid,p_session uuid,p_merchant uuid,p_granted boolean,p_version text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT reward173_session_ok(p_account,p_session) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_granted IS NULL OR p_version IS NULL OR length(p_version) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF NOT EXISTS(SELECT 1 FROM loyalty180_tiers t WHERE t.merchant_id=p_merchant AND t.enabled) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF p_granted THEN
  INSERT INTO loyalty180_consents(account_id,merchant_id,version)VALUES(p_account,p_merchant,p_version)
  ON CONFLICT(account_id,merchant_id)DO UPDATE SET version=excluded.version,granted_at=clock_timestamp(),withdrawn_at=NULL;
 ELSE
  UPDATE loyalty180_consents SET withdrawn_at=clock_timestamp() WHERE account_id=p_account AND merchant_id=p_merchant AND withdrawn_at IS NULL;
 END IF;
 RETURN jsonb_build_object('granted',p_granted);
END $$;
REVOKE ALL ON FUNCTION loyalty180_bind_internal(uuid,text,text),mobile_loyalty_progress(uuid,uuid,uuid),mobile_loyalty_bind_wallet(uuid,uuid,text,text),mobile_loyalty_consent(uuid,uuid,uuid,boolean,text)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_loyalty_progress(uuid,uuid,uuid),mobile_loyalty_bind_wallet(uuid,uuid,text,text),mobile_loyalty_consent(uuid,uuid,uuid,boolean,text)TO bitpos_app;

-- ---- Step 2: durable issue/revoke queue for the worker (all merchant-context; the tenant is the bitpos.merchant setting) ----
-- The admin script records a tier's mint once; thresholds and the mint then stay fixed.
CREATE FUNCTION loyalty180_set_mint(p_slot integer,p_mint text,p_signature text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;t loyalty180_tiers;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 UPDATE loyalty180_tiers SET mint_address=p_mint,mint_signature=p_signature,updated_at=clock_timestamp() WHERE merchant_id=merchant AND slot=p_slot AND mint_address IS NULL RETURNING * INTO t;
 IF NOT FOUND THEN RAISE EXCEPTION 'LOYALTY_TIER_LOCKED';END IF;
 RETURN loyalty180_tier_view(t);
END $$;
-- Queue the highest reached tier (with a mint) for every account that consented AND has a proven wallet. Safe to call repeatedly.
CREATE FUNCTION loyalty180_enqueue()RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;queued integer;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 WITH members AS(
  SELECT c.account_id,b.wallet_address FROM loyalty180_consents c
  JOIN loyalty180_wallet_bindings b ON b.account_id=c.account_id AND b.revoked_at IS NULL
  WHERE c.merchant_id=merchant AND c.withdrawn_at IS NULL),
 scored AS(
  SELECT m.account_id,m.wallet_address,(SELECT t.currency FROM loyalty180_tiers t WHERE t.merchant_id=merchant AND t.enabled ORDER BY t.slot LIMIT 1) cur,
   (SELECT t.decimals FROM loyalty180_tiers t WHERE t.merchant_id=merchant AND t.enabled ORDER BY t.slot LIMIT 1) dec FROM members m),
 reached AS(
  SELECT s.account_id,s.wallet_address,(SELECT t.slot FROM loyalty180_tiers t WHERE t.merchant_id=merchant AND t.enabled AND t.mint_address IS NOT NULL
    AND t.min_points<=loyalty180_lifetime(s.account_id,merchant,s.cur,s.dec) ORDER BY t.min_points DESC LIMIT 1) slot FROM scored s WHERE s.cur IS NOT NULL),
 ins AS(
  INSERT INTO loyalty180_mints(merchant_id,account_id,tier_slot,wallet_address,idempotency_key)
  SELECT merchant,r.account_id,r.slot,r.wallet_address,'loyalty:'||merchant||':'||r.account_id||':'||r.slot FROM reached r WHERE r.slot IS NOT NULL
  ON CONFLICT DO NOTHING RETURNING 1)
 SELECT count(*) INTO queued FROM ins;
 RETURN queued;
END $$;
-- Hand the worker a batch. PENDING rows and SENT rows older than two minutes (the worker may have died mid-send) are claimed; the worker MUST check the chain before sending again.
CREATE FUNCTION loyalty180_claim(p_limit integer)RETURNS TABLE(id uuid,account_id uuid,tier_slot smallint,wallet_address text,mint_address text,previous_status text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN QUERY
 WITH picked AS(
  SELECT m.id,m.status AS old FROM loyalty180_mints m WHERE m.merchant_id=merchant AND (m.status='PENDING' OR (m.status='SENT' AND m.updated_at<clock_timestamp()-interval '2 minutes'))
  ORDER BY m.created_at LIMIT greatest(1,least(p_limit,20)) FOR UPDATE SKIP LOCKED),
 upd AS(
  UPDATE loyalty180_mints m SET status='SENT',attempts=m.attempts+1,updated_at=clock_timestamp() FROM picked p WHERE m.id=p.id
  RETURNING m.id,m.account_id,m.tier_slot,m.wallet_address,m.attempts,p.old)
 SELECT u.id,u.account_id,u.tier_slot,u.wallet_address,t.mint_address,u.old,u.attempts FROM upd u JOIN loyalty180_tiers t ON t.merchant_id=merchant AND t.slot=u.tier_slot;
END $$;
CREATE FUNCTION loyalty180_finish(p_id uuid,p_ok boolean,p_signature text,p_error text)RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;m loyalty180_mints;outcome text;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO m FROM loyalty180_mints WHERE id=p_id AND merchant_id=merchant FOR UPDATE;
 IF NOT FOUND OR m.status<>'SENT' THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 outcome:=CASE WHEN p_ok THEN 'CONFIRMED' WHEN m.attempts>=5 THEN 'FAILED' ELSE 'PENDING' END;
 UPDATE loyalty180_mints SET status=outcome,signature=coalesce(p_signature,signature),last_error=left(coalesce(p_error,''),80),updated_at=clock_timestamp() WHERE id=p_id;
 RETURN outcome;
END $$;
-- Badges to take back: consent withdrawn, or the account's tier is now below the badge (a refund removed points). Marks them REVOKING and returns them.
CREATE FUNCTION loyalty180_revoke_claim(p_limit integer)RETURNS TABLE(id uuid,wallet_address text,mint_address text)LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN QUERY
 WITH due AS(
  SELECT m.id FROM loyalty180_mints m JOIN loyalty180_tiers t ON t.merchant_id=m.merchant_id AND t.slot=m.tier_slot
  WHERE m.merchant_id=merchant AND (m.status='CONFIRMED' OR (m.status='REVOKING' AND m.updated_at<clock_timestamp()-interval '2 minutes'))
  AND (NOT EXISTS(SELECT 1 FROM loyalty180_consents c WHERE c.account_id=m.account_id AND c.merchant_id=merchant AND c.withdrawn_at IS NULL)
   OR loyalty180_lifetime(m.account_id,merchant,t.currency,t.decimals)<t.min_points)
  ORDER BY m.updated_at LIMIT greatest(1,least(p_limit,20)) FOR UPDATE OF m SKIP LOCKED),
 upd AS(UPDATE loyalty180_mints m SET status='REVOKING',updated_at=clock_timestamp() FROM due d WHERE m.id=d.id RETURNING m.id,m.wallet_address,m.tier_slot)
 SELECT u.id,u.wallet_address,t.mint_address FROM upd u JOIN loyalty180_tiers t ON t.merchant_id=merchant AND t.slot=u.tier_slot;
END $$;
CREATE FUNCTION loyalty180_revoke_finish(p_id uuid,p_ok boolean,p_error text)RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;outcome text;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 outcome:=CASE WHEN p_ok THEN 'REVOKED' ELSE 'CONFIRMED' END;
 UPDATE loyalty180_mints SET status=outcome,last_error=left(coalesce(p_error,''),80),updated_at=clock_timestamp() WHERE id=p_id AND merchant_id=merchant AND status='REVOKING';
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION loyalty180_set_mint(integer,text,text),loyalty180_enqueue(),loyalty180_claim(integer),loyalty180_finish(uuid,boolean,text,text),loyalty180_revoke_claim(integer),loyalty180_revoke_finish(uuid,boolean,text)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION loyalty180_set_mint(integer,text,text),loyalty180_enqueue(),loyalty180_claim(integer),loyalty180_finish(uuid,boolean,text,text),loyalty180_revoke_claim(integer),loyalty180_revoke_finish(uuid,boolean,text)TO bitpos_app;
-- Merchants the worker should visit (tenant-fenced tables cannot be listed by the app role directly).
CREATE FUNCTION loyalty180_merchants()RETURNS TABLE(merchant_id uuid)LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT DISTINCT t.merchant_id FROM loyalty180_tiers t WHERE t.enabled AND t.mint_address IS NOT NULL
$$;
REVOKE ALL ON FUNCTION loyalty180_merchants()FROM PUBLIC;
GRANT EXECUTE ON FUNCTION loyalty180_merchants()TO bitpos_app;

-- ---- Step 3: one-time codes so the customer's wallet can be proven on a web page without putting any session in a URL ----
CREATE TABLE loyalty180_bind_codes(
 code_hash text PRIMARY KEY CHECK(code_hash ~ '^[0-9a-f]{64}$'),
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 failures integer NOT NULL DEFAULT 0 CHECK(failures>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE loyalty180_bind_codes ENABLE ROW LEVEL SECURITY;
-- Session-checked. Issuing a new code retires the account's earlier unused codes.
CREATE FUNCTION mobile_loyalty_bind_code(p_account uuid,p_session uuid,p_code_hash text,p_ttl_seconds integer)RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE expires timestamptz;
BEGIN
 IF NOT reward173_session_ok(p_account,p_session) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' OR p_ttl_seconds NOT BETWEEN 60 AND 900 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 UPDATE loyalty180_bind_codes SET used_at=clock_timestamp() WHERE account_id=p_account AND used_at IS NULL;
 expires:=clock_timestamp()+make_interval(secs=>p_ttl_seconds);
 INSERT INTO loyalty180_bind_codes(code_hash,account_id,expires_at)VALUES(p_code_hash,p_account,expires);
 RETURN expires;
END $$;
-- Public side (no session). The account comes only from a live, unused, un-brute-forced code.
CREATE FUNCTION loyalty180_code_account(p_code_hash text)RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT c.account_id FROM loyalty180_bind_codes c JOIN mobile_accounts a ON a.id=c.account_id
 WHERE c.code_hash=p_code_hash AND c.used_at IS NULL AND c.expires_at>clock_timestamp() AND c.failures<5 AND a.disabled_at IS NULL
$$;
CREATE FUNCTION loyalty180_code_failed(p_code_hash text)RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 UPDATE loyalty180_bind_codes SET failures=failures+1 WHERE code_hash=p_code_hash AND used_at IS NULL
$$;
CREATE FUNCTION loyalty180_bind_with_code(p_code_hash text,p_wallet text,p_challenge_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE account uuid;result jsonb;
BEGIN
 account:=loyalty180_code_account(p_code_hash);
 IF account IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 result:=loyalty180_bind_internal(account,p_wallet,p_challenge_hash);
 UPDATE loyalty180_bind_codes SET used_at=clock_timestamp() WHERE code_hash=p_code_hash;
 RETURN result||jsonb_build_object('accountId',account);
END $$;

-- Customer overview: every shop with tiers where the caller has a paid online order (session checked).
CREATE FUNCTION mobile_loyalty_overview(p_account uuid,p_session uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE shops jsonb:='[]'::jsonb;m record;
BEGIN
 IF NOT reward173_session_ok(p_account,p_session) THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 FOR m IN SELECT DISTINCT f.merchant_id,mm.name FROM online_food_orders f JOIN merchants mm ON mm.id=f.merchant_id
  WHERE f.account_id=p_account AND EXISTS(SELECT 1 FROM loyalty180_tiers t WHERE t.merchant_id=f.merchant_id AND t.enabled) ORDER BY mm.name LIMIT 30 LOOP
  shops:=shops||jsonb_build_array(mobile_loyalty_progress(p_account,p_session,m.merchant_id)||jsonb_build_object('merchantName',m.name));
 END LOOP;
 RETURN shops;
END $$;
-- POS card: how many customers come back (computed from paid, refund-free online orders; no personal data).
CREATE FUNCTION loyalty180_repeat_stats()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;payers integer;repeaters integer;recent integer;members integer;badges integer;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 WITH paid AS(SELECT f.account_id,o.paid_at FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id AND o.status='PAID'
  WHERE f.merchant_id=merchant AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=f.merchant_id AND r.order_id=f.order_id)),
 per AS(SELECT account_id,count(*) n,max(paid_at) last_paid FROM paid GROUP BY account_id)
 SELECT count(*),count(*) FILTER(WHERE n>=2),count(*) FILTER(WHERE last_paid>clock_timestamp()-interval '30 days') INTO payers,repeaters,recent FROM per;
 SELECT count(*) INTO members FROM loyalty180_consents WHERE merchant_id=merchant AND withdrawn_at IS NULL;
 SELECT count(*) INTO badges FROM loyalty180_mints WHERE merchant_id=merchant AND status='CONFIRMED';
 RETURN jsonb_build_object('payingCustomers',payers,'repeatCustomers',repeaters,'repeatRatePercent',CASE WHEN payers=0 THEN 0 ELSE round(100.0*repeaters/payers)::integer END,'activeLast30Days',recent,'members',members,'badgesHeld',badges);
END $$;
REVOKE ALL ON FUNCTION mobile_loyalty_bind_code(uuid,uuid,text,integer),loyalty180_code_account(text),loyalty180_code_failed(text),loyalty180_bind_with_code(text,text,text),mobile_loyalty_overview(uuid,uuid),loyalty180_repeat_stats()FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_loyalty_bind_code(uuid,uuid,text,integer),loyalty180_code_account(text),loyalty180_code_failed(text),loyalty180_bind_with_code(text,text,text),mobile_loyalty_overview(uuid,uuid),loyalty180_repeat_stats()TO bitpos_app;
