-- Configured food evidence retains real-product aggregates for stock/promotions.
SET search_path=bitpos,public;
-- Existing quotes retain NULL and cannot acquire invented configurations later.
ALTER TABLE order_quotes ADD COLUMN configured_food_version smallint CHECK(configured_food_version IS NULL OR configured_food_version=1);
CREATE TABLE quote_configured_food(
 merchant_id uuid NOT NULL,quote_id uuid NOT NULL,items jsonb NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(merchant_id,quote_id),FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id)
);
CREATE TABLE order_configured_food(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,quote_id uuid NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id) REFERENCES order_authority(merchant_id,order_id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES quote_configured_food(merchant_id,quote_id)
);
CREATE TRIGGER immutable_configured_quote BEFORE UPDATE OR DELETE ON quote_configured_food FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_configured_order BEFORE UPDATE OR DELETE ON order_configured_food FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION configured_money(amount numeric,currency text,decimals integer) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
 IF amount<>trunc(amount) OR amount<0 OR amount>999999999999999999 THEN RAISE EXCEPTION 'INVALID_CONFIGURED_MONEY' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('currency',currency,'decimals',decimals,'amountMinor',amount::numeric(18,0)::text);
END $$;
CREATE FUNCTION configured_request_hash(account uuid,branch uuid,items jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(account,branch,coalesce((SELECT jsonb_agg(i ORDER BY i->>'lineId') FROM jsonb_array_elements(items) i),'[]'::jsonb))::text,'UTF8')),'hex')
$$;
-- Reconstruct the entire expected document from frozen product components and
-- immutable definitions. Comparing this value proves every field, not just sums.
CREATE FUNCTION expected_configured_food(merchant uuid,quote uuid,items jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE q order_quotes%ROWTYPE;v catalog_price_versions%ROWTYPE;i jsonb;l jsonb;g jsonb;c jsonb;s jsonb;selections jsonb;lines jsonb:='[]';
 option_id uuid;active_id uuid;definition product_option_versions%ROWTYPE;seen text[]:='{}';pairs text[];pair text;quantity integer;selected_qty integer;group_qty integer;
 addition numeric;product_base numeric;product_unit numeric;subtotal numeric:=0;discount numeric:=0;total numeric:=0;note text;
BEGIN
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=merchant AND id=quote;
 SELECT * INTO STRICT v FROM catalog_price_versions WHERE merchant_id=merchant AND id=q.price_version_id;
 IF q.origin_kind<>'online' OR jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'INVALID_CONFIGURED_CART' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(q.cart)<>(SELECT count(DISTINCT x->>'productId') FROM jsonb_array_elements(items) x)
 OR jsonb_array_length(q.lines)<>jsonb_array_length(q.cart)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.cart) a WHERE (a->>'qty')::numeric IS DISTINCT FROM (SELECT sum((b->>'qty')::numeric) FROM jsonb_array_elements(items) b WHERE b->>'productId'=a->>'productId'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.lines) a WHERE (a->>'qty')::numeric IS DISTINCT FROM (SELECT sum((b->>'qty')::numeric) FROM jsonb_array_elements(items) b WHERE b->>'productId'=a->>'productId'))
 OR (SELECT count(DISTINCT a->>'productId') FROM jsonb_array_elements(q.cart) a)<>jsonb_array_length(q.cart)
 OR (SELECT count(DISTINCT a->>'productId') FROM jsonb_array_elements(q.lines) a)<>jsonb_array_length(q.lines)
 THEN RAISE EXCEPTION 'CONFIGURED_AGGREGATE_MISMATCH' USING ERRCODE='23514';END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(items) ORDER BY value->>'lineId' LOOP
  IF jsonb_typeof(i) IS DISTINCT FROM 'object' OR NOT(i ?& ARRAY['lineId','productId','qty','optionVersion','selections','allergyNote'])
  OR i-ARRAY['lineId','productId','qty','optionVersion','selections','allergyNote']<>'{}'::jsonb
  OR NOT coalesce(canonical_online_option_uuid(i->>'lineId'),false) OR NOT coalesce(canonical_online_option_uuid(i->>'productId'),false)
  OR i->>'lineId'=ANY(seen) OR jsonb_typeof(i->'qty') IS DISTINCT FROM 'number' OR (i->>'qty')!~'^[1-9][0-9]*$' OR (i->>'qty')::numeric NOT BETWEEN 1 AND 100
  OR jsonb_typeof(i->'selections') IS DISTINCT FROM 'array' OR jsonb_array_length(i->'selections')>200
  OR jsonb_typeof(i->'optionVersion') NOT IN ('string','null') OR (i->'optionVersion'<>'null'::jsonb AND NOT coalesce(canonical_online_option_uuid(i->>'optionVersion'),false))
  OR jsonb_typeof(i->'allergyNote') NOT IN ('string','null')
  THEN RAISE EXCEPTION 'INVALID_CONFIGURED_ITEM' USING ERRCODE='23514';END IF;
  seen:=array_append(seen,i->>'lineId');quantity:=(i->>'qty')::integer;
  SELECT value INTO STRICT l FROM jsonb_array_elements(q.lines) WHERE value->>'productId'=i->>'productId';
  product_base:=(l->'basePrice'->>'amountMinor')::numeric;product_unit:=(l->'unitPrice'->>'amountMinor')::numeric;
  IF product_base IS NULL OR product_unit IS NULL
  OR jsonb_typeof(l->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(l->'nameEn') IS DISTINCT FROM 'string'
  OR length(l->>'name')>320 OR length(l->>'nameEn')>320
  OR jsonb_typeof(l->'qty') IS DISTINCT FROM 'number' OR (l->>'qty')!~'^[1-9][0-9]*$'
  OR l->'basePrice' IS DISTINCT FROM configured_money(product_base,v.currency,v.decimals)
  OR l->'unitPrice' IS DISTINCT FROM configured_money(product_unit,v.currency,v.decimals) OR product_base<product_unit
  OR (l->>'qty')::numeric NOT BETWEEN 1 AND 100 OR l->>'priceVersion' IS DISTINCT FROM v.id::text
  THEN RAISE EXCEPTION 'CONFIGURED_PRODUCT_MISMATCH' USING ERRCODE='23514';END IF;
  option_id:=(i->>'optionVersion')::uuid;active_id:=NULL;
  SELECT active_version_id INTO active_id FROM product_online_options WHERE merchant_id=merchant AND product_id=(i->>'productId')::uuid;
  IF option_id IS DISTINCT FROM active_id THEN RAISE EXCEPTION 'CONFIGURED_OPTIONS_CHANGED' USING ERRCODE='23514';END IF;
  definition:=NULL;
  IF option_id IS NOT NULL THEN
   SELECT * INTO STRICT definition FROM product_option_versions WHERE merchant_id=merchant AND product_id=(i->>'productId')::uuid AND id=option_id;
   IF jsonb_array_length(definition.groups)>0 AND (definition.currency<>v.currency OR definition.decimals<>v.decimals) THEN RAISE EXCEPTION 'CONFIGURED_DENOMINATION_MISMATCH' USING ERRCODE='23514';END IF;
  END IF;
  note:=i->>'allergyNote';
  IF note IS NOT NULL AND (coalesce(definition.note_enabled,true)=false OR char_length(note)>300 OR octet_length(note)>1200 OR note~'[\u0001-\u0009\u000b-\u001f\u007f-\u009f]')
  THEN RAISE EXCEPTION 'INVALID_CONFIGURED_NOTE' USING ERRCODE='23514';END IF;
  selections:='[]';pairs:='{}';addition:=0;
  FOR s IN SELECT value FROM jsonb_array_elements(i->'selections') ORDER BY value->>'groupId',value->>'choiceId' LOOP
   IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['groupId','choiceId','qty']) OR s-ARRAY['groupId','choiceId','qty']<>'{}'::jsonb
   OR NOT coalesce(canonical_online_option_uuid(s->>'groupId'),false) OR NOT coalesce(canonical_online_option_uuid(s->>'choiceId'),false)
   OR jsonb_typeof(s->'qty') IS DISTINCT FROM 'number' OR (s->>'qty')!~'^[1-9][0-9]*$' OR (s->>'qty')::numeric NOT BETWEEN 1 AND 10
   THEN RAISE EXCEPTION 'INVALID_CONFIGURED_SELECTION' USING ERRCODE='23514';END IF;
   pair:=(s->>'groupId')||':'||(s->>'choiceId');IF pair=ANY(pairs) THEN RAISE EXCEPTION 'DUPLICATE_CONFIGURED_SELECTION' USING ERRCODE='23514';END IF;pairs:=array_append(pairs,pair);
   SELECT value INTO STRICT g FROM jsonb_array_elements(coalesce(definition.groups,'[]')) WHERE value->>'id'=s->>'groupId';
   SELECT value INTO STRICT c FROM jsonb_array_elements(g->'choices') WHERE value->>'id'=s->>'choiceId';
   selected_qty:=(s->>'qty')::integer;
   IF g->'enabled'<>'true'::jsonb OR c->'enabled'<>'true'::jsonb OR selected_qty>(c->>'maxQty')::integer THEN RAISE EXCEPTION 'UNAVAILABLE_CONFIGURED_SELECTION' USING ERRCODE='23514';END IF;
   addition:=addition+(c->'priceDelta'->>'amountMinor')::numeric*selected_qty;
   selections:=selections||jsonb_build_array(jsonb_build_object('groupId',g->>'id','groupName',g->>'name','groupNameEn',g->>'nameEn','choiceId',c->>'id','choiceName',c->>'name','choiceNameEn',c->>'nameEn','qty',selected_qty,'priceDelta',c->'priceDelta'));
  END LOOP;
  FOR g IN SELECT value FROM jsonb_array_elements(coalesce(definition.groups,'[]')) WHERE value->'enabled'='true'::jsonb LOOP
   SELECT coalesce(sum((value->>'qty')::integer),0) INTO group_qty FROM jsonb_array_elements(i->'selections') WHERE value->>'groupId'=g->>'id';
   IF group_qty<(g->>'minSelections')::integer OR group_qty>(g->>'maxSelections')::integer THEN RAISE EXCEPTION 'CONFIGURED_CARDINALITY_MISMATCH' USING ERRCODE='23514';END IF;
  END LOOP;
  lines:=lines||jsonb_build_array(jsonb_build_object('lineId',i->>'lineId','productId',l->>'productId','name',l->>'name','nameEn',l->>'nameEn','qty',quantity,'priceVersion',l->>'priceVersion','optionVersion',option_id,'selections',selections,'allergyNote',note,
   'productBasePrice',l->'basePrice','productUnitPrice',l->'unitPrice','optionsUnitPrice',configured_money(addition,v.currency,v.decimals),'basePrice',configured_money(product_base+addition,v.currency,v.decimals),'unitPrice',configured_money(product_unit+addition,v.currency,v.decimals),'lineTotal',configured_money((product_unit+addition)*quantity,v.currency,v.decimals)));
  subtotal:=subtotal+(product_base+addition)*quantity;discount:=discount+(product_base-product_unit)*quantity;total:=total+(product_unit+addition)*quantity;
 END LOOP;
 RETURN jsonb_build_object('lines',lines,'subtotal',configured_money(subtotal,v.currency,v.decimals),'discount',configured_money(discount,v.currency,v.decimals),'fees',configured_money(0,v.currency,v.decimals),'tax',configured_money(0,v.currency,v.decimals),'total',configured_money(total,v.currency,v.decimals));
EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
 RAISE EXCEPTION 'INVALID_CONFIGURED_EVIDENCE' USING ERRCODE='23514';
END $$;
CREATE FUNCTION assert_configured_quote(merchant uuid,quote uuid) RETURNS void LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE q order_quotes%ROWTYPE;d quote_configured_food%ROWTYPE;expected jsonb;
BEGIN
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=merchant AND id=quote;
 SELECT * INTO d FROM quote_configured_food WHERE merchant_id=merchant AND quote_id=quote;
 IF q.origin_kind<>'online' THEN IF FOUND THEN RAISE EXCEPTION 'ROUTED_CONFIGURED_EVIDENCE' USING ERRCODE='23514';END IF;RETURN;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_CONFIGURED_QUOTE' USING ERRCODE='23514';END IF;
 IF q.configured_food_version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'UNCONFIGURED_QUOTE_VERSION' USING ERRCODE='23514';END IF;
 expected:=expected_configured_food(merchant,quote,d.items);
 IF d.snapshot IS DISTINCT FROM expected OR q.total_minor::text IS DISTINCT FROM expected->'total'->>'amountMinor'
 OR q.request_hash IS DISTINCT FROM configured_request_hash(q.source_account_id,q.source_branch_id,d.items)
 THEN RAISE EXCEPTION 'CONFIGURED_QUOTE_MISMATCH' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION guard_configured_quote_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='order_quotes' THEN PERFORM assert_configured_quote(NEW.merchant_id,NEW.id);
 ELSE PERFORM assert_configured_quote(NEW.merchant_id,NEW.quote_id);END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER configured_quote_parent AFTER INSERT ON order_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_configured_quote_complete();
