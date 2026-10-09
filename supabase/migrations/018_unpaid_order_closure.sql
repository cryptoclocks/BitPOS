-- Cancellation and timeout reuse EXPIRED, with an explicit immutable closure reason.
ALTER TABLE bitpos.orders ADD COLUMN closure_reason text CHECK (closure_reason IN ('canceled','timeout'));

-- BUILDING has not exposed transaction bytes. Its publisher locks the order and
-- rechecks liveOrder before READY; closing the order prevents later publication.
-- READY bytes may have left the server, even without a recorded payer signature.
CREATE FUNCTION bitpos.unpaid_order_safe(p_merchant uuid,p_order uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.merchant_id=p_merchant AND o.id=p_order
  AND o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT','EXPIRED')
  AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id
   AND (p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL
    OR p.status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED')
    OR (p.transaction_base64 IS NOT NULL AND p.status NOT IN ('EXPIRED','FAILED','REJECTED')))));
$$;
REVOKE ALL ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.unpaid_order_safe(uuid,uuid) TO bitpos_app;

CREATE OR REPLACE FUNCTION bitpos.device_current_screen_data(p_merchant uuid,p_device uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT to_jsonb(data) FROM (
  SELECT s.kind,s.screen_generation::text,d.assignment_generation::text,s.lease_until,
   c.id AS session_id,c.cart_version::text,c.cart,
   CASE WHEN rq.id IS NOT NULL THEN to_jsonb(rq)||jsonb_build_object('total_minor',rq.total_minor::text,'cart_version',rq.cart_version::text,'pricing_revision',rq.pricing_revision::text) END AS review,
   o.id AS order_id,o.status,o.version,o.quote_expires_at,o.access_token,o.reservation_released,o.recovery_resolved_at,o.closure_reason,
   o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') AND bitpos.unpaid_order_safe(p_merchant,o.id) AS can_cancel,
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
