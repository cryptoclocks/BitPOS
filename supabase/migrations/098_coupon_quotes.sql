-- Coupon replacement quote evidence. Checkout remains explicitly unadmitted
-- until the bill/payment/closure/refund coupling is integrated and verified.
SET search_path=bitpos,public;
ALTER TABLE order_quotes ADD COLUMN coupon098_version smallint CHECK(coupon098_version IS NULL OR coupon098_version=1);
CREATE TABLE coupon098_quotes(
 merchant_id uuid NOT NULL,quote_id uuid NOT NULL,source_quote_id uuid NOT NULL,hold_id uuid NOT NULL UNIQUE REFERENCES coupon097_holds,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,quote_id),UNIQUE(merchant_id,source_quote_id),
 FOREIGN KEY(merchant_id,quote_id)REFERENCES order_quotes,FOREIGN KEY(merchant_id,source_quote_id)REFERENCES order_quotes,CHECK(quote_id<>source_quote_id)
);
CREATE TABLE coupon098_commands(account_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,request_hash text NOT NULL,merchant_id uuid NOT NULL,quote_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES mobile_sessions,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,command_id),FOREIGN KEY(merchant_id,quote_id)REFERENCES coupon098_quotes);
ALTER TABLE coupon098_quotes ENABLE ROW LEVEL SECURITY;ALTER TABLE coupon098_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coupon098_quotes,coupon098_commands FROM PUBLIC,bitpos_app;
CREATE TRIGGER coupon098_quotes_immutable BEFORE UPDATE OR DELETE ON coupon098_quotes FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER coupon098_commands_immutable BEFORE UPDATE OR DELETE ON coupon098_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
-- Exact060 legacy validator, renamed only; non-coupon callers retain its checks.
CREATE FUNCTION coupon098_legacy_assert_configured_quote(merchant uuid,quote uuid) RETURNS void
LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE q order_quotes%ROWTYPE;d quote_configured_food%ROWTYPE;expected jsonb;delivery quote_delivery_snapshots;price catalog_price_versions;fee numeric;total numeric;
BEGIN
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=merchant AND id=quote;
 SELECT * INTO d FROM quote_configured_food WHERE merchant_id=merchant AND quote_id=quote;
 IF q.origin_kind<>'online' THEN IF FOUND THEN RAISE EXCEPTION 'ROUTED_CONFIGURED_EVIDENCE' USING ERRCODE='23514';END IF;RETURN;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_CONFIGURED_QUOTE' USING ERRCODE='23514';END IF;
 IF q.configured_food_version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'UNCONFIGURED_QUOTE_VERSION' USING ERRCODE='23514';END IF;
 expected:=expected_configured_food(merchant,quote,d.items);
 IF q.authority->'serving'->>'kind'='delivery' THEN
  SELECT * INTO STRICT delivery FROM quote_delivery_snapshots WHERE merchant_id=merchant AND quote_id=quote;
  SELECT * INTO STRICT price FROM catalog_price_versions WHERE merchant_id=merchant AND id=q.price_version_id;
  fee:=delivery.delivery_minor+delivery.service_minor;
  total:=(expected->'total'->>'amountMinor')::numeric+fee;
  expected:=expected||jsonb_build_object('fees',configured_money(fee,price.currency,price.decimals),'total',configured_money(total,price.currency,price.decimals));
  IF d.snapshot IS DISTINCT FROM expected OR q.total_minor::text IS DISTINCT FROM expected->'total'->>'amountMinor'
  OR q.request_hash IS DISTINCT FROM draft067_delivery_hash(merchant,quote,d.items)
  THEN RAISE EXCEPTION 'DELIVERY_CONFIGURED_QUOTE_MISMATCH' USING ERRCODE='23514';END IF;
 ELSE
  IF d.snapshot IS DISTINCT FROM expected OR q.total_minor::text IS DISTINCT FROM expected->'total'->>'amountMinor'
  OR q.request_hash IS DISTINCT FROM configured_request_hash(q.source_account_id,q.source_branch_id,d.items)
  THEN RAISE EXCEPTION 'CONFIGURED_QUOTE_MISMATCH' USING ERRCODE='23514';END IF;
 END IF;