CREATE CONSTRAINT TRIGGER configured_quote_document AFTER INSERT ON quote_configured_food DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_configured_quote_complete();
CREATE FUNCTION guard_configured_order_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE merchant uuid;oid uuid;a order_authority%ROWTYPE;d order_configured_food%ROWTYPE;q quote_configured_food%ROWTYPE;
BEGIN
 merchant:=NEW.merchant_id;
 IF current_setting('bitpos.merchant',true) IS DISTINCT FROM merchant::text
 THEN RAISE EXCEPTION 'CONFIGURED_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='orders' THEN oid:=NEW.id;ELSE oid:=NEW.order_id;END IF;
 SELECT * INTO a FROM order_authority WHERE merchant_id=merchant AND order_id=oid;
 SELECT * INTO d FROM order_configured_food WHERE merchant_id=merchant AND order_id=oid;
 IF a.source_kind IS DISTINCT FROM 'online' THEN IF FOUND THEN RAISE EXCEPTION 'ROUTED_CONFIGURED_EVIDENCE' USING ERRCODE='23514';END IF;RETURN NULL;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_CONFIGURED_ORDER' USING ERRCODE='23514';END IF;
 SELECT * INTO q FROM quote_configured_food WHERE merchant_id=merchant AND quote_id=a.quote_id;
 IF NOT FOUND OR d.quote_id IS DISTINCT FROM a.quote_id OR d.snapshot IS DISTINCT FROM q.snapshot OR a.total_minor::text IS DISTINCT FROM d.snapshot->'total'->>'amountMinor'
 THEN RAISE EXCEPTION 'CONFIGURED_ORDER_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER configured_order_parent AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_configured_order_complete();
