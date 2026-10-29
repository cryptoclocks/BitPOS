-- Internal coupon holds, not checkout admission. Merchant-funded policies only
-- until the platform funding adapter proves real available budget separately.
SET search_path=bitpos,public;
CREATE TABLE coupon097_campaigns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,branch_id uuid,
 code text NOT NULL CHECK(code~'^[A-Z0-9][A-Z0-9_-]{2,31}$'),name text NOT NULL CHECK(length(btrim(name))BETWEEN 1 AND 160),
 enabled boolean NOT NULL DEFAULT false,active_version_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,id),UNIQUE(merchant_id,code),FOREIGN KEY(merchant_id,branch_id)REFERENCES marketplace_branches,
 CHECK(NOT enabled OR active_version_id IS NOT NULL)
);
CREATE TABLE coupon097_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,campaign_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),price_version_id uuid NOT NULL,
 discount_kind text NOT NULL CHECK(discount_kind IN('FIXED','BASIS_POINTS')),fixed_minor bigint CHECK(fixed_minor BETWEEN 1 AND 999999999999999999),basis_points integer CHECK(basis_points BETWEEN 1 AND 10000),
 minimum_food_minor bigint NOT NULL CHECK(minimum_food_minor BETWEEN 0 AND 999999999999999999),maximum_discount_minor bigint NOT NULL CHECK(maximum_discount_minor BETWEEN 1 AND 999999999999999999),
 merchant_funding_bps integer NOT NULL DEFAULT 10000 CHECK(merchant_funding_bps BETWEEN 0 AND 10000),
 global_cap integer NOT NULL CHECK(global_cap BETWEEN 1 AND 1000000),account_cap integer NOT NULL CHECK(account_cap BETWEEN 1 AND 1000000),budget_minor bigint NOT NULL CHECK(budget_minor BETWEEN 1 AND 999999999999999999),
 serving text[] NOT NULL CHECK(cardinality(serving)BETWEEN 1 AND 2 AND serving<@ARRAY['pickup','delivery']::text[]),
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,campaign_id,id),UNIQUE(campaign_id,revision),FOREIGN KEY(merchant_id,campaign_id)REFERENCES coupon097_campaigns(merchant_id,id),FOREIGN KEY(merchant_id,price_version_id)REFERENCES catalog_price_versions,
 CHECK(expires_at>starts_at),CHECK(discount_kind='FIXED'AND fixed_minor IS NOT NULL AND basis_points IS NULL OR discount_kind='BASIS_POINTS'AND fixed_minor IS NULL AND basis_points IS NOT NULL)
);
ALTER TABLE coupon097_campaigns ADD FOREIGN KEY(merchant_id,id,active_version_id)REFERENCES coupon097_versions(merchant_id,campaign_id,id);
CREATE TRIGGER coupon097_versions_immutable BEFORE UPDATE OR DELETE ON coupon097_versions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE coupon097_holds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,version_id uuid NOT NULL REFERENCES coupon097_versions,account_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,
 quote_id uuid NOT NULL,source_request_hash text NOT NULL,pricing jsonb NOT NULL,discount_minor bigint NOT NULL CHECK(discount_minor>0),merchant_minor bigint NOT NULL CHECK(merchant_minor>=0),platform_minor bigint NOT NULL CHECK(platform_minor>=0),
 state text NOT NULL DEFAULT 'HELD'CHECK(state IN('HELD','RELEASED','EXPIRED','RECONCILE')),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,quote_id),FOREIGN KEY(merchant_id,quote_id)REFERENCES order_quotes,
 CHECK(discount_minor=merchant_minor+platform_minor),CHECK(expires_at>created_at)
);
CREATE INDEX coupon097_live_policy ON coupon097_holds(version_id,account_id)WHERE state IN('HELD','RECONCILE');
CREATE INDEX coupon097_due ON coupon097_holds(version_id,expires_at,id)WHERE state='HELD';
CREATE TABLE coupon097_commands(
 account_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('HOLD','RELEASE')),request_hash text NOT NULL,hold_id uuid NOT NULL REFERENCES coupon097_holds,session_id uuid NOT NULL REFERENCES mobile_sessions,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,command_id)
);
CREATE TRIGGER coupon097_commands_immutable BEFORE UPDATE OR DELETE ON coupon097_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
ALTER TABLE coupon097_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon097_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon097_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon097_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coupon097_campaigns,coupon097_versions,coupon097_holds,coupon097_commands FROM PUBLIC,bitpos_app;
CREATE FUNCTION coupon097_terms(v coupon097_versions)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('minimumFoodMinor',(v).minimum_food_minor::text,'maximumDiscountMinor',(v).maximum_discount_minor::text,'merchantFundingBps',(v).merchant_funding_bps,'discount',CASE WHEN(v).discount_kind='FIXED'THEN jsonb_build_object('kind','FIXED','fixedMinor',(v).fixed_minor::text)ELSE jsonb_build_object('kind','BASIS_POINTS','basisPoints',(v).basis_points)END)
$$;
CREATE FUNCTION coupon097_hold_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE v coupon097_versions;c coupon097_campaigns;q order_quotes;document quote_configured_food;amounts jsonb;expected jsonb;used_count bigint;used_account bigint;used_budget numeric;at timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 IF TG_OP='DELETE'THEN RAISE EXCEPTION 'IMMUTABLE_COUPON_HOLD';END IF;
 SELECT * INTO STRICT v FROM coupon097_versions WHERE id=NEW.version_id FOR UPDATE;
 IF TG_OP='UPDATE'THEN
  IF(to_jsonb(NEW)-ARRAY['state','version','updated_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updated_at'])OR NEW.version<>OLD.version+1 OR OLD.state<>'HELD'OR NEW.state NOT IN('RELEASED','EXPIRED','RECONCILE')THEN RAISE EXCEPTION 'IMMUTABLE_COUPON_HOLD';END IF;
  IF NEW.state='EXPIRED'AND OLD.expires_at>clock_timestamp()THEN RAISE EXCEPTION 'COUPON_LEASE_STILL_LIVE';END IF;
  IF NEW.state IN('RELEASED','EXPIRED')AND EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=OLD.merchant_id AND quote_id=OLD.quote_id)THEN RAISE EXCEPTION 'COUPON_RECONCILIATION_REQUIRED';END IF;
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
CREATE TRIGGER coupon097_hold_guard BEFORE INSERT OR UPDATE OR DELETE ON coupon097_holds FOR EACH ROW EXECUTE FUNCTION coupon097_hold_guard();
CREATE FUNCTION coupon097_receipt(h coupon097_holds)RETURNS jsonb LANGUAGE sql VOLATILE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('holdId',(h).id,'quoteId',(h).quote_id,'versionId',(h).version_id,'state',(h).state,'version',(h).version::text,'pricing',(h).pricing,'expiresAt',(h).expires_at,'leaseLive',(h).state='HELD'AND(h).expires_at>clock_timestamp(),'checkoutReady',false)
$$;
CREATE FUNCTION coupon097_hold(quote uuid,policy uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;key uuid;digest text;prior coupon097_commands;h coupon097_holds;q order_quotes;v coupon097_versions;amounts jsonb;p jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF jsonb_typeof(payload)IS DISTINCT FROM 'object'OR(SELECT count(*)FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'commandId')IS DISTINCT FROM 'string'OR NOT coalesce(canonical_online_option_uuid(payload->>'commandId'),false)THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'commandId')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array('HOLD',quote,policy,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,97));
 SELECT * INTO prior FROM coupon097_commands WHERE account_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;SELECT * INTO STRICT h FROM coupon097_holds WHERE id=prior.hold_id;RETURN coupon097_receipt(h);END IF;
 SELECT * INTO q FROM order_quotes WHERE id=quote AND origin_kind='online'AND source_account_id=actor;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO v FROM coupon097_versions WHERE id=policy AND merchant_id=q.merchant_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM coupon097_holds WHERE merchant_id=q.merchant_id AND quote_id=q.id)THEN RAISE EXCEPTION 'COUPON_QUOTE_ALREADY_RESERVED';END IF;
 SELECT jsonb_agg(jsonb_build_object('lineId',value->>'lineId','amountMinor',value->'lineTotal'->>'amountMinor'))INTO amounts FROM quote_configured_food d CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'lines')value WHERE d.merchant_id=q.merchant_id AND d.quote_id=q.id;
 p:=coupon096_price(coupon097_terms(v),amounts);
 INSERT INTO coupon097_holds(merchant_id,version_id,account_id,session_id,quote_id,source_request_hash,pricing,discount_minor,merchant_minor,platform_minor,expires_at)
 VALUES(q.merchant_id,v.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,q.id,q.request_hash,p,(p->>'discountMinor')::bigint,(p->>'merchantFundingMinor')::bigint,(p->>'platformFundingMinor')::bigint,least(q.valid_until,v.expires_at))RETURNING * INTO h;
 INSERT INTO coupon097_commands(account_id,command_id,operation,request_hash,hold_id,session_id)VALUES(actor,key,'HOLD',digest,h.id,h.session_id);RETURN coupon097_receipt(h);
