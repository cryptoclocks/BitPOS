-- Coordinator applies transactionally after 026. No global product offers are written.
-- Keep C API/worker stopped until BOTH 027 and 028 commit; transaction rollback
-- before COMMIT is safe. If 028 fails after 027 committed, keep C writers stopped
-- and forward-repair 028 before serving C (do not deploy an unguarded intermediate).
-- After scoped quotes/bills exist: never drop sidecars, revisions or guards, never
-- recalculate historical bill money. Disable new /api/promotions mutations at the
-- API/proxy, clear private provider configuration to stop new model requests,
-- revoke active campaigns through owner/manager versioned command, retain worker
-- lifecycle reconciliation and existing financial retrieval/payment paths.
-- Roll forward with a corrective migration; do not restore pre-C quote writers
-- that omit scoped sidecars while scoped eligibility can still issue new quotes.
SET search_path TO bitpos,extensions,public;
CREATE TABLE ai_generation_jobs(
 merchant_id uuid NOT NULL REFERENCES merchants,id uuid NOT NULL DEFAULT gen_random_uuid(),state text NOT NULL CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CONFIGURATION_REQUIRED')),
 actor_id text NOT NULL,input jsonb NOT NULL,products jsonb NOT NULL,blocker text,campaign_id uuid,provenance jsonb,validated_output jsonb,
 lease_id uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),reserved_microusd bigint NOT NULL DEFAULT 0 CHECK(reserved_microusd>=0),budget_day date,
 provider_origin text,provider_model text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 PRIMARY KEY(merchant_id,id),CHECK((state='RUNNING')=(lease_id IS NOT NULL AND lease_until IS NOT NULL))
);
-- Global provider/day ceiling: tenant partitioning must not multiply provider spend.
CREATE TABLE ai_provider_budget_days(provider_origin text NOT NULL,day date NOT NULL,reserved_microusd bigint NOT NULL DEFAULT 0 CHECK(reserved_microusd>=0),PRIMARY KEY(provider_origin,day));
REVOKE ALL ON ai_provider_budget_days FROM PUBLIC,bitpos_app;
CREATE FUNCTION reserve_promotion_budget(p_merchant uuid,p_job uuid,p_origin text,p_model text,p_job_cap bigint,p_daily_cap bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF p_merchant::text IS DISTINCT FROM current_setting('bitpos.merchant',true) OR p_job_cap<=0 OR p_daily_cap<p_job_cap OR p_origin !~ '^https://' THEN RAISE EXCEPTION 'invalid AI budget boundary' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM ai_generation_jobs WHERE merchant_id=p_merchant AND id=p_job AND state='QUEUED' AND attempts=0 AND reserved_microusd=0 FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO ai_provider_budget_days(provider_origin,day) VALUES(p_origin,current_date) ON CONFLICT DO NOTHING;
 UPDATE ai_provider_budget_days SET reserved_microusd=reserved_microusd+p_job_cap WHERE provider_origin=p_origin AND day=current_date AND reserved_microusd+p_job_cap<=p_daily_cap;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE ai_generation_jobs SET reserved_microusd=p_job_cap,budget_day=current_date,provider_origin=p_origin,provider_model=p_model WHERE merchant_id=p_merchant AND id=p_job;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION reserve_promotion_budget(uuid,uuid,text,text,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_promotion_budget(uuid,uuid,text,text,bigint,bigint) TO bitpos_app;
CREATE TABLE promotion_assets(
 merchant_id uuid NOT NULL REFERENCES merchants,token text NOT NULL CHECK(token ~ '^[A-Za-z0-9_-]{43}$'),image bytea NOT NULL CHECK(octet_length(image)=112000),preview bytea NOT NULL CHECK(octet_length(preview) BETWEEN 24 AND 524288),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,token),UNIQUE(token)
);
CREATE TABLE promotion_campaigns(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),job_id uuid NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','APPROVED','REVOKED','EXPIRED','FAILED')),
 product_id uuid NOT NULL,headline text NOT NULL CHECK(octet_length(headline) BETWEEN 1 AND 160),copy text NOT NULL CHECK(octet_length(copy) BETWEEN 1 AND 360),rationale text NOT NULL,
 discount_percent integer NOT NULL CHECK(discount_percent BETWEEN 1 AND 99),max_discount_percent integer NOT NULL CHECK(max_discount_percent BETWEEN discount_percent AND 99),
 snapshot jsonb NOT NULL,starts_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,asset_token text,asset_blocker text,provenance jsonb NOT NULL,approved_version integer,approved_by text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,job_id),FOREIGN KEY(merchant_id,job_id) REFERENCES ai_generation_jobs(merchant_id,id),FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),FOREIGN KEY(merchant_id,asset_token) REFERENCES promotion_assets(merchant_id,token),CHECK(isfinite(starts_at) AND isfinite(expires_at) AND expires_at>starts_at AND expires_at<=starts_at+interval '7 days'),CHECK(state<>'APPROVED' OR approved_version IS NOT NULL AND approved_version<=version)
);
ALTER TABLE ai_generation_jobs ADD FOREIGN KEY(merchant_id,campaign_id) REFERENCES promotion_campaigns(merchant_id,id);
CREATE TABLE promotion_revisions(
 merchant_id uuid NOT NULL,campaign_id uuid NOT NULL,version integer NOT NULL,content jsonb NOT NULL,approved_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,campaign_id,version),FOREIGN KEY(merchant_id,campaign_id) REFERENCES promotion_campaigns(merchant_id,id)
);
CREATE TABLE promotion_targets(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL,campaign_version integer NOT NULL,target_device_id uuid NOT NULL,entry_id uuid NOT NULL,
 assignment_generation bigint NOT NULL CHECK(assignment_generation>0),auth_generation bigint NOT NULL CHECK(auth_generation>0),screen_generation bigint NOT NULL CHECK(screen_generation>0),guest_generation bigint NOT NULL CHECK(guest_generation>=0),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','DELIVERED','RENDERED','EXPIRED','REVOKED','FAILED')),failure text,offer_token text NOT NULL DEFAULT translate(rtrim(encode(gen_random_bytes(32),'base64'),'='),'+/','-_') CHECK(offer_token ~ '^[A-Za-z0-9_-]{43}$'),
 asset_token text,menu_url text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_event_id uuid,last_connection_generation bigint,cancel_event_id uuid,rendered_at timestamptz,
 PRIMARY KEY(merchant_id,id),UNIQUE(offer_token),FOREIGN KEY(merchant_id,campaign_id,campaign_version) REFERENCES promotion_revisions(merchant_id,campaign_id,version),FOREIGN KEY(merchant_id,target_device_id) REFERENCES devices(merchant_id,id),FOREIGN KEY(merchant_id,entry_id) REFERENCES table_entries(merchant_id,id),FOREIGN KEY(merchant_id,asset_token) REFERENCES promotion_assets(merchant_id,token),FOREIGN KEY(merchant_id,last_event_id) REFERENCES outbox_events(merchant_id,id),FOREIGN KEY(merchant_id,cancel_event_id) REFERENCES outbox_events(merchant_id,id),CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX one_active_campaign_target ON promotion_targets(merchant_id,campaign_id) WHERE state IN ('QUEUED','DELIVERED','RENDERED');
CREATE UNIQUE INDEX one_active_device_promotion ON promotion_targets(merchant_id,target_device_id) WHERE state IN ('QUEUED','DELIVERED','RENDERED');
CREATE TABLE promotion_requests(merchant_id uuid NOT NULL REFERENCES merchants,idempotency_key text NOT NULL CHECK(octet_length(idempotency_key) BETWEEN 1 AND 128),request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(merchant_id,idempotency_key));
ALTER TABLE table_visits ADD COLUMN promotion_offer_token text CHECK(promotion_offer_token ~ '^[A-Za-z0-9_-]{43}$');
CREATE TABLE scoped_offer_eligibility(
 merchant_id uuid NOT NULL,target_id uuid NOT NULL,session_id uuid NOT NULL,visit_id uuid,order_id uuid,quantity_limit integer NOT NULL DEFAULT 1 CHECK(quantity_limit=1),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,target_id),UNIQUE(merchant_id,session_id),FOREIGN KEY(merchant_id,target_id) REFERENCES promotion_targets(merchant_id,id),FOREIGN KEY(merchant_id,session_id) REFERENCES device_sessions(merchant_id,id),FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE TABLE quote_scoped_promotions(merchant_id uuid NOT NULL,quote_id uuid NOT NULL,product_id uuid NOT NULL,target_id uuid NOT NULL,evidence jsonb NOT NULL,PRIMARY KEY(merchant_id,quote_id,product_id),FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),FOREIGN KEY(merchant_id,target_id) REFERENCES promotion_targets(merchant_id,id));
