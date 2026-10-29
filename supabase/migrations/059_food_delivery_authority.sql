-- Food delivery authority. Local preparation; disable delivery admission on rollback.
-- Never delete immutable quotes, shipment custody or financial allocation evidence.
SET search_path=bitpos,public;
CREATE TABLE delivery_policy_versions(
 merchant_id uuid NOT NULL,branch_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 price_version_id uuid NOT NULL,currency text NOT NULL,decimals integer NOT NULL,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 120),
 origin_latitude_e7 integer NOT NULL CHECK(origin_latitude_e7 BETWEEN -900000000 AND 900000000),
 origin_longitude_e7 integer NOT NULL CHECK(origin_longitude_e7 BETWEEN -1800000000 AND 1800000000),
 south_e7 integer NOT NULL CHECK(south_e7 BETWEEN -900000000 AND 900000000),
 north_e7 integer NOT NULL CHECK(north_e7 BETWEEN -900000000 AND 900000000),
 west_e7 integer NOT NULL CHECK(west_e7 BETWEEN -1800000000 AND 1800000000),
 east_e7 integer NOT NULL CHECK(east_e7 BETWEEN -1800000000 AND 1800000000),
 delivery_minor bigint NOT NULL CHECK(delivery_minor BETWEEN 0 AND 999999999999999999),
 service_minor bigint NOT NULL CHECK(service_minor BETWEEN 0 AND 999999999999999999),
 merchant_minor bigint NOT NULL CHECK(merchant_minor BETWEEN 0 AND 999999999999999999),
 driver_minor bigint NOT NULL CHECK(driver_minor BETWEEN 0 AND 999999999999999999),
 platform_minor bigint NOT NULL CHECK(platform_minor BETWEEN 0 AND 999999999999999999),
 published_by uuid NOT NULL REFERENCES mobile_accounts,fixture boolean NOT NULL,
 published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,branch_id,id),UNIQUE(id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES marketplace_branches(merchant_id,id),
 FOREIGN KEY(merchant_id,price_version_id) REFERENCES catalog_price_versions(merchant_id,id),
 CHECK(south_e7<north_e7 AND west_e7<east_e7),
 CHECK(origin_latitude_e7 BETWEEN south_e7 AND north_e7 AND origin_longitude_e7 BETWEEN west_e7 AND east_e7),
 CHECK(delivery_minor::numeric+service_minor::numeric=merchant_minor::numeric+driver_minor::numeric+platform_minor::numeric),
 CHECK(delivery_minor::numeric+service_minor::numeric<=999999999999999999)
);
CREATE TABLE branch_delivery_policies(
 merchant_id uuid NOT NULL,branch_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 active_version_id uuid NOT NULL,enabled boolean NOT NULL,
 PRIMARY KEY(merchant_id,branch_id),
 FOREIGN KEY(merchant_id,branch_id,active_version_id) REFERENCES delivery_policy_versions(merchant_id,branch_id,id)
);
CREATE TABLE delivery_policy_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,
 merchant_id uuid NOT NULL,branch_id uuid NOT NULL,request jsonb NOT NULL,response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,idempotency_key),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES marketplace_branches(merchant_id,id)
);
CREATE TABLE delivery_policy_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_account_id uuid NOT NULL REFERENCES mobile_accounts,
 session_id uuid NOT NULL REFERENCES mobile_sessions,merchant_id uuid NOT NULL,branch_id uuid NOT NULL,policy_version_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,branch_id,policy_version_id) REFERENCES delivery_policy_versions(merchant_id,branch_id,id)
);
REVOKE ALL ON delivery_policy_audit FROM PUBLIC,bitpos_app;
ALTER TABLE delivery_policy_audit ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_delivery_policy BEFORE UPDATE OR DELETE ON delivery_policy_versions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_delivery_policy_command BEFORE UPDATE OR DELETE ON delivery_policy_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION guard_delivery_policy_denomination() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE price catalog_price_versions;BEGIN
 SELECT * INTO STRICT price FROM catalog_price_versions WHERE merchant_id=NEW.merchant_id AND id=NEW.price_version_id;
 IF NEW.currency IS DISTINCT FROM price.currency OR NEW.decimals IS DISTINCT FROM price.decimals THEN RAISE EXCEPTION 'DELIVERY_POLICY_DENOMINATION_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_policy_denomination BEFORE INSERT ON delivery_policy_versions FOR EACH ROW EXECUTE FUNCTION guard_delivery_policy_denomination();
