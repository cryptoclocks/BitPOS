-- Canonical online authority; apply after 050, in the migration runner transaction.
-- No historical financial rows are updated. Disable online admission to roll back
-- application behavior; retain immutable online evidence and roll forward schema.
SET search_path=bitpos,public;

CREATE TABLE marketplace_branches(
 merchant_id uuid NOT NULL REFERENCES merchants,id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 320),name_en text,
 address_label text,latitude double precision,longitude double precision,
 timezone text NOT NULL DEFAULT 'Asia/Bangkok',enabled boolean NOT NULL DEFAULT false,
 pickup_enabled boolean NOT NULL DEFAULT true,delivery_enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),PRIMARY KEY(merchant_id,id),UNIQUE(id),
 CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
 CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
ALTER TABLE marketplace_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON marketplace_branches TO bitpos_app
 USING(merchant_id::text=current_setting('bitpos.merchant',true))
 WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
REVOKE ALL ON marketplace_branches FROM PUBLIC;
GRANT SELECT ON marketplace_branches TO bitpos_app;

ALTER TABLE order_quotes ADD COLUMN source_account_id uuid REFERENCES mobile_accounts,
 ADD COLUMN source_branch_id uuid,
 ADD FOREIGN KEY(merchant_id,source_branch_id) REFERENCES marketplace_branches(merchant_id,id);
ALTER TABLE order_authority ADD COLUMN source_account_id uuid REFERENCES mobile_accounts,
 ADD COLUMN source_branch_id uuid,
 ADD FOREIGN KEY(merchant_id,source_branch_id) REFERENCES marketplace_branches(merchant_id,id),
 ALTER COLUMN target_device_id DROP NOT NULL,
 ALTER COLUMN target_assignment_generation DROP NOT NULL,
 ALTER COLUMN screen_generation DROP NOT NULL;
ALTER TABLE order_submissions ADD COLUMN source_account_id uuid REFERENCES mobile_accounts,
 ADD COLUMN source_branch_id uuid,
 ADD FOREIGN KEY(merchant_id,source_branch_id) REFERENCES marketplace_branches(merchant_id,id);

-- Preserve each original routed predicate verbatim, including installation-generated
-- constraint names. Only predicates that exclude the new union member are widened.
-- Separate exhaustive constraints below make online a disjoint branch, not a bypass.
DO $migration$
DECLARE c record; kind_column text;
BEGIN
 FOR c IN SELECT conrelid::regclass AS relation,conname,pg_get_expr(conbin,conrelid) AS predicate
 FROM pg_constraint WHERE contype='c' AND conrelid IN
 ('bitpos.order_quotes'::regclass,'bitpos.order_authority'::regclass,'bitpos.order_submissions'::regclass)
 AND (pg_get_expr(conbin,conrelid) ~ '\m(origin_kind|source_kind|serving_kind)\M'
 OR (conrelid='bitpos.order_quotes'::regclass AND pg_get_expr(conbin,conrelid)='(target_device_id IS NOT NULL)'))
 LOOP
  kind_column:=CASE WHEN c.relation='bitpos.order_authority'::regclass THEN 'source_kind' ELSE 'origin_kind' END;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.relation,c.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%I = ''online'' OR (%s))',c.relation,c.conname,kind_column,c.predicate);
 END LOOP;
END $migration$;

ALTER TABLE order_quotes ADD CONSTRAINT quote_online_origin CHECK(
 (origin_kind IN ('register','device') AND source_account_id IS NULL AND source_branch_id IS NULL)
 OR (origin_kind='online' AND source_account_id IS NOT NULL AND source_branch_id IS NOT NULL
 AND origin_id=source_account_id AND source_register_id IS NULL AND source_device_id IS NULL
 AND session_id IS NULL AND cart_version IS NULL));
ALTER TABLE order_authority ADD CONSTRAINT authority_online_origin CHECK(
 (source_kind IN ('register','device') AND source_account_id IS NULL AND source_branch_id IS NULL
 AND target_device_id IS NOT NULL AND target_assignment_generation IS NOT NULL AND screen_generation IS NOT NULL)
 OR (source_kind='online' AND source_account_id IS NOT NULL AND source_branch_id IS NOT NULL
 AND source_register_id IS NULL AND source_device_id IS NULL AND target_device_id IS NULL
 AND target_assignment_generation IS NULL AND creation_pairing_generation IS NULL
 AND screen_generation IS NULL AND serving_kind IN ('pickup','delivery') AND serving_table_id IS NULL));
