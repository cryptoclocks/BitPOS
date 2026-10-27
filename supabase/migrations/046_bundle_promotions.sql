SET search_path=bitpos,public;
ALTER TABLE device_capabilities DROP CONSTRAINT device_capabilities_capabilities_check;
ALTER TABLE device_capabilities ADD CONSTRAINT device_capabilities_capabilities_check CHECK(capabilities <@ ARRAY['pickup_ready_v1','promotion_v1','promotion_playlist_v1','promotion_playlist_v2','promotion_bundle_v1']::text[]);
CREATE FUNCTION bundle_campaign_current(m uuid,cid uuid,tid uuid,pv uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM promotion_campaigns c JOIN promotion_revisions r ON r.merchant_id=c.merchant_id AND r.campaign_id=c.id AND r.version=c.approved_version JOIN promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id LEFT JOIN promotion_scope_placements x ON x.merchant_id=c.merchant_id AND x.campaign_id=c.id
 WHERE c.merchant_id=m AND c.id=cid AND s.audience='daily' AND c.state='APPROVED' AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND r.content->'snapshot' ? 'bundle' AND r.content->'snapshot'->>'priceVersion'=pv::text
 AND (x.binding->'placement'->>'kind' IS DISTINCT FROM 'table' OR tid IS NOT NULL AND x.binding->'placement'->>'tableId'=tid::text AND promotion_table_binding_current(m,c.id))
 AND jsonb_array_length(r.content->'snapshot'->'bundle'->'members')=2 AND (r.content->'snapshot'->'bundle'->'unitPrice'->>'amountMinor')::bigint>=2
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.content->'snapshot'->'bundle'->'members') member WHERE NOT EXISTS(SELECT 1 FROM products p JOIN catalog_prices cp ON cp.merchant_id=p.merchant_id AND cp.product_id=p.id JOIN merchant_pricing mp ON mp.merchant_id=cp.merchant_id AND mp.active_price_version_id=cp.price_version_id WHERE p.merchant_id=m AND p.id=(member->>'productId')::uuid AND cp.price_version_id=pv AND cp.unit_minor=(member->'basePrice'->>'amountMinor')::bigint AND p.image_url IS NOT DISTINCT FROM member->>'imageUrl' AND p.stock-p.reserved>=1))
 AND EXISTS(SELECT 1 FROM promotion_playlist_targets t JOIN devices d ON d.merchant_id=t.merchant_id AND d.id=t.target_device_id WHERE t.merchant_id=m AND t.campaign_id=c.id AND t.campaign_version=c.approved_version AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND t.expires_at>clock_timestamp() AND d.revoked_at IS NULL AND d.assignment_generation=t.assignment_generation AND d.auth_generation=t.auth_generation))