REVOKE ALL ON delivery_policy_versions,branch_delivery_policies,delivery_policy_commands FROM PUBLIC,bitpos_app;
ALTER TABLE delivery_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE branch_delivery_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_delivery_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE delivery_policy_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_policy_tenant ON delivery_policy_versions TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY branch_delivery_policy_tenant ON branch_delivery_policies TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT ON delivery_policy_versions,branch_delivery_policies TO bitpos_app;
REVOKE ALL ON FUNCTION guard_delivery_policy_denomination() FROM PUBLIC;
CREATE FUNCTION delivery_policy_publish(merchant uuid,branch uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_live_actor();grant_id uuid;key uuid;old delivery_policy_commands;head branch_delivery_policies;price catalog_price_versions;fields jsonb;version_id uuid:=gen_random_uuid();receipt jsonb;
BEGIN
 SELECT id INTO grant_id FROM platform_staff_role_grants WHERE account_id=actor AND role='administrator' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY id LIMIT 1;
 IF grant_id IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM marketplace_branches WHERE merchant_id=merchant AND id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>4 OR NOT payload ?& ARRAY['idempotencyKey','expectedRevision','enabled','policy']
 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'expectedRevision') IS DISTINCT FROM 'string' OR (payload->>'expectedRevision')!~'^(0|[1-9][0-9]{0,18})$'
 OR (payload->>'expectedRevision')::numeric>9223372036854775807 OR jsonb_typeof(payload->'enabled') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery.policy.'||actor::text||key::text,0));
 PERFORM 1 FROM mobile_accounts WHERE id=actor FOR SHARE;
 SELECT * INTO head FROM branch_delivery_policies WHERE merchant_id=merchant AND branch_id=branch FOR UPDATE;
 SELECT id INTO grant_id FROM platform_staff_role_grants WHERE account_id=actor AND role='administrator' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY id LIMIT 1 FOR SHARE;
 IF grant_id IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 -- Every potentially blocking acquisition precedes the final authority checks.
 PERFORM driver_live_actor();
 IF NOT EXISTS(SELECT 1 FROM platform_staff_role_grants WHERE id=grant_id AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT * INTO old FROM delivery_policy_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF old.merchant_id IS DISTINCT FROM merchant OR old.branch_id IS DISTINCT FROM branch OR old.request IS DISTINCT FROM payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN old.response;END IF;
 IF coalesce(head.revision,0)<>(payload->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 fields:=payload->'policy';
 IF jsonb_typeof(fields) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(fields))<>13
 OR NOT fields ?& ARRAY['name','originLatitudeE7','originLongitudeE7','southE7','northE7','westE7','eastE7','deliveryMinor','serviceMinor','merchantMinor','driverMinor','platformMinor','fixture']
 OR jsonb_typeof(fields->'name') IS DISTINCT FROM 'string' OR char_length(btrim(fields->>'name')) NOT BETWEEN 1 AND 120
 OR jsonb_typeof(fields->'fixture') IS DISTINCT FROM 'boolean'
 OR EXISTS(SELECT 1 FROM jsonb_each(fields) f WHERE f.key IN ('originLatitudeE7','originLongitudeE7','southE7','northE7','westE7','eastE7') AND (jsonb_typeof(f.value) IS DISTINCT FROM 'number' OR f.value::text!~'^-?(0|[1-9][0-9]{0,9})$'))
 OR EXISTS(SELECT 1 FROM jsonb_each(fields) f WHERE f.key IN ('deliveryMinor','serviceMinor','merchantMinor','driverMinor','platformMinor') AND (jsonb_typeof(f.value) IS DISTINCT FROM 'string' OR f.value#>>'{}'!~'^(0|[1-9][0-9]{0,17})$'))
 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(fields) f WHERE f.key IN ('originLatitudeE7','southE7','northE7') AND abs(f.value::text::numeric)>900000000)
 OR EXISTS(SELECT 1 FROM jsonb_each(fields) f WHERE f.key IN ('originLongitudeE7','westE7','eastE7') AND abs(f.value::text::numeric)>1800000000)
 OR (fields->>'southE7')::numeric>=(fields->>'northE7')::numeric OR (fields->>'westE7')::numeric>=(fields->>'eastE7')::numeric
 OR (fields->>'originLatitudeE7')::numeric NOT BETWEEN (fields->>'southE7')::numeric AND (fields->>'northE7')::numeric
 OR (fields->>'originLongitudeE7')::numeric NOT BETWEEN (fields->>'westE7')::numeric AND (fields->>'eastE7')::numeric
 OR (fields->>'deliveryMinor')::numeric+(fields->>'serviceMinor')::numeric<>(fields->>'merchantMinor')::numeric+(fields->>'driverMinor')::numeric+(fields->>'platformMinor')::numeric
 OR (fields->>'deliveryMinor')::numeric+(fields->>'serviceMinor')::numeric>999999999999999999 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT v.* INTO price FROM merchant_pricing p JOIN catalog_price_versions v ON v.merchant_id=p.merchant_id AND v.id=p.active_price_version_id WHERE p.merchant_id=merchant;
 IF price.id IS NULL THEN RAISE EXCEPTION 'SETUP_REQUIRED';END IF;
 INSERT INTO delivery_policy_versions(merchant_id,branch_id,id,price_version_id,currency,decimals,name,origin_latitude_e7,origin_longitude_e7,south_e7,north_e7,west_e7,east_e7,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,published_by,fixture)
 VALUES(merchant,branch,version_id,price.id,price.currency,price.decimals,fields->>'name',(fields->>'originLatitudeE7')::integer,(fields->>'originLongitudeE7')::integer,(fields->>'southE7')::integer,(fields->>'northE7')::integer,(fields->>'westE7')::integer,(fields->>'eastE7')::integer,(fields->>'deliveryMinor')::bigint,(fields->>'serviceMinor')::bigint,(fields->>'merchantMinor')::bigint,(fields->>'driverMinor')::bigint,(fields->>'platformMinor')::bigint,actor,(fields->>'fixture')::boolean);
 INSERT INTO branch_delivery_policies(merchant_id,branch_id,revision,active_version_id,enabled) VALUES(merchant,branch,1,version_id,(payload->>'enabled')::boolean)
 ON CONFLICT(merchant_id,branch_id) DO UPDATE SET revision=branch_delivery_policies.revision+1,active_version_id=EXCLUDED.active_version_id,enabled=EXCLUDED.enabled;
 receipt:=jsonb_build_object('version',version_id,'revision',(coalesce(head.revision,0)+1)::text);
 INSERT INTO delivery_policy_commands(actor_account_id,idempotency_key,merchant_id,branch_id,request,response) VALUES(actor,key,merchant,branch,payload,receipt);
 INSERT INTO delivery_policy_audit(actor_account_id,session_id,merchant_id,branch_id,policy_version_id) VALUES(actor,current_setting('bitpos.mobile_session')::uuid,merchant,branch,version_id);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION delivery_policy_publish(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery_policy_publish(uuid,uuid,jsonb) TO bitpos_app;
CREATE FUNCTION delivery_policy_view(merchant uuid,branch uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=bitpos,pg_temp AS $$
 SELECT jsonb_build_object('version',v.id,'revision',p.revision::text,'branchId',branch,'merchantId',merchant,'enabled',p.enabled,'currency',v.currency,'decimals',v.decimals,'priceVersionId',v.price_version_id,
 'policy',jsonb_build_object('name',v.name,'originLatitudeE7',v.origin_latitude_e7,'originLongitudeE7',v.origin_longitude_e7,'southE7',v.south_e7,'northE7',v.north_e7,'westE7',v.west_e7,'eastE7',v.east_e7,'deliveryMinor',v.delivery_minor::text,'serviceMinor',v.service_minor::text,'merchantMinor',v.merchant_minor::text,'driverMinor',v.driver_minor::text,'platformMinor',v.platform_minor::text,'fixture',v.fixture))
 FROM branch_delivery_policies p JOIN delivery_policy_versions v ON v.merchant_id=p.merchant_id AND v.branch_id=p.branch_id AND v.id=p.active_version_id WHERE p.merchant_id=merchant AND p.branch_id=branch
$$;
CREATE FUNCTION delivery_policy_read(merchant uuid,branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE actor uuid:=driver_live_actor();grant_id uuid;
BEGIN
 PERFORM 1 FROM mobile_accounts WHERE id=actor FOR SHARE;
 SELECT id INTO grant_id FROM platform_staff_role_grants WHERE account_id=actor AND role='administrator' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY id LIMIT 1 FOR SHARE;
 PERFORM driver_live_actor();
 IF grant_id IS NULL OR NOT EXISTS(SELECT 1 FROM platform_staff_role_grants WHERE id=grant_id AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM marketplace_branches WHERE merchant_id=merchant AND id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 RETURN jsonb_build_object('policy',delivery_policy_view(merchant,branch));
END $$;
REVOKE ALL ON FUNCTION delivery_policy_view(uuid,uuid),delivery_policy_read(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery_policy_view(uuid,uuid),delivery_policy_read(uuid,uuid) TO bitpos_app;
