-- Original BitPOS online product configuration; no routed POS price/stock changes.
-- Rollback: disable online-options admission; retain immutable version/command history.
SET search_path=bitpos,public;
CREATE FUNCTION canonical_online_option_uuid(value text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT value ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
$$;
REVOKE ALL ON FUNCTION canonical_online_option_uuid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canonical_online_option_uuid(text) TO bitpos_app;
CREATE FUNCTION valid_online_option_groups(groups jsonb,currency text,decimals smallint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=bitpos,pg_temp AS $$
DECLARE g jsonb;c jsonb;ids text[];choice_ids text[];capacity integer;
BEGIN
 IF jsonb_typeof(groups)<>'array' OR jsonb_array_length(groups)>10 THEN RETURN false;END IF;
 ids:=ARRAY[]::text[];
 FOR g IN SELECT value FROM jsonb_array_elements(groups) LOOP
  IF jsonb_typeof(g)<>'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(g) k) IS DISTINCT FROM ARRAY['choices','enabled','id','maxSelections','minSelections','name','nameEn'] THEN RETURN false;END IF;
  IF NOT canonical_online_option_uuid(g->>'id') THEN RETURN false;END IF;
  IF (g->>'id')::uuid::text=ANY(ids) THEN RETURN false;END IF;ids:=array_append(ids,(g->>'id')::uuid::text);
  IF jsonb_typeof(g->'id')<>'string' OR jsonb_typeof(g->'name')<>'string' OR jsonb_typeof(g->'nameEn')<>'string' OR char_length(g->>'name') NOT BETWEEN 1 AND 80 OR char_length(g->>'nameEn') NOT BETWEEN 1 AND 80 OR (g->>'name')~'[[:cntrl:]]' OR (g->>'nameEn')~'[[:cntrl:]]' OR jsonb_typeof(g->'enabled')<>'boolean'
   OR jsonb_typeof(g->'minSelections')<>'number' OR jsonb_typeof(g->'maxSelections')<>'number' OR (g->>'minSelections')!~'^(0|[1-9][0-9]*)$' OR (g->>'maxSelections')!~'^(0|[1-9][0-9]*)$'
   OR (g->>'minSelections')::integer NOT BETWEEN 0 AND 20 OR (g->>'maxSelections')::integer NOT BETWEEN (g->>'minSelections')::integer AND 20
   OR jsonb_typeof(g->'choices')<>'array' OR jsonb_array_length(g->'choices') NOT BETWEEN 1 AND 20 THEN RETURN false;END IF;
  choice_ids:=ARRAY[]::text[];capacity:=0;
  FOR c IN SELECT value FROM jsonb_array_elements(g->'choices') LOOP
   IF jsonb_typeof(c)<>'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c) k) IS DISTINCT FROM ARRAY['enabled','id','maxQty','name','nameEn','priceDelta'] THEN RETURN false;END IF;
   IF NOT canonical_online_option_uuid(c->>'id') THEN RETURN false;END IF;
   IF (c->>'id')::uuid::text=ANY(choice_ids) THEN RETURN false;END IF;choice_ids:=array_append(choice_ids,(c->>'id')::uuid::text);
   IF jsonb_typeof(c->'id')<>'string' OR jsonb_typeof(c->'name')<>'string' OR jsonb_typeof(c->'nameEn')<>'string' OR char_length(c->>'name') NOT BETWEEN 1 AND 80 OR char_length(c->>'nameEn') NOT BETWEEN 1 AND 80 OR (c->>'name')~'[[:cntrl:]]' OR (c->>'nameEn')~'[[:cntrl:]]' OR jsonb_typeof(c->'enabled')<>'boolean'
    OR jsonb_typeof(c->'maxQty')<>'number' OR (c->>'maxQty')!~'^[1-9][0-9]*$' OR (c->>'maxQty')::integer NOT BETWEEN 1 AND 10
    OR jsonb_typeof(c->'priceDelta')<>'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c->'priceDelta') k) IS DISTINCT FROM ARRAY['amountMinor','currency','decimals']
    OR jsonb_typeof(c->'priceDelta'->'amountMinor')<>'string' OR (c->'priceDelta'->>'amountMinor')!~'^(0|[1-9][0-9]*)$' OR length(c->'priceDelta'->>'amountMinor')>19
    OR (c->'priceDelta'->>'amountMinor')::numeric>999999999999999999 OR c->'priceDelta'->>'currency' IS DISTINCT FROM currency OR c->'priceDelta'->'decimals' IS DISTINCT FROM to_jsonb(decimals)
    THEN RETURN false;END IF;
   IF (c->>'enabled')::boolean THEN capacity:=capacity+(c->>'maxQty')::integer;END IF;
  END LOOP;
  IF (g->>'enabled')::boolean AND capacity<(g->>'minSelections')::integer THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION valid_online_option_groups(jsonb,text,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION valid_online_option_groups(jsonb,text,smallint) TO bitpos_app;
CREATE TABLE product_option_versions(
 merchant_id uuid NOT NULL,product_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),revision bigint NOT NULL CHECK(revision>0),
 currency text NOT NULL,decimals smallint NOT NULL,note_enabled boolean NOT NULL,groups jsonb NOT NULL,
 price_version_id uuid NOT NULL,configured_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,product_id,id),UNIQUE(merchant_id,product_id,revision),UNIQUE(merchant_id,product_id,id,revision),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 FOREIGN KEY(merchant_id,price_version_id) REFERENCES catalog_price_versions(merchant_id,id),
 CHECK((currency='USD' AND decimals IN (2,4)) OR (currency='USDG' AND decimals=6)),
 CHECK(valid_online_option_groups(groups,currency,decimals))
);
CREATE TABLE product_online_options(
 merchant_id uuid NOT NULL,product_id uuid NOT NULL,active_version_id uuid NOT NULL,revision bigint NOT NULL,
 PRIMARY KEY(merchant_id,product_id),
 FOREIGN KEY(merchant_id,product_id,active_version_id,revision) REFERENCES product_option_versions(merchant_id,product_id,id,revision)
);
CREATE TABLE product_option_commands(
 merchant_id uuid NOT NULL,product_id uuid NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL CHECK(length(request_hash)=64),
 version_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,product_id,idempotency_key),
 FOREIGN KEY(merchant_id,product_id,version_id) REFERENCES product_option_versions(merchant_id,product_id,id)
);
CREATE TRIGGER immutable_option_version BEFORE UPDATE OR DELETE ON product_option_versions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_option_command BEFORE UPDATE OR DELETE ON product_option_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION guard_online_option_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE v catalog_price_versions%ROWTYPE;current_revision bigint;
BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 SELECT c.* INTO STRICT v FROM merchant_pricing p JOIN catalog_price_versions c ON c.merchant_id=p.merchant_id AND c.id=p.active_price_version_id WHERE p.merchant_id=NEW.merchant_id;
 SELECT revision INTO current_revision FROM product_online_options WHERE merchant_id=NEW.merchant_id AND product_id=NEW.product_id;
 IF NEW.price_version_id<>v.id OR NEW.currency<>v.currency OR NEW.decimals<>v.decimals OR NEW.revision<>coalesce(current_revision,0)+1
 THEN RAISE EXCEPTION 'INVALID_ONLINE_OPTION_VERSION' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER online_option_publication BEFORE INSERT ON product_option_versions FOR EACH ROW EXECUTE FUNCTION guard_online_option_publication();