END $$;
CREATE FUNCTION coupon098_hash(b order_quotes,h coupon097_holds)RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array('bitpos.coupon.quote.v1',(b).id,(b).request_hash,(h).id,(h).version_id,(h).pricing,(b).total_minor,(h).expires_at,(b).authority)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION coupon098_snapshot(base jsonb,discount bigint)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE currency text:=base->'total'->>'currency';decimals integer:=(base->'total'->>'decimals')::integer;total numeric:=(base->'total'->>'amountMinor')::numeric-discount;
BEGIN
 IF discount<=0 OR total<0 THEN RAISE EXCEPTION 'COUPON_INVALID_ADJUSTMENT';END IF;
 RETURN base||jsonb_build_object('discount',configured_money((base->'discount'->>'amountMinor')::numeric+discount,currency,decimals),'total',configured_money(total,currency,decimals));
END $$;
CREATE FUNCTION coupon098_assert_snapshot(merchant uuid,target uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE q order_quotes;b order_quotes;t coupon098_quotes;h coupon097_holds;v coupon097_versions;d quote_configured_food;original quote_configured_food;expected jsonb;amounts jsonb;price catalog_price_versions;atomic numeric;delivery quote_delivery_snapshots;original_delivery quote_delivery_snapshots;
BEGIN
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=merchant AND id=target;SELECT * INTO t FROM coupon098_quotes WHERE merchant_id=merchant AND quote_id=target;
 IF NOT FOUND OR q.coupon098_version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'COUPON_QUOTE_EVIDENCE_REQUIRED' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT b FROM order_quotes WHERE merchant_id=merchant AND id=t.source_quote_id;
 IF b.coupon098_version IS NOT NULL OR b.origin_kind<>'online'THEN RAISE EXCEPTION 'COUPON_INVALID_SOURCE' USING ERRCODE='23514';END IF;
 -- The original quote/document already passed their own deferred admission.
 -- Rechecking mutable option pointers here would invalidate historical evidence.
 SELECT * INTO STRICT h FROM coupon097_holds WHERE id=t.hold_id;SELECT * INTO STRICT v FROM coupon097_versions WHERE id=h.version_id;
 SELECT * INTO STRICT original FROM quote_configured_food WHERE merchant_id=merchant AND quote_id=b.id;SELECT * INTO STRICT d FROM quote_configured_food WHERE merchant_id=merchant AND quote_id=q.id;
 SELECT jsonb_agg(jsonb_build_object('lineId',value->>'lineId','amountMinor',value->'lineTotal'->>'amountMinor'))INTO amounts FROM jsonb_array_elements(original.snapshot->'lines');
 expected:=coupon096_price(coupon097_terms(v),amounts);
 IF(h.merchant_id,h.quote_id,h.account_id,h.source_request_hash)IS DISTINCT FROM(b.merchant_id,b.id,b.source_account_id,b.request_hash)OR h.pricing IS DISTINCT FROM expected
 OR h.discount_minor::text IS DISTINCT FROM expected->>'discountMinor'OR h.merchant_minor::text IS DISTINCT FROM expected->>'merchantFundingMinor'OR h.platform_minor::text IS DISTINCT FROM expected->>'platformFundingMinor'
 OR h.expires_at>b.valid_until OR h.expires_at>v.expires_at OR h.merchant_id<>v.merchant_id OR b.price_version_id<>v.price_version_id
 THEN RAISE EXCEPTION 'COUPON_SOURCE_BINDING_MISMATCH' USING ERRCODE='23514';END IF;
 expected:=coupon098_snapshot(original.snapshot,h.discount_minor);
 SELECT * INTO STRICT price FROM catalog_price_versions WHERE merchant_id=merchant AND id=q.price_version_id;
 atomic:=((expected->'total'->>'amountMinor')::numeric)*CASE WHEN price.currency='USD'THEN power(10::numeric,6-price.decimals)WHEN price.currency='USDG'THEN 1 ELSE NULL END;
 IF(to_jsonb(q)-ARRAY['id','total_minor','usdg_minor','settlement','request_hash','valid_until','coupon098_version'])IS DISTINCT FROM(to_jsonb(b)-ARRAY['id','total_minor','usdg_minor','settlement','request_hash','valid_until','coupon098_version'])
 OR d.items IS DISTINCT FROM original.items OR d.snapshot IS DISTINCT FROM expected OR q.total_minor::text IS DISTINCT FROM expected->'total'->>'amountMinor'OR q.valid_until IS DISTINCT FROM h.expires_at
 OR q.usdg_minor::numeric IS DISTINCT FROM atomic OR q.settlement IS DISTINCT FROM(b.settlement||jsonb_build_object('amountMinor',atomic::bigint::text))OR q.request_hash IS DISTINCT FROM coupon098_hash(b,h)
 THEN RAISE EXCEPTION 'COUPON_QUOTE_MISMATCH' USING ERRCODE='23514';END IF;
 IF q.authority->'serving'->>'kind'='delivery'THEN
  SELECT * INTO STRICT original_delivery FROM quote_delivery_snapshots WHERE merchant_id=merchant AND quote_id=b.id;SELECT * INTO STRICT delivery FROM quote_delivery_snapshots WHERE merchant_id=merchant AND quote_id=q.id;
  IF(to_jsonb(delivery)-'quote_id')IS DISTINCT FROM(to_jsonb(original_delivery)-'quote_id')THEN RAISE EXCEPTION 'COUPON_DELIVERY_MISMATCH' USING ERRCODE='23514';END IF;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION assert_configured_quote(merchant uuid,quote uuid)RETURNS void LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE q order_quotes;
BEGIN
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=merchant AND id=quote;
 IF q.coupon098_version IS NULL THEN PERFORM coupon098_legacy_assert_configured_quote(merchant,quote);ELSE PERFORM coupon098_assert_snapshot(merchant,quote);END IF;
END $$;
CREATE FUNCTION coupon098_complete()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN PERFORM coupon098_assert_snapshot(NEW.merchant_id,NEW.quote_id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER coupon098_complete AFTER INSERT ON coupon098_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION coupon098_complete();
CREATE FUNCTION coupon098_checkout_gate()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM order_quotes WHERE merchant_id=NEW.merchant_id AND id=NEW.quote_id AND coupon098_version=1)THEN RAISE EXCEPTION 'COUPON_CHECKOUT_NOT_ADMITTED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER coupon098_checkout_gate BEFORE INSERT ON order_authority FOR EACH ROW EXECUTE FUNCTION coupon098_checkout_gate();
CREATE FUNCTION coupon098_apply(source uuid,policy uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;key uuid;digest text;prior coupon098_commands;b order_quotes;h coupon097_holds;held jsonb;target uuid:=gen_random_uuid();d quote_configured_food;price catalog_price_versions;total numeric;atomic numeric;t coupon098_quotes;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF jsonb_typeof(payload)IS DISTINCT FROM 'object'OR(SELECT count(*)FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'commandId')IS DISTINCT FROM 'string'OR NOT coalesce(canonical_online_option_uuid(payload->>'commandId'),false)THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'commandId')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array('COUPON_QUOTE',source,policy,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,98));
 SELECT * INTO prior FROM coupon098_commands WHERE account_id=actor AND command_id=key;
 IF FOUND THEN
  IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF prior.merchant_id::text IS DISTINCT FROM current_setting('bitpos.merchant',true)THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  SELECT * INTO STRICT t FROM coupon098_quotes WHERE merchant_id=prior.merchant_id AND quote_id=prior.quote_id;RETURN jsonb_build_object('quoteId',t.quote_id,'sourceQuoteId',t.source_quote_id,'holdId',t.hold_id,'checkoutReady',false);
 END IF;
 SELECT * INTO b FROM order_quotes WHERE id=source AND origin_kind='online'AND source_account_id=actor;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF b.merchant_id::text IS DISTINCT FROM current_setting('bitpos.merchant',true)THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF b.coupon098_version IS NOT NULL THEN RAISE EXCEPTION 'COUPON_ALREADY_APPLIED';END IF;
 PERFORM 1 FROM merchants WHERE id=b.merchant_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM quote_coffee_constraints WHERE merchant_id=b.merchant_id AND quote_id=b.id)OR EXISTS(SELECT 1 FROM quote_table_occupancies WHERE merchant_id=b.merchant_id AND quote_id=b.id)THEN RAISE EXCEPTION 'COUPON_COLLECTION_REVIEW_REQUIRED';END IF;
 held:=coupon097_hold(source,policy,payload);SELECT * INTO STRICT h FROM coupon097_holds WHERE id=(held->>'holdId')::uuid;
 IF h.state<>'HELD'OR h.expires_at<=clock_timestamp()THEN RAISE EXCEPTION 'COUPON_HOLD_UNAVAILABLE';END IF;
 total:=b.total_minor-h.discount_minor;IF total<=0 THEN RAISE EXCEPTION 'COUPON_ZERO_ORDER_REQUIRES_COMPLETION';END IF;
 SELECT * INTO STRICT price FROM catalog_price_versions WHERE merchant_id=b.merchant_id AND id=b.price_version_id;
 atomic:=total*CASE WHEN price.currency='USD'THEN power(10::numeric,6-price.decimals)WHEN price.currency='USDG'THEN 1 ELSE NULL END;
 IF atomic IS NULL OR atomic>999999999999999999 THEN RAISE EXCEPTION 'INVALID_CONFIGURED_MONEY';END IF;
 INSERT INTO order_quotes(merchant_id,id,origin_kind,origin_id,source_register_id,source_device_id,session_id,cart_version,price_version_id,pricing_revision,cart,lines,total_minor,usdg_minor,treasury,settlement,authority,request_hash,quoted_at,valid_until,source_account_id,source_branch_id,configured_food_version,coupon098_version)
 VALUES(b.merchant_id,target,b.origin_kind,b.origin_id,b.source_register_id,b.source_device_id,b.session_id,b.cart_version,b.price_version_id,b.pricing_revision,b.cart,b.lines,total,atomic,b.treasury,b.settlement||jsonb_build_object('amountMinor',atomic::bigint::text),b.authority,coupon098_hash(b,h),b.quoted_at,h.expires_at,b.source_account_id,b.source_branch_id,b.configured_food_version,1);
 SELECT * INTO STRICT d FROM quote_configured_food WHERE merchant_id=b.merchant_id AND quote_id=b.id;
 INSERT INTO quote_configured_food(merchant_id,quote_id,items,snapshot)VALUES(b.merchant_id,target,d.items,coupon098_snapshot(d.snapshot,h.discount_minor));
 INSERT INTO quote_delivery_snapshots SELECT merchant_id,target,branch_id,account_id,address_id,address_version,policy_version_id,zone_version_id,recipient_name,phone,address_text,instructions,origin_latitude_e7,origin_longitude_e7,latitude_e7,longitude_e7,currency,decimals,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,fixture FROM quote_delivery_snapshots WHERE merchant_id=b.merchant_id AND quote_id=b.id;
 INSERT INTO quote_scoped_promotions SELECT merchant_id,target,product_id,target_id,evidence FROM quote_scoped_promotions WHERE merchant_id=b.merchant_id AND quote_id=b.id;
 INSERT INTO daily_quote_promotions SELECT merchant_id,target,product_id,campaign_id,campaign_version,evidence FROM daily_quote_promotions WHERE merchant_id=b.merchant_id AND quote_id=b.id;
 INSERT INTO personal_quote_promotions SELECT merchant_id,target,product_id,target_id,campaign_id,campaign_version,recipient_id,evidence FROM personal_quote_promotions WHERE merchant_id=b.merchant_id AND quote_id=b.id;
 INSERT INTO coupon098_quotes(merchant_id,quote_id,source_quote_id,hold_id)VALUES(b.merchant_id,target,b.id,h.id);
 PERFORM coupon098_assert_snapshot(b.merchant_id,target);
 INSERT INTO coupon098_commands(account_id,command_id,request_hash,merchant_id,quote_id,session_id)VALUES(actor,key,digest,b.merchant_id,target,nullif(current_setting('bitpos.mobile_session',true),'')::uuid);
 RETURN jsonb_build_object('quoteId',target,'sourceQuoteId',b.id,'holdId',h.id,'checkoutReady',false);
