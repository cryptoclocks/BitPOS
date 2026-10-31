-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
-- Café Copilot campaign envelope: the owner-approved limits around one AI-drafted promotion (total units, units per order,
-- end time, discount cap). The promotion itself is a normal BitPOS daily campaign made by the existing generate pipeline;
-- the envelope adds a shop-wide unit cap that the database enforces in the same transaction that creates the order.
SET search_path TO bitpos,extensions,public;

CREATE TABLE paypal_campaign_envelopes(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL,
 campaign_id uuid,
 agent_run_id uuid,
 product_id uuid NOT NULL,
 max_units integer NOT NULL CHECK(max_units BETWEEN 1 AND 500),
 max_units_per_order integer NOT NULL DEFAULT 1 CHECK(max_units_per_order BETWEEN 1 AND 20),
 discount_percent integer NOT NULL CHECK(discount_percent BETWEEN 1 AND 50),
 max_discount_percent integer NOT NULL CHECK(max_discount_percent BETWEEN discount_percent AND 50),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 approved_version integer,
 approved_by text CHECK(length(approved_by)<=200),
 approved_at timestamptz,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','APPROVED','ENDED','REVOKED')),
 ended_reason text CHECK(ended_reason IN ('SOLD_OUT','TIME','REVOKED','STOCK')),
 created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,job_id),
 FOREIGN KEY(merchant_id,job_id) REFERENCES ai_generation_jobs(merchant_id,id),
 FOREIGN KEY(merchant_id,campaign_id) REFERENCES promotion_campaigns(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK(max_units_per_order<=max_units),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'),
 CHECK(state<>'APPROVED' OR approved_version=version AND approved_by IS NOT NULL),
 CHECK((state='ENDED')=(ended_reason IS NOT NULL) OR state='REVOKED')
);
CREATE UNIQUE INDEX paypal_envelope_per_campaign ON paypal_campaign_envelopes(merchant_id,campaign_id) WHERE campaign_id IS NOT NULL;

