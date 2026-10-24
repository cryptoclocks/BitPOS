-- Additive guards: existing quote_money, bill_snapshot, line_price_snapshot,
-- attempt proof, settlement routines and immutable financial triggers stay intact.
SET search_path TO bitpos,public;
CREATE FUNCTION guard_scoped_quote_line() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE l jsonb;t promotion_targets;c promotion_campaigns;price bigint;base bigint;effective bigint;offer versioned_product_offers;
BEGIN
 FOR l IN SELECT value FROM jsonb_array_elements(NEW.lines) WHERE value ? 'scopedPromotion' LOOP
  SELECT * INTO STRICT t FROM promotion_targets WHERE merchant_id=NEW.merchant_id AND id=(l->'scopedPromotion'->>'targetId')::uuid;
  SELECT * INTO STRICT c FROM promotion_campaigns WHERE merchant_id=t.merchant_id AND id=t.campaign_id;
  SELECT cp.unit_minor INTO STRICT base FROM catalog_prices cp JOIN merchant_pricing m ON m.merchant_id=cp.merchant_id AND m.active_price_version_id=cp.price_version_id WHERE cp.merchant_id=NEW.merchant_id AND cp.product_id=c.product_id AND cp.price_version_id=NEW.price_version_id;
  effective:=base;
  SELECT * INTO offer FROM versioned_product_offers WHERE merchant_id=NEW.merchant_id AND product_id=c.product_id AND price_version_id=NEW.price_version_id ORDER BY revision DESC LIMIT 1;
  IF offer.enabled AND offer.expires_at>clock_timestamp() THEN effective:=offer.current_minor; END IF;
  price:=base-floor(base::numeric*c.discount_percent/100)::bigint;
  -- Generated authority columns are computed after BEFORE triggers; inspect the
  -- canonical JSON here and let their existing composite foreign keys run later.
  IF NEW.origin_kind<>'device' OR NEW.session_id IS NULL OR NEW.source_device_id IS DISTINCT FROM t.target_device_id OR (NEW.authority->'target'->>'deviceId')::uuid IS DISTINCT FROM t.target_device_id OR (NEW.authority->'serving'->>'tableId')::uuid IS DISTINCT FROM (SELECT table_id FROM table_entries WHERE merchant_id=t.merchant_id AND id=t.entry_id)
   OR NOT promotion_eligible(NEW.merchant_id,t.id,NEW.session_id) OR (l->>'qty')::integer IS DISTINCT FROM 1 OR l->>'productId' IS DISTINCT FROM c.product_id::text OR l->'promotion' IS DISTINCT FROM 'null'::jsonb
   OR l->'scopedPromotion' IS DISTINCT FROM jsonb_build_object('targetId',t.id::text,'campaignId',c.id::text,'campaignVersion',t.campaign_version,'sessionId',NEW.session_id::text,'discountPercent',c.discount_percent,'expiresAt',l->'scopedPromotion'->>'expiresAt')
   OR (l->'scopedPromotion'->>'expiresAt')::timestamptz IS DISTINCT FROM t.expires_at OR NEW.valid_until>t.expires_at OR NEW.price_version_id::text IS DISTINCT FROM (c.snapshot->>'priceVersion')
   OR price<=0 OR price>=effective OR (l->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base OR (l->'unitPrice'->>'amountMinor')::bigint IS DISTINCT FROM price
   OR l->'basePrice'->>'currency' IS DISTINCT FROM l->'unitPrice'->>'currency' OR l->'basePrice'->>'decimals' IS DISTINCT FROM l->'unitPrice'->>'decimals'
   OR NOT EXISTS(SELECT 1 FROM products p WHERE p.merchant_id=NEW.merchant_id AND p.id=c.product_id AND p.stock-p.reserved>=1)
  THEN RAISE EXCEPTION 'invalid scoped quote price or binding' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER scoped_quote_price BEFORE INSERT ON order_quotes FOR EACH ROW EXECUTE FUNCTION guard_scoped_quote_line();
CREATE FUNCTION guard_scoped_quote_sidecar() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_quotes q CROSS JOIN LATERAL jsonb_array_elements(q.lines) l WHERE q.merchant_id=NEW.merchant_id AND q.id=NEW.quote_id AND l->>'productId'=NEW.product_id::text AND l->'scopedPromotion'=NEW.evidence AND NEW.evidence->>'targetId'=NEW.target_id::text) THEN RAISE EXCEPTION 'scoped quote evidence mismatch' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER scoped_quote_sidecar BEFORE INSERT ON quote_scoped_promotions FOR EACH ROW EXECUTE FUNCTION guard_scoped_quote_sidecar();
CREATE FUNCTION guard_scoped_order_sidecar() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_authority a JOIN quote_scoped_promotions q ON q.merchant_id=a.merchant_id AND q.quote_id=a.quote_id JOIN scoped_offer_eligibility e ON e.merchant_id=q.merchant_id AND e.target_id=q.target_id WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id AND a.quote_id=NEW.quote_id AND q.product_id=NEW.product_id AND q.target_id=NEW.target_id AND q.evidence=NEW.evidence AND e.order_id=NEW.order_id AND e.session_id::text=NEW.evidence->>'sessionId') THEN RAISE EXCEPTION 'scoped bill evidence mismatch' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER scoped_order_sidecar BEFORE INSERT ON order_scoped_promotions FOR EACH ROW EXECUTE FUNCTION guard_scoped_order_sidecar();
CREATE FUNCTION guard_scoped_quote_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.lines) l WHERE l ? 'scopedPromotion')<>(SELECT count(*) FROM quote_scoped_promotions q WHERE q.merchant_id=NEW.merchant_id AND q.quote_id=NEW.id) THEN RAISE EXCEPTION 'missing scoped quote provenance' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scoped_quote_complete AFTER INSERT ON order_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_scoped_quote_complete();
CREATE FUNCTION guard_scoped_bill_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.id AND (SELECT count(*) FROM jsonb_array_elements(q.lines) l WHERE l ? 'scopedPromotion')<>(SELECT count(*) FROM order_scoped_promotions s WHERE s.merchant_id=NEW.merchant_id AND s.order_id=NEW.id)) THEN RAISE EXCEPTION 'missing immutable scoped bill provenance' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scoped_bill_complete AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_scoped_bill_complete();
-- Preserve all existing authenticated final-send checks. Both normal delivery and
-- render ACK execute this additional predicate under the same routing mutex.
ALTER FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) RENAME TO device_validate_send_pre_promotion;
CREATE FUNCTION device_validate_send(p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,p_connection_generation bigint,p_connection_id uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE result jsonb;allowed boolean; BEGIN
 result:=device_validate_send_pre_promotion(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id,p_event);
 IF NOT (result->>'allowed')::boolean OR p_event IS NULL THEN RETURN result; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM outbox_events event WHERE event.merchant_id=p_merchant AND event.id=p_event AND event.type='PROMOTION' AND NOT EXISTS(
  SELECT 1 FROM promotion_targets t JOIN devices d ON d.merchant_id=t.merchant_id AND d.id=t.target_device_id JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id JOIN device_capabilities cap ON cap.merchant_id=d.merchant_id AND cap.device_id=d.id JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id
  WHERE t.merchant_id=p_merchant AND t.id::text=event.payload->'payload'->>'targetId' AND t.campaign_id::text=event.payload->'payload'->>'campaignId' AND t.target_device_id=p_device
   AND t.assignment_generation=d.assignment_generation AND t.auth_generation=d.auth_generation AND event.payload->>'authGeneration'=t.auth_generation::text
   AND s.kind='idle' AND s.screen_generation=t.screen_generation AND event.screen_generation=t.screen_generation AND cap.connection_generation=p_connection_generation AND 'promotion_v1'=ANY(cap.capabilities)
   AND ((event.payload->'payload'->>'state'='CANCELED' AND t.cancel_event_id=event.id AND t.state IN ('REVOKED','EXPIRED','FAILED')) OR
    (event.payload->'payload'->>'state'='READY' AND t.last_event_id=event.id AND t.last_connection_generation=p_connection_generation AND t.state IN ('DELIVERED','RENDERED') AND t.expires_at>clock_timestamp() AND c.state='APPROVED' AND c.approved_version=t.campaign_version AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND promotion_binding_current(t.merchant_id,t.id) AND d.pickup_guest_generation=t.guest_generation
     AND NOT EXISTS(SELECT 1 FROM scoped_offer_eligibility e WHERE e.merchant_id=t.merchant_id AND e.target_id=t.id)
     AND NOT EXISTS(SELECT 1 FROM pickup_notifications n WHERE n.merchant_id=t.merchant_id AND n.target_device_id=t.target_device_id AND n.state IN ('PENDING','DELIVERED','RENDERED') AND n.expires_at>clock_timestamp() AND pickup_binding_current(n.merchant_id,n.id))))
 )) INTO allowed;
 IF NOT allowed THEN UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent'; END IF;
 RETURN jsonb_set(result,'{allowed}',to_jsonb(allowed));
