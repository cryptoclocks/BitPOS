-- DS41: coupon quote -> order -> payment -> refund binding. Replaces the
-- 098 "never admitted" checkout gate with server-side admission. Merchant-funded
-- coupons only (platform funding stays refused). A wallet/client callback is
-- never consulted: payment state comes from the orders row the verifier settles.
SET search_path=bitpos,public;
CREATE TABLE coupon167_redemptions(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,quote_id uuid NOT NULL,hold_id uuid NOT NULL UNIQUE REFERENCES coupon097_holds,
 version_id uuid NOT NULL REFERENCES coupon097_versions,account_id uuid NOT NULL REFERENCES mobile_accounts,
 discount_minor bigint NOT NULL CHECK(discount_minor>0),merchant_minor bigint NOT NULL CHECK(merchant_minor>=0),platform_minor bigint NOT NULL CHECK(platform_minor=0),
 payable_minor bigint NOT NULL CHECK(payable_minor>0),CHECK(discount_minor=merchant_minor+platform_minor),
 state text NOT NULL DEFAULT 'BOUND'CHECK(state IN('BOUND','CONSUMED','RELEASED')),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id),UNIQUE(merchant_id,quote_id),
 FOREIGN KEY(merchant_id,order_id)REFERENCES orders(merchant_id,id),FOREIGN KEY(merchant_id,quote_id)REFERENCES coupon098_quotes(merchant_id,quote_id)
);
ALTER TABLE coupon167_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coupon167_redemptions FROM PUBLIC,bitpos_app;
CREATE FUNCTION coupon167_redemption_guard()RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE'THEN RAISE EXCEPTION 'immutable authority record' USING ERRCODE='23514';END IF;
 IF(to_jsonb(NEW)-ARRAY['state','version','updated_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updated_at'])OR NEW.version<>OLD.version+1
 OR OLD.state<>'BOUND'OR NEW.state NOT IN('CONSUMED','RELEASED')THEN RAISE EXCEPTION 'COUPON_REDEMPTION_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coupon167_redemption_guard BEFORE UPDATE OR DELETE ON coupon167_redemptions FOR EACH ROW EXECUTE FUNCTION coupon167_redemption_guard();
