-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
-- NEAR payment ledger, kept beside (not inside) the Solana payment_attempts/payments tables. A bill here mirrors one
-- bill in the on-chain contract. One order is paid by one channel: a live NEAR bill blocks new Solana attempts
-- (trigger below) and the NEAR path refuses while a Solana attempt is live (checked under the order row lock).
SET search_path TO bitpos,extensions,public;

CREATE TABLE near_bills(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 quote_id uuid NOT NULL,
 order_version integer NOT NULL CHECK(order_version>0),
 chain_bill_id text NOT NULL UNIQUE CHECK(chain_bill_id ~ '^b[0-9a-f]{32}$'),
 contract text NOT NULL CHECK(contract ~ '^[a-z0-9._-]{2,64}$'),
 merchant_account text NOT NULL CHECK(merchant_account ~ '^[a-z0-9._-]{2,64}$'),
 token_contract text NOT NULL CHECK(token_contract ~ '^[a-z0-9._-]{2,64}$'),
 amount_units bigint NOT NULL CHECK(amount_units BETWEEN 1 AND 100000000000),
 witness_device_id uuid,
 witness_pk text CHECK(witness_pk ~ '^[0-9a-f]{64}$'),
 witness_timeout_ms integer NOT NULL CHECK(witness_timeout_ms BETWEEN 30000 AND 3600000),
 status text NOT NULL DEFAULT 'OPENING' CHECK(status IN ('OPENING','OPEN','ESCROW','SETTLING','SETTLED','PAYOUT_FAILED','REFUNDED','VOID','FAILED_OPEN','MISMATCH')),
 payer text CHECK(payer ~ '^[a-z0-9._-]{2,64}$'),
 open_tx text CHECK(length(open_tx) BETWEEN 32 AND 64),
 pay_tx text CHECK(length(pay_tx) BETWEEN 32 AND 64),
 ack_tx text CHECK(length(ack_tx) BETWEEN 32 AND 64),
 settle_tx text CHECK(length(settle_tx) BETWEEN 32 AND 64),
 refund_tx text CHECK(length(refund_tx) BETWEEN 32 AND 64),
 last_issue text CHECK(length(last_issue)<=160),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_check_at timestamptz,
 paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),
 FOREIGN KEY(merchant_id) REFERENCES near_merchant_settings(merchant_id),
 FOREIGN KEY(merchant_id,witness_device_id) REFERENCES near_devices(merchant_id,id),
 CHECK(chain_bill_id='b'||replace(id::text,'-','')),
 CHECK((witness_pk IS NULL)=(witness_device_id IS NULL)),
 CHECK(status IN ('OPENING','FAILED_OPEN') OR open_tx IS NOT NULL),
 CHECK(expires_at>created_at)
);
-- At most one bill per order that can still change; closed ones stay as history.
CREATE UNIQUE INDEX near_one_live_bill ON near_bills(merchant_id,order_id) WHERE status IN ('OPENING','OPEN','ESCROW','SETTLING','PAYOUT_FAILED');
CREATE INDEX near_bills_due ON near_bills(merchant_id,next_check_at) WHERE status IN ('OPENING','OPEN','ESCROW','SETTLING','PAYOUT_FAILED');

