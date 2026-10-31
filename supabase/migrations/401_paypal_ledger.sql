-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
-- PayPal payment ledger, kept beside (not inside) the Solana payment_attempts/payments tables, whose columns are
-- Solana facts (signature, mint, program) that a PayPal payment does not have. One order can be paid by one channel:
-- a live PayPal checkout blocks new Solana attempts (trigger below) and the PayPal path refuses while a Solana attempt
-- is live (checked under the order row lock in the API). Both paths lock the order row first.
SET search_path TO bitpos,extensions,public;

CREATE TABLE paypal_checkouts(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 quote_id uuid NOT NULL,
 order_version integer NOT NULL CHECK(order_version>0),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 payee_merchant_id text NOT NULL CHECK(payee_merchant_id ~ '^[A-Z0-9]{13}$'),
 create_request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 capture_request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 invoice_id text NOT NULL UNIQUE CHECK(invoice_id ~ '^BP[0-9a-f]{32}$'),
 paypal_order_id text UNIQUE CHECK(paypal_order_id ~ '^[A-Z0-9]{10,30}$'),
 status text NOT NULL DEFAULT 'CREATING' CHECK(status IN ('CREATING','CREATED','APPROVED','CAPTURING','CAPTURED','PENDING','UNKNOWN','DECLINED','EXPIRED','FAILED_CREATE','MISMATCH')),
 last_issue text CHECK(length(last_issue)<=120),
 last_debug_id text CHECK(length(last_debug_id)<=64),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_check_at timestamptz,
 cancelled_at timestamptz,
 approved_at timestamptz,
 capture_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),
 FOREIGN KEY(merchant_id) REFERENCES paypal_merchant_settings(merchant_id),
 CHECK(invoice_id='BP'||replace(id::text,'-','')),
 CHECK(status IN ('CREATING','FAILED_CREATE') OR paypal_order_id IS NOT NULL),
 CHECK(expires_at>created_at)
);
-- At most one checkout per order that can still change; terminal ones stay as history.
CREATE UNIQUE INDEX paypal_one_live_checkout ON paypal_checkouts(merchant_id,order_id) WHERE status IN ('CREATING','CREATED','APPROVED','CAPTURING','PENDING','UNKNOWN');
CREATE INDEX paypal_checkouts_due ON paypal_checkouts(merchant_id,next_check_at) WHERE status IN ('CREATING','APPROVED','CAPTURING','PENDING','UNKNOWN');

