-- Search policy only. Offers, custody, payment and stock retain their existing owners.
SET search_path=bitpos,public;
CREATE TABLE food_dispatch_policy_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,branch_id uuid NOT NULL,
 enabled boolean NOT NULL,vehicle_type text NOT NULL CHECK(vehicle_type IN('MOTORCYCLE','CAR')),
 offer_budget smallint NOT NULL CHECK(offer_budget BETWEEN 1 AND 6),cycle_seconds integer NOT NULL CHECK(cycle_seconds BETWEEN 60 AND 300),
 overall_seconds integer NOT NULL CHECK(overall_seconds BETWEEN 60 AND 900),max_cycles smallint NOT NULL CHECK(max_cycles BETWEEN 1 AND 3),
 shortlist_size smallint NOT NULL CHECK(shortlist_size BETWEEN 1 AND 6),max_pickup_seconds integer NOT NULL CHECK(max_pickup_seconds BETWEEN 60 AND 3600),
 valid_until timestamptz NOT NULL CHECK(isfinite(valid_until)),issued_by uuid NOT NULL REFERENCES mobile_accounts,
 issued_grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(merchant_id,branch_id,id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branch_delivery_policies,CHECK(overall_seconds>=cycle_seconds)
);
CREATE TABLE food_dispatch_policy_heads(
 merchant_id uuid NOT NULL,branch_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),version_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,branch_id),FOREIGN KEY(merchant_id,branch_id,version_id) REFERENCES food_dispatch_policy_versions(merchant_id,branch_id,id)
);
CREATE TABLE food_dispatch_policy_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,idempotency_key uuid NOT NULL,request jsonb NOT NULL,response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,idempotency_key)
);
DO $$DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['food_dispatch_policy_versions','food_dispatch_policy_heads','food_dispatch_policy_commands'] LOOP
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker',name);EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
 END LOOP;
END $$;
CREATE TRIGGER food_dispatch_policy_immutable BEFORE UPDATE OR DELETE ON food_dispatch_policy_versions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER food_dispatch_policy_command_immutable BEFORE UPDATE OR DELETE ON food_dispatch_policy_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
-- Caller already owns the merchant root. Role locks remain held through its command.
CREATE FUNCTION food_dispatch_policy_staff(merchant uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;selected_grant uuid;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 SELECT g.id INTO selected_grant FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
 WHERE g.account_id=actor AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=merchant
 ORDER BY g.id LIMIT 1 FOR SHARE OF g,sc;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF selected_grant IS NULL OR NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
 WHERE g.id=selected_grant AND g.account_id=actor AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=merchant)
 THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN selected_grant;
END $$;
CREATE FUNCTION food_dispatch_policy_live(policy uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM food_dispatch_policy_versions p JOIN food_dispatch_policy_heads h ON(h.merchant_id,h.branch_id,h.version_id)=(p.merchant_id,p.branch_id,p.id)
 JOIN platform_staff_role_grants g ON g.id=p.issued_grant_id JOIN platform_role_scopes sc ON sc.grant_id=g.id AND sc.merchant_id=p.merchant_id
 JOIN mobile_accounts actor ON actor.id=p.issued_by JOIN branch_delivery_policies b ON(b.merchant_id,b.branch_id)=(p.merchant_id,p.branch_id)
 JOIN marketplace_branches mb ON(mb.merchant_id,mb.id)=(p.merchant_id,p.branch_id)
 WHERE p.id=policy AND p.enabled AND p.valid_until>clock_timestamp() AND actor.disabled_at IS NULL AND g.account_id=p.issued_by
 AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND b.enabled AND mb.enabled AND mb.delivery_enabled)
