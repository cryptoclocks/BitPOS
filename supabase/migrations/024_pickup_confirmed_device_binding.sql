-- Additive forward repair to 023. Apply atomically after verified private backup.
-- Pre-COMMIT rollback: ROLLBACK. After COMMIT, retain rows and roll forward;
-- restoring the prior application image is safe while pickup writers are stopped.
-- No bill, quote, customer, payment, stock or notification identity is changed.
SET search_path TO bitpos,public;
CREATE OR REPLACE FUNCTION pickup_binding_current(p_merchant uuid,p_notice uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM pickup_notifications n JOIN devices d ON d.merchant_id=n.merchant_id AND d.id=n.target_device_id
  JOIN device_screen_state screen ON screen.merchant_id=d.merchant_id AND screen.device_id=d.id
  WHERE n.merchant_id=p_merchant AND n.id=p_notice AND d.revoked_at IS NULL
   AND n.assignment_generation=d.assignment_generation AND n.auth_generation=d.auth_generation
   AND d.table_id IS NOT DISTINCT FROM n.serving_table_id
   AND (n.visit_id IS NULL OR (
    n.guest_generation=d.pickup_guest_generation
    AND EXISTS(SELECT 1 FROM table_visits v JOIN device_sessions ds ON ds.merchant_id=v.merchant_id AND ds.id=v.session_id AND ds.public_visit_id=v.id
     JOIN order_authority a ON a.merchant_id=v.merchant_id AND a.order_id=v.order_id
     JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id AND q.session_id=ds.id
     WHERE v.merchant_id=n.merchant_id AND v.id=n.visit_id AND v.order_id=n.order_id
      -- Original guest/order source stays immutable. Only an explicitly confirmed
      -- notification may target a replacement device serving the original table.
      AND ds.device_id=a.target_device_id
      AND (n.target_device_id=a.target_device_id OR n.binding_confirmed_by IS NOT NULL))
    AND NOT EXISTS(SELECT 1 FROM device_sessions other
     WHERE other.merchant_id=n.merchant_id AND other.device_id=n.target_device_id AND other.public_visit_id IS NOT NULL AND other.public_visit_id<>n.visit_id
      AND (other.ended_at IS NULL
       OR (screen.kind='order' AND EXISTS(SELECT 1 FROM order_quotes q JOIN order_authority a ON a.merchant_id=q.merchant_id AND a.quote_id=q.id WHERE q.merchant_id=other.merchant_id AND q.session_id=other.id AND a.order_id=screen.order_id))))
   ))
 )
$$;
REVOKE ALL ON FUNCTION pickup_binding_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pickup_binding_current(uuid,uuid) TO bitpos_app;