CREATE TABLE paypal_campaign_units(
 merchant_id uuid NOT NULL,
 envelope_id uuid NOT NULL,
 order_id uuid NOT NULL,
 units integer NOT NULL CHECK(units>0),
 state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN ('RESERVED','CONSUMED','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,envelope_id,order_id),
 FOREIGN KEY(merchant_id,envelope_id) REFERENCES paypal_campaign_envelopes(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE INDEX paypal_campaign_units_order ON paypal_campaign_units(merchant_id,order_id);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['paypal_campaign_envelopes','paypal_campaign_units'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON paypal_campaign_envelopes,paypal_campaign_units TO bitpos_app;

-- Limits are immutable once approved; changing them means a new version that must be approved again.
CREATE FUNCTION paypal_envelope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF (NEW.merchant_id,NEW.id,NEW.job_id,NEW.product_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.merchant_id,OLD.id,OLD.job_id,OLD.product_id,OLD.created_by,OLD.created_at)
  OR OLD.campaign_id IS NOT NULL AND NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
  RAISE EXCEPTION 'PAYPAL_ENVELOPE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF (NEW.max_units,NEW.max_units_per_order,NEW.discount_percent,NEW.max_discount_percent,NEW.starts_at,NEW.ends_at) IS DISTINCT FROM (OLD.max_units,OLD.max_units_per_order,OLD.discount_percent,OLD.max_discount_percent,OLD.starts_at,OLD.ends_at)
  AND (NEW.version<=OLD.version OR NEW.state<>'DRAFT') THEN
  RAISE EXCEPTION 'PAYPAL_ENVELOPE_REAPPROVAL_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('ENDED','REVOKED') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'PAYPAL_ENVELOPE_TERMINAL' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER paypal_envelope_guard BEFORE UPDATE ON paypal_campaign_envelopes FOR EACH ROW EXECUTE FUNCTION paypal_envelope_guard();

-- Reserve units when an order takes the campaign's daily price (same transaction as the order: freezeDailyOrder). The
-- envelope row lock serializes concurrent orders, so the cap counts every reserved and consumed unit, not only paid ones.
CREATE FUNCTION paypal_reserve_campaign_units() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE v_env paypal_campaign_envelopes%ROWTYPE; v_qty integer; v_used bigint;
BEGIN
 SELECT e.* INTO v_env FROM paypal_campaign_envelopes e WHERE e.merchant_id=NEW.merchant_id AND e.campaign_id=NEW.campaign_id FOR UPDATE OF e;
 IF NOT FOUND THEN RETURN NEW; END IF;-- not a Copilot campaign: existing rules only
 IF v_env.state<>'APPROVED' THEN RAISE EXCEPTION 'CAMPAIGN_NOT_ACTIVE' USING ERRCODE='P0001'; END IF;
 IF clock_timestamp()<v_env.starts_at OR clock_timestamp()>=v_env.ends_at THEN RAISE EXCEPTION 'CAMPAIGN_ENDED' USING ERRCODE='P0001'; END IF;
 SELECT i.qty INTO v_qty FROM order_items i WHERE i.merchant_id=NEW.merchant_id AND i.order_id=NEW.order_id AND i.product_id=NEW.product_id;
 v_qty:=coalesce(v_qty,1);
 IF v_qty>v_env.max_units_per_order THEN RAISE EXCEPTION 'CAMPAIGN_ORDER_LIMIT' USING ERRCODE='P0001'; END IF;
 SELECT coalesce(sum(u.units),0) INTO v_used FROM paypal_campaign_units u WHERE u.merchant_id=NEW.merchant_id AND u.envelope_id=v_env.id AND u.state IN ('RESERVED','CONSUMED');
 IF v_used+v_qty>v_env.max_units THEN RAISE EXCEPTION 'CAMPAIGN_SOLD_OUT' USING ERRCODE='P0001'; END IF;
 INSERT INTO paypal_campaign_units(merchant_id,envelope_id,order_id,units) VALUES(NEW.merchant_id,v_env.id,NEW.order_id,v_qty);
 RETURN NEW;
END $$;
CREATE TRIGGER paypal_reserve_campaign_units AFTER INSERT ON daily_order_promotions FOR EACH ROW EXECUTE FUNCTION paypal_reserve_campaign_units();

-- Follow the order's money state, whichever channel paid it: PAID consumes; anything that ends without payment, or a late
-- payment kept as RECOVERY, releases the units back to the cap.
CREATE FUNCTION paypal_campaign_units_follow_order() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.status='PAID' AND OLD.status<>'PAID' THEN
  UPDATE paypal_campaign_units SET state='CONSUMED',updated_at=clock_timestamp() WHERE merchant_id=NEW.merchant_id AND order_id=NEW.id AND state='RESERVED';
  UPDATE paypal_campaign_envelopes e SET state='ENDED',ended_reason='SOLD_OUT'
   WHERE e.merchant_id=NEW.merchant_id AND e.state='APPROVED' AND e.id IN (SELECT envelope_id FROM paypal_campaign_units WHERE merchant_id=NEW.merchant_id AND order_id=NEW.id)
   AND (SELECT coalesce(sum(units),0) FROM paypal_campaign_units u WHERE u.merchant_id=e.merchant_id AND u.envelope_id=e.id AND u.state='CONSUMED')>=e.max_units;
 ELSIF NEW.status IN ('EXPIRED','RECOVERY') AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE paypal_campaign_units SET state='RELEASED',updated_at=clock_timestamp() WHERE merchant_id=NEW.merchant_id AND order_id=NEW.id AND state='RESERVED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paypal_campaign_units_follow_order AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION paypal_campaign_units_follow_order();

-- The PayPal worker also ends Copilot offers: past their end time, or sold out while the campaign is still live.
CREATE OR REPLACE FUNCTION bitpos.paypal_due_merchants() RETURNS TABLE(merchant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT DISTINCT c.merchant_id FROM paypal_checkouts c
 WHERE c.status IN ('CREATING','APPROVED','CAPTURING','PENDING','UNKNOWN') AND (c.next_check_at IS NULL OR c.next_check_at<=clock_timestamp())
 UNION SELECT DISTINCT c.merchant_id FROM paypal_checkouts c WHERE c.status='CREATED' AND c.expires_at<=clock_timestamp()
 UNION SELECT DISTINCT e.merchant_id FROM paypal_campaign_envelopes e WHERE e.state='APPROVED' AND e.ends_at<=clock_timestamp()
 UNION SELECT DISTINCT e.merchant_id FROM paypal_campaign_envelopes e JOIN promotion_campaigns p ON p.merchant_id=e.merchant_id AND p.id=e.campaign_id
  WHERE e.state='ENDED' AND p.state='APPROVED';
$$;
REVOKE ALL ON FUNCTION bitpos.paypal_due_merchants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.paypal_due_merchants() TO bitpos_app;
