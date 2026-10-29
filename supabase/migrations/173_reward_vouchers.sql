-- DS52 demo-grade "redeem points for a voucher". Deliberately small:
--  * a merchant defines 1-3 rewards (slots 1..3); each reward is a merchant-funded FIXED coupon campaign
--    (migration 097) created by this migration's functions, so the voucher is priced ONLY by the existing coupon
--    quote path (mobile_coupon_apply -> coupon098_apply -> 167 admission). There is no new pricing path;
--    zero-payable is impossible because the minimum food spend must exceed the discount;
--  * points are the existing derived points (one per whole currency unit of a PAID, refund-free online food order)
--    of THAT merchant, minus this ledger's redemptions. Redeeming debits points and issues one voucher in one
--    transaction under a per-account advisory lock, so a balance can never go negative and a retry with the same
--    idempotency key returns the same voucher;
--  * a voucher is single-use and bound to the account, merchant and reward. Its state is DERIVED, never stored:
--    USED when the coupon redemption (167) is CONSUMED, IN_USE while a live hold or a bound order uses it,
--    EXPIRED after expires_at, otherwise AVAILABLE. Releasing the hold or cancelling the order unpaid makes it
--    AVAILABLE again; an EXPIRED voucher is NOT credited back (documented demo rule: points are spent on redemption);
--  * discount terms of a reward are locked after creation (only names, points cost, validity and enabled may change);
--    disabling a reward stops new redemptions but already issued vouchers keep working until they expire;
--  * no platform funding, tiers, NFTs or tokens. Rollback: DROP the reward173_* objects and re-apply migrations
--    141 and 171 function bodies.
SET search_path=bitpos,public;
CREATE TABLE reward173_rewards(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 3),
 name_th text NOT NULL CHECK(length(btrim(name_th))BETWEEN 1 AND 80),name_en text NOT NULL CHECK(length(btrim(name_en))BETWEEN 1 AND 80),
 points_cost integer NOT NULL CHECK(points_cost BETWEEN 1 AND 1000000),
 currency text NOT NULL CHECK(currency IN('THB','USD','USDG')),decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 6),
 discount_minor bigint NOT NULL CHECK(discount_minor BETWEEN 1 AND 999999999999),
 minimum_spend_minor bigint NOT NULL CHECK(minimum_spend_minor BETWEEN 1 AND 999999999999),CHECK(minimum_spend_minor>discount_minor),
 validity_days smallint NOT NULL CHECK(validity_days BETWEEN 1 AND 365),enabled boolean NOT NULL DEFAULT true,campaign_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,slot),UNIQUE(merchant_id,id),FOREIGN KEY(merchant_id,campaign_id)REFERENCES coupon097_campaigns(merchant_id,id)
);
CREATE TABLE reward173_redemptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES mobile_accounts,merchant_id uuid NOT NULL,reward_id uuid NOT NULL,
 points integer NOT NULL CHECK(points>0),idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,idempotency_key),FOREIGN KEY(merchant_id,reward_id)REFERENCES reward173_rewards(merchant_id,id)
);
CREATE INDEX reward173_redemptions_balance ON reward173_redemptions(account_id,merchant_id);
CREATE TABLE reward173_vouchers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),redemption_id uuid NOT NULL UNIQUE REFERENCES reward173_redemptions,account_id uuid NOT NULL REFERENCES mobile_accounts,
 merchant_id uuid NOT NULL,reward_id uuid NOT NULL,expires_at timestamptz NOT NULL,hold_id uuid UNIQUE REFERENCES coupon097_holds,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,reward_id)REFERENCES reward173_rewards(merchant_id,id)
);
CREATE INDEX reward173_vouchers_account ON reward173_vouchers(account_id,created_at DESC);
CREATE TRIGGER reward173_redemptions_immutable BEFORE UPDATE OR DELETE ON reward173_redemptions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION reward173_voucher_guard()RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR(to_jsonb(NEW)-'hold_id')IS DISTINCT FROM(to_jsonb(OLD)-'hold_id')THEN RAISE EXCEPTION 'immutable authority record' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reward173_vouchers_guard BEFORE UPDATE OR DELETE ON reward173_vouchers FOR EACH ROW EXECUTE FUNCTION reward173_voucher_guard();
ALTER TABLE reward173_rewards ENABLE ROW LEVEL SECURITY;ALTER TABLE reward173_redemptions ENABLE ROW LEVEL SECURITY;ALTER TABLE reward173_vouchers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reward173_rewards,reward173_redemptions,reward173_vouchers FROM PUBLIC,bitpos_app;