CREATE OR REPLACE FUNCTION coupon097_hold_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE v coupon097_versions;c coupon097_campaigns;q order_quotes;document quote_configured_food;amounts jsonb;expected jsonb;used_count bigint;used_account bigint;used_budget numeric;at timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 IF TG_OP='DELETE'THEN RAISE EXCEPTION 'IMMUTABLE_COUPON_HOLD';END IF;
 SELECT * INTO STRICT v FROM coupon097_versions WHERE id=NEW.version_id FOR UPDATE;
 IF TG_OP='UPDATE'THEN
  IF(to_jsonb(NEW)-ARRAY['state','version','updated_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updated_at'])OR NEW.version<>OLD.version+1 OR OLD.state<>'HELD'AND NOT(OLD.state='RECONCILE'AND NEW.state='RELEASED'AND EXISTS(SELECT 1 FROM coupon167_redemptions r WHERE r.hold_id=OLD.id AND r.state='RELEASED'))OR NEW.state NOT IN('RELEASED','EXPIRED','RECONCILE')THEN RAISE EXCEPTION 'IMMUTABLE_COUPON_HOLD';END IF;
  IF NEW.state='EXPIRED'AND OLD.expires_at>clock_timestamp()THEN RAISE EXCEPTION 'COUPON_LEASE_STILL_LIVE';END IF;
  IF NEW.state IN('RELEASED','EXPIRED')AND EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=OLD.merchant_id AND quote_id=OLD.quote_id)AND NOT EXISTS(SELECT 1 FROM coupon167_redemptions r WHERE r.hold_id=OLD.id AND r.state='RELEASED')THEN RAISE EXCEPTION 'COUPON_RECONCILIATION_REQUIRED';END IF;
  RETURN NEW;
 END IF;
 PERFORM dispatch_realtime_actor();IF NEW.account_id IS DISTINCT FROM dispatch_live_actor()OR NEW.session_id IS DISTINCT FROM nullif(current_setting('bitpos.mobile_session',true),'')::uuid THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO STRICT c FROM coupon097_campaigns WHERE id=v.campaign_id FOR SHARE;
 SELECT * INTO q FROM order_quotes WHERE merchant_id=NEW.merchant_id AND id=NEW.quote_id AND origin_kind='online'AND source_account_id=NEW.account_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF q.valid_until<=at OR v.starts_at>at OR v.expires_at<=at OR NOT c.enabled OR c.active_version_id<>v.id OR v.merchant_id<>q.merchant_id
 OR c.branch_id IS NOT NULL AND c.branch_id<>q.source_branch_id OR NOT(q.authority->'serving'->>'kind'=ANY(v.serving))OR q.price_version_id<>v.price_version_id
 OR NOT EXISTS(SELECT 1 FROM merchant_pricing WHERE merchant_id=q.merchant_id AND active_price_version_id=q.price_version_id AND revision=q.pricing_revision)
 THEN RAISE EXCEPTION 'COUPON_INELIGIBLE';END IF;
 IF v.merchant_funding_bps<>10000 THEN RAISE EXCEPTION 'COUPON_PLATFORM_FUNDING_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=q.merchant_id AND quote_id=q.id)THEN RAISE EXCEPTION 'COUPON_QUOTE_ALREADY_BILLED';END IF;
 PERFORM assert_configured_quote(q.merchant_id,q.id);
 SELECT * INTO STRICT document FROM quote_configured_food WHERE merchant_id=q.merchant_id AND quote_id=q.id;
 SELECT jsonb_agg(jsonb_build_object('lineId',value->>'lineId','amountMinor',value->'lineTotal'->>'amountMinor'))INTO amounts FROM jsonb_array_elements(document.snapshot->'lines');
 expected:=coupon096_price(coupon097_terms(v),amounts);
 IF NEW.state<>'HELD'OR NEW.version<>1 OR NEW.pricing IS DISTINCT FROM expected OR NEW.source_request_hash<>q.request_hash OR NEW.expires_at IS DISTINCT FROM least(q.valid_until,v.expires_at)
 OR NEW.discount_minor::text IS DISTINCT FROM expected->>'discountMinor'OR NEW.merchant_minor::text IS DISTINCT FROM expected->>'merchantFundingMinor'OR NEW.platform_minor::text IS DISTINCT FROM expected->>'platformFundingMinor'THEN RAISE EXCEPTION 'COUPON_NONCANONICAL_HOLD';END IF;
 SELECT count(*),count(*)FILTER(WHERE account_id=NEW.account_id),coalesce(sum(discount_minor),0)INTO used_count,used_account,used_budget FROM coupon097_holds WHERE version_id=v.id AND state IN('HELD','RECONCILE');
 IF used_count>=v.global_cap THEN RAISE EXCEPTION 'COUPON_GLOBAL_LIMIT';END IF;
 IF used_account>=v.account_cap THEN RAISE EXCEPTION 'COUPON_ACCOUNT_LIMIT';END IF;
 IF used_budget+NEW.discount_minor>v.budget_minor THEN RAISE EXCEPTION 'COUPON_BUDGET_LIMIT';END IF;
 RETURN NEW;
END $$;