ALTER TABLE order_submissions ADD CONSTRAINT submission_online_origin CHECK(
 (origin_kind IN ('register','device') AND source_account_id IS NULL AND source_branch_id IS NULL)
 OR (origin_kind='online' AND source_account_id IS NOT NULL AND source_branch_id IS NOT NULL
 AND origin_id=source_account_id AND source_register_id IS NULL AND source_device_id IS NULL));

CREATE FUNCTION guard_online_quote() RETURNS trigger LANGUAGE plpgsql
SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.origin_kind='online' THEN
  IF NEW.authority IS DISTINCT FROM jsonb_build_object(
   'kind','versioned','source',jsonb_build_object('kind','online','accountId',NEW.source_account_id,
    'branchId',NEW.source_branch_id,'channel','customer_app','label',NEW.authority->'source'->>'label'),
   'serving',jsonb_build_object('kind',NEW.authority->'serving'->>'kind','label',NEW.authority->'serving'->>'label'),
   'target',NULL,'pairingGeneration',NULL)
   OR coalesce(octet_length(NEW.authority->'source'->>'label'),0) NOT BETWEEN 1 AND 95
   OR coalesce(octet_length(NEW.authority->'serving'->>'label'),0) NOT BETWEEN 1 AND 95
   OR coalesce(NEW.authority->'serving'->>'kind','') NOT IN ('pickup','delivery')
   OR NOT EXISTS(SELECT 1 FROM mobile_accounts WHERE id=NEW.source_account_id AND disabled_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM marketplace_branches b WHERE b.merchant_id=NEW.merchant_id
    AND b.id=NEW.source_branch_id AND b.enabled
    AND CASE NEW.authority->'serving'->>'kind' WHEN 'pickup' THEN b.pickup_enabled WHEN 'delivery' THEN b.delivery_enabled ELSE false END)
  THEN RAISE EXCEPTION 'invalid online quote authority' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER online_quote BEFORE INSERT ON order_quotes FOR EACH ROW EXECUTE FUNCTION guard_online_quote();

CREATE OR REPLACE FUNCTION guard_authority_quote() RETURNS trigger LANGUAGE plpgsql
SET search_path=bitpos,pg_temp AS $$
DECLARE q order_quotes;
BEGIN
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=NEW.merchant_id AND id=NEW.quote_id;
 IF q.origin_kind IS DISTINCT FROM NEW.source_kind
 OR q.origin_id IS DISTINCT FROM coalesce(NEW.source_register_id,NEW.source_device_id,NEW.source_account_id)
 OR q.source_register_id IS DISTINCT FROM NEW.source_register_id
 OR q.source_device_id IS DISTINCT FROM NEW.source_device_id
 OR q.source_account_id IS DISTINCT FROM NEW.source_account_id
 OR q.source_branch_id IS DISTINCT FROM NEW.source_branch_id
 OR q.price_version_id IS DISTINCT FROM NEW.price_version_id OR q.total_minor IS DISTINCT FROM NEW.total_minor
 OR q.settlement IS DISTINCT FROM NEW.settlement OR q.target_device_id IS DISTINCT FROM NEW.target_device_id
 OR (q.authority->'target'->>'assignmentGeneration')::bigint IS DISTINCT FROM NEW.target_assignment_generation
 OR q.authority->'source'->>'label' IS DISTINCT FROM NEW.source_label_snapshot
 OR q.authority->'serving'->>'kind' IS DISTINCT FROM NEW.serving_kind
 OR q.serving_table_id IS DISTINCT FROM NEW.serving_table_id
 OR q.authority->'serving'->>'label' IS DISTINCT FROM NEW.serving_label_snapshot
 OR (q.authority->>'pairingGeneration')::bigint IS DISTINCT FROM NEW.creation_pairing_generation
 THEN RAISE EXCEPTION 'quote authority mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_bill_complete() RETURNS trigger LANGUAGE plpgsql
SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.authority_version=2 AND NOT EXISTS(
 SELECT 1 FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id
 JOIN order_submissions s ON s.merchant_id=a.merchant_id AND s.order_id=a.order_id
 WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.id AND s.origin_kind=a.source_kind
 AND s.origin_id=coalesce(a.source_register_id,a.source_device_id,a.source_account_id)
 AND s.source_register_id IS NOT DISTINCT FROM a.source_register_id
 AND s.source_device_id IS NOT DISTINCT FROM a.source_device_id
 AND s.source_account_id IS NOT DISTINCT FROM a.source_account_id
 AND s.source_branch_id IS NOT DISTINCT FROM a.source_branch_id
 AND (SELECT count(*) FROM order_items i WHERE i.merchant_id=a.merchant_id AND i.order_id=a.order_id)=jsonb_array_length(q.lines))
 THEN RAISE EXCEPTION 'incomplete bill or submission origin' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

-- The existing precision-aware default quote trigger handles online authority too.
-- Repair only missing merchant defaults; do not re-enable an owner's disabled asset.
INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy)
 SELECT id,'usdg-devnet',true,'{"id":"USD_CENTS_TO_USDG_1_TO_1","numerator":"10000","denominator":"1"}'::jsonb
 FROM merchants ON CONFLICT(merchant_id,asset_id) DO NOTHING;
CREATE OR REPLACE FUNCTION default_merchant_payment_asset() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
BEGIN
 INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy)
 VALUES(NEW.id,'usdg-devnet',true,'{"id":"USD_CENTS_TO_USDG_1_TO_1","numerator":"10000","denominator":"1"}')
 ON CONFLICT(merchant_id,asset_id) DO NOTHING;
 RETURN NEW;
END $$;

-- Device effects are forbidden even if a caller bypasses its routed projection.
CREATE FUNCTION guard_online_device_effect() RETURNS trigger LANGUAGE plpgsql
SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=NEW.merchant_id
 AND a.order_id=NEW.order_id AND a.source_kind='online') THEN
  RAISE EXCEPTION 'online order has no device effects' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER online_no_pickup_device BEFORE INSERT OR UPDATE ON pickup_notifications
 FOR EACH ROW EXECUTE FUNCTION guard_online_device_effect();
CREATE TRIGGER online_no_device_sound BEFORE INSERT ON device_sound_effects
 FOR EACH ROW EXECUTE FUNCTION guard_online_device_effect();
CREATE TRIGGER online_no_device_outbox BEFORE INSERT ON outbox_events
 FOR EACH ROW WHEN (NEW.target_device_id IS NOT NULL OR NEW.type IN ('ORDER','PICKUP_READY'))
 EXECUTE FUNCTION guard_online_device_effect();
REVOKE ALL ON FUNCTION guard_online_quote(),guard_online_device_effect() FROM PUBLIC;

-- Keep stock/payment/recovery in the existing transactional settlement routine.
-- Routed settlement JSON excludes only the two newly added columns.
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
            OR v_order.status IN ('PAID','RECOVERY');
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


-- Preserve the routed-only screen JSON shape after adding relational columns.
CREATE OR REPLACE FUNCTION bitpos.device_current_screen_data(p_merchant uuid,p_device uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT to_jsonb(data) FROM (
  SELECT s.kind,s.screen_generation::text,d.assignment_generation::text,s.lease_until,
   c.id AS session_id,c.cart_version::text,c.cart,
   CASE WHEN rq.id IS NOT NULL THEN (to_jsonb(rq)-'source_account_id'-'source_branch_id')||jsonb_build_object('total_minor',rq.total_minor::text,'cart_version',rq.cart_version::text,'pricing_revision',rq.pricing_revision::text,'settlement',coalesce(rc.reviewed_settlement,rq.settlement),'valid_until',least(rq.valid_until,rc.repeat_expires_at,rc.reviewed_expires_at)) END AS review,
   o.id AS order_id,o.status,o.version,o.quote_expires_at,o.access_token,o.reservation_released,o.recovery_resolved_at,o.closure_reason,
   o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') AND bitpos.unpaid_order_safe(p_merchant,o.id) AS can_cancel,
   CASE WHEN oa.order_id IS NOT NULL THEN (to_jsonb(oa)-'source_account_id'-'source_branch_id')||jsonb_build_object('target_assignment_generation',oa.target_assignment_generation::text,'creation_pairing_generation',oa.creation_pairing_generation::text,'screen_generation',oa.screen_generation::text,'total_minor',oa.total_minor::text,'settlement',bitpos.effective_payment_settlement(p_merchant,o.id)) END AS authority,
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