CREATE TABLE order_scoped_promotions(merchant_id uuid NOT NULL,order_id uuid NOT NULL,product_id uuid NOT NULL,quote_id uuid NOT NULL,target_id uuid NOT NULL,evidence jsonb NOT NULL,PRIMARY KEY(merchant_id,order_id,product_id),UNIQUE(merchant_id,target_id),FOREIGN KEY(merchant_id,order_id,product_id) REFERENCES order_line_prices(merchant_id,order_id,product_id),FOREIGN KEY(merchant_id,quote_id,product_id) REFERENCES quote_scoped_promotions(merchant_id,quote_id,product_id),FOREIGN KEY(merchant_id,target_id) REFERENCES scoped_offer_eligibility(merchant_id,target_id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ai_generation_jobs','promotion_assets','promotion_campaigns','promotion_revisions','promotion_targets','promotion_requests','scoped_offer_eligibility','quote_scoped_promotions','order_scoped_promotions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['promotion_assets','promotion_revisions','promotion_requests','quote_scoped_promotions','order_scoped_promotions'] LOOP EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_authority_row()',t); END LOOP;
END $$;
CREATE FUNCTION promotion_binding_current(p_merchant uuid,p_target uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM promotion_targets p JOIN devices d ON d.merchant_id=p.merchant_id AND d.id=p.target_device_id JOIN table_entries e ON e.merchant_id=p.merchant_id AND e.id=p.entry_id JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id WHERE p.merchant_id=p_merchant AND p.id=p_target AND d.revoked_at IS NULL AND t.retired_at IS NULL AND d.assignment_generation=p.assignment_generation AND d.auth_generation=p.auth_generation AND d.table_id=e.table_id AND e.device_id=d.id AND e.assignment_generation=p.assignment_generation AND e.auth_generation=p.auth_generation)
$$;
CREATE FUNCTION promotion_eligible(p_merchant uuid,p_target uuid,p_session uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM promotion_targets t JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id JOIN scoped_offer_eligibility e ON e.merchant_id=t.merchant_id AND e.target_id=t.id JOIN device_sessions s ON s.merchant_id=e.merchant_id AND s.id=e.session_id JOIN device_screen_state d ON d.merchant_id=s.merchant_id AND d.device_id=s.device_id WHERE t.merchant_id=p_merchant AND t.id=p_target AND e.session_id=p_session AND e.order_id IS NULL AND s.ended_at IS NULL AND s.device_id=t.target_device_id AND s.assignment_generation=t.assignment_generation AND d.kind='cart' AND d.session_id=s.id AND d.lease_until>clock_timestamp() AND t.state IN ('DELIVERED','RENDERED') AND t.expires_at>clock_timestamp() AND c.state='APPROVED' AND c.approved_version=t.campaign_version AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND promotion_binding_current(t.merchant_id,t.id))
$$;
REVOKE ALL ON FUNCTION promotion_binding_current(uuid,uuid),promotion_eligible(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promotion_binding_current(uuid,uuid),promotion_eligible(uuid,uuid,uuid) TO bitpos_app;
CREATE FUNCTION guard_promotion_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF ROW(NEW.merchant_id,NEW.id,NEW.campaign_id,NEW.campaign_version,NEW.target_device_id,NEW.entry_id,NEW.assignment_generation,NEW.auth_generation,NEW.screen_generation,NEW.guest_generation,NEW.offer_token,NEW.asset_token,NEW.menu_url,NEW.expires_at) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.campaign_id,OLD.campaign_version,OLD.target_device_id,OLD.entry_id,OLD.assignment_generation,OLD.auth_generation,OLD.screen_generation,OLD.guest_generation,OLD.offer_token,OLD.asset_token,OLD.menu_url,OLD.expires_at) THEN RAISE EXCEPTION 'immutable promotion target' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER promotion_target_identity BEFORE UPDATE ON promotion_targets FOR EACH ROW EXECUTE FUNCTION guard_promotion_binding();
CREATE FUNCTION guard_scoped_eligibility() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.merchant_id,NEW.target_id,NEW.session_id,NEW.visit_id,NEW.quantity_limit) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.target_id,OLD.session_id,OLD.visit_id,OLD.quantity_limit) OR OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN RAISE EXCEPTION 'immutable scoped binding' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM promotion_targets t JOIN device_sessions s ON s.merchant_id=t.merchant_id AND s.id=NEW.session_id JOIN device_screen_state d ON d.merchant_id=s.merchant_id AND d.device_id=s.device_id JOIN devices dev ON dev.merchant_id=s.merchant_id AND dev.id=s.device_id WHERE t.merchant_id=NEW.merchant_id AND t.id=NEW.target_id AND s.device_id=t.target_device_id AND s.ended_at IS NULL AND d.kind='cart' AND d.session_id=s.id AND d.lease_until>clock_timestamp() AND s.assignment_generation=t.assignment_generation AND s.public_visit_id IS NOT DISTINCT FROM NEW.visit_id AND (NEW.visit_id IS NULL AND dev.pickup_guest_generation=t.guest_generation OR NEW.visit_id IS NOT NULL AND s.pickup_guest_generation=t.guest_generation+1 AND dev.pickup_guest_generation=s.pickup_guest_generation) AND t.state IN ('DELIVERED','RENDERED') AND t.expires_at>clock_timestamp() AND promotion_binding_current(t.merchant_id,t.id)) THEN RAISE EXCEPTION 'invalid acquired promotion session' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER scoped_binding BEFORE INSERT OR UPDATE ON scoped_offer_eligibility FOR EACH ROW EXECUTE FUNCTION guard_scoped_eligibility();
CREATE FUNCTION resolve_promotion_media(p_token text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$ SELECT a.merchant_id FROM promotion_assets a WHERE a.token=p_token AND (EXISTS(SELECT 1 FROM promotion_campaigns c WHERE c.merchant_id=a.merchant_id AND c.asset_token=a.token AND c.state IN ('DRAFT','APPROVED') AND c.expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM promotion_targets t WHERE t.merchant_id=a.merchant_id AND t.asset_token=a.token AND t.state IN ('QUEUED','DELIVERED','RENDERED') AND t.expires_at>clock_timestamp())) $$;
CREATE FUNCTION promotion_work_queue() RETURNS TABLE(merchant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$ SELECT DISTINCT merchant_id FROM ai_generation_jobs WHERE state IN ('QUEUED','RUNNING') UNION SELECT DISTINCT merchant_id FROM promotion_targets WHERE state IN ('QUEUED','DELIVERED','RENDERED') $$;
REVOKE ALL ON FUNCTION resolve_promotion_media(text),promotion_work_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_promotion_media(text),promotion_work_queue() TO bitpos_app;
