-- Coordinator-integrated native isolated routine drafts; internal BitPOS service only.
-- Existing data/quotes/authority and chain verification remain unchanged.
-- Coordinator-owned migration draft only; not applied by this writer.
-- Caller has already verified the chain proof and entered its tenant transaction.
-- This routine changes settlement rows only. The caller emits the existing order
-- event in the same transaction, preserving bill construction and verifier time.
CREATE OR REPLACE FUNCTION bitpos.settle_verified_attempt(
 p_merchant uuid,
 p_order uuid,
 p_attempt uuid,
 p_finalized boolean
) RETURNS SETOF bitpos.orders
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=bitpos,pg_temp
AS $settle_verified_attempt$
DECLARE
 v_order bitpos.orders%ROWTYPE;
 v_attempt bitpos.payment_attempts%ROWTYPE;
 v_late boolean;
BEGIN
 -- Do not set or repair the tenant here: it belongs to the verified caller.
 -- IS DISTINCT FROM also rejects an absent/cleared setting or null merchant.
 IF p_merchant IS NULL
    OR current_setting('bitpos.merchant',true) IS DISTINCT FROM p_merchant::text THEN
  RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH' USING ERRCODE='42501';
 END IF;
 IF p_finalized IS NULL THEN
  RAISE EXCEPTION 'INVALID_SETTLEMENT_STAGE' USING ERRCODE='22004';
 END IF;

 -- Separate statements enforce order -> attempt locking. VOLATILE PL/pgSQL
 -- takes a fresh READ COMMITTED snapshot for each statement after a lock wait;
 -- combining these locks/reads in one join or outer statement is not equivalent.
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

 -- Read after both locks, including any competing settlement's committed effects.
 IF EXISTS(SELECT 1 FROM bitpos.payments p
           WHERE p.merchant_id=p_merchant AND p.order_id=p_order AND p.attempt_id=p_attempt) THEN
  RETURN;
 END IF;

 IF NOT p_finalized THEN
  UPDATE bitpos.payment_attempts a SET status='CONFIRMED'
  WHERE a.merchant_id=p_merchant AND a.order_id=p_order AND a.id=p_attempt;
  IF v_order.status NOT IN ('PAID','RECOVERY','EXPIRED','CONFIRMING') THEN
   RETURN QUERY
   UPDATE bitpos.orders o SET status='CONFIRMING',version=o.version+1
   WHERE o.merchant_id=p_merchant AND o.id=p_order
   RETURNING o.*;
  END IF;
  RETURN;
 END IF;

 -- Match the existing decision point: actual wall time after order/attempt
 -- locks and duplicate detection, before product locks. now() would backdate
 -- expiry to BEGIN and could consume stock for an already-expired quote.
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

 -- The order lock owns its reservation. Each table is mutated once; any SQL
 -- error or caller emitOrder failure rolls back payment, inventory and outbox.
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

 -- paid_at deliberately retains the caller's transaction-start policy.
 RETURN QUERY
 UPDATE bitpos.orders o
 SET status=CASE WHEN v_late THEN 'RECOVERY' ELSE 'PAID' END,
     version=o.version+1,paid_at=now(),reservation_released=true
 WHERE o.merchant_id=p_merchant AND o.id=p_order
 RETURNING o.*;
END;
$settle_verified_attempt$;

REVOKE ALL ON FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean) TO bitpos_app;