END $$;
REVOKE ALL ON FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) TO bitpos_app;
CREATE FUNCTION guard_scoped_original_screen() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM promotion_targets t JOIN device_screen_state s ON s.merchant_id=t.merchant_id AND s.device_id=t.target_device_id WHERE t.merchant_id=NEW.merchant_id AND t.id=NEW.target_id AND s.kind='cart' AND s.session_id=NEW.session_id AND s.screen_generation=t.screen_generation+1) THEN RAISE EXCEPTION 'scoped offer lost original screen' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER scoped_original_screen BEFORE INSERT ON scoped_offer_eligibility FOR EACH ROW EXECUTE FUNCTION guard_scoped_original_screen();
CREATE FUNCTION guard_visit_offer_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NEW.promotion_offer_token IS DISTINCT FROM OLD.promotion_offer_token THEN RAISE EXCEPTION 'immutable visit offer capability' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER visit_offer_identity BEFORE UPDATE ON table_visits FOR EACH ROW EXECUTE FUNCTION guard_visit_offer_identity();
CREATE FUNCTION guard_generation_job_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF ROW(NEW.merchant_id,NEW.id,NEW.actor_id,NEW.input,NEW.products,NEW.created_at) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.actor_id,OLD.input,OLD.products,OLD.created_at)
 OR NEW.attempts<OLD.attempts OR NEW.reserved_microusd<OLD.reserved_microusd
 OR OLD.state IN ('SUCCEEDED','FAILED','CONFIGURATION_REQUIRED')
 OR OLD.provenance IS NOT NULL AND ROW(NEW.provenance,NEW.validated_output) IS DISTINCT FROM ROW(OLD.provenance,OLD.validated_output)
 THEN RAISE EXCEPTION 'immutable generation input or terminal outcome' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER generation_job_identity BEFORE UPDATE ON ai_generation_jobs FOR EACH ROW EXECUTE FUNCTION guard_generation_job_identity();