CREATE FUNCTION reward173_session_ok(p_account uuid,p_session uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts x ON x.id=s.account_id
  WHERE s.id=p_session AND s.account_id=p_account AND s.revoked_at IS NULL
  AND s.access_expires_at>statement_timestamp() AND s.refresh_expires_at>statement_timestamp() AND x.disabled_at IS NULL)
$$;
-- Points a merchant's paid, refund-free online food orders gave this account in one currency, minus redemptions, never negative.
CREATE FUNCTION reward173_balance(p_account uuid,p_merchant uuid,p_currency text,p_decimals smallint)RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT greatest(0,
  coalesce((SELECT sum(div(a.total_minor::numeric,10::numeric^a.catalog_decimals))
   FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id AND o.status='PAID'
   JOIN order_authority a ON a.merchant_id=f.merchant_id AND a.order_id=f.order_id
   WHERE f.account_id=p_account AND f.merchant_id=p_merchant AND a.catalog_currency=p_currency AND a.catalog_decimals=p_decimals
   AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=f.merchant_id AND r.order_id=f.order_id)),0)
  -coalesce((SELECT sum(x.points) FROM reward173_redemptions x JOIN reward173_rewards w ON w.merchant_id=x.merchant_id AND w.id=x.reward_id
   WHERE x.account_id=p_account AND x.merchant_id=p_merchant AND w.currency=p_currency AND w.decimals=p_decimals),0))::bigint
$$;
-- Derived voucher state; see the header for the rules.
CREATE FUNCTION reward173_voucher_state(v reward173_vouchers)RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT CASE
  WHEN EXISTS(SELECT 1 FROM coupon167_redemptions r WHERE r.hold_id=(v).hold_id AND r.state='CONSUMED')THEN 'USED'
  WHEN EXISTS(SELECT 1 FROM coupon097_holds h WHERE h.id=(v).hold_id AND h.state IN('HELD','RECONCILE')
   AND(h.expires_at>clock_timestamp()OR EXISTS(SELECT 1 FROM coupon167_redemptions r WHERE r.hold_id=h.id AND r.state='BOUND')))THEN 'IN_USE'
  WHEN(v).expires_at<=clock_timestamp()THEN 'EXPIRED'
  ELSE 'AVAILABLE' END
$$;
CREATE FUNCTION reward173_view(w reward173_rewards)RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',(w).id,'slot',(w).slot,'nameTh',(w).name_th,'nameEn',(w).name_en,'pointsCost',(w).points_cost,'currency',(w).currency,'decimals',(w).decimals,
  'discountMinor',(w).discount_minor::text,'minimumSpendMinor',(w).minimum_spend_minor::text,'validityDays',(w).validity_days,'enabled',(w).enabled)
$$;

