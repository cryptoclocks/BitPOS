-- Forward-only return-contract cutover: quiesce/drain callers before application.
-- Apply DROP/recreate/regrant in the migration runner's single transaction.
-- Migration010's financial/locking policy is retained; JS still formats and publishes
-- the sequence-bearing frame on the same client, so any rejection rolls it all back.
DROP FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean);
CREATE FUNCTION bitpos.settle_verified_attempt(
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
            OR v_order.quote_expires_at<=clock_timestamp()
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
   ON CONFLICT DO NOTHING;
  END IF;

  -- Ordered after INSERT: a sibling data-modifying CTE would share its snapshot.
  -- Exactly orderDetails(...,true), with explicit bigint strings in JSON transport.
  SELECT to_jsonb(a)||jsonb_build_object(
   'target_assignment_generation',a.target_assignment_generation::text,
   'creation_pairing_generation',a.creation_pairing_generation::text,
   'screen_generation',a.screen_generation::text,'total_minor',a.total_minor::text,
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
