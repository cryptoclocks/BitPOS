-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
-- Records an on-chain settled Living Bill with the same effects, locks and returned shape as the finalized branch of
-- settle_verified_attempt (migration 055): one transaction marks the order PAID (or RECOVERY when late, duplicate or
-- re-quoted), consumes the stock reservation, records the paid sound effect, marks every payout paid, funds supplier
-- invoices and returns the details the existing publisher needs.
-- The caller has already read the bill from the contract at final finality, checked it against this row and set the
-- row to SETTLED.
SET search_path TO bitpos,extensions,public;

CREATE FUNCTION bitpos.near_settle_bill(p_merchant uuid,p_order uuid,p_bill uuid)
RETURNS TABLE(updated_order bitpos.orders,details jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=bitpos,pg_temp
AS $near_settle_bill$
DECLARE
 v_order bitpos.orders%ROWTYPE;
 v_bill bitpos.near_bills%ROWTYPE;
 v_authority bitpos.order_authority%ROWTYPE;
 v_reason text;
BEGIN
 IF p_merchant IS NULL OR current_setting('bitpos.merchant',true) IS DISTINCT FROM p_merchant::text THEN
  RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH' USING ERRCODE='42501';
 END IF;
 -- Lock order first, like the Solana path, so the two channels serialize on the same row.
 SELECT o.* INTO v_order FROM bitpos.orders o WHERE o.merchant_id=p_merchant AND o.id=p_order FOR UPDATE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT b.* INTO v_bill FROM bitpos.near_bills b WHERE b.merchant_id=p_merchant AND b.order_id=p_order AND b.id=p_bill FOR UPDATE OF b;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 -- Replays (page, device, worker) after the first settlement change nothing.
 IF EXISTS(SELECT 1 FROM bitpos.near_settlements s WHERE s.merchant_id=p_merchant AND s.bill_id=p_bill) THEN
  RETURN;
 END IF;
 IF v_bill.status<>'SETTLED' OR v_bill.payer IS NULL
  OR (SELECT coalesce(sum(p.amount_units),0) FROM bitpos.near_payouts p WHERE p.merchant_id=p_merchant AND p.bill_id=p_bill)<>v_bill.amount_units THEN
  RAISE EXCEPTION 'PAYMENT_QUOTE_MISMATCH' USING ERRCODE='23514';
 END IF;
 SELECT a.* INTO v_authority FROM bitpos.order_authority a WHERE a.merchant_id=p_merchant AND a.order_id=p_order;

 -- Wall time after the order/bill locks, before product waits (same policy as migration 055).
 v_reason:=CASE
  WHEN v_order.status IN ('PAID','RECOVERY')
   OR EXISTS(SELECT 1 FROM bitpos.near_settlements s WHERE s.merchant_id=p_merchant AND s.order_id=p_order AND s.state='SETTLED')
   OR EXISTS(SELECT 1 FROM bitpos.payments p WHERE p.merchant_id=p_merchant AND p.order_id=p_order AND p.state='SETTLED') THEN 'ALREADY_PAID'
  WHEN v_order.reservation_released THEN 'RESERVATION_RELEASED'
  WHEN v_authority.quote_id IS DISTINCT FROM v_bill.quote_id
   OR v_authority.catalog_decimals>6
   OR v_authority.total_minor*(10^(6-v_authority.catalog_decimals))::bigint<>v_bill.amount_units THEN 'QUOTE_CHANGED'
  WHEN bitpos.online_acceptance_ended(p_merchant,p_order) THEN 'ACCEPTANCE_ENDED'
  WHEN v_bill.paid_at IS NOT NULL AND v_bill.expires_at<=v_bill.paid_at THEN 'LATE'
 END;
 IF NOT v_order.reservation_released THEN
  PERFORM p.id FROM bitpos.products p
  JOIN bitpos.order_items i ON i.merchant_id=p.merchant_id AND i.product_id=p.id
  WHERE p.merchant_id=p_merchant AND i.merchant_id=p_merchant AND i.order_id=p_order
  ORDER BY p.id FOR UPDATE OF p;
 END IF;
 INSERT INTO bitpos.near_settlements(merchant_id,bill_id,order_id,amount_units,state,recovery_reason)
 VALUES(p_merchant,p_bill,p_order,v_bill.amount_units,CASE WHEN v_reason IS NULL THEN 'SETTLED' ELSE 'RECOVERY' END,v_reason);
 -- The contract paid every recipient in one receipt, whatever the order's state is here.
 UPDATE bitpos.near_payouts SET paid=true WHERE merchant_id=p_merchant AND bill_id=p_bill;
 UPDATE bitpos.near_supplier_invoices i
 SET funded_units=least(i.total_units,i.funded_units+x.units),
     status=CASE WHEN i.funded_units+x.units>=i.total_units THEN 'FUNDED' ELSE i.status END,
     funded_at=CASE WHEN i.funded_units+x.units>=i.total_units THEN clock_timestamp() ELSE i.funded_at END
 FROM (SELECT p.invoice_id,sum(p.amount_units)::bigint AS units FROM bitpos.near_payouts p
  WHERE p.merchant_id=p_merchant AND p.bill_id=p_bill AND p.invoice_id IS NOT NULL GROUP BY p.invoice_id) x
 WHERE i.merchant_id=p_merchant AND i.id=x.invoice_id AND i.status='OPEN';
 IF NOT v_order.reservation_released THEN
  UPDATE bitpos.products p
  SET stock=p.stock-CASE WHEN v_reason IS NULL THEN i.qty ELSE 0 END,reserved=p.reserved-i.qty
  FROM bitpos.order_items i
  WHERE p.merchant_id=p_merchant AND i.merchant_id=p_merchant AND i.order_id=p_order AND p.id=i.product_id;
 END IF;
 UPDATE bitpos.orders o
 SET status=CASE WHEN v_reason IS NULL THEN 'PAID' ELSE 'RECOVERY' END,
     version=o.version+1,paid_at=now(),reservation_released=true
 WHERE o.merchant_id=p_merchant AND o.id=p_order
 RETURNING o.* INTO v_order;
 PERFORM bitpos.ensure_online_decision_refunds(p_merchant,p_order);

 updated_order:=v_order;
 details:=NULL;
 IF v_order.authority_version=2 THEN
  IF v_order.status='PAID' THEN
   INSERT INTO bitpos.device_sound_effects(merchant_id,device_id,order_id,paid_version)
   SELECT a.merchant_id,a.target_device_id,a.order_id,v_order.version
   FROM bitpos.order_authority a
   WHERE a.merchant_id=p_merchant AND a.order_id=p_order
    AND a.source_kind IN ('register','device') AND a.target_device_id IS NOT NULL
   ON CONFLICT DO NOTHING;
  END IF;
  -- Same projection as settle_verified_attempt (migration 055) so the existing publisher and decoders are reused.
  -- `settlement` stays the order's frozen quote settlement; the NEAR facts live in near_settlements/near_bills.
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
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_ORDER_AUTHORITY' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEXT;
END;
$near_settle_bill$;
REVOKE ALL ON FUNCTION bitpos.near_settle_bill(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.near_settle_bill(uuid,uuid,uuid) TO bitpos_app;