-- Merchant side. The caller (apps/api) enforces owner/manager before calling; the tenant is the bitpos.merchant setting.
CREATE FUNCTION reward173_list()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(reward173_view(w)ORDER BY w.slot)FROM reward173_rewards w WHERE w.merchant_id=merchant),'[]'::jsonb);
END $$;
CREATE FUNCTION reward173_save(p_slot integer,p_name_th text,p_name_en text,p_points integer,p_discount bigint,p_minimum bigint,p_validity integer,p_enabled boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;w reward173_rewards;price catalog_price_versions;campaign uuid:=gen_random_uuid();version uuid:=gen_random_uuid();code text;
BEGIN
 IF merchant IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 SELECT * INTO w FROM reward173_rewards WHERE merchant_id=merchant AND slot=p_slot FOR UPDATE;
 IF FOUND THEN
  IF w.discount_minor<>p_discount OR w.minimum_spend_minor<>p_minimum THEN RAISE EXCEPTION 'REWARD_TERMS_LOCKED';END IF;
  UPDATE reward173_rewards SET name_th=p_name_th,name_en=p_name_en,points_cost=p_points,validity_days=p_validity,enabled=p_enabled,updated_at=clock_timestamp()WHERE id=w.id RETURNING * INTO w;
  RETURN reward173_view(w);
 END IF;
 SELECT v.* INTO price FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=merchant;
 IF NOT FOUND THEN RAISE EXCEPTION 'REWARD_PRICING_REQUIRED';END IF;
 code:='RW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 INSERT INTO coupon097_campaigns(id,merchant_id,code,name)VALUES(campaign,merchant,code,'Reward voucher: '||left(btrim(p_name_en),120));
 INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,fixed_minor,minimum_food_minor,maximum_discount_minor,merchant_funding_bps,global_cap,account_cap,budget_minor,serving,starts_at,expires_at)
 VALUES(version,merchant,campaign,1,price.id,'FIXED',p_discount,p_minimum,p_discount,10000,1000000,1000000,900000000000000000,ARRAY['pickup','delivery'],clock_timestamp()-interval '1 minute','2100-01-01 00:00:00+00');
 UPDATE coupon097_campaigns SET active_version_id=version,enabled=true WHERE id=campaign;
 INSERT INTO reward173_rewards(merchant_id,slot,name_th,name_en,points_cost,currency,decimals,discount_minor,minimum_spend_minor,validity_days,enabled,campaign_id)
 VALUES(merchant,p_slot,p_name_th,p_name_en,p_points,price.currency,price.decimals,p_discount,p_minimum,p_validity,p_enabled,campaign)RETURNING * INTO w;
 RETURN reward173_view(w);
END $$;
REVOKE ALL ON FUNCTION reward173_list(),reward173_save(integer,text,text,integer,bigint,bigint,integer,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reward173_list(),reward173_save(integer,text,text,integer,bigint,bigint,integer,boolean)TO bitpos_app;

-- Customer side.
CREATE FUNCTION reward173_voucher_view(v reward173_vouchers)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',(v).id,'rewardId',w.id,'merchantId',w.merchant_id,'merchantName',m.name,'nameTh',w.name_th,'nameEn',w.name_en,'code',c.code,'state',reward173_voucher_state(v),
  'expiresAt',(v).expires_at,'createdAt',(v).created_at,'pointsSpent',x.points,'currency',w.currency,'decimals',w.decimals,'discountMinor',w.discount_minor::text,'minimumSpendMinor',w.minimum_spend_minor::text)
 FROM reward173_rewards w JOIN merchants m ON m.id=w.merchant_id JOIN coupon097_campaigns c ON c.id=w.campaign_id JOIN reward173_redemptions x ON x.id=(v).redemption_id
 WHERE w.merchant_id=(v).merchant_id AND w.id=(v).reward_id