$$;
CREATE FUNCTION food_dispatch_policy_snapshot(merchant uuid,branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE p food_dispatch_policy_versions;h food_dispatch_policy_heads;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;PERFORM food_dispatch_policy_staff(merchant);
 IF NOT EXISTS(SELECT 1 FROM branch_delivery_policies WHERE merchant_id=merchant AND branch_id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO h FROM food_dispatch_policy_heads WHERE merchant_id=merchant AND branch_id=branch;
 IF NOT FOUND THEN RETURN jsonb_build_object('revision','0','policy',NULL);END IF;
 SELECT * INTO STRICT p FROM food_dispatch_policy_versions WHERE id=h.version_id;
 RETURN jsonb_build_object('revision',h.revision::text,'policy',jsonb_build_object('id',p.id,'enabled',p.enabled,'live',food_dispatch_policy_live(p.id),
 'vehicleType',p.vehicle_type,'offerBudget',p.offer_budget,'cycleSeconds',p.cycle_seconds,'overallSeconds',p.overall_seconds,'maxCycles',p.max_cycles,
 'shortlistSize',p.shortlist_size,'maxPickupSeconds',p.max_pickup_seconds,'validUntil',p.valid_until,'reason',p.reason));
END $$;
CREATE FUNCTION food_dispatch_policy_command(merchant uuid,branch uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;sponsor uuid;key uuid;prior food_dispatch_policy_commands;h food_dispatch_policy_heads;policy uuid:=gen_random_uuid();receipt jsonb;request jsonb;until_at timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;sponsor:=food_dispatch_policy_staff(merchant);PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','enabled','vehicleType','offerBudget','cycleSeconds','overallSeconds','maxCycles','shortlistSize','maxPickupSeconds','validUntil','reason']
 OR (SELECT count(*) FROM jsonb_object_keys(payload))<>12 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR (payload->>'expectedVersion')!~'^(0|[1-9][0-9]{0,18})$'
 OR (payload->>'expectedVersion')::numeric>9223372036854775807 OR jsonb_typeof(payload->'enabled') IS DISTINCT FROM 'boolean'
 OR payload->>'vehicleType' NOT IN('MOTORCYCLE','CAR') OR jsonb_typeof(payload->'vehicleType') IS DISTINCT FROM 'string'
 OR jsonb_typeof(payload->'validUntil') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string'
 OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['offerBudget','cycleSeconds','overallSeconds','maxCycles','shortlistSize','maxPickupSeconds']) field
 WHERE jsonb_typeof(payload->field) IS DISTINCT FROM 'number' OR (payload->>field)!~'^[0-9]{1,4}$') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF (payload->>'offerBudget')::integer NOT BETWEEN 1 AND 6 OR (payload->>'cycleSeconds')::integer NOT BETWEEN 60 AND 300
 OR (payload->>'overallSeconds')::integer NOT BETWEEN 60 AND 900 OR (payload->>'maxCycles')::integer NOT BETWEEN 1 AND 3
 OR (payload->>'shortlistSize')::integer NOT BETWEEN 1 AND 6 OR (payload->>'maxPickupSeconds')::integer NOT BETWEEN 60 AND 3600
 OR (payload->>'overallSeconds')::integer<(payload->>'cycleSeconds')::integer THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 BEGIN until_at:=(payload->>'validUntil')::timestamptz;EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_REQUEST';END;
 IF NOT EXISTS(SELECT 1 FROM branch_delivery_policies WHERE merchant_id=merchant AND branch_id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 key:=(payload->>'idempotencyKey')::uuid;request:=jsonb_build_array(merchant,branch,payload);PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,73));
 SELECT * INTO prior FROM food_dispatch_policy_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.request<>request THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 SELECT * INTO h FROM food_dispatch_policy_heads WHERE merchant_id=merchant AND branch_id=branch FOR UPDATE;
 IF coalesce(h.revision,0)<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 -- Recheck selected locked delegation after every possible wait; no stale sponsor publication.
 IF food_dispatch_policy_staff(merchant) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT isfinite(until_at) OR until_at<=clock_timestamp() OR until_at>clock_timestamp()+interval '30 days' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 INSERT INTO food_dispatch_policy_versions(id,merchant_id,branch_id,enabled,vehicle_type,offer_budget,cycle_seconds,overall_seconds,max_cycles,shortlist_size,max_pickup_seconds,valid_until,issued_by,issued_grant_id,reason)
 VALUES(policy,merchant,branch,(payload->>'enabled')::boolean,payload->>'vehicleType',(payload->>'offerBudget')::smallint,(payload->>'cycleSeconds')::integer,(payload->>'overallSeconds')::integer,(payload->>'maxCycles')::smallint,(payload->>'shortlistSize')::smallint,(payload->>'maxPickupSeconds')::integer,until_at,actor,sponsor,btrim(payload->>'reason'));
 INSERT INTO food_dispatch_policy_heads(merchant_id,branch_id,revision,version_id) VALUES(merchant,branch,coalesce(h.revision,0)+1,policy)
 ON CONFLICT(merchant_id,branch_id) DO UPDATE SET revision=excluded.revision,version_id=excluded.version_id;
 receipt:=jsonb_build_object('revision',(coalesce(h.revision,0)+1)::text,'policyId',policy);
 INSERT INTO food_dispatch_policy_commands(actor_account_id,idempotency_key,request,response) VALUES(actor,key,request,receipt);RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_dispatch_policy_staff(uuid),food_dispatch_policy_live(uuid),food_dispatch_policy_snapshot(uuid,uuid),food_dispatch_policy_command(uuid,uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker;
GRANT EXECUTE ON FUNCTION food_dispatch_policy_snapshot(uuid,uuid),food_dispatch_policy_command(uuid,uuid,jsonb) TO bitpos_app;
