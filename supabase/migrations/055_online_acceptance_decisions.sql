-- Generated with tools/runtime/generate-online-acceptance-migration.ts.
-- Additive local acceptance/refund obligations; never proof of a refund transfer.
SET search_path=bitpos,public;
CREATE INDEX online_acceptance_due ON online_food_orders(acceptance_deadline,merchant_id,order_id) WHERE acceptance_status='PENDING';
CREATE OR REPLACE FUNCTION online_acceptance_ended(p_merchant uuid,p_order uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE f online_food_orders%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=p_merchant AND order_id=p_order AND source_kind='online') THEN RETURN false; END IF;
 SELECT * INTO f FROM online_food_orders WHERE merchant_id=p_merchant AND order_id=p_order;
 IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_ONLINE_LIFECYCLE' USING ERRCODE='23514'; END IF;
 RETURN f.acceptance_status IN ('REJECTED','TIMED_OUT') OR (f.acceptance_status='PENDING' AND f.acceptance_deadline<=clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION online_acceptance_ended(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION online_acceptance_ended(uuid,uuid) TO bitpos_app;

ALTER TABLE refunds ADD COLUMN amount_minor bigint,ADD COLUMN asset_descriptor jsonb,ADD COLUMN settlement jsonb,
 ADD COLUMN beneficiary text,ADD COLUMN cause text,ADD COLUMN version integer NOT NULL DEFAULT 1;
-- Existing rows are preserved and enriched only from immutable received-payment facts.
UPDATE refunds r SET amount_minor=p.amount_minor,asset_descriptor=a.descriptor,settlement=a.settlement,
 beneficiary=a.payer,cause='LEGACY_REQUESTED'
FROM payments p JOIN payment_attempt_assets a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id AND a.attempt_id=p.attempt_id
WHERE r.payment_id=p.id AND r.merchant_id=p.merchant_id AND r.order_id=p.order_id;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM refunds WHERE amount_minor IS NULL OR asset_descriptor IS NULL OR settlement IS NULL OR beneficiary IS NULL)
 THEN RAISE EXCEPTION 'REFUND_BACKFILL_REQUIRES_AUTHORITATIVE_PAYMENT_ASSET: preserve existing rows and resolve provenance before migration'; END IF;
END $$;
ALTER TABLE refunds ALTER COLUMN amount_minor SET NOT NULL,ALTER COLUMN asset_descriptor SET NOT NULL,
 ALTER COLUMN settlement SET NOT NULL,ALTER COLUMN beneficiary SET NOT NULL,ALTER COLUMN cause SET NOT NULL,
 ADD CHECK(amount_minor>0 AND version>0),ADD CHECK(cause IN ('LEGACY_REQUESTED','ONLINE_ACCEPTANCE_REJECTED','ONLINE_ACCEPTANCE_TIMED_OUT'));
ALTER TABLE payments ADD CONSTRAINT payment_order_identity UNIQUE(merchant_id,order_id,id);
ALTER TABLE refunds ADD CONSTRAINT refund_payment_order FOREIGN KEY(merchant_id,order_id,payment_id) REFERENCES payments(merchant_id,order_id,id);
CREATE OR REPLACE FUNCTION guard_refund_facts() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF ROW(NEW.id,NEW.merchant_id,NEW.order_id,NEW.payment_id,NEW.amount_minor,NEW.asset_descriptor,NEW.settlement,NEW.beneficiary,NEW.cause,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.merchant_id,OLD.order_id,OLD.payment_id,OLD.amount_minor,OLD.asset_descriptor,OLD.settlement,OLD.beneficiary,OLD.cause,OLD.created_at)
 THEN RAISE EXCEPTION 'immutable refund obligation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_refund_facts BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION guard_refund_facts();
REVOKE DELETE ON refunds FROM bitpos_app;
CREATE TRIGGER immutable_refund_delete BEFORE DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE online_stock_returns(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,payment_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id) REFERENCES online_food_orders,
 FOREIGN KEY(merchant_id,order_id,payment_id) REFERENCES payments(merchant_id,order_id,id)
);
ALTER TABLE online_stock_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON online_stock_returns TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
REVOKE ALL ON online_stock_returns FROM PUBLIC;
GRANT SELECT,INSERT ON online_stock_returns TO bitpos_app;
CREATE TRIGGER immutable_online_stock_return BEFORE UPDATE OR DELETE ON online_stock_returns FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();

