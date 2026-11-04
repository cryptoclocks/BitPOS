-- Store-side REAL refunds of paid counter/table wallet orders (Solana devnet USDG). One full refund per order, paid back to the wallet that paid, from the
-- shop's treasury, by the refund worker through the same exact-bytes payout provider the food refunds use (prepare -> persist the exact signed bytes -> claim
-- submission -> broadcast -> reconcile against FINALIZED chain history). A client click or a callback never marks a refund done: only verified finalized
-- chain evidence does. The application role can add a refund request and move its state forward but cannot rewrite what was prepared or its identity.
-- Demo payments (signature 'demo:...') and cash are never refunded here (simulated buttons exist for them). Rollback: stop the worker lane, DROP FUNCTION
-- order_refund_work(integer); DROP TABLE order_refunds (the chain transfers themselves are not reversible).
SET search_path=bitpos,public;

CREATE TABLE order_refunds(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 payment_id uuid NOT NULL REFERENCES payments(id),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 asset_id text NOT NULL,
 beneficiary_owner text NOT NULL CHECK(char_length(beneficiary_owner) BETWEEN 32 AND 44),
 source_owner text NOT NULL CHECK(char_length(source_owner) BETWEEN 32 AND 44),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 120),
 requested_by text NOT NULL,
 state text NOT NULL DEFAULT 'SIGNING' CHECK(state IN('SIGNING','PREPARED','UNKNOWN','FINALIZED','FAILED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 prepared jsonb,
 signature text,
 submitted_at timestamptz,
 evidence jsonb,
 evidence_digest text,
 last_reason text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finalized_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 CHECK((state IN('SIGNING'))=(prepared IS NULL)),
 CHECK(state<>'FINALIZED' OR(evidence IS NOT NULL AND finalized_at IS NOT NULL))
);
CREATE UNIQUE INDEX order_refunds_one_live ON order_refunds(merchant_id,order_id) WHERE state<>'FAILED';
CREATE INDEX order_refunds_work ON order_refunds(updated_at,id) WHERE state IN('SIGNING','PREPARED','UNKNOWN');
CREATE FUNCTION guard_order_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state IN('FINALIZED','FAILED') THEN RAISE EXCEPTION 'immutable terminal refund' USING ERRCODE='23514';END IF;
 IF OLD.prepared IS NOT NULL AND NEW.prepared IS DISTINCT FROM OLD.prepared THEN RAISE EXCEPTION 'prepared refund bytes are immutable' USING ERRCODE='23514';END IF;
 IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN RAISE EXCEPTION 'refund signature is immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_refund_guard BEFORE UPDATE ON order_refunds FOR EACH ROW EXECUTE FUNCTION guard_order_refund();
CREATE TRIGGER order_refund_no_delete BEFORE DELETE ON order_refunds FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
ALTER TABLE order_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON order_refunds FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON order_refunds TO bitpos_app;
GRANT UPDATE(state,version,prepared,signature,submitted_at,evidence,evidence_digest,last_reason,attempts,updated_at,finalized_at) ON order_refunds TO bitpos_app;

-- Which refunds still need work, across shops. Returns only ids (the worker then works inside each shop's own tenant transaction).
CREATE FUNCTION order_refund_work(p_limit integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('merchantId',merchant_id,'id',id)),'[]'::jsonb)
 FROM(SELECT merchant_id,id FROM order_refunds WHERE state IN('SIGNING','PREPARED','UNKNOWN') ORDER BY updated_at,id LIMIT least(greatest(p_limit,1),10))w
$$;
REVOKE ALL ON FUNCTION order_refund_work(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION order_refund_work(integer) TO bitpos_app;