-- Identity, money and attribution never change; terminal states never change.
CREATE FUNCTION paypal_checkout_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF (NEW.merchant_id,NEW.id,NEW.order_id,NEW.quote_id,NEW.order_version,NEW.amount_cents,NEW.currency,NEW.payee_merchant_id,NEW.create_request_id,NEW.capture_request_id,NEW.invoice_id,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM (OLD.merchant_id,OLD.id,OLD.order_id,OLD.quote_id,OLD.order_version,OLD.amount_cents,OLD.currency,OLD.payee_merchant_id,OLD.create_request_id,OLD.capture_request_id,OLD.invoice_id,OLD.created_at,OLD.expires_at)
  OR OLD.paypal_order_id IS NOT NULL AND NEW.paypal_order_id IS DISTINCT FROM OLD.paypal_order_id THEN
  RAISE EXCEPTION 'PAYPAL_CHECKOUT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF OLD.status IN ('CAPTURED','DECLINED','EXPIRED','FAILED_CREATE','MISMATCH') AND NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'PAYPAL_CHECKOUT_TERMINAL' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER paypal_checkout_guard BEFORE UPDATE ON paypal_checkouts FOR EACH ROW EXECUTE FUNCTION paypal_checkout_guard();

CREATE TABLE paypal_captures(
 merchant_id uuid NOT NULL,
 capture_id text NOT NULL UNIQUE CHECK(capture_id ~ '^[A-Z0-9]{10,30}$'),
 checkout_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('COMPLETED','PENDING','DECLINED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
 status_reason text CHECK(length(status_reason)<=80),
 gross_cents bigint NOT NULL CHECK(gross_cents>0),
 fee_cents bigint CHECK(fee_cents>=0),
 net_cents bigint,
 currency text NOT NULL CHECK(currency='USD'),
 payee_merchant_id text NOT NULL CHECK(payee_merchant_id ~ '^[A-Z0-9]{13}$'),
 verified_via text NOT NULL CHECK(verified_via IN ('capture_response','order_lookup','capture_lookup')),
 verified boolean NOT NULL,
 mismatch text[],
 redacted jsonb NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,capture_id),
 FOREIGN KEY(merchant_id,checkout_id) REFERENCES paypal_checkouts(merchant_id,id),
 CHECK(verified=(mismatch IS NULL))
);
-- PayPal returns the one capture again on replays; a second capture id for the same checkout is an anomaly.
CREATE UNIQUE INDEX paypal_one_capture_per_checkout ON paypal_captures(merchant_id,checkout_id);

CREATE TABLE paypal_settlements(
 merchant_id uuid NOT NULL,
 capture_id text NOT NULL,
 order_id uuid NOT NULL,
 checkout_id uuid NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 state text NOT NULL CHECK(state IN ('SETTLED','RECOVERY')),
 recovery_reason text CHECK(recovery_reason IN ('LATE','ALREADY_PAID','RESERVATION_RELEASED','ACCEPTANCE_ENDED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,capture_id),
 FOREIGN KEY(merchant_id,capture_id) REFERENCES paypal_captures(merchant_id,capture_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,checkout_id) REFERENCES paypal_checkouts(merchant_id,id),
 CHECK((state='SETTLED')=(recovery_reason IS NULL))
);
-- One settled PayPal payment per order; any second real payment is kept as RECOVERY, never dropped.
CREATE UNIQUE INDEX paypal_one_settled_per_order ON paypal_settlements(merchant_id,order_id) WHERE state='SETTLED';

-- Refunds/reversals after settlement are separate facts; they never rewrite the bill, stock or paid display.
CREATE TABLE paypal_payment_events(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 capture_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('REFUNDED','PARTIALLY_REFUNDED','REVERSED','DENIED_AFTER_SETTLE')),
 amount_cents bigint CHECK(amount_cents>0),
 source_event_id text CHECK(length(source_event_id)<=100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,source_event_id),
 FOREIGN KEY(merchant_id,capture_id) REFERENCES paypal_captures(merchant_id,capture_id)
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['paypal_checkouts','paypal_captures','paypal_settlements','paypal_payment_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON paypal_checkouts,paypal_captures TO bitpos_app;
GRANT SELECT,INSERT ON paypal_settlements,paypal_payment_events TO bitpos_app;

-- Mutex, Solana side: no new Solana attempt while a PayPal checkout for the order is live or captured.
CREATE FUNCTION paypal_block_solana_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 PERFORM 1 FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM paypal_checkouts c WHERE c.merchant_id=NEW.merchant_id AND c.order_id=NEW.order_id
   AND c.status IN ('CREATING','CREATED','APPROVED','CAPTURING','PENDING','UNKNOWN','CAPTURED')) THEN
  RAISE EXCEPTION 'PAYMENT_PENDING' USING ERRCODE='55P03',DETAIL='paypal';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paypal_block_solana_attempt BEFORE INSERT ON payment_attempts FOR EACH ROW EXECUTE FUNCTION paypal_block_solana_attempt();

-- Pre-existing function (migration 055), extended: an order is not safe to close/expire while PayPal may be moving money
-- (capture sent or outcome unknown) or after a capture that is not yet settled. Body otherwise unchanged.
CREATE OR REPLACE FUNCTION bitpos.unpaid_order_safe(p_merchant uuid,p_order uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.merchant_id=p_merchant AND o.id=p_order
 AND (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','EXPIRED')
 OR (o.status='CONFIRMING' AND bitpos.online_acceptance_ended(p_merchant,p_order)
 AND NOT EXISTS(SELECT 1 FROM payments WHERE merchant_id=p_merchant AND order_id=p_order)))
 AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id
 AND NOT (p.status IN ('EXPIRED','FAILED','REJECTED') AND p.failure_reconciled_at IS NOT NULL)
 AND (p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL OR p.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED')
 OR (p.transaction_base64 IS NOT NULL AND p.status NOT IN ('EXPIRED','FAILED','REJECTED'))))
 AND NOT EXISTS(SELECT 1 FROM bitpos.paypal_checkouts c WHERE c.merchant_id=o.merchant_id AND c.order_id=o.id
 AND c.status IN ('CAPTURING','PENDING','UNKNOWN','CAPTURED'))
 AND NOT EXISTS(SELECT 1 FROM bitpos.paypal_settlements s WHERE s.merchant_id=o.merchant_id AND s.order_id=o.id));
$$;
REVOKE ALL ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) TO bitpos_app;
