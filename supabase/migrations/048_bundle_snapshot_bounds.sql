SET search_path=bitpos,public;
CREATE OR REPLACE FUNCTION guard_bundle_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE b jsonb;v catalog_price_versions;total bigint;BEGIN
 IF NOT (NEW.snapshot ? 'bundle') THEN RETURN NEW;END IF;
 b:=NEW.snapshot->'bundle';SELECT * INTO STRICT v FROM catalog_price_versions WHERE merchant_id=NEW.merchant_id AND id=(NEW.snapshot->>'priceVersion')::uuid;
 IF jsonb_array_length(b->'members')<>2 OR (SELECT count(DISTINCT value->>'productId') FROM jsonb_array_elements(b->'members'))<>2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'members') item WHERE item->>'productId'=NEW.product_id::text)
 OR NOT EXISTS(SELECT 1 FROM promotion_job_contexts WHERE merchant_id=NEW.merchant_id AND job_id=NEW.job_id AND audience='daily') THEN RAISE EXCEPTION 'invalid bundle members' USING ERRCODE='23514';END IF;
 SELECT sum((member->'basePrice'->>'amountMinor')::bigint) INTO total FROM jsonb_array_elements(b->'members') member;
 IF (b->'unitPrice'->>'amountMinor')::bigint NOT BETWEEN greatest(2,ceil(total::numeric/100)::bigint) AND total-1 OR b->'unitPrice'->>'currency'<>v.currency OR (b->'unitPrice'->>'decimals')::int<>v.decimals OR (NEW.snapshot->'basePrice'->>'amountMinor')::bigint<>total
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'members') member WHERE NOT EXISTS(SELECT 1 FROM catalog_prices cp JOIN products p ON p.merchant_id=cp.merchant_id AND p.id=cp.product_id WHERE cp.merchant_id=NEW.merchant_id AND cp.price_version_id=v.id AND cp.product_id=(member->>'productId')::uuid AND cp.unit_minor=(member->'basePrice'->>'amountMinor')::bigint AND member->'basePrice'->>'currency'=v.currency AND (member->'basePrice'->>'decimals')::int=v.decimals AND member->>'priceVersion'=v.id::text AND p.image_url IS NOT DISTINCT FROM member->>'imageUrl')) THEN RAISE EXCEPTION 'invalid bundle price snapshot' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