CREATE FUNCTION ensure_online_decision_refunds(p_merchant uuid,p_order uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE f online_food_orders%ROWTYPE; p payments%ROWTYPE; a payment_attempt_assets%ROWTYPE; r refunds%ROWTYPE; why text; inserted integer;
BEGIN
 IF current_setting('bitpos.merchant',true) IS DISTINCT FROM p_merchant::text THEN RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM orders WHERE merchant_id=p_merchant AND id=p_order FOR UPDATE;
 IF NOT online_acceptance_ended(p_merchant,p_order) THEN RETURN; END IF;
 SELECT * INTO f FROM online_food_orders WHERE merchant_id=p_merchant AND order_id=p_order FOR UPDATE;
 why:=CASE WHEN f.acceptance_status='REJECTED' THEN 'ONLINE_ACCEPTANCE_REJECTED' ELSE 'ONLINE_ACCEPTANCE_TIMED_OUT' END;
 FOR p IN SELECT * FROM payments WHERE merchant_id=p_merchant AND order_id=p_order ORDER BY id FOR UPDATE LOOP
  SELECT * INTO a FROM payment_attempt_assets WHERE merchant_id=p_merchant AND order_id=p_order AND attempt_id=p.attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PAYMENT_ASSET' USING ERRCODE='23514'; END IF;
  INSERT INTO refunds(merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary,cause)
  VALUES(p_merchant,p_order,p.id,p.amount_minor,a.descriptor,a.settlement,a.payer,why) ON CONFLICT(payment_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  SELECT * INTO r FROM refunds WHERE payment_id=p.id;
  IF r.merchant_id<>p_merchant OR r.order_id<>p_order OR r.amount_minor<>p.amount_minor OR r.asset_descriptor<>a.descriptor OR r.settlement<>a.settlement OR r.beneficiary<>a.payer
  THEN RAISE EXCEPTION 'REFUND_OBLIGATION_CONFLICT' USING ERRCODE='23514'; END IF;
  IF inserted=1 THEN
   INSERT INTO audit_logs(merchant_id,actor,action,subject) VALUES(p_merchant,'acceptance-policy','refund.required',r.id::text);
   PERFORM online_food_event(p_merchant,p_order,'REFUND');
  END IF;
  IF p.state='SETTLED' THEN
   INSERT INTO online_stock_returns(merchant_id,order_id,payment_id) VALUES(p_merchant,p_order,p.id) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted=ROW_COUNT;
   IF inserted=1 THEN
    IF EXISTS(SELECT 1 FROM order_fulfillment WHERE merchant_id=p_merchant AND order_id=p_order AND status<>'RECEIVED') THEN RAISE EXCEPTION 'NEGATIVE_ACCEPTANCE_AFTER_PREPARATION' USING ERRCODE='23514'; END IF;
    PERFORM products.id FROM products JOIN order_items i ON i.merchant_id=products.merchant_id AND i.product_id=products.id WHERE i.merchant_id=p_merchant AND i.order_id=p_order ORDER BY products.id FOR UPDATE OF products;
    UPDATE products SET stock=stock+i.qty FROM order_items i WHERE i.merchant_id=p_merchant AND i.order_id=p_order AND products.merchant_id=i.merchant_id AND products.id=i.product_id;
   END IF;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION ensure_online_decision_refunds(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_online_decision_refunds(uuid,uuid) TO bitpos_app;

CREATE OR REPLACE FUNCTION guard_online_food_update() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF (NEW.merchant_id,NEW.order_id,NEW.account_id,NEW.branch_id,NEW.acceptance_deadline) IS DISTINCT FROM (OLD.merchant_id,OLD.order_id,OLD.account_id,OLD.branch_id,OLD.acceptance_deadline)
 THEN RAISE EXCEPTION 'immutable online ownership' USING ERRCODE='23514'; END IF;
 IF NEW.acceptance_status IS DISTINCT FROM OLD.acceptance_status THEN
  IF OLD.acceptance_status<>'PENDING' OR NEW.acceptance_status='PENDING' OR NEW.acceptance_version<>OLD.acceptance_version+1 THEN RAISE EXCEPTION 'invalid online acceptance transition' USING ERRCODE='23514'; END IF;
  IF NEW.acceptance_status IN ('ACCEPTED','REJECTED') THEN
   IF NEW.decision_by IS NULL THEN RAISE EXCEPTION 'online acceptance actor missing' USING ERRCODE='23514'; END IF;
   IF NEW.acceptance_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'ONLINE_ACCEPTANCE_DEADLINE_ELAPSED' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.acceptance_status='ACCEPTED' AND NEW.decision_reason IS NOT NULL THEN RAISE EXCEPTION 'acceptance has rejection reason' USING ERRCODE='23514'; END IF;
  IF NEW.acceptance_status='REJECTED' AND (NEW.decision_reason IS NULL OR length(btrim(NEW.decision_reason)) NOT BETWEEN 1 AND 300) THEN RAISE EXCEPTION 'rejection reason required' USING ERRCODE='23514'; END IF;
  IF NEW.acceptance_status='TIMED_OUT' AND (NEW.acceptance_deadline>clock_timestamp() OR NEW.decision_by IS NOT NULL OR NEW.decision_reason IS DISTINCT FROM 'ACCEPTANCE_DEADLINE') THEN RAISE EXCEPTION 'invalid acceptance timeout' USING ERRCODE='23514'; END IF;
 ELSIF (NEW.acceptance_version,NEW.decision_by,NEW.decision_reason) IS DISTINCT FROM (OLD.acceptance_version,OLD.decision_by,OLD.decision_reason) THEN RAISE EXCEPTION 'immutable online decision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION online_acceptance_work_queue() RETURNS TABLE(merchant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT DISTINCT f.merchant_id FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id
 WHERE (f.acceptance_status='PENDING' AND f.acceptance_deadline<=clock_timestamp())
 OR (f.acceptance_status IN ('REJECTED','TIMED_OUT') AND (NOT o.reservation_released OR EXISTS(SELECT 1 FROM payments p WHERE p.merchant_id=f.merchant_id AND p.order_id=f.order_id AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id))))
$$;
REVOKE ALL ON FUNCTION online_acceptance_work_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION online_acceptance_work_queue() TO bitpos_app;

-- Preserve routed awaiting/expired semantics; only terminated online orders may
-- close CONFIRMING after all issued attempts have conclusively failed.
CREATE OR REPLACE FUNCTION bitpos.unpaid_order_safe(p_merchant uuid,p_order uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.merchant_id=p_merchant AND o.id=p_order
 AND (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','EXPIRED')
 OR (o.status='CONFIRMING' AND bitpos.online_acceptance_ended(p_merchant,p_order)
 AND NOT EXISTS(SELECT 1 FROM payments WHERE merchant_id=p_merchant AND order_id=p_order)))
 AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id
 AND NOT (p.status IN ('EXPIRED','FAILED','REJECTED') AND p.failure_reconciled_at IS NOT NULL)
 AND (p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL OR p.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED')
 OR (p.transaction_base64 IS NOT NULL AND p.status NOT IN ('EXPIRED','FAILED','REJECTED')))));
$$;
REVOKE ALL ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) TO bitpos_app;