-- Identity, money and attribution never change; closed states never change.
CREATE FUNCTION near_bill_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF (NEW.merchant_id,NEW.id,NEW.order_id,NEW.quote_id,NEW.order_version,NEW.chain_bill_id,NEW.contract,NEW.merchant_account,NEW.token_contract,NEW.amount_units,NEW.witness_device_id,NEW.witness_pk,NEW.witness_timeout_ms,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM (OLD.merchant_id,OLD.id,OLD.order_id,OLD.quote_id,OLD.order_version,OLD.chain_bill_id,OLD.contract,OLD.merchant_account,OLD.token_contract,OLD.amount_units,OLD.witness_device_id,OLD.witness_pk,OLD.witness_timeout_ms,OLD.created_at,OLD.expires_at)
  OR OLD.payer IS NOT NULL AND NEW.payer IS DISTINCT FROM OLD.payer THEN
  RAISE EXCEPTION 'NEAR_BILL_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF OLD.status IN ('SETTLED','REFUNDED','VOID','FAILED_OPEN','MISMATCH') AND NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'NEAR_BILL_TERMINAL' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER near_bill_guard BEFORE UPDATE ON near_bills FOR EACH ROW EXECUTE FUNCTION near_bill_guard();

-- Who this bill pays, frozen when the bill is opened and sent to the contract in the same order.
CREATE TABLE near_payouts(
 merchant_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 seq smallint NOT NULL CHECK(seq BETWEEN 0 AND 9),
 role text NOT NULL CHECK(role IN ('owner','tax','tips','supplier')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 near_account text NOT NULL CHECK(near_account ~ '^[a-z0-9._-]{2,64}$'),
 amount_units bigint NOT NULL CHECK(amount_units>0),
 recipient_id uuid,
 invoice_id uuid,
 paid boolean NOT NULL DEFAULT false,
 PRIMARY KEY(merchant_id,bill_id,seq),
 FOREIGN KEY(merchant_id,bill_id) REFERENCES near_bills(merchant_id,id),
 FOREIGN KEY(merchant_id,recipient_id) REFERENCES near_recipients(merchant_id,id),
 FOREIGN KEY(merchant_id,invoice_id) REFERENCES near_supplier_invoices(merchant_id,id),
 CHECK(invoice_id IS NULL OR role='supplier')
);
CREATE INDEX near_payouts_invoice ON near_payouts(merchant_id,invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TABLE near_settlements(
 merchant_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 order_id uuid NOT NULL,
 amount_units bigint NOT NULL CHECK(amount_units>0),
 state text NOT NULL CHECK(state IN ('SETTLED','RECOVERY')),
 recovery_reason text CHECK(recovery_reason IN ('LATE','ALREADY_PAID','RESERVATION_RELEASED','ACCEPTANCE_ENDED','QUOTE_CHANGED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,bill_id),
 FOREIGN KEY(merchant_id,bill_id) REFERENCES near_bills(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 CHECK((state='SETTLED')=(recovery_reason IS NULL))
);
-- One settled NEAR payment per order; any second real payment is kept as RECOVERY, never dropped.
CREATE UNIQUE INDEX near_one_settled_per_order ON near_settlements(merchant_id,order_id) WHERE state='SETTLED';

-- Evidence timeline: every step of a bill with its transaction hash. Facts only; never rewritten.
CREATE TABLE near_bill_events(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 bill_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('BILL_OPENED','OPEN_FAILED','PAYMENT_RELAYED','PAYMENT_REFUSED','PAYMENT_BOUNCED','PAID_ESCROW','WITNESS_ACK','WITNESS_REFUSED','SETTLED','PAYOUT_FAILED','REFUND_SENT','REFUNDED','VOIDED','MISMATCH','CHAIN_CHECK')),
 tx_hash text CHECK(length(tx_hash) BETWEEN 32 AND 64),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,bill_id) REFERENCES near_bills(merchant_id,id)
);
CREATE INDEX near_bill_events_bill ON near_bill_events(merchant_id,bill_id,created_at);
-- A transaction is recorded once per bill and kind, so replays (page, device, worker) add nothing.
CREATE UNIQUE INDEX near_bill_events_once ON near_bill_events(merchant_id,bill_id,kind,tx_hash) WHERE tx_hash IS NOT NULL;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['near_bills','near_payouts','near_settlements','near_bill_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON near_bills,near_payouts TO bitpos_app;
GRANT SELECT,INSERT ON near_settlements,near_bill_events TO bitpos_app;

-- Cross-tenant sweep for the reconcile worker: ids only, then the work happens per tenant.
CREATE FUNCTION bitpos.near_due_bills(p_limit integer) RETURNS TABLE(merchant_id uuid,bill_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT b.merchant_id,b.id FROM bitpos.near_bills b
 WHERE b.status IN ('OPENING','OPEN','ESCROW','SETTLING','PAYOUT_FAILED') AND coalesce(b.next_check_at,b.created_at)<=clock_timestamp()
 ORDER BY coalesce(b.next_check_at,b.created_at) LIMIT least(greatest(p_limit,1),50);
$$;
REVOKE ALL ON FUNCTION bitpos.near_due_bills(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.near_due_bills(integer) TO bitpos_app;

-- Mutex, Solana side: no new Solana attempt while a NEAR bill for the order is live or settled.
CREATE FUNCTION near_block_solana_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 PERFORM 1 FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM near_bills b WHERE b.merchant_id=NEW.merchant_id AND b.order_id=NEW.order_id
   AND b.status IN ('OPENING','OPEN','ESCROW','SETTLING','PAYOUT_FAILED','SETTLED')) THEN
  RAISE EXCEPTION 'PAYMENT_PENDING' USING ERRCODE='55P03',DETAIL='near';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER near_block_solana_attempt BEFORE INSERT ON payment_attempts FOR EACH ROW EXECUTE FUNCTION near_block_solana_attempt();

-- Pre-existing function (migration 055), extended: an order is not safe to close or expire while the contract holds
-- its money (escrow, payout in flight or failed) or after an on-chain settlement that is not yet recorded here.
-- Body otherwise unchanged.
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
 AND NOT EXISTS(SELECT 1 FROM bitpos.near_bills b WHERE b.merchant_id=o.merchant_id AND b.order_id=o.id
 AND b.status IN ('ESCROW','SETTLING','PAYOUT_FAILED','SETTLED'))
 AND NOT EXISTS(SELECT 1 FROM bitpos.near_settlements s WHERE s.merchant_id=o.merchant_id AND s.order_id=o.id));
$$;
REVOKE ALL ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) TO bitpos_app;
