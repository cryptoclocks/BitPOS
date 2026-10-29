-- Apply transactionally after 041 with API/worker writers paused and a verified backup.
-- Before COMMIT: ROLLBACK. After publication retain immutable lineage/revisions and
-- daily financial sidecars; disable derivation commands, revoke via CAS and roll forward.
-- Never remove price guards or reprice existing bills after table quotes exist.
SET search_path=bitpos,extensions,public;
ALTER TABLE promotion_campaigns DROP CONSTRAINT promotion_campaigns_merchant_id_job_id_key;
ALTER TABLE promotion_campaigns ADD COLUMN manual_derived boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX one_generated_campaign_per_job ON promotion_campaigns(merchant_id,job_id) WHERE NOT manual_derived;
CREATE TABLE promotion_derivations(
 merchant_id uuid NOT NULL,campaign_id uuid NOT NULL,binding jsonb NOT NULL,origin text NOT NULL CHECK(origin IN ('manual_derived','ai_regenerated')),
 PRIMARY KEY(merchant_id,campaign_id),FOREIGN KEY(merchant_id,campaign_id) REFERENCES promotion_campaigns(merchant_id,id),
 CHECK(binding->'placement'->>'kind' IN ('campaign_devices','table')),
 CHECK(jsonb_array_length(binding->'targets') BETWEEN 1 AND 100)
);
CREATE TABLE promotion_job_derivations(
 merchant_id uuid NOT NULL,job_id uuid NOT NULL,binding jsonb NOT NULL,
 PRIMARY KEY(merchant_id,job_id),FOREIGN KEY(merchant_id,job_id) REFERENCES ai_generation_jobs(merchant_id,id),
 CHECK(binding->'placement'->>'kind' IN ('campaign_devices','table')),
 CHECK(jsonb_array_length(binding->'targets') BETWEEN 1 AND 100)
);
DO $$ DECLARE relation text;BEGIN FOREACH relation IN ARRAY ARRAY['promotion_derivations','promotion_job_derivations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',relation);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO bitpos_app',relation);
 EXECUTE format('CREATE TRIGGER immutable_lineage BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_authority_row()',relation);
END LOOP;END $$;
-- Destination authority survives source replacement; do not require source receipt
-- to remain live after explicit publication. Its identity remains immutable history.
CREATE FUNCTION promotion_table_binding_current(p_merchant uuid,p_campaign uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM promotion_derivations x CROSS JOIN LATERAL jsonb_array_elements(x.binding->'targets') item
 JOIN devices d ON d.merchant_id=x.merchant_id AND d.id=(item->>'deviceId')::uuid
 JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
 WHERE x.merchant_id=p_merchant AND x.campaign_id=p_campaign AND x.binding->'placement'->>'kind'='table'
 AND d.revoked_at IS NULL AND d.assignment_generation=(item->>'assignmentGeneration')::bigint AND d.auth_generation=(item->>'authGeneration')::bigint
 AND d.table_id=(x.binding->'placement'->>'tableId')::uuid AND t.retired_at IS NULL AND t.occupancy_generation=(x.binding->>'occupancyGeneration')::bigint)