CREATE FUNCTION guard_online_option_pointer() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable option aggregate' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 IF TG_OP='UPDATE' AND (NEW.merchant_id<>OLD.merchant_id OR NEW.product_id<>OLD.product_id OR NEW.revision<>OLD.revision+1) OR TG_OP='INSERT' AND NEW.revision<>1 THEN RAISE EXCEPTION 'INVALID_ONLINE_OPTION_VERSION' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM product_option_versions o JOIN merchant_pricing p ON p.merchant_id=o.merchant_id JOIN catalog_price_versions v ON v.merchant_id=p.merchant_id AND v.id=p.active_price_version_id WHERE o.merchant_id=NEW.merchant_id AND o.product_id=NEW.product_id AND o.id=NEW.active_version_id AND (jsonb_array_length(o.groups)=0 OR o.currency=v.currency AND o.decimals=v.decimals))
 THEN RAISE EXCEPTION 'ONLINE_OPTIONS_DENOMINATION_CONFLICT' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER online_option_pointer BEFORE INSERT OR UPDATE OR DELETE ON product_online_options FOR EACH ROW EXECUTE FUNCTION guard_online_option_pointer();
CREATE FUNCTION guard_options_price_denomination() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE v catalog_price_versions%ROWTYPE;
BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT v FROM catalog_price_versions WHERE merchant_id=NEW.merchant_id AND id=NEW.active_price_version_id;
 IF EXISTS(SELECT 1 FROM product_online_options p JOIN product_option_versions o ON o.merchant_id=p.merchant_id AND o.product_id=p.product_id AND o.id=p.active_version_id WHERE p.merchant_id=NEW.merchant_id AND jsonb_array_length(o.groups)>0 AND (o.currency<>v.currency OR o.decimals<>v.decimals))
 THEN RAISE EXCEPTION 'ONLINE_OPTIONS_DENOMINATION_CONFLICT' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER options_price_denomination BEFORE INSERT OR UPDATE ON merchant_pricing FOR EACH ROW EXECUTE FUNCTION guard_options_price_denomination();
CREATE FUNCTION complete_online_option_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM product_online_options p WHERE p.merchant_id=NEW.merchant_id AND p.product_id=NEW.product_id AND p.revision=(SELECT max(v.revision) FROM product_option_versions v WHERE v.merchant_id=NEW.merchant_id AND v.product_id=NEW.product_id))
 THEN RAISE EXCEPTION 'INCOMPLETE_ONLINE_OPTION_PUBLICATION' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER complete_option_publication AFTER INSERT ON product_option_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_online_option_publication();
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['product_option_versions','product_online_options','product_option_commands'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON %I USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
REVOKE ALL ON product_option_versions,product_online_options,product_option_commands FROM PUBLIC;
GRANT SELECT,INSERT ON product_option_versions,product_option_commands TO bitpos_app;
GRANT SELECT,INSERT,UPDATE ON product_online_options TO bitpos_app;
