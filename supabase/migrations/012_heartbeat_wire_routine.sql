-- Internal BitPOS service routines. No payment, quote, inventory or credential migration.
-- Canonical screen data has one definition for ordinary reads and heartbeat replies.
CREATE FUNCTION bitpos.device_current_screen_data(p_merchant uuid,p_device uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT to_jsonb(data) FROM (
  SELECT s.kind,s.screen_generation::text,d.assignment_generation::text,s.lease_until,
   c.id AS session_id,c.cart_version::text,c.cart,
   CASE WHEN rq.id IS NOT NULL THEN to_jsonb(rq)||jsonb_build_object('total_minor',rq.total_minor::text,'cart_version',rq.cart_version::text,'pricing_revision',rq.pricing_revision::text) END AS review,
   o.id AS order_id,o.status,o.version,o.quote_expires_at,o.access_token,o.reservation_released,o.recovery_resolved_at,
   CASE WHEN oa.order_id IS NOT NULL THEN to_jsonb(oa)||jsonb_build_object('target_assignment_generation',oa.target_assignment_generation::text,'creation_pairing_generation',oa.creation_pairing_generation::text,'screen_generation',oa.screen_generation::text,'total_minor',oa.total_minor::text) END AS authority,
   q.lines,EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=s.merchant_id AND p.order_id=o.id AND p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')) AS ambiguous,
   EXISTS(SELECT 1 FROM device_event_deliveries dd JOIN outbox_events e ON e.merchant_id=dd.merchant_id AND e.id=dd.event_id WHERE dd.merchant_id=s.merchant_id AND dd.device_id=s.device_id AND e.order_id=o.id AND e.order_version=o.version AND dd.status='rendered') AS rendered
  FROM device_screen_state s
  JOIN devices d ON d.merchant_id=s.merchant_id AND d.id=s.device_id
  LEFT JOIN device_sessions c ON c.merchant_id=s.merchant_id AND c.id=s.session_id
  LEFT JOIN order_quotes rq ON rq.merchant_id=c.merchant_id AND rq.id=c.review_quote_id
  LEFT JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id
  LEFT JOIN order_authority oa ON oa.merchant_id=o.merchant_id AND oa.order_id=o.id
  LEFT JOIN order_quotes q ON q.merchant_id=oa.merchant_id AND q.id=oa.quote_id
  WHERE s.merchant_id=p_merchant AND s.device_id=p_device
 ) data;
$$;
REVOKE ALL ON FUNCTION bitpos.device_current_screen_data(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.device_current_screen_data(uuid,uuid) TO bitpos_app;

CREATE FUNCTION bitpos.device_heartbeat(
 p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,
 p_connection_generation bigint,p_connection_id uuid,p_session uuid,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE v_old bitpos.device_command_results%ROWTYPE;v_expired_session uuid;v_meta jsonb;v_screen jsonb;
BEGIN
 -- Never repair a mismatched tenant or resurrect expired/replaced credentials.
 IF current_setting('bitpos.merchant',true) IS DISTINCT FROM p_merchant::text THEN RETURN NULL; END IF;
 PERFORM 1 FROM merchants WHERE id=p_merchant FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Fresh snapshot after the routing mutex; the same authority order as other commands.
 PERFORM 1 FROM devices d
 JOIN device_credentials c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
 JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id
 WHERE d.merchant_id=p_merchant AND d.id=p_device AND d.revoked_at IS NULL
  AND c.token_hash=p_token_hash AND c.revoked_at IS NULL
  AND c.auth_generation=d.auth_generation AND c.auth_generation=p_auth_generation
  AND p.connection_generation=p_connection_generation AND p.connection_id=p_connection_id
  AND p.connected_until>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_old FROM device_command_results WHERE merchant_id=p_merchant AND device_id=p_device AND request_id=p_request;
 IF FOUND THEN
  SELECT jsonb_build_object('assignmentGeneration',d.assignment_generation::text,'screenGeneration',s.screen_generation::text)
  INTO v_meta FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
  WHERE d.merchant_id=p_merchant AND d.id=p_device;
  RETURN v_meta||jsonb_build_object('kind','replay','requestHash',v_old.request_hash,'result',v_old.result);
 END IF;
 UPDATE device_presence SET connected_until=clock_timestamp()+interval '60 seconds',last_seen_at=clock_timestamp()
 WHERE merchant_id=p_merchant AND device_id=p_device AND connection_generation=p_connection_generation
  AND connection_id=p_connection_id AND connected_until>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- One expiry decision ends the draft and releases its screen together. A late
 -- heartbeat cannot revive it, and its saved cart remains available for recovery.
 SELECT session_id INTO v_expired_session FROM device_screen_state
 WHERE merchant_id=p_merchant AND device_id=p_device AND kind='cart' AND lease_until<=clock_timestamp();
 IF FOUND THEN
  UPDATE device_sessions SET ended_at=clock_timestamp() WHERE merchant_id=p_merchant AND id=v_expired_session;
  UPDATE device_screen_state SET kind='idle',screen_generation=screen_generation+1,session_id=NULL,lease_until=NULL
  WHERE merchant_id=p_merchant AND device_id=p_device AND kind='cart' AND session_id=v_expired_session;
 END IF;
 IF p_session IS NOT NULL THEN
  UPDATE device_screen_state SET lease_until=clock_timestamp()+interval '120 seconds'
  WHERE merchant_id=p_merchant AND device_id=p_device AND kind='cart' AND session_id=p_session;
 END IF;
 v_screen:=bitpos.device_current_screen_data(p_merchant,p_device);
 RETURN jsonb_build_object('kind','heartbeat','screenData',v_screen,
  'assignmentGeneration',v_screen->'assignment_generation','screenGeneration',v_screen->'screen_generation');
END;
$$;
REVOKE ALL ON FUNCTION bitpos.device_heartbeat(uuid,uuid,text,bigint,bigint,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.device_heartbeat(uuid,uuid,text,bigint,bigint,uuid,uuid,uuid) TO bitpos_app;