CREATE CONSTRAINT TRIGGER configured_order_document AFTER INSERT ON order_configured_food DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_configured_order_complete();
-- The orders row normally precedes authority. An immediate parent event must
-- not consume the only completeness check before the online identity exists.
CREATE CONSTRAINT TRIGGER configured_order_authority AFTER INSERT ON order_authority DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_configured_order_complete();
-- Keep every existing conversion and denomination condition. Only online total
-- equality moves to the mandatory deep deferred proof above.
CREATE OR REPLACE FUNCTION guard_quote_money() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v catalog_price_versions;amount numeric;BEGIN
 SELECT * INTO STRICT v FROM catalog_price_versions WHERE merchant_id=NEW.merchant_id AND id=NEW.price_version_id;
 SELECT sum((l->'unitPrice'->>'amountMinor')::numeric*(l->>'qty')::numeric) INTO amount FROM jsonb_array_elements(NEW.lines) l;
 IF v.currency NOT IN ('USD','USDG') OR (NEW.origin_kind<>'online' AND amount<>NEW.total_minor)
 OR NEW.usdg_minor::numeric<>NEW.total_minor::numeric*(CASE WHEN v.currency='USD' THEN power(10::numeric,6-v.decimals) ELSE 1 END)
 OR NEW.settlement IS DISTINCT FROM jsonb_build_object('currency','USDG','decimals',6,'amountMinor',NEW.usdg_minor::text,'network','solana:devnet','genesisHash','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','mint','4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7','tokenProgram','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb','testToken',true,'recipient',NEW.treasury,'sponsor','merchant_funded')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.lines) l WHERE l->'unitPrice'->>'currency'<>v.currency OR (l->'unitPrice'->>'decimals')::int<>v.decimals OR l->>'priceVersion'<>v.id::text OR (l->>'qty')::int NOT BETWEEN 1 AND 100 OR (l->'unitPrice'->>'amountMinor')::bigint<=0)
 THEN RAISE EXCEPTION 'invalid canonical quote money' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['quote_configured_food','order_configured_food'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON %I USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
REVOKE ALL ON quote_configured_food,order_configured_food FROM PUBLIC;
GRANT SELECT,INSERT ON quote_configured_food,order_configured_food TO bitpos_app;
REVOKE ALL ON FUNCTION configured_money(numeric,text,integer),configured_request_hash(uuid,uuid,jsonb),expected_configured_food(uuid,uuid,jsonb),assert_configured_quote(uuid,uuid),guard_configured_quote_complete(),guard_configured_order_complete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION configured_money(numeric,text,integer),configured_request_hash(uuid,uuid,jsonb),expected_configured_food(uuid,uuid,jsonb),assert_configured_quote(uuid,uuid),guard_configured_quote_complete(),guard_configured_order_complete() TO bitpos_app;