$$;
ALTER FUNCTION playlist_target_current(uuid,uuid) RENAME TO playlist_target_current_pre_derivation;
CREATE FUNCTION promotion_derivation_current(p_merchant uuid,b jsonb) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT coalesce(
  b->'placement'->>'kind' IN ('campaign_devices','table')
  AND jsonb_array_length(b->'targets') BETWEEN 1 AND 100
  AND jsonb_array_length(b->'placement'->'deviceIds')=jsonb_array_length(b->'targets')
  AND (SELECT count(DISTINCT value->>'deviceId') FROM jsonb_array_elements(b->'targets'))=jsonb_array_length(b->'targets')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'placement'->'deviceIds') id WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'targets') item WHERE item->>'deviceId'=id#>>'{}'))
  AND EXISTS(SELECT 1 FROM promotion_campaigns c WHERE c.merchant_id=p_merchant AND c.id=(b->'placement'->>'sourceCampaignId')::uuid AND c.version=(b->'placement'->>'sourceVersion')::integer AND c.approved_version=(b->>'sourceRevision')::integer AND c.discount_percent=(b->>'sourceDiscount')::integer AND c.state='APPROVED' AND c.expires_at>clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'targets') item WHERE NOT EXISTS(
   SELECT 1 FROM promotion_playlist_targets p JOIN devices d ON d.merchant_id=p.merchant_id AND d.id=p.target_device_id
   LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
   WHERE p.merchant_id=p_merchant AND p.id=(item->>'targetId')::uuid AND p.campaign_id=(b->'placement'->>'sourceCampaignId')::uuid AND p.campaign_version=(b->>'sourceRevision')::integer
   AND p.target_device_id=(item->>'deviceId')::uuid AND p.assignment_generation=(item->>'assignmentGeneration')::bigint AND p.auth_generation=(item->>'authGeneration')::bigint
   AND d.revoked_at IS NULL AND d.assignment_generation=p.assignment_generation AND d.auth_generation=p.auth_generation
   AND p.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND p.expires_at>clock_timestamp() AND playlist_target_current_pre_derivation(p.merchant_id,p.id)
   AND NOT EXISTS(SELECT 1 FROM promotion_derivations x WHERE x.merchant_id=p.merchant_id AND x.campaign_id=p.campaign_id AND x.binding->'placement'->>'kind'='table' AND NOT promotion_table_binding_current(p.merchant_id,p.campaign_id))
   AND (b->'placement'->>'kind'<>'table' OR d.table_id=(b->'placement'->>'tableId')::uuid AND t.retired_at IS NULL AND t.occupancy_generation=(b->>'occupancyGeneration')::bigint)
  ))
  AND (b->'placement'->>'kind'<>'campaign_devices' OR jsonb_array_length(b->'targets')=(SELECT count(*) FROM promotion_playlist_targets p WHERE p.merchant_id=p_merchant AND p.campaign_id=(b->'placement'->>'sourceCampaignId')::uuid AND p.campaign_version=(b->>'sourceRevision')::integer))
  AND (b->'placement'->>'kind'<>'table' OR jsonb_array_length(b->'targets')=1)
  AND b->'placement'->>'priceAuthority'=CASE WHEN (SELECT audience FROM promotion_scopes WHERE merchant_id=p_merchant AND campaign_id=(b->'placement'->>'sourceCampaignId')::uuid)<>'daily' THEN 'personal' WHEN b->'placement'->>'kind'='table' THEN 'table' ELSE 'public' END
  AND ((SELECT audience FROM promotion_scopes WHERE merchant_id=p_merchant AND campaign_id=(b->'placement'->>'sourceCampaignId')::uuid)='daily' OR b->'placement'->>'kind'='table'),false)
$$;
CREATE FUNCTION guard_promotion_derivation() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE c promotion_campaigns;source promotion_campaigns;BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 IF NOT promotion_derivation_current(NEW.merchant_id,NEW.binding) THEN RAISE EXCEPTION 'stale derivation authority' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT source FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=(NEW.binding->'placement'->>'sourceCampaignId')::uuid;
 IF TG_TABLE_NAME='promotion_derivations' THEN
  SELECT * INTO STRICT c FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=NEW.campaign_id;
  IF c.state<>'DRAFT' OR c.version<>1 OR (NEW.origin='manual_derived') IS DISTINCT FROM c.manual_derived
   OR c.manual_derived AND (c.job_id<>source.job_id OR c.provenance IS DISTINCT FROM source.provenance)
   OR NOT c.manual_derived AND NOT EXISTS(SELECT 1 FROM promotion_job_derivations j WHERE j.merchant_id=NEW.merchant_id AND j.job_id=c.job_id AND j.binding=NEW.binding)
  THEN RAISE EXCEPTION 'invalid derivation origin' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_campaign_lineage BEFORE INSERT ON promotion_derivations FOR EACH ROW EXECUTE FUNCTION guard_promotion_derivation();
