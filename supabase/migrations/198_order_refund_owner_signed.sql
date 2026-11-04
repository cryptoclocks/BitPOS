-- Owner-signed store refunds: BitPOS holds NO key. The server prepares the exact unsigned refund transaction (fee payer = the shop's treasury wallet), the shop
-- owner signs it in their OWN wallet, the server verifies the returned bytes equal the prepared message and carry the treasury's valid signature, stores them as
-- PREPARED and the keyless worker lane broadcasts and reconciles them against FINALIZED chain history (the same exact-bytes machinery as migration 196).
-- signing_mode 'server' keeps the opt-in server-key mode of 196 unchanged; 'owner' rows start in AWAITING_OWNER (no bytes yet, nothing signed by anybody).
-- A refund the owner decides against can be cancelled while AWAITING_OWNER (state FAILED, last_reason CANCELLED) so a new request can be made.
-- Rollback: stop the worker owner lane; ALTER TABLE order_refunds DROP COLUMN unsigned, DROP COLUMN signing_mode; restore the 196 constraints/functions.
SET search_path=bitpos,public;

ALTER TABLE order_refunds ADD COLUMN signing_mode text NOT NULL DEFAULT 'server' CHECK(signing_mode IN('server','owner'));
ALTER TABLE order_refunds ADD COLUMN unsigned jsonb;

DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='bitpos.order_refunds'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%SIGNING%' LOOP
  EXECUTE format('ALTER TABLE order_refunds DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_state_check CHECK(state IN('AWAITING_OWNER','SIGNING','PREPARED','UNKNOWN','FINALIZED','FAILED'));
ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_prepared_check CHECK((state IN('AWAITING_OWNER','SIGNING'))=(prepared IS NULL) OR(state='FAILED'));
ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_mode_state_check CHECK(signing_mode='owner' OR state<>'AWAITING_OWNER');
ALTER TABLE order_refunds ALTER COLUMN state SET DEFAULT 'SIGNING';

CREATE OR REPLACE FUNCTION guard_order_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state IN('FINALIZED','FAILED') THEN RAISE EXCEPTION 'immutable terminal refund' USING ERRCODE='23514';END IF;
 IF OLD.prepared IS NOT NULL AND NEW.prepared IS DISTINCT FROM OLD.prepared THEN RAISE EXCEPTION 'prepared refund bytes are immutable' USING ERRCODE='23514';END IF;
 IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN RAISE EXCEPTION 'refund signature is immutable' USING ERRCODE='23514';END IF;
 -- the unsigned message may be replaced (fresh blockhash) only while nothing has been signed; once signed bytes exist it is frozen
 IF OLD.state<>'AWAITING_OWNER' AND NEW.unsigned IS DISTINCT FROM OLD.unsigned THEN RAISE EXCEPTION 'unsigned refund message is frozen' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

GRANT UPDATE(unsigned) ON order_refunds TO bitpos_app;

-- Which refunds still need work, across shops. Owner-mode rows appear only once the owner's signed bytes are stored (PREPARED/UNKNOWN); AWAITING_OWNER never.
CREATE OR REPLACE FUNCTION order_refund_work(p_limit integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('merchantId',merchant_id,'id',id,'mode',signing_mode,'sourceOwner',source_owner,'amountMinor',amount_minor::text)),'[]'::jsonb)
 FROM(SELECT merchant_id,id,signing_mode,source_owner,amount_minor FROM order_refunds WHERE state IN('SIGNING','PREPARED','UNKNOWN') ORDER BY updated_at,id LIMIT least(greatest(p_limit,1),10))w
$$;

-- Lane-specific work list: a lane never starves behind stuck rows of the other signing mode.
CREATE FUNCTION order_refund_work(p_limit integer,p_mode text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('merchantId',merchant_id,'id',id,'mode',signing_mode,'sourceOwner',source_owner,'amountMinor',amount_minor::text)),'[]'::jsonb)
 FROM(SELECT merchant_id,id,signing_mode,source_owner,amount_minor FROM order_refunds WHERE state IN('SIGNING','PREPARED','UNKNOWN') AND signing_mode=p_mode ORDER BY updated_at,id LIMIT least(greatest(p_limit,1),10))w
$$;
REVOKE ALL ON FUNCTION order_refund_work(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION order_refund_work(integer,text) TO bitpos_app;