END $$;
CREATE FUNCTION coupon097_release(target uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;key uuid;digest text;prior coupon097_commands;h coupon097_holds;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF jsonb_typeof(payload)IS DISTINCT FROM 'object'OR(SELECT count(*)FROM jsonb_object_keys(payload))<>2 OR NOT payload?&ARRAY['commandId','expectedVersion']
 OR jsonb_typeof(payload->'commandId')IS DISTINCT FROM 'string'OR NOT coalesce(canonical_online_option_uuid(payload->>'commandId'),false)
 OR jsonb_typeof(payload->'expectedVersion')IS DISTINCT FROM 'string'OR(payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$'OR(payload->>'expectedVersion')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'commandId')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array('RELEASE',target,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,97));
 SELECT * INTO h FROM coupon097_holds WHERE id=target AND account_id=actor;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM 1 FROM coupon097_versions WHERE id=h.version_id FOR UPDATE;SELECT * INTO STRICT h FROM coupon097_holds WHERE id=target FOR UPDATE;
 SELECT * INTO prior FROM coupon097_commands WHERE account_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN coupon097_receipt(h);END IF;
 IF h.version<>(payload->>'expectedVersion')::bigint OR h.state<>'HELD'THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 UPDATE coupon097_holds SET state=CASE WHEN EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=h.merchant_id AND quote_id=h.quote_id)THEN 'RECONCILE'ELSE 'RELEASED'END,version=version+1,updated_at=clock_timestamp()WHERE id=h.id RETURNING * INTO h;
 INSERT INTO coupon097_commands(account_id,command_id,operation,request_hash,hold_id,session_id)VALUES(actor,key,'RELEASE',digest,h.id,nullif(current_setting('bitpos.mobile_session',true),'')::uuid);RETURN coupon097_receipt(h);
END $$;
CREATE FUNCTION coupon097_expire(maximum integer)RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE v record;h record;changed integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 IF maximum IS NULL OR maximum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR v IN SELECT id FROM coupon097_versions WHERE EXISTS(SELECT 1 FROM coupon097_holds WHERE version_id=coupon097_versions.id AND state='HELD'AND expires_at<=clock_timestamp())ORDER BY id FOR UPDATE SKIP LOCKED LOOP
  FOR h IN SELECT * FROM coupon097_holds WHERE version_id=v.id AND state='HELD'AND expires_at<=clock_timestamp()ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LOOP
   UPDATE coupon097_holds SET state=CASE WHEN EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=h.merchant_id AND quote_id=h.quote_id)THEN 'RECONCILE'ELSE 'EXPIRED'END,version=version+1,updated_at=clock_timestamp()WHERE id=h.id;
   changed:=changed+1;IF changed>=maximum THEN RETURN changed;END IF;
  END LOOP;
 END LOOP;RETURN changed;
END $$;
REVOKE ALL ON FUNCTION coupon097_terms(coupon097_versions),coupon097_hold_guard(),coupon097_receipt(coupon097_holds),coupon097_hold(uuid,uuid,jsonb),coupon097_release(uuid,jsonb),coupon097_expire(integer)FROM PUBLIC,bitpos_app;
