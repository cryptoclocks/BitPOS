SET search_path=bitpos,public;
-- Approval alone is private. Compare personal prices only with explicitly published daily prices.
CREATE OR REPLACE FUNCTION guard_personal_quote_line() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE line jsonb;target promotion_playlist_targets;campaign promotion_campaigns;revision promotion_revisions;scope promotion_scopes;base bigint;price bigint;public_price bigint;offer versioned_product_offers;daily_price bigint;
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
  public_price:=base;
  SELECT * INTO offer FROM versioned_product_offers WHERE merchant_id=NEW.merchant_id AND price_version_id=NEW.price_version_id AND product_id=campaign.product_id ORDER BY revision DESC LIMIT 1;
  IF offer.enabled AND offer.expires_at>clock_timestamp() THEN public_price:=offer.current_minor;END IF;
  SELECT min(base-floor(base::numeric*(r.content->>'discountPercent')::integer/100)::bigint) INTO daily_price FROM promotion_campaigns c
   JOIN promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id AND s.audience='daily'
   JOIN promotion_revisions r ON r.merchant_id=c.merchant_id AND r.campaign_id=c.id AND r.version=c.approved_version
   WHERE c.merchant_id=NEW.merchant_id AND c.product_id=campaign.product_id AND c.state='APPROVED' AND EXISTS(SELECT 1 FROM promotion_playlist_targets published WHERE published.merchant_id=c.merchant_id AND published.campaign_id=c.id AND published.campaign_version=c.approved_version) AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp()
   AND r.content->'snapshot'->>'priceVersion'=NEW.price_version_id::text AND (r.content->'snapshot'->'basePrice'->>'amountMinor')::bigint=base
   AND r.content->'snapshot'->>'imageUrl' IS NOT DISTINCT FROM (SELECT image_url FROM products WHERE merchant_id=NEW.merchant_id AND id=c.product_id)
   AND base-floor(base::numeric*(r.content->>'discountPercent')::integer/100)::bigint>=s.minimum_unit_minor;
  public_price:=least(public_price,coalesce(daily_price,public_price));price:=base-floor(base::numeric*(revision.content->>'discountPercent')::integer/100)::bigint;
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