CREATE FUNCTION bitpos.validate_refund_obligation() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.status<>'REQUESTED' OR NEW.signature IS NOT NULL OR NEW.version<>1 OR NOT EXISTS(
  SELECT 1 FROM payments p JOIN payment_attempt_assets a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id AND a.attempt_id=p.attempt_id
  WHERE p.merchant_id=NEW.merchant_id AND p.order_id=NEW.order_id AND p.id=NEW.payment_id
  AND p.amount_minor=NEW.amount_minor AND a.descriptor=NEW.asset_descriptor AND a.settlement=NEW.settlement AND a.payer=NEW.beneficiary)
 THEN RAISE EXCEPTION 'refund obligation must match received payment' USING ERRCODE='23514'; END IF;
 IF NEW.cause IS DISTINCT FROM (SELECT CASE WHEN acceptance_status='REJECTED' THEN 'ONLINE_ACCEPTANCE_REJECTED' ELSE 'ONLINE_ACCEPTANCE_TIMED_OUT' END FROM online_food_orders WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id) OR NOT bitpos.online_acceptance_ended(NEW.merchant_id,NEW.order_id)
 THEN RAISE EXCEPTION 'refund obligation requires terminal online acceptance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_refund_obligation BEFORE INSERT ON bitpos.refunds FOR EACH ROW EXECUTE FUNCTION bitpos.validate_refund_obligation();