-- Hold state RECONCILE may now move to RELEASED once the order was closed unpaid.
CREATE OR REPLACE FUNCTION coupon098_checkout_gate()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;q order_quotes;t coupon098_quotes;h coupon097_holds;v coupon097_versions;
BEGIN
 SELECT * INTO q FROM order_quotes WHERE merchant_id=NEW.merchant_id AND id=NEW.quote_id;
 IF NOT FOUND OR q.coupon098_version IS DISTINCT FROM 1 THEN RETURN NEW;END IF;
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 actor:=dispatch_live_actor();
 IF NEW.merchant_id::text IS DISTINCT FROM current_setting('bitpos.merchant',true)OR NEW.source_kind<>'online'OR NEW.source_account_id IS DISTINCT FROM actor OR q.source_account_id IS DISTINCT FROM actor
 OR NEW.total_minor IS DISTINCT FROM q.total_minor OR NEW.settlement IS DISTINCT FROM q.settlement THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT t FROM coupon098_quotes WHERE merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id;
 SELECT * INTO STRICT h FROM coupon097_holds WHERE id=t.hold_id;
 PERFORM 1 FROM coupon097_versions WHERE id=h.version_id FOR UPDATE;
 SELECT * INTO STRICT h FROM coupon097_holds WHERE id=t.hold_id FOR UPDATE;SELECT * INTO STRICT v FROM coupon097_versions WHERE id=h.version_id;
 IF h.account_id<>actor OR h.state<>'HELD'OR h.expires_at<=clock_timestamp()OR q.valid_until<=clock_timestamp()THEN RAISE EXCEPTION 'COUPON_HOLD_UNAVAILABLE';END IF;
 IF v.merchant_funding_bps<>10000 OR h.platform_minor<>0 THEN RAISE EXCEPTION 'COUPON_PLATFORM_FUNDING_REQUIRED';END IF;
 IF q.total_minor<=0 THEN RAISE EXCEPTION 'COUPON_ZERO_ORDER_REQUIRES_COMPLETION';END IF;
 IF NOT EXISTS(SELECT 1 FROM merchant_pricing p JOIN merchants m ON m.id=p.merchant_id JOIN marketplace_branches b ON b.merchant_id=m.id AND b.id=q.source_branch_id
  WHERE p.merchant_id=NEW.merchant_id AND p.active_price_version_id=q.price_version_id AND p.revision=q.pricing_revision AND m.treasury=q.treasury AND b.enabled
  AND(q.authority->'serving'->>'kind'='pickup'AND b.pickup_enabled OR q.authority->'serving'->>'kind'='delivery'AND b.delivery_enabled))THEN RAISE EXCEPTION 'COUPON_QUOTE_CHANGED';END IF;
 PERFORM coupon098_assert_snapshot(NEW.merchant_id,NEW.quote_id);
 PERFORM coupon098_legacy_assert_configured_quote(NEW.merchant_id,t.source_quote_id);
 IF EXISTS(SELECT 1 FROM coupon167_redemptions WHERE hold_id=h.id OR merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id)THEN RAISE EXCEPTION 'COUPON_ALREADY_REDEEMED';END IF;
 INSERT INTO coupon167_redemptions(merchant_id,order_id,quote_id,hold_id,version_id,account_id,discount_minor,merchant_minor,platform_minor,payable_minor)
 VALUES(NEW.merchant_id,NEW.order_id,NEW.quote_id,h.id,h.version_id,actor,h.discount_minor,h.merchant_minor,h.platform_minor,q.total_minor);
 RETURN NEW;
END $$;
CREATE FUNCTION coupon167_order_status()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r coupon167_redemptions;
BEGIN
 SELECT * INTO r FROM coupon167_redemptions WHERE merchant_id=NEW.merchant_id AND order_id=NEW.id FOR UPDATE;
 IF NOT FOUND OR r.state<>'BOUND'THEN RETURN NEW;END IF;
 IF NEW.status='PAID'THEN
  UPDATE coupon167_redemptions SET state='CONSUMED',version=version+1,updated_at=clock_timestamp()WHERE merchant_id=r.merchant_id AND order_id=r.order_id;
 ELSIF NEW.status='EXPIRED'AND NEW.closure_reason IS NOT NULL THEN
  UPDATE coupon167_redemptions SET state='RELEASED',version=version+1,updated_at=clock_timestamp()WHERE merchant_id=r.merchant_id AND order_id=r.order_id;
  UPDATE coupon097_holds SET state='RELEASED',version=version+1,updated_at=clock_timestamp()WHERE id=r.hold_id AND state IN('HELD','RECONCILE');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coupon167_order_status AFTER UPDATE OF status,closure_reason ON orders FOR EACH ROW EXECUTE FUNCTION coupon167_order_status();
REVOKE ALL ON FUNCTION coupon167_redemption_guard(),coupon167_order_status()FROM PUBLIC,bitpos_app;