CREATE TRIGGER guard_job_lineage BEFORE INSERT ON promotion_job_derivations FOR EACH ROW EXECUTE FUNCTION guard_promotion_derivation();
CREATE FUNCTION guard_campaign_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF ROW(NEW.merchant_id,NEW.id,NEW.job_id,NEW.manual_derived,NEW.provenance) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.job_id,OLD.manual_derived,OLD.provenance) THEN RAISE EXCEPTION 'immutable campaign origin' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER campaign_origin BEFORE UPDATE ON promotion_campaigns FOR EACH ROW EXECUTE FUNCTION guard_campaign_origin();
CREATE FUNCTION promotion_applicable_price(p_merchant uuid,p_product uuid,p_version uuid,p_table uuid DEFAULT NULL) RETURNS bigint LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 WITH catalog AS (SELECT cp.unit_minor AS base FROM catalog_prices cp JOIN merchant_pricing m ON m.merchant_id=cp.merchant_id AND m.active_price_version_id=cp.price_version_id WHERE cp.merchant_id=p_merchant AND cp.product_id=p_product AND cp.price_version_id=p_version),
 global_offer AS (SELECT CASE WHEN enabled AND expires_at>clock_timestamp() THEN current_minor ELSE NULL END AS current_minor FROM versioned_product_offers WHERE merchant_id=p_merchant AND product_id=p_product AND price_version_id=p_version ORDER BY revision DESC LIMIT 1),
 daily AS (SELECT catalog.base-floor(catalog.base::numeric*(r.content->>'discountPercent')::integer/100)::bigint AS price
 FROM catalog,promotion_campaigns c JOIN promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id AND s.audience='daily'
 JOIN promotion_revisions r ON r.merchant_id=c.merchant_id AND r.campaign_id=c.id AND r.version=c.approved_version
 LEFT JOIN promotion_derivations x ON x.merchant_id=c.merchant_id AND x.campaign_id=c.id
 WHERE c.merchant_id=p_merchant AND c.product_id=p_product AND c.state='APPROVED' AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp()
 AND (x.binding->'placement'->>'kind' IS DISTINCT FROM 'table' OR p_table IS NOT NULL AND (x.binding->'placement'->>'tableId')::uuid=p_table AND promotion_table_binding_current(c.merchant_id,c.id))
 AND r.content->'snapshot'->>'priceVersion'=p_version::text AND (r.content->'snapshot'->'basePrice'->>'amountMinor')::bigint=catalog.base
 AND r.content->'snapshot'->>'imageUrl' IS NOT DISTINCT FROM (SELECT image_url FROM products WHERE merchant_id=p_merchant AND id=p_product)
 AND catalog.base-floor(catalog.base::numeric*(r.content->>'discountPercent')::integer/100)::bigint>=s.minimum_unit_minor
 AND EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=c.merchant_id AND t.campaign_id=c.id AND t.campaign_version=c.approved_version AND t.audience='daily' AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND t.expires_at>clock_timestamp()))
 SELECT least(catalog.base,coalesce((SELECT current_minor FROM global_offer),catalog.base),coalesce((SELECT min(price) FROM daily),catalog.base)) FROM catalog