-- Coordinator-owned migration draft. No schema/data application in this task.
-- Internal backend calls only: actor identity is authenticated from live DB rows.
-- All tenant settings are local to the caller's transaction, including autocommit.
CREATE OR REPLACE FUNCTION bitpos.device_stream_probe(
 p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,
 p_connection_generation bigint,p_connection_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=bitpos,pg_temp AS $$
DECLARE v_row jsonb;
BEGIN
 PERFORM set_config('bitpos.merchant',p_merchant::text,true);
 -- No routing mutex: this is a scheduling hint, not cached authorization.
 SELECT to_jsonb(state) INTO v_row FROM (
  SELECT d.label,d.table_id,d.assignment_generation::text,t.label AS table_label,
   r.id AS register_id,r.pairing_generation::text,mp.active_price_version_id,
   s.kind,s.screen_generation::text,s.lease_until<=clock_timestamp() AS expired,
   o.status,o.reservation_released,o.recovery_resolved_at,
   EXISTS(SELECT 1 FROM payment_attempts pa WHERE pa.merchant_id=d.merchant_id AND pa.order_id=o.id AND pa.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')) AS ambiguous,
   EXISTS(SELECT 1 FROM device_event_deliveries dd JOIN outbox_events e ON e.merchant_id=dd.merchant_id AND e.id=dd.event_id WHERE dd.merchant_id=d.merchant_id AND dd.device_id=d.id AND e.order_id=o.id AND e.order_version=o.version AND dd.status='rendered') AS rendered,
   EXISTS(SELECT 1 FROM outbox_events e WHERE e.merchant_id=d.merchant_id AND e.target_device_id=d.id AND NOT EXISTS(SELECT 1 FROM device_event_deliveries dd WHERE dd.merchant_id=e.merchant_id AND dd.device_id=d.id AND dd.event_id=e.id AND dd.connection_generation=p_connection_generation)) AS pending
  FROM devices d
  JOIN device_credentials c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
  JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id
  JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
  LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
  LEFT JOIN registers r ON r.merchant_id=d.merchant_id AND r.paired_device_id=d.id
  LEFT JOIN merchant_pricing mp ON mp.merchant_id=d.merchant_id
  LEFT JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id
  WHERE d.merchant_id=p_merchant AND d.id=p_device
   AND c.token_hash=p_token_hash AND c.revoked_at IS NULL AND d.revoked_at IS NULL
   AND c.auth_generation=d.auth_generation AND c.auth_generation=p_auth_generation
   AND p.connection_generation=p_connection_generation AND p.connection_id=p_connection_id
   AND p.connected_until>clock_timestamp()
 ) state;
 RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION bitpos.device_claim_events(
 p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,
 p_connection_generation bigint,p_connection_id uuid,p_config jsonb,p_owner jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=bitpos,pg_temp AS $$
DECLARE v_row jsonb;v_config jsonb;v_supplied jsonb;v_owner jsonb;v_events jsonb;v_live boolean;v_expired boolean;
BEGIN
 PERFORM set_config('bitpos.merchant',p_merchant::text,true);
 PERFORM 1 FROM merchants WHERE id=p_merchant FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Separate statement, hence a fresh READ COMMITTED snapshot after lock wait.
 v_row:=bitpos.device_stream_probe(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id);
 IF v_row IS NULL THEN RETURN NULL; END IF;
 -- Only mutable DB-backed CONFIG facts are compared. Service-owned origin,
 -- limits and heartbeat/lease policy are deliberately not asserted by SQL.
 v_config:=jsonb_build_object(
  'merchantId',p_merchant,'deviceId',p_device,'label',v_row->'label',
  'tableId',v_row->'table_id','tableLabel',v_row->'table_label',
  'assignmentGeneration',v_row->'assignment_generation',
  'pairingGeneration',v_row->'pairing_generation',
  'pairing',CASE WHEN v_row->>'register_id' IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('registerId',v_row->'register_id','pairingGeneration',v_row->'pairing_generation') END,
  'priceVersion',v_row->'active_price_version_id','pricingReady',v_row->>'active_price_version_id' IS NOT NULL);
 v_supplied:=jsonb_build_object(
  'merchantId',p_config->'merchantId','deviceId',p_config->'deviceId','label',p_config->'label',
  'tableId',p_config->'tableId','tableLabel',p_config->'tableLabel',
  'assignmentGeneration',p_config->'assignmentGeneration','pairingGeneration',p_config->'pairingGeneration',
  'pairing',p_config->'pairing','priceVersion',p_config->'priceVersion','pricingReady',p_config->'pricingReady');
 v_owner:=jsonb_build_object('kind',v_row->'kind','generation',v_row->'screen_generation',
  'canDismiss',CASE WHEN v_row->>'kind'<>'order' OR (v_row->>'ambiguous')::boolean THEN false
   WHEN v_row->>'status'='PAID' THEN (v_row->>'rendered')::boolean
   WHEN v_row->>'status'='EXPIRED' THEN (v_row->>'reservation_released')::boolean
   WHEN v_row->>'status'='RECOVERY' THEN v_row->>'recovery_resolved_at' IS NOT NULL
   ELSE false END);
 IF (v_row->>'expired')::boolean OR v_config IS DISTINCT FROM v_supplied OR v_owner IS DISTINCT FROM p_owner THEN
  RETURN jsonb_build_object('refresh',true,'row',v_row,'events','[]'::jsonb);
 END IF;
 -- Authenticate again in the effect statement: even elapsed presence cannot
 -- turn the prior metadata hint into claim authority. No catalog/order rebuild.
 WITH live AS MATERIALIZED (
  SELECT d.assignment_generation,s.kind,s.screen_generation,s.order_id,o.version,s.lease_until<=clock_timestamp() AS expired
  FROM devices d
  JOIN device_credentials c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
  JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id
  JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
  LEFT JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id
  WHERE d.merchant_id=p_merchant AND d.id=p_device
   AND c.token_hash=p_token_hash AND c.revoked_at IS NULL AND d.revoked_at IS NULL
   AND c.auth_generation=d.auth_generation AND c.auth_generation=p_auth_generation
   AND p.connection_generation=p_connection_generation AND p.connection_id=p_connection_id
   AND p.connected_until>clock_timestamp()
 ), candidates AS MATERIALIZED (
  SELECT e.*,l.kind AS current_kind,l.screen_generation AS current_screen,l.order_id AS current_order,l.version AS current_version,l.assignment_generation AS current_assignment
  FROM outbox_events e CROSS JOIN live l
  WHERE e.merchant_id=p_merchant AND e.target_device_id=p_device AND NOT coalesce(l.expired,false)
   AND (NOT EXISTS(SELECT 1 FROM device_event_deliveries dd WHERE dd.merchant_id=e.merchant_id AND dd.device_id=p_device AND dd.event_id=e.id AND dd.connection_generation=p_connection_generation)
    OR EXISTS(SELECT 1 FROM device_event_deliveries dd WHERE dd.merchant_id=e.merchant_id AND dd.device_id=p_device AND dd.event_id=e.id AND dd.connection_generation=p_connection_generation AND dd.status='sent'))
 ), stale AS MATERIALIZED (
  SELECT * FROM candidates WHERE screen_generation<>current_screen OR target_assignment_generation<>current_assignment
   OR (order_id IS NOT NULL AND (current_kind<>'order' OR order_id IS DISTINCT FROM current_order OR order_version IS DISTINCT FROM current_version))
   OR (type='CATALOG' AND current_kind<>'idle')
 ), superseded AS (
  INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation,status)
  SELECT merchant_id,target_device_id,id,device_seq,p_connection_generation,'superseded' FROM stale
  ON CONFLICT(merchant_id,device_id,event_id,connection_generation) DO UPDATE SET status='superseded' WHERE device_event_deliveries.status='sent' RETURNING event_id
 ), pending AS MATERIALIZED (
  SELECT e.* FROM candidates e WHERE NOT EXISTS(SELECT 1 FROM stale x WHERE x.id=e.id)
   AND NOT EXISTS(SELECT 1 FROM device_event_deliveries dd WHERE dd.merchant_id=e.merchant_id AND dd.device_id=p_device AND dd.event_id=e.id AND dd.connection_generation=p_connection_generation)
  ORDER BY device_seq LIMIT greatest(0,8-(SELECT count(*)::int FROM device_event_deliveries dd WHERE dd.merchant_id=p_merchant AND dd.device_id=p_device AND dd.connection_generation=p_connection_generation AND dd.status='sent' AND NOT EXISTS(SELECT 1 FROM stale x WHERE x.id=dd.event_id)))
 ), delivered AS (
  INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation)
  SELECT merchant_id,target_device_id,id,device_seq,p_connection_generation FROM pending ON CONFLICT DO NOTHING RETURNING event_id
 ) SELECT EXISTS(SELECT 1 FROM live),coalesce((SELECT expired FROM live),false),coalesce((SELECT jsonb_agg(e.payload||jsonb_build_object('connectionGeneration',p_connection_generation::text) ORDER BY e.device_seq) FROM pending e JOIN delivered d ON d.event_id=e.id),'[]'::jsonb)
 INTO v_live,v_expired,v_events;
 IF NOT v_live THEN RETURN NULL; END IF;
 IF v_expired THEN RETURN jsonb_build_object('refresh',true,'row',jsonb_set(v_row,'{expired}','true'::jsonb),'events','[]'::jsonb); END IF;
 RETURN jsonb_build_object('refresh',false,'row',v_row,'events',v_events);
END;
$$;

CREATE OR REPLACE FUNCTION bitpos.device_validate_send(
 p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,
 p_connection_generation bigint,p_connection_id uuid,p_event uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=bitpos,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 PERFORM set_config('bitpos.merchant',p_merchant::text,true);
 PERFORM 1 FROM merchants WHERE id=p_merchant FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('live',false,'allowed',false); END IF;
 -- Fresh statement after the routing wait; no socket/network work under lock.
 WITH live AS MATERIALIZED (
  SELECT d.id,d.assignment_generation,s.kind,s.screen_generation,s.order_id,cs.cart_version,o.version,
   d.label,d.table_id,t.label AS table_label,r.id AS register_id,r.pairing_generation,mp.active_price_version_id
  FROM devices d
  JOIN device_credentials c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
  JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id
  JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
  LEFT JOIN device_sessions cs ON cs.merchant_id=s.merchant_id AND cs.id=s.session_id
  LEFT JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id
  LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
  LEFT JOIN registers r ON r.merchant_id=d.merchant_id AND r.paired_device_id=d.id
  LEFT JOIN merchant_pricing mp ON mp.merchant_id=d.merchant_id
  WHERE d.merchant_id=p_merchant AND d.id=p_device
   AND c.token_hash=p_token_hash AND c.revoked_at IS NULL AND d.revoked_at IS NULL
   AND c.auth_generation=d.auth_generation AND c.auth_generation=p_auth_generation
   AND p.connection_generation=p_connection_generation AND p.connection_id=p_connection_id
   AND p.connected_until>clock_timestamp()
 ), current AS MATERIALIZED (
  SELECT e.id FROM outbox_events e CROSS JOIN live l WHERE e.merchant_id=p_merchant AND e.target_device_id=p_device AND e.id=p_event
   AND e.screen_generation=l.screen_generation AND e.target_assignment_generation=l.assignment_generation
   AND (e.order_id IS NULL OR (l.kind='order' AND l.order_id=e.order_id AND l.version=e.order_version))
   AND (e.type<>'CATALOG' OR (l.kind='idle' AND (e.payload->'payload'->>'priceVersion')::uuid IS NOT DISTINCT FROM l.active_price_version_id AND (e.payload->'payload'->>'validUntil')::timestamptz>clock_timestamp()))
   AND (e.type<>'SNAPSHOT' OR (e.payload->'payload'->'screen'->>'kind'=l.kind AND (l.kind<>'cart' OR e.payload->'payload'->'screen'->>'cartVersion'=l.cart_version::text)))
   AND (e.type<>'CONFIG' OR (e.payload->'payload'->>'label'=l.label AND (e.payload->'payload'->>'tableId')::uuid IS NOT DISTINCT FROM l.table_id AND e.payload->'payload'->>'tableLabel' IS NOT DISTINCT FROM l.table_label AND (e.payload->'payload'->'pairing'->>'registerId')::uuid IS NOT DISTINCT FROM l.register_id AND (e.payload->'payload'->>'pairingGeneration')::bigint IS NOT DISTINCT FROM l.pairing_generation AND (e.payload->'payload'->>'priceVersion')::uuid IS NOT DISTINCT FROM l.active_price_version_id))
 ), superseded AS (
  UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent' AND EXISTS(SELECT 1 FROM live) AND NOT EXISTS(SELECT 1 FROM current) RETURNING event_id
 ) SELECT jsonb_build_object('live',EXISTS(SELECT 1 FROM live),'allowed',EXISTS(SELECT 1 FROM live) AND (p_event IS NULL OR EXISTS(SELECT 1 FROM current))) INTO v_result;
 RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION bitpos.device_stream_probe(uuid,uuid,text,bigint,bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bitpos.device_claim_events(uuid,uuid,text,bigint,bigint,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bitpos.device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.device_stream_probe(uuid,uuid,text,bigint,bigint,uuid) TO bitpos_app;
GRANT EXECUTE ON FUNCTION bitpos.device_claim_events(uuid,uuid,text,bigint,bigint,uuid,jsonb,jsonb) TO bitpos_app;
GRANT EXECUTE ON FUNCTION bitpos.device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) TO bitpos_app;