END $$;
REVOKE ALL ON FUNCTION coupon098_legacy_assert_configured_quote(uuid,uuid),coupon098_hash(order_quotes,coupon097_holds),coupon098_snapshot(jsonb,bigint),coupon098_assert_snapshot(uuid,uuid),coupon098_complete(),coupon098_checkout_gate(),coupon098_apply(uuid,uuid,jsonb)FROM PUBLIC,bitpos_app;
-- Existing configured quote triggers need these validators; they expose no rows
-- and do not admit billing or grant raw coupon-table access.
GRANT EXECUTE ON FUNCTION coupon098_legacy_assert_configured_quote(uuid,uuid),coupon098_assert_snapshot(uuid,uuid)TO bitpos_app;

CREATE FUNCTION coupon098_validate_live(merchant uuid,target uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;q order_quotes;t coupon098_quotes;h coupon097_holds;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF merchant::text IS DISTINCT FROM current_setting('bitpos.merchant',true)THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO q FROM order_quotes WHERE merchant_id=merchant AND id=target AND source_account_id=actor AND coupon098_version=1;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 SELECT * INTO STRICT t FROM coupon098_quotes WHERE merchant_id=merchant AND quote_id=target;SELECT * INTO STRICT h FROM coupon097_holds WHERE id=t.hold_id;
 PERFORM 1 FROM coupon097_versions WHERE id=h.version_id FOR UPDATE;SELECT * INTO STRICT h FROM coupon097_holds WHERE id=t.hold_id FOR UPDATE;
 IF h.account_id<>actor OR h.state<>'HELD'OR h.expires_at<=clock_timestamp()OR q.valid_until<=clock_timestamp()THEN RAISE EXCEPTION 'COUPON_HOLD_UNAVAILABLE';END IF;
 IF NOT EXISTS(SELECT 1 FROM merchant_pricing p JOIN merchants m ON m.id=p.merchant_id JOIN marketplace_branches b ON b.merchant_id=m.id AND b.id=q.source_branch_id
 WHERE p.merchant_id=merchant AND p.active_price_version_id=q.price_version_id AND p.revision=q.pricing_revision AND m.treasury=q.treasury AND b.enabled
 AND(q.authority->'serving'->>'kind'='pickup'AND b.pickup_enabled OR q.authority->'serving'->>'kind'='delivery'AND b.delivery_enabled))THEN RAISE EXCEPTION 'COUPON_QUOTE_CHANGED';END IF;

 PERFORM coupon098_assert_snapshot(merchant,target);
 -- Live options/current quote constraints are separate from historical evidence.
 PERFORM coupon098_legacy_assert_configured_quote(merchant,t.source_quote_id);
END $$;
REVOKE ALL ON FUNCTION coupon098_validate_live(uuid,uuid)FROM PUBLIC,bitpos_app;