$$;
CREATE FUNCTION playlist_target_current(p_merchant uuid,p_target uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT playlist_target_current_pre_derivation(p_merchant,p_target) AND EXISTS(
 SELECT 1 FROM promotion_playlist_targets t JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id
 JOIN promotion_revisions r ON r.merchant_id=t.merchant_id AND r.campaign_id=t.campaign_id AND r.version=t.campaign_version
 JOIN promotion_scopes s ON s.merchant_id=t.merchant_id AND s.campaign_id=t.campaign_id
 JOIN products p ON p.merchant_id=c.merchant_id AND p.id=c.product_id
 JOIN merchant_pricing m ON m.merchant_id=c.merchant_id
 JOIN catalog_prices cp ON cp.merchant_id=m.merchant_id AND cp.price_version_id=m.active_price_version_id AND cp.product_id=p.id
 LEFT JOIN promotion_derivations x ON x.merchant_id=t.merchant_id AND x.campaign_id=t.campaign_id
 WHERE t.merchant_id=p_merchant AND t.id=p_target AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED')
 AND p.stock-p.reserved>=1 AND r.content->'snapshot'->>'priceVersion'=m.active_price_version_id::text
 AND (r.content->'snapshot'->'basePrice'->>'amountMinor')::bigint=cp.unit_minor AND r.content->'snapshot'->>'imageUrl' IS NOT DISTINCT FROM p.image_url
 AND cp.unit_minor-floor(cp.unit_minor::numeric*(r.content->>'discountPercent')::integer/100)::bigint>=s.minimum_unit_minor
 AND cp.unit_minor-floor(cp.unit_minor::numeric*(r.content->>'discountPercent')::integer/100)::bigint<=promotion_applicable_price(p_merchant,p.id,m.active_price_version_id,CASE WHEN x.binding->'placement'->>'kind'='table' OR t.audience='personal' THEN t.table_id ELSE NULL END)
 AND (x.binding->'placement'->>'kind' IS DISTINCT FROM 'table' OR t.target_device_id=(x.binding->'placement'->'deviceIds'->>0)::uuid AND promotion_table_binding_current(t.merchant_id,t.campaign_id)))
$$;
REVOKE ALL ON FUNCTION promotion_derivation_current(uuid,jsonb),promotion_table_binding_current(uuid,uuid),promotion_applicable_price(uuid,uuid,uuid,uuid),playlist_target_current_pre_derivation(uuid,uuid),playlist_target_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promotion_derivation_current(uuid,jsonb),promotion_table_binding_current(uuid,uuid),promotion_applicable_price(uuid,uuid,uuid,uuid),playlist_target_current_pre_derivation(uuid,uuid),playlist_target_current(uuid,uuid) TO bitpos_app;
CREATE OR REPLACE FUNCTION guard_daily_quote() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE line jsonb;campaign promotion_campaigns;scope promotion_scopes;revision promotion_revisions;base bigint;price bigint;global_price bigint;offer versioned_product_offers;placement jsonb;BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) WHERE value ? 'dailyPromotion' LOOP
  SELECT * INTO STRICT campaign FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=(line->'dailyPromotion'->>'campaignId')::uuid;
  SELECT * INTO STRICT scope FROM promotion_scopes WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND audience='daily';
  SELECT * INTO STRICT revision FROM promotion_revisions WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND version=(line->'dailyPromotion'->>'campaignVersion')::integer;
  SELECT binding->'placement' INTO placement FROM promotion_derivations WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id;
  SELECT cp.unit_minor INTO STRICT base FROM catalog_prices cp JOIN merchant_pricing m ON m.merchant_id=cp.merchant_id AND m.active_price_version_id=cp.price_version_id WHERE cp.merchant_id=NEW.merchant_id AND cp.price_version_id=NEW.price_version_id AND cp.product_id=campaign.product_id;
  global_price:=base;SELECT * INTO offer FROM versioned_product_offers WHERE merchant_id=NEW.merchant_id AND price_version_id=NEW.price_version_id AND product_id=campaign.product_id ORDER BY revision DESC LIMIT 1;
  IF offer.enabled AND offer.expires_at>clock_timestamp() THEN global_price:=offer.current_minor;END IF;
  price:=base-floor(base::numeric*(revision.content->>'discountPercent')::integer/100)::bigint;
  IF placement->>'kind'='table' AND (
   NOT promotion_table_binding_current(NEW.merchant_id,campaign.id)
   OR NEW.authority->'serving'->>'kind' IS DISTINCT FROM 'table'
   OR NEW.authority->'serving'->>'tableId' IS DISTINCT FROM placement->>'tableId'
   OR NEW.authority->'target'->>'deviceId' IS DISTINCT FROM placement->'deviceIds'->>0
   OR NOT EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=NEW.merchant_id AND t.campaign_id=campaign.id AND t.campaign_version=revision.version AND playlist_target_current(t.merchant_id,t.id))
  ) THEN RAISE EXCEPTION 'table price escaped original destination' USING ERRCODE='23514';END IF;
  IF campaign.state<>'APPROVED' OR campaign.approved_version<>revision.version OR campaign.starts_at>clock_timestamp() OR campaign.expires_at<=clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=NEW.merchant_id AND t.campaign_id=campaign.id AND t.campaign_version=revision.version AND t.audience='daily' AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND t.expires_at>clock_timestamp())
   OR line ? 'scopedPromotion' OR line ? 'personalPromotion' OR line->'promotion' IS DISTINCT FROM 'null'::jsonb OR line->>'productId' IS DISTINCT FROM campaign.product_id::text
   OR line->'dailyPromotion' IS DISTINCT FROM jsonb_build_object('campaignId',campaign.id::text,'campaignVersion',revision.version,'discountPercent',(revision.content->>'discountPercent')::integer,'startsAt',line->'dailyPromotion'->>'startsAt','expiresAt',line->'dailyPromotion'->>'expiresAt')
   OR (line->'dailyPromotion'->>'startsAt')::timestamptz IS DISTINCT FROM campaign.starts_at OR (line->'dailyPromotion'->>'expiresAt')::timestamptz IS DISTINCT FROM campaign.expires_at
   OR NEW.valid_until>campaign.expires_at OR revision.content->'snapshot'->>'priceVersion' IS DISTINCT FROM NEW.price_version_id::text
   OR revision.content->'snapshot'->>'imageUrl' IS DISTINCT FROM (SELECT image_url FROM products WHERE merchant_id=NEW.merchant_id AND id=campaign.product_id)
   OR price<scope.minimum_unit_minor OR price>=global_price OR price>promotion_applicable_price(NEW.merchant_id,campaign.product_id,NEW.price_version_id,CASE WHEN placement->>'kind'='table' THEN (placement->>'tableId')::uuid ELSE NULL END)
   OR (line->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base OR (line->'unitPrice'->>'amountMinor')::bigint IS DISTINCT FROM price
   OR line->'basePrice'->>'currency' IS DISTINCT FROM line->'unitPrice'->>'currency' OR line->'basePrice'->>'decimals' IS DISTINCT FROM line->'unitPrice'->>'decimals'
   OR NOT EXISTS(SELECT 1 FROM products WHERE merchant_id=NEW.merchant_id AND id=campaign.product_id AND stock-reserved>=1)
  THEN RAISE EXCEPTION 'invalid daily quote authority' USING ERRCODE='23514';END IF;
 END LOOP;RETURN NEW;
END $$;
-- Preserve private-recipient proof and nonstacking; table offers affect only the
-- matching table's comparison price, never another recipient's public floor.
CREATE OR REPLACE FUNCTION guard_personal_quote_line() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE line jsonb;target promotion_playlist_targets;campaign promotion_campaigns;revision promotion_revisions;scope promotion_scopes;base bigint;price bigint;public_price bigint;
BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) WHERE value ? 'personalPromotion' LOOP
  SELECT * INTO STRICT target FROM promotion_playlist_targets WHERE merchant_id=NEW.merchant_id AND id=(line->'personalPromotion'->>'targetId')::uuid;
  SELECT * INTO STRICT campaign FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=target.campaign_id;
  PERFORM 1 FROM customer_auth_sessions a JOIN personal_promotion_job_bindings b ON b.merchant_id=a.merchant_id AND b.customer_auth_session_id=a.id
  WHERE b.merchant_id=NEW.merchant_id AND b.job_id=campaign.job_id FOR SHARE OF a;
  SELECT * INTO STRICT revision FROM promotion_revisions WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND version=target.campaign_version;
  SELECT * INTO STRICT scope FROM promotion_scopes WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND audience IN ('customer','from_order');
  SELECT cp.unit_minor INTO STRICT base FROM catalog_prices cp JOIN merchant_pricing m ON m.merchant_id=cp.merchant_id AND m.active_price_version_id=cp.price_version_id WHERE cp.merchant_id=NEW.merchant_id AND cp.price_version_id=NEW.price_version_id AND cp.product_id=campaign.product_id;
  public_price:=promotion_applicable_price(NEW.merchant_id,campaign.product_id,NEW.price_version_id,target.table_id);
  price:=base-floor(base::numeric*(revision.content->>'discountPercent')::integer/100)::bigint;
  IF NOT personal_promotion_eligible(NEW.merchant_id,target.id,NEW.session_id) OR NEW.origin_kind<>'device' OR NEW.source_device_id IS DISTINCT FROM target.target_device_id
   OR (NEW.authority->'target'->>'deviceId')::uuid IS DISTINCT FROM target.target_device_id OR (NEW.authority->'serving'->>'tableId')::uuid IS DISTINCT FROM target.table_id
   OR (line->>'qty')::integer IS DISTINCT FROM 1 OR line->>'productId' IS DISTINCT FROM campaign.product_id::text OR line->'promotion' IS DISTINCT FROM 'null'::jsonb OR line ? 'dailyPromotion' OR line ? 'scopedPromotion'
   OR line->'personalPromotion' IS DISTINCT FROM jsonb_build_object('targetId',target.id::text,'campaignId',target.campaign_id::text,'campaignVersion',target.campaign_version,'recipientId',target.recipient_id::text,'occupancyId',target.occupancy_id::text,'occupancyGeneration',target.occupancy_generation::text,'sessionId',NEW.session_id::text,'discountPercent',(revision.content->>'discountPercent')::integer,'expiresAt',line->'personalPromotion'->>'expiresAt')
   OR (line->'personalPromotion'->>'expiresAt')::timestamptz IS DISTINCT FROM target.expires_at OR NEW.valid_until>target.expires_at
   OR revision.content->'snapshot'->>'priceVersion' IS DISTINCT FROM NEW.price_version_id::text OR (revision.content->'snapshot'->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base
   OR revision.content->'snapshot'->>'imageUrl' IS DISTINCT FROM (SELECT image_url FROM products WHERE merchant_id=NEW.merchant_id AND id=campaign.product_id)
   OR price<scope.minimum_unit_minor OR price>=public_price OR (line->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base OR (line->'unitPrice'->>'amountMinor')::bigint IS DISTINCT FROM price
   OR line->'basePrice'->>'currency' IS DISTINCT FROM line->'unitPrice'->>'currency' OR line->'basePrice'->>'decimals' IS DISTINCT FROM line->'unitPrice'->>'decimals'
   OR NOT EXISTS(SELECT 1 FROM products WHERE merchant_id=NEW.merchant_id AND id=campaign.product_id AND stock-reserved>=1)
  THEN RAISE EXCEPTION 'invalid personal quote authority' USING ERRCODE='23514';END IF;
 END LOOP;RETURN NEW;
END $$;
-- Reconnect/config/cart snapshots must recheck all frozen item authorities at the
-- final send, not merely a matching playlist generation from an earlier snapshot.
ALTER FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) RENAME TO device_validate_send_pre_derivation;
CREATE FUNCTION device_validate_send(p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,p_connection_generation bigint,p_connection_id uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE result jsonb;event outbox_events;BEGIN
 result:=device_validate_send_pre_derivation(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id,p_event);
 IF NOT (result->>'allowed')::boolean OR p_event IS NULL THEN RETURN result;END IF;
 SELECT * INTO event FROM outbox_events WHERE merchant_id=p_merchant AND id=p_event;
 IF event.type IN ('CONFIG','SNAPSHOT','CART') AND event.payload->'payload' ? 'promotionPlaylist'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(event.payload->'payload'->'promotionPlaylist'->'items') item WHERE NOT playlist_target_current(p_merchant,(item->>'targetId')::uuid)) THEN
  UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent';
  RETURN jsonb_set(result,'{allowed}','false'::jsonb);
 END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION device_validate_send_pre_derivation(uuid,uuid,text,bigint,bigint,uuid,uuid),device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_validate_send_pre_derivation(uuid,uuid,text,bigint,bigint,uuid,uuid),device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) TO bitpos_app;