$$;
CREATE FUNCTION mobile_reward_catalog(p_account uuid,p_session uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NOT reward173_session_ok(p_account,p_session)THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 -- Only shops where this account has a paid order or an earlier redemption; a shop's rewards are not advertised to strangers.
 RETURN coalesce((SELECT jsonb_agg(item ORDER BY mname,slot)FROM(
  SELECT m.name mname,w.slot,reward173_view(w)||jsonb_build_object('merchantId',m.id,'merchantName',m.name,'balance',b.balance,'redeemable',b.balance>=w.points_cost)item
  FROM reward173_rewards w JOIN merchants m ON m.id=w.merchant_id
  CROSS JOIN LATERAL(SELECT reward173_balance(p_account,w.merchant_id,w.currency,w.decimals)balance)b
  WHERE w.enabled AND(EXISTS(SELECT 1 FROM online_food_orders f WHERE f.merchant_id=w.merchant_id AND f.account_id=p_account)
   OR EXISTS(SELECT 1 FROM reward173_redemptions x WHERE x.merchant_id=w.merchant_id AND x.account_id=p_account)))q),'[]'::jsonb);
END $$;
CREATE FUNCTION mobile_reward_vouchers(p_account uuid,p_session uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NOT reward173_session_ok(p_account,p_session)THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(reward173_voucher_view(v)ORDER BY v.created_at DESC,v.id)FROM(SELECT * FROM reward173_vouchers WHERE account_id=p_account ORDER BY created_at DESC,id LIMIT 100)v),'[]'::jsonb);
END $$;
CREATE FUNCTION mobile_reward_redeem(p_account uuid,p_session uuid,p_reward uuid,p_key uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE w reward173_rewards;c coupon097_campaigns;prior reward173_redemptions;x reward173_redemptions;v reward173_vouchers;digest text;balance bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'REWARD_READ_COMMITTED_REQUIRED';END IF;
 IF p_reward IS NULL OR p_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF NOT reward173_session_ok(p_account,p_session)THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 -- One lock per account orders every balance check and debit; each later statement sees the previous commit.
 PERFORM pg_advisory_xact_lock(hashtextextended('reward173:'||p_account::text,173));
 digest:=encode(sha256(convert_to(jsonb_build_array('REDEEM',p_reward)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM reward173_redemptions WHERE account_id=p_account AND idempotency_key=p_key;
 IF FOUND THEN
  IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  SELECT * INTO STRICT v FROM reward173_vouchers WHERE redemption_id=prior.id;SELECT * INTO STRICT w FROM reward173_rewards WHERE id=prior.reward_id;
  RETURN jsonb_build_object('voucher',reward173_voucher_view(v),'balance',reward173_balance(p_account,w.merchant_id,w.currency,w.decimals),'replayed',true);
 END IF;
 SELECT * INTO w FROM reward173_rewards WHERE id=p_reward FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO c FROM coupon097_campaigns WHERE id=w.campaign_id;
 IF NOT w.enabled OR NOT c.enabled THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
 -- Same visibility rule as the catalog: no paid order or earlier redemption at this shop means the reward does not exist for this account.
 IF NOT(EXISTS(SELECT 1 FROM online_food_orders f WHERE f.merchant_id=w.merchant_id AND f.account_id=p_account)OR EXISTS(SELECT 1 FROM reward173_redemptions z WHERE z.merchant_id=w.merchant_id AND z.account_id=p_account))THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 balance:=reward173_balance(p_account,w.merchant_id,w.currency,w.decimals);
 IF balance<w.points_cost THEN RAISE EXCEPTION 'REWARD_INSUFFICIENT_POINTS';END IF;
 INSERT INTO reward173_redemptions(account_id,merchant_id,reward_id,points,idempotency_key,request_hash)VALUES(p_account,w.merchant_id,w.id,w.points_cost,p_key,digest)RETURNING * INTO x;
 INSERT INTO reward173_vouchers(redemption_id,account_id,merchant_id,reward_id,expires_at)VALUES(x.id,p_account,w.merchant_id,w.id,clock_timestamp()+w.validity_days*interval '1 day')RETURNING * INTO v;
 RETURN jsonb_build_object('voucher',reward173_voucher_view(v),'balance',balance-w.points_cost,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION mobile_reward_catalog(uuid,uuid),mobile_reward_vouchers(uuid,uuid),mobile_reward_redeem(uuid,uuid,uuid,uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_reward_catalog(uuid,uuid),mobile_reward_vouchers(uuid,uuid),mobile_reward_redeem(uuid,uuid,uuid,uuid)TO bitpos_app;
REVOKE ALL ON FUNCTION reward173_session_ok(uuid,uuid),reward173_balance(uuid,uuid,text,smallint),reward173_voucher_state(reward173_vouchers),reward173_voucher_view(reward173_vouchers)FROM PUBLIC;

-- The account-wide totals now net out redemptions (per currency) so the two numbers on the Rewards page agree.
CREATE OR REPLACE FUNCTION mobile_reward_totals(p_account uuid,p_session uuid)
RETURNS TABLE(currency text,decimals smallint,orders integer,points bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT t.catalog_currency,t.catalog_decimals,t.orders,greatest(0,t.points-coalesce(s.spent,0))::bigint FROM(
  SELECT a.catalog_currency,a.catalog_decimals,count(*)::integer orders,sum(div(a.total_minor::numeric,10::numeric^a.catalog_decimals))::bigint points
  FROM online_food_orders f
  JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id AND o.status='PAID'
  JOIN order_authority a ON a.merchant_id=f.merchant_id AND a.order_id=f.order_id
  WHERE f.account_id=p_account
  AND EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts x ON x.id=s.account_id
   WHERE s.id=p_session AND s.account_id=p_account AND s.revoked_at IS NULL
   AND s.access_expires_at>statement_timestamp() AND s.refresh_expires_at>statement_timestamp() AND x.disabled_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=f.merchant_id AND r.order_id=f.order_id)
  GROUP BY a.catalog_currency,a.catalog_decimals)t
 LEFT JOIN LATERAL(SELECT sum(x.points)spent FROM reward173_redemptions x JOIN reward173_rewards w ON w.merchant_id=x.merchant_id AND w.id=x.reward_id
  WHERE x.account_id=p_account AND w.currency=t.catalog_currency AND w.decimals=t.catalog_decimals)s ON true
 ORDER BY t.catalog_currency,t.catalog_decimals
$$;

-- Voucher gate on the existing 171 coupon entry point. Reward-backed campaigns need an AVAILABLE voucher of the caller; the voucher is
-- then linked to the hold that coupon098_apply created. Replaying a stored command keeps the voucher it first used. Everything else is 171 unchanged.
CREATE OR REPLACE FUNCTION mobile_coupon_apply(p_source uuid,p_code text,p_command uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;merchant uuid;norm text;campaign coupon097_campaigns;version uuid;prior coupon098_commands;used uuid;rw reward173_rewards;backed boolean;voucher reward173_vouchers;result jsonb;active coupon097_versions;pv catalog_price_versions;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 IF p_source IS NULL OR p_command IS NULL OR merchant IS NULL OR p_code IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 norm:=upper(btrim(p_code));
 IF norm !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' THEN RAISE EXCEPTION 'COUPON_NOT_FOUND';END IF;
 SELECT * INTO campaign FROM coupon097_campaigns WHERE merchant_id=merchant AND coupon097_campaigns.code=norm;
 IF NOT FOUND OR NOT campaign.enabled OR campaign.active_version_id IS NULL THEN RAISE EXCEPTION 'COUPON_NOT_FOUND';END IF;
 version:=campaign.active_version_id;
 SELECT * INTO rw FROM reward173_rewards WHERE merchant_id=merchant AND campaign_id=campaign.id;backed:=FOUND;
 SELECT * INTO prior FROM coupon098_commands WHERE account_id=actor AND command_id=p_command;
 IF FOUND THEN
  SELECT h.version_id INTO used FROM coupon098_quotes q JOIN coupon097_holds h ON h.id=q.hold_id WHERE q.merchant_id=prior.merchant_id AND q.quote_id=prior.quote_id;
  IF used IS NULL OR NOT EXISTS(SELECT 1 FROM coupon097_versions v WHERE v.id=used AND v.campaign_id=campaign.id)THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  version:=used;
 ELSIF backed THEN
  -- A price publish creates a new price version; re-point the (immutable-terms) reward coupon at it when currency and decimals are unchanged.
  SELECT * INTO active FROM coupon097_versions WHERE id=campaign.active_version_id FOR UPDATE;
  SELECT v.* INTO pv FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=merchant;
  IF FOUND AND pv.id<>active.price_version_id AND pv.currency=rw.currency AND pv.decimals=rw.decimals THEN
   version:=gen_random_uuid();
   INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,fixed_minor,minimum_food_minor,maximum_discount_minor,merchant_funding_bps,global_cap,account_cap,budget_minor,serving,starts_at,expires_at)
   SELECT version,merchant_id,campaign_id,(SELECT max(revision)+1 FROM coupon097_versions WHERE campaign_id=campaign.id),pv.id,discount_kind,fixed_minor,minimum_food_minor,maximum_discount_minor,merchant_funding_bps,global_cap,account_cap,budget_minor,serving,starts_at,expires_at
   FROM coupon097_versions WHERE id=active.id;
   UPDATE coupon097_campaigns SET active_version_id=version WHERE id=campaign.id;
  END IF;
  SELECT v.* INTO voucher FROM reward173_vouchers v WHERE v.account_id=actor AND v.merchant_id=merchant AND v.reward_id=rw.id AND reward173_voucher_state(v)='AVAILABLE'
   ORDER BY v.expires_at,v.id LIMIT 1 FOR UPDATE OF v SKIP LOCKED;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_REWARD_VOUCHER_REQUIRED';END IF;
 END IF;
 result:=coupon098_apply(p_source,version,jsonb_build_object('commandId',p_command));
 IF voucher.id IS NOT NULL THEN UPDATE reward173_vouchers SET hold_id=(result->>'holdId')::uuid WHERE id=voucher.id;END IF;
 RETURN result;
END $$;
