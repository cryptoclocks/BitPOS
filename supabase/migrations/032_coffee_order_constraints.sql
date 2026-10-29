-- New Coffee Copilot scope. Apply after 029/030/031 transactionally with backup.
-- Rollback: disable new proposal/repeat/grant admission, retain all immutable
-- quote/order/payment evidence and reconcile signed attempts. Never drop history.
SET search_path TO bitpos,extensions,public;
CREATE TABLE merchant_collection_policy(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,counter_enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE quote_coffee_constraints(
 merchant_id uuid NOT NULL,quote_id uuid NOT NULL,collection text NOT NULL CHECK(collection IN ('table','counter')),
 collection_policy_version integer NOT NULL CHECK(collection_policy_version>0),
 reviewed_asset jsonb,reviewed_settlement jsonb,reviewed_grant_id uuid,reviewed_session_id uuid,reviewed_expires_at timestamptz,
 repeat_source_order_id uuid,repeat_recipient text,repeat_max_atomic numeric(20,0),repeat_expires_at timestamptz,
 PRIMARY KEY(merchant_id,quote_id),FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),
 FOREIGN KEY(merchant_id,repeat_source_order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,reviewed_grant_id) REFERENCES delegated_grants(merchant_id,id),
 FOREIGN KEY(merchant_id,reviewed_session_id) REFERENCES delegated_owner_sessions(merchant_id,id),
 CHECK((reviewed_asset IS NULL)=(reviewed_settlement IS NULL)),
 CHECK((reviewed_grant_id IS NULL AND reviewed_session_id IS NULL AND reviewed_expires_at IS NULL)
 OR (reviewed_grant_id IS NOT NULL AND reviewed_session_id IS NOT NULL AND reviewed_asset IS NOT NULL AND reviewed_expires_at IS NOT NULL AND isfinite(reviewed_expires_at))),
 CHECK((repeat_source_order_id IS NULL AND repeat_recipient IS NULL AND repeat_max_atomic IS NULL AND repeat_expires_at IS NULL)
 OR (repeat_source_order_id IS NOT NULL AND reviewed_asset IS NOT NULL AND reviewed_settlement IS NOT NULL AND repeat_recipient IS NOT NULL AND repeat_max_atomic BETWEEN 1 AND 18446744073709551615 AND repeat_expires_at IS NOT NULL AND isfinite(repeat_expires_at)))
);
CREATE TABLE order_coffee_constraints(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,quote_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,order_id),UNIQUE(merchant_id,quote_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES quote_coffee_constraints(merchant_id,quote_id)
);
CREATE TABLE repeat_quote_requests(
 merchant_id uuid NOT NULL,visit_id uuid NOT NULL,request_id uuid NOT NULL,input_hash text NOT NULL,quote_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,visit_id,request_id),FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES quote_coffee_constraints(merchant_id,quote_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_collection_policy','quote_coffee_constraints','order_coffee_constraints','repeat_quote_requests'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['quote_coffee_constraints','order_coffee_constraints','repeat_quote_requests'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_authority_row()',t);
 END LOOP;
END $$;
CREATE FUNCTION guard_coffee_order_constraint() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id AND a.quote_id=NEW.quote_id) THEN
  RAISE EXCEPTION 'coffee constraint does not match reviewed order' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coffee_order_binding BEFORE INSERT ON order_coffee_constraints FOR EACH ROW EXECUTE FUNCTION guard_coffee_order_constraint();
-- Deferred guard prevents alternate routed-order writers dropping reviewed caps.
CREATE FUNCTION require_coffee_order_constraint() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM quote_coffee_constraints q WHERE q.merchant_id=NEW.merchant_id AND q.quote_id=NEW.quote_id)
 AND NOT EXISTS(SELECT 1 FROM order_coffee_constraints c WHERE c.merchant_id=NEW.merchant_id AND c.order_id=NEW.order_id AND c.quote_id=NEW.quote_id) THEN
  RAISE EXCEPTION 'reviewed coffee constraints missing from order' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER coffee_order_required AFTER INSERT ON order_authority DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_coffee_order_constraint();
-- Keep the existing frame shape and heartbeat/read ownership. Only a new
-- reviewed cart's denomination/expiry changes; existing bills remain frozen.
CREATE OR REPLACE FUNCTION bitpos.device_current_screen_data(p_merchant uuid,p_device uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT to_jsonb(data) FROM (
  SELECT s.kind,s.screen_generation::text,d.assignment_generation::text,s.lease_until,
   c.id AS session_id,c.cart_version::text,c.cart,
   CASE WHEN rq.id IS NOT NULL THEN to_jsonb(rq)||jsonb_build_object('total_minor',rq.total_minor::text,'cart_version',rq.cart_version::text,'pricing_revision',rq.pricing_revision::text,'settlement',coalesce(rc.reviewed_settlement,rq.settlement),'valid_until',least(rq.valid_until,rc.repeat_expires_at,rc.reviewed_expires_at)) END AS review,
   o.id AS order_id,o.status,o.version,o.quote_expires_at,o.access_token,o.reservation_released,o.recovery_resolved_at,o.closure_reason,
   o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') AND bitpos.unpaid_order_safe(p_merchant,o.id) AS can_cancel,
   CASE WHEN oa.order_id IS NOT NULL THEN to_jsonb(oa)||jsonb_build_object('target_assignment_generation',oa.target_assignment_generation::text,'creation_pairing_generation',oa.creation_pairing_generation::text,'screen_generation',oa.screen_generation::text,'total_minor',oa.total_minor::text,'settlement',bitpos.effective_payment_settlement(p_merchant,o.id)) END AS authority,
   q.lines,EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=s.merchant_id AND p.order_id=o.id AND p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')) AS ambiguous,
   EXISTS(SELECT 1 FROM device_event_deliveries dd JOIN outbox_events e ON e.merchant_id=dd.merchant_id AND e.id=dd.event_id WHERE dd.merchant_id=s.merchant_id AND dd.device_id=s.device_id AND e.order_id=o.id AND e.order_version=o.version AND dd.status='rendered') AS rendered
  FROM device_screen_state s
  JOIN devices d ON d.merchant_id=s.merchant_id AND d.id=s.device_id
  LEFT JOIN device_sessions c ON c.merchant_id=s.merchant_id AND c.id=s.session_id
  LEFT JOIN order_quotes rq ON rq.merchant_id=c.merchant_id AND rq.id=c.review_quote_id
  LEFT JOIN quote_coffee_constraints rc ON rc.merchant_id=rq.merchant_id AND rc.quote_id=rq.id
  LEFT JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id
  LEFT JOIN order_authority oa ON oa.merchant_id=o.merchant_id AND oa.order_id=o.id
  LEFT JOIN order_quotes q ON q.merchant_id=oa.merchant_id AND q.id=oa.quote_id
  WHERE s.merchant_id=p_merchant AND s.device_id=p_device
 ) data;
$$;
