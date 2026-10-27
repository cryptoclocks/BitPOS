-- Apply with new quote writers after a verified backup. Before COMMIT: ROLLBACK.
-- After financial sidecars exist: pause new promotion commands, retain history,
-- revoke through versioned merchant APIs and roll forward; never reprice old bills.
SET search_path TO bitpos,extensions,public;
CREATE TABLE promotion_scopes(
 merchant_id uuid NOT NULL,campaign_id uuid NOT NULL,audience text NOT NULL CHECK(audience IN ('daily','customer','from_order')),
 context jsonb NOT NULL,minimum_unit_minor bigint NOT NULL CHECK(minimum_unit_minor>0),
 PRIMARY KEY(merchant_id,campaign_id),FOREIGN KEY(merchant_id,campaign_id) REFERENCES promotion_campaigns(merchant_id,id)
);
CREATE TRIGGER immutable_promotion_scope BEFORE UPDATE OR DELETE ON promotion_scopes FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE promotion_job_contexts(
 merchant_id uuid NOT NULL,job_id uuid NOT NULL,audience text NOT NULL CHECK(audience IN ('daily','customer','from_order')),
 context jsonb NOT NULL,minimum_unit_minor bigint NOT NULL CHECK(minimum_unit_minor>0),
 PRIMARY KEY(merchant_id,job_id),FOREIGN KEY(merchant_id,job_id) REFERENCES ai_generation_jobs(merchant_id,id)
);
CREATE TRIGGER immutable_promotion_job_context BEFORE UPDATE OR DELETE ON promotion_job_contexts FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE daily_quote_promotions(
 merchant_id uuid NOT NULL,quote_id uuid NOT NULL,product_id uuid NOT NULL,campaign_id uuid NOT NULL,campaign_version integer NOT NULL,evidence jsonb NOT NULL,
 PRIMARY KEY(merchant_id,quote_id,product_id),FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),FOREIGN KEY(merchant_id,campaign_id,campaign_version) REFERENCES promotion_revisions(merchant_id,campaign_id,version)
);
CREATE TABLE daily_order_promotions(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,product_id uuid NOT NULL,quote_id uuid NOT NULL,campaign_id uuid NOT NULL,campaign_version integer NOT NULL,evidence jsonb NOT NULL,
 PRIMARY KEY(merchant_id,order_id,product_id),FOREIGN KEY(merchant_id,order_id,product_id) REFERENCES order_line_prices(merchant_id,order_id,product_id),
 FOREIGN KEY(merchant_id,quote_id,product_id) REFERENCES daily_quote_promotions(merchant_id,quote_id,product_id),
 FOREIGN KEY(merchant_id,campaign_id,campaign_version) REFERENCES promotion_revisions(merchant_id,campaign_id,version)
);
DO $$ DECLARE relation text; BEGIN FOREACH relation IN ARRAY ARRAY['promotion_scopes','promotion_job_contexts','daily_quote_promotions','daily_order_promotions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',relation);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',relation);
END LOOP; END $$;
CREATE TRIGGER immutable_daily_quote BEFORE UPDATE OR DELETE ON daily_quote_promotions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_daily_order BEFORE UPDATE OR DELETE ON daily_order_promotions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION guard_daily_quote() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE line jsonb;campaign promotion_campaigns;scope promotion_scopes;revision promotion_revisions;base bigint;price bigint;global_price bigint;offer versioned_product_offers;
BEGIN
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) WHERE value ? 'dailyPromotion' LOOP
  SELECT * INTO STRICT campaign FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=(line->'dailyPromotion'->>'campaignId')::uuid;
  SELECT * INTO STRICT scope FROM promotion_scopes WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND audience='daily';
  SELECT * INTO STRICT revision FROM promotion_revisions WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND version=(line->'dailyPromotion'->>'campaignVersion')::integer;
  SELECT unit_minor INTO STRICT base FROM catalog_prices WHERE merchant_id=NEW.merchant_id AND price_version_id=NEW.price_version_id AND product_id=campaign.product_id;
  global_price:=base;SELECT * INTO offer FROM versioned_product_offers WHERE merchant_id=NEW.merchant_id AND price_version_id=NEW.price_version_id AND product_id=campaign.product_id ORDER BY revision DESC LIMIT 1;
  IF offer.enabled AND offer.expires_at>clock_timestamp() THEN global_price:=offer.current_minor; END IF;
  price:=base-floor(base::numeric*(revision.content->>'discountPercent')::integer/100)::bigint;
  IF campaign.state<>'APPROVED' OR campaign.approved_version<>revision.version OR campaign.starts_at>clock_timestamp() OR campaign.expires_at<=clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=NEW.merchant_id AND t.campaign_id=campaign.id AND t.campaign_version=revision.version AND t.audience='daily' AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND t.expires_at>clock_timestamp())
   OR line ? 'scopedPromotion' OR line ? 'personalPromotion' OR line->'promotion' IS DISTINCT FROM 'null'::jsonb OR line->>'productId' IS DISTINCT FROM campaign.product_id::text
   OR line->'dailyPromotion' IS DISTINCT FROM jsonb_build_object('campaignId',campaign.id::text,'campaignVersion',revision.version,'discountPercent',(revision.content->>'discountPercent')::integer,'startsAt',line->'dailyPromotion'->>'startsAt','expiresAt',line->'dailyPromotion'->>'expiresAt')
   OR (line->'dailyPromotion'->>'startsAt')::timestamptz IS DISTINCT FROM campaign.starts_at OR (line->'dailyPromotion'->>'expiresAt')::timestamptz IS DISTINCT FROM campaign.expires_at
   OR NEW.valid_until>campaign.expires_at OR revision.content->'snapshot'->>'priceVersion' IS DISTINCT FROM NEW.price_version_id::text
   OR price<scope.minimum_unit_minor OR price>=global_price OR (line->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base OR (line->'unitPrice'->>'amountMinor')::bigint IS DISTINCT FROM price
  THEN RAISE EXCEPTION 'invalid daily quote authority' USING ERRCODE='23514'; END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER daily_quote_authority BEFORE INSERT ON order_quotes FOR EACH ROW EXECUTE FUNCTION guard_daily_quote();
CREATE FUNCTION guard_daily_quote_sidecar() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_quotes q CROSS JOIN LATERAL jsonb_array_elements(q.lines) l WHERE q.merchant_id=NEW.merchant_id AND q.id=NEW.quote_id AND l->>'productId'=NEW.product_id::text AND l->'dailyPromotion'=NEW.evidence AND NEW.evidence->>'campaignId'=NEW.campaign_id::text AND (NEW.evidence->>'campaignVersion')::integer=NEW.campaign_version) THEN RAISE EXCEPTION 'daily quote evidence mismatch' USING ERRCODE='23514'; END IF;RETURN NEW;END $$;
CREATE TRIGGER daily_quote_sidecar BEFORE INSERT ON daily_quote_promotions FOR EACH ROW EXECUTE FUNCTION guard_daily_quote_sidecar();
CREATE FUNCTION guard_daily_order_sidecar() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_authority a JOIN daily_quote_promotions q ON q.merchant_id=a.merchant_id AND q.quote_id=a.quote_id WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id AND q.product_id=NEW.product_id AND q.quote_id=NEW.quote_id AND q.campaign_id=NEW.campaign_id AND q.campaign_version=NEW.campaign_version AND q.evidence=NEW.evidence) THEN RAISE EXCEPTION 'daily bill evidence mismatch' USING ERRCODE='23514'; END IF;RETURN NEW;END $$;
CREATE TRIGGER daily_order_sidecar BEFORE INSERT ON daily_order_promotions FOR EACH ROW EXECUTE FUNCTION guard_daily_order_sidecar();
CREATE FUNCTION guard_daily_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='order_quotes' THEN
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.lines) l WHERE l ? 'dailyPromotion')<>(SELECT count(*) FROM daily_quote_promotions q WHERE q.merchant_id=NEW.merchant_id AND q.quote_id=NEW.id) THEN RAISE EXCEPTION 'missing daily quote evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.id AND (SELECT count(*) FROM jsonb_array_elements(q.lines) l WHERE l ? 'dailyPromotion')<>(SELECT count(*) FROM daily_order_promotions d WHERE d.merchant_id=NEW.merchant_id AND d.order_id=NEW.id)) THEN RAISE EXCEPTION 'missing daily bill evidence' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER daily_quote_complete AFTER INSERT ON order_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_daily_complete();
CREATE CONSTRAINT TRIGGER daily_bill_complete AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_daily_complete();
