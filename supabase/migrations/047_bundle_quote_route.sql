SET search_path=bitpos,public;
-- Read submitted canonical serving authority before the existing columns trigger runs.
CREATE OR REPLACE FUNCTION guard_bundle_quote() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE grouped record;content jsonb;b jsonb;member jsonb;line jsonb;other jsonb;amount bigint;total bigint;first bigint;units int;BEGIN
 FOR grouped IN SELECT value->'bundle'->>'campaignId' AS campaign,count(*) AS n FROM jsonb_array_elements(NEW.lines) WHERE value ? 'bundle' GROUP BY value->'bundle'->>'campaignId' LOOP
  IF grouped.n<>2 THEN RAISE EXCEPTION 'incomplete bundle' USING ERRCODE='23514';END IF;
  SELECT r.content INTO STRICT content FROM promotion_revisions r JOIN promotion_campaigns c ON c.merchant_id=r.merchant_id AND c.id=r.campaign_id AND c.approved_version=r.version WHERE r.merchant_id=NEW.merchant_id AND r.campaign_id=grouped.campaign::uuid;
  IF NOT bundle_campaign_current(NEW.merchant_id,grouped.campaign::uuid,coalesce(NEW.serving_table_id,(NEW.authority->'serving'->>'tableId')::uuid),NEW.price_version_id) THEN RAISE EXCEPTION 'bundle not applicable' USING ERRCODE='23514';END IF;
  b:=content->'snapshot'->'bundle';amount:=(b->'unitPrice'->>'amountMinor')::bigint;total:=(content->'snapshot'->'basePrice'->>'amountMinor')::bigint;first:=greatest(1,floor(amount::numeric*(b->'members'->0->'basePrice'->>'amountMinor')::numeric/total)::bigint);units:=NULL;
  FOR member IN SELECT value FROM jsonb_array_elements(b->'members') LOOP
   SELECT value INTO STRICT line FROM jsonb_array_elements(NEW.lines) WHERE value->>'productId'=member->>'productId';
   IF line->'bundle'->>'campaignId'<>grouped.campaign OR (line->'bundle'->>'campaignVersion')::int<>(SELECT approved_version FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=grouped.campaign::uuid)
   OR line->'bundle'->>'pairUnitMinor'<>amount::text OR line->'basePrice' IS DISTINCT FROM member->'basePrice' OR line->'promotion' IS DISTINCT FROM 'null'::jsonb OR line ? 'dailyPromotion' OR line ? 'personalPromotion' OR line ? 'scopedPromotion'
   OR (line->'unitPrice'->>'amountMinor')::bigint<>(CASE WHEN member->>'productId'=b->'members'->0->>'productId' THEN first ELSE amount-first END) OR units IS NOT NULL AND units<>(line->>'qty')::int THEN RAISE EXCEPTION 'bundle allocation mismatch' USING ERRCODE='23514';END IF;units:=(line->>'qty')::int;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