CREATE OR REPLACE FUNCTION bitpos.settle_verified_attempt(
 p_merchant uuid,
 p_order uuid,
 p_attempt uuid,
 p_finalized boolean
) RETURNS TABLE(updated_order bitpos.orders,details jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=bitpos,pg_temp
AS $settle_verified_attempt$
DECLARE
 v_order bitpos.orders%ROWTYPE;
 v_attempt bitpos.payment_attempts%ROWTYPE;
 v_late boolean;
 v_asset bitpos.payment_attempt_assets%ROWTYPE;
 v_quote bitpos.payment_quotes%ROWTYPE;
BEGIN
 IF p_merchant IS NULL
    OR current_setting('bitpos.merchant',true) IS DISTINCT FROM p_merchant::text THEN
  RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH' USING ERRCODE='42501';
 END IF;
 IF p_finalized IS NULL THEN
  RAISE EXCEPTION 'INVALID_SETTLEMENT_STAGE' USING ERRCODE='22004';
 END IF;

 -- Separate statements give fresh READ COMMITTED snapshots after each lock wait.
 SELECT o.* INTO v_order
 FROM bitpos.orders o
 WHERE o.merchant_id=p_merchant AND o.id=p_order
 FOR UPDATE OF o;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002';
 END IF;
 SELECT a.* INTO v_attempt
 FROM bitpos.payment_attempts a
 WHERE a.merchant_id=p_merchant AND a.order_id=p_order AND a.id=p_attempt
 FOR UPDATE OF a;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002';
 END IF;

 IF EXISTS(SELECT 1 FROM bitpos.payments p
           WHERE p.merchant_id=p_merchant AND p.order_id=p_order AND p.attempt_id=p_attempt) THEN
  PERFORM bitpos.ensure_online_decision_refunds(p_merchant,p_order);
  RETURN;
 END IF;

 SELECT * INTO v_asset FROM bitpos.payment_attempt_assets WHERE merchant_id=p_merchant AND order_id=p_order AND attempt_id=p_attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PAYMENT_ASSET' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_quote FROM bitpos.payment_quotes WHERE merchant_id=p_merchant AND order_id=p_order AND id=v_asset.quote_id;
 IF NOT FOUND OR v_attempt.signature IS NULL OR v_attempt.signed_base64 IS NULL OR v_attempt.transaction_base64 IS NULL
 OR v_attempt.mint IS DISTINCT FROM v_asset.descriptor->>'mint'
 OR v_attempt.token_program IS DISTINCT FROM v_asset.descriptor->>'tokenProgram'
 OR v_attempt.amount_minor::text IS DISTINCT FROM v_asset.settlement->>'amountMinor'
 OR v_attempt.recipient IS DISTINCT FROM v_asset.recipient
 OR v_attempt.payer IS DISTINCT FROM v_asset.payer OR v_attempt.reference IS DISTINCT FROM v_asset.reference
 OR v_asset.descriptor IS DISTINCT FROM v_quote.descriptor OR v_asset.settlement IS DISTINCT FROM v_quote.settlement
 OR v_asset.expires_at IS DISTINCT FROM v_quote.expires_at THEN
 RAISE EXCEPTION 'PAYMENT_QUOTE_MISMATCH' USING ERRCODE='23514'; END IF;

 IF NOT p_finalized THEN
  UPDATE bitpos.payment_attempts a SET status='CONFIRMED'
  WHERE a.merchant_id=p_merchant AND a.order_id=p_order AND a.id=p_attempt;
  IF v_order.status IN ('PAID','RECOVERY','EXPIRED','CONFIRMING') THEN
   RETURN;
  END IF;
  UPDATE bitpos.orders o SET status='CONFIRMING',version=o.version+1
  WHERE o.merchant_id=p_merchant AND o.id=p_order
  RETURNING o.* INTO v_order;
 ELSE
  -- Wall time after order/attempt locks and duplicate read, before product waits.
  v_late := v_order.reservation_released
            OR v_asset.expires_at<=clock_timestamp()
            OR v_order.status IN ('PAID','RECOVERY')
            OR bitpos.online_acceptance_ended(p_merchant,p_order);
  IF NOT v_order.reservation_released THEN
   PERFORM p.id
   FROM bitpos.products p
   JOIN bitpos.order_items i ON i.merchant_id=p.merchant_id AND i.product_id=p.id
   WHERE p.merchant_id=p_merchant AND i.merchant_id=p_merchant AND i.order_id=p_order
   ORDER BY p.id
   FOR UPDATE OF p;
  END IF;

  INSERT INTO bitpos.payments(merchant_id,order_id,attempt_id,signature,amount_minor,state)
  VALUES(p_merchant,p_order,p_attempt,v_attempt.signature,v_attempt.amount_minor,
         CASE WHEN v_late THEN 'RECOVERY' ELSE 'SETTLED' END);
  IF NOT v_order.reservation_released THEN
   UPDATE bitpos.products p
   SET stock=p.stock-CASE WHEN v_late THEN 0 ELSE i.qty END,reserved=p.reserved-i.qty
   FROM bitpos.order_items i
   WHERE p.merchant_id=p_merchant AND i.merchant_id=p_merchant
     AND i.order_id=p_order AND p.id=i.product_id;
  END IF;
  UPDATE bitpos.payment_attempts a SET status='FINALIZED'
  WHERE a.merchant_id=p_merchant AND a.order_id=p_order AND a.id=p_attempt;

  -- paid_at keeps the historical transaction-start policy, not the expiry clock.
  UPDATE bitpos.orders o
  SET status=CASE WHEN v_late THEN 'RECOVERY' ELSE 'PAID' END,
      version=o.version+1,paid_at=now(),reservation_released=true
  WHERE o.merchant_id=p_merchant AND o.id=p_order
  RETURNING o.* INTO v_order;
 END IF;

 PERFORM bitpos.ensure_online_decision_refunds(p_merchant,p_order);
 updated_order := v_order;
 details := NULL;
 IF v_order.authority_version=2 THEN
  IF v_order.status='PAID' THEN
   INSERT INTO bitpos.device_sound_effects(merchant_id,device_id,order_id,paid_version)
   SELECT a.merchant_id,a.target_device_id,a.order_id,v_order.version
   FROM bitpos.order_authority a
   WHERE a.merchant_id=p_merchant AND a.order_id=p_order
    AND a.source_kind IN ('register','device') AND a.target_device_id IS NOT NULL
   ON CONFLICT DO NOTHING;
  END IF;

  -- Ordered after INSERT: a sibling data-modifying CTE would share its snapshot.
  -- Exactly orderDetails(...,true), with explicit bigint strings in JSON transport.
  SELECT (CASE WHEN a.source_kind='online' THEN to_jsonb(a)
   ELSE to_jsonb(a)-'source_account_id'-'source_branch_id' END)||jsonb_build_object(
   'target_assignment_generation',a.target_assignment_generation::text,
   'creation_pairing_generation',a.creation_pairing_generation::text,
   'screen_generation',a.screen_generation::text,'total_minor',a.total_minor::text,
   'settlement',bitpos.effective_payment_settlement(p_merchant,p_order),
   'lines',q.lines,
   'legacy_items',CASE WHEN q.lines IS NULL THEN (
    SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.name,
     'name_en',i.name_en,'qty',i.qty,'unit_minor',i.unit_minor::text) ORDER BY i.product_id)
    FROM bitpos.order_items i WHERE i.merchant_id=p_merchant AND i.order_id=p_order
   ) END,
   'effect_id',e.effect_id,'consumed_at',e.consumed_at,
   'ambiguous',(SELECT count(*)::int FROM bitpos.payment_attempts p
    WHERE p.merchant_id=p_merchant AND p.order_id=p_order
     AND p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')),
   'rendered',EXISTS(SELECT 1 FROM bitpos.device_event_deliveries d
    JOIN bitpos.outbox_events b ON b.merchant_id=d.merchant_id AND b.id=d.event_id
    WHERE d.merchant_id=p_merchant AND d.device_id=a.target_device_id
     AND b.order_id=p_order AND b.order_version=v_order.version AND d.status='rendered')
  ) INTO details
  FROM bitpos.order_authority a
  LEFT JOIN bitpos.order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id
  LEFT JOIN bitpos.device_sound_effects e ON v_order.status='PAID'
   AND e.merchant_id=a.merchant_id AND e.device_id=a.target_device_id
   AND e.order_id=p_order AND e.paid_version=v_order.version
  WHERE a.merchant_id=p_merchant AND a.order_id=p_order;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'MISSING_ORDER_AUTHORITY' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEXT;
END;
$settle_verified_attempt$;
REVOKE ALL ON FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean) TO bitpos_app;