$$;
CREATE FUNCTION guard_bundle_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE b jsonb;v catalog_price_versions;total bigint;BEGIN
 IF NOT (NEW.snapshot ? 'bundle') THEN RETURN NEW;END IF;
 b:=NEW.snapshot->'bundle';SELECT * INTO STRICT v FROM catalog_price_versions WHERE merchant_id=NEW.merchant_id AND id=(NEW.snapshot->>'priceVersion')::uuid;
 IF jsonb_array_length(b->'members')<>2 OR (SELECT count(DISTINCT value->>'productId') FROM jsonb_array_elements(b->'members'))<>2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'members') item WHERE item->>'productId'=NEW.product_id::text)
 OR NOT EXISTS(SELECT 1 FROM promotion_job_contexts WHERE merchant_id=NEW.merchant_id AND job_id=NEW.job_id AND audience='daily') THEN RAISE EXCEPTION 'invalid bundle members' USING ERRCODE='23514';END IF;
 SELECT sum((member->'basePrice'->>'amountMinor')::bigint) INTO total FROM jsonb_array_elements(b->'members') member;
 IF (b->'unitPrice'->>'amountMinor')::bigint NOT BETWEEN 2 AND total-1 OR b->'unitPrice'->>'currency'<>v.currency OR (b->'unitPrice'->>'decimals')::int<>v.decimals OR (NEW.snapshot->'basePrice'->>'amountMinor')::bigint<>total
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'members') member WHERE NOT EXISTS(SELECT 1 FROM catalog_prices cp JOIN products p ON p.merchant_id=cp.merchant_id AND p.id=cp.product_id WHERE cp.merchant_id=NEW.merchant_id AND cp.price_version_id=v.id AND cp.product_id=(member->>'productId')::uuid AND cp.unit_minor=(member->'basePrice'->>'amountMinor')::bigint AND p.image_url IS NOT DISTINCT FROM member->>'imageUrl')) THEN RAISE EXCEPTION 'invalid bundle price snapshot' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER bundle_snapshot BEFORE INSERT OR UPDATE ON promotion_campaigns FOR EACH ROW EXECUTE FUNCTION guard_bundle_snapshot();
ALTER FUNCTION playlist_target_current(uuid,uuid) RENAME TO playlist_target_current_pre_bundle;
CREATE FUNCTION playlist_target_current(m uuid,tgt uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT CASE WHEN r.content->'snapshot' ? 'bundle' THEN bundle_campaign_current(m,t.campaign_id,t.table_id,(r.content->'snapshot'->>'priceVersion')::uuid) AND d.revoked_at IS NULL AND d.assignment_generation=t.assignment_generation AND d.auth_generation=t.auth_generation AND (x.binding->'placement'->>'kind' IS DISTINCT FROM 'table' OR d.table_id=(x.binding->'placement'->>'tableId')::uuid AND promotion_table_binding_current(m,t.campaign_id)) ELSE playlist_target_current_pre_bundle(m,tgt) END
 FROM promotion_playlist_targets t JOIN devices d ON d.merchant_id=t.merchant_id AND d.id=t.target_device_id JOIN promotion_revisions r ON r.merchant_id=t.merchant_id AND r.campaign_id=t.campaign_id AND r.version=t.campaign_version LEFT JOIN promotion_scope_placements x ON x.merchant_id=t.merchant_id AND x.campaign_id=t.campaign_id WHERE t.merchant_id=m AND t.id=tgt
$$;
-- Bundle pricing is applied to two complete cart lines, never to a single menu product.
DO $$DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('bitpos.promotion_applicable_price(uuid,uuid,uuid,uuid)'::regprocedure);
 IF position('c.state=''APPROVED''' in definition)=0 THEN RAISE EXCEPTION 'expected daily guard absent';END IF;
 EXECUTE replace(definition,'c.state=''APPROVED''','c.state=''APPROVED'' AND NOT (r.content->''snapshot'' ? ''bundle'')');
END $$;
CREATE FUNCTION guard_bundle_quote() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE grouped record;content jsonb;b jsonb;member jsonb;line jsonb;other jsonb;amount bigint;total bigint;first bigint;units int;BEGIN
 FOR grouped IN SELECT value->'bundle'->>'campaignId' AS campaign,count(*) AS n FROM jsonb_array_elements(NEW.lines) WHERE value ? 'bundle' GROUP BY value->'bundle'->>'campaignId' LOOP
  IF grouped.n<>2 THEN RAISE EXCEPTION 'incomplete bundle' USING ERRCODE='23514';END IF;
  SELECT r.content INTO STRICT content FROM promotion_revisions r JOIN promotion_campaigns c ON c.merchant_id=r.merchant_id AND c.id=r.campaign_id AND c.approved_version=r.version WHERE r.merchant_id=NEW.merchant_id AND r.campaign_id=grouped.campaign::uuid;
  IF NOT bundle_campaign_current(NEW.merchant_id,grouped.campaign::uuid,NEW.serving_table_id,NEW.price_version_id) THEN RAISE EXCEPTION 'bundle not applicable' USING ERRCODE='23514';END IF;
  b:=content->'snapshot'->'bundle';amount:=(b->'unitPrice'->>'amountMinor')::bigint;total:=(content->'snapshot'->'basePrice'->>'amountMinor')::bigint;first:=greatest(1,floor(amount::numeric*(b->'members'->0->'basePrice'->>'amountMinor')::numeric/total)::bigint);units:=NULL;
  FOR member IN SELECT value FROM jsonb_array_elements(b->'members') LOOP
   SELECT value INTO STRICT line FROM jsonb_array_elements(NEW.lines) WHERE value->>'productId'=member->>'productId';
   IF line->'bundle'->>'campaignId'<>grouped.campaign OR (line->'bundle'->>'campaignVersion')::int<>(SELECT approved_version FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=grouped.campaign::uuid)
   OR line->'bundle'->>'pairUnitMinor'<>amount::text OR line->'basePrice' IS DISTINCT FROM member->'basePrice' OR line->'promotion' IS DISTINCT FROM 'null'::jsonb OR line ? 'dailyPromotion' OR line ? 'personalPromotion' OR line ? 'scopedPromotion'
   OR (line->'unitPrice'->>'amountMinor')::bigint<>(CASE WHEN member->>'productId'=b->'members'->0->>'productId' THEN first ELSE amount-first END) OR units IS NOT NULL AND units<>(line->>'qty')::int THEN RAISE EXCEPTION 'bundle allocation mismatch' USING ERRCODE='23514';END IF;units:=(line->>'qty')::int;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER bundle_quote_authority BEFORE INSERT ON order_quotes FOR EACH ROW EXECUTE FUNCTION guard_bundle_quote();
REVOKE ALL ON FUNCTION bundle_campaign_current(uuid,uuid,uuid,uuid),playlist_target_current_pre_bundle(uuid,uuid),playlist_target_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bundle_campaign_current(uuid,uuid,uuid,uuid),playlist_target_current_pre_bundle(uuid,uuid),playlist_target_current(uuid,uuid) TO bitpos_app;