CREATE FUNCTION guard_derived_campaign_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE x promotion_derivations;j promotion_job_derivations;BEGIN
 SELECT * INTO x FROM promotion_derivations WHERE merchant_id=NEW.merchant_id AND campaign_id=NEW.id;
 SELECT * INTO j FROM promotion_job_derivations WHERE merchant_id=NEW.merchant_id AND job_id=NEW.job_id;
 IF NEW.manual_derived AND (x.campaign_id IS NULL OR x.origin<>'manual_derived')
 OR NOT NEW.manual_derived AND j.job_id IS NOT NULL AND (x.campaign_id IS NULL OR x.origin<>'ai_regenerated' OR x.binding IS DISTINCT FROM j.binding)
 THEN RAISE EXCEPTION 'missing durable derivation lineage' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER derived_campaign_complete AFTER INSERT ON promotion_campaigns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_derived_campaign_complete();
CREATE FUNCTION guard_derived_target_destination() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE x promotion_derivations;item jsonb;BEGIN
 SELECT * INTO x FROM promotion_derivations WHERE merchant_id=NEW.merchant_id AND campaign_id=NEW.campaign_id;
 IF x.campaign_id IS NULL THEN RETURN NEW;END IF;
 SELECT value INTO item FROM jsonb_array_elements(x.binding->'targets') WHERE value->>'deviceId'=NEW.target_device_id::text;
 IF item IS NULL OR NOT promotion_derivation_current(NEW.merchant_id,x.binding)
 OR NEW.assignment_generation IS DISTINCT FROM (item->>'assignmentGeneration')::bigint
 OR NEW.auth_generation IS DISTINCT FROM (item->>'authGeneration')::bigint
 OR x.binding->'placement'->>'kind'='table' AND NEW.table_id IS DISTINCT FROM (x.binding->'placement'->>'tableId')::uuid
 THEN RAISE EXCEPTION 'derived target escaped original scope' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER derived_target_destination BEFORE INSERT ON promotion_playlist_targets FOR EACH ROW EXECUTE FUNCTION guard_derived_target_destination();
