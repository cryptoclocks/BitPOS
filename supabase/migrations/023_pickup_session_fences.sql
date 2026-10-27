-- Apply the entire file in one transaction (the migration runner owns BEGIN/COMMIT).
-- Pre-COMMIT rollback boundary: ROLLBACK restores all 022 routines/schema/data.
-- After COMMIT do not revert to 022's unsafe visit predicate: stop pickup writers,
-- retain these columns/history, and roll forward. No financial rows are changed.
SET search_path TO bitpos,public;
ALTER TABLE devices ADD COLUMN pickup_guest_generation bigint NOT NULL DEFAULT 0 CHECK(pickup_guest_generation>=0);
ALTER TABLE device_sessions ADD COLUMN pickup_guest_generation bigint CHECK(pickup_guest_generation>0);
-- Historical acquired sessions, including ended ones, are durable replacement
-- evidence. Anonymous visits (even later/expired ones) do not enter this sequence.
WITH acquired AS (
 SELECT merchant_id,id,row_number() OVER(PARTITION BY merchant_id,device_id ORDER BY created_at,id) AS generation
 FROM device_sessions WHERE public_visit_id IS NOT NULL
) UPDATE device_sessions s SET pickup_guest_generation=a.generation FROM acquired a WHERE s.merchant_id=a.merchant_id AND s.id=a.id;
UPDATE devices d SET pickup_guest_generation=a.generation FROM (
 SELECT merchant_id,device_id,max(pickup_guest_generation) AS generation FROM device_sessions GROUP BY merchant_id,device_id
) a WHERE d.merchant_id=a.merchant_id AND d.id=a.device_id AND a.generation IS NOT NULL;
ALTER TABLE device_sessions ADD CONSTRAINT pickup_guest_session CHECK((public_visit_id IS NULL)=(pickup_guest_generation IS NULL));
CREATE UNIQUE INDEX pickup_guest_acquisition ON device_sessions(merchant_id,device_id,pickup_guest_generation) WHERE pickup_guest_generation IS NOT NULL;
CREATE FUNCTION fence_pickup_guest_acquisition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.pickup_guest_generation IS DISTINCT FROM OLD.pickup_guest_generation THEN RAISE EXCEPTION 'immutable guest acquisition' USING ERRCODE='23514'; END IF;
 ELSIF NEW.public_visit_id IS NOT NULL THEN
  -- Same tenant routing mutex as quote acquisition, ACK and final send. The
  -- counter advances only on an actual acquired device session, never a visit.
  PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
  UPDATE devices SET pickup_guest_generation=pickup_guest_generation+1 WHERE merchant_id=NEW.merchant_id AND id=NEW.device_id
  RETURNING pickup_guest_generation INTO NEW.pickup_guest_generation;
 ELSE NEW.pickup_guest_generation:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pickup_guest_acquisition BEFORE INSERT OR UPDATE ON device_sessions FOR EACH ROW EXECUTE FUNCTION fence_pickup_guest_acquisition();
ALTER TABLE pickup_notifications
 ADD COLUMN guest_generation bigint NOT NULL DEFAULT 0 CHECK(guest_generation>=0),
 ADD COLUMN binding_confirmed_by text,
 ADD COLUMN binding_confirmed_at timestamptz,
 ADD COLUMN cancel_event_id uuid,
 ADD CONSTRAINT pickup_binding_confirmation CHECK((binding_confirmed_by IS NULL)=(binding_confirmed_at IS NULL)),
 ADD FOREIGN KEY(merchant_id,cancel_event_id) REFERENCES outbox_events(merchant_id,id);
UPDATE pickup_notifications n SET guest_generation=s.pickup_guest_generation
FROM table_visits v JOIN device_sessions s ON s.merchant_id=v.merchant_id AND s.id=v.session_id AND s.public_visit_id=v.id
WHERE n.merchant_id=v.merchant_id AND n.visit_id=v.id AND s.pickup_guest_generation IS NOT NULL;
CREATE INDEX pickup_missing_tombstone ON pickup_notifications(merchant_id,target_device_id,created_at)
 WHERE state='TARGET_CHANGED' AND last_event_id IS NOT NULL AND cancel_event_id IS NULL;
CREATE FUNCTION guard_pickup_notification_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF ROW(NEW.merchant_id,NEW.id,NEW.order_id,NEW.target_device_id,NEW.assignment_generation,NEW.auth_generation,NEW.serving_table_id,NEW.visit_id,NEW.guest_generation,NEW.binding_confirmed_by,NEW.binding_confirmed_at,NEW.effect_id)
 IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.order_id,OLD.target_device_id,OLD.assignment_generation,OLD.auth_generation,OLD.serving_table_id,OLD.visit_id,OLD.guest_generation,OLD.binding_confirmed_by,OLD.binding_confirmed_at,OLD.effect_id)
 THEN RAISE EXCEPTION 'immutable pickup binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pickup_binding_identity BEFORE UPDATE ON pickup_notifications FOR EACH ROW EXECUTE FUNCTION guard_pickup_notification_binding();
-- Shared authority predicate, intentionally independent of notification lifecycle,
-- TTL and idle screen: busy screens queue; expired/terminal notices never READY.
-- Staff retry freezes a separately confirmed generation, but cannot deliver to
-- a different guest still holding a cart/order. The bill/quote/visit stay pinned.
CREATE FUNCTION pickup_binding_current(p_merchant uuid,p_notice uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
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
     WHERE v.merchant_id=n.merchant_id AND v.id=n.visit_id AND v.order_id=n.order_id AND ds.device_id=n.target_device_id)
    AND NOT EXISTS(SELECT 1 FROM device_sessions other
     WHERE other.merchant_id=n.merchant_id AND other.device_id=n.target_device_id AND other.public_visit_id IS NOT NULL AND other.public_visit_id<>n.visit_id
      AND (other.ended_at IS NULL
       OR (screen.kind='order' AND EXISTS(SELECT 1 FROM order_quotes q JOIN order_authority a ON a.merchant_id=q.merchant_id AND a.quote_id=q.id WHERE q.merchant_id=other.merchant_id AND q.session_id=other.id AND a.order_id=screen.order_id))))
   ))
 )
$$;
REVOKE ALL ON FUNCTION pickup_binding_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pickup_binding_current(uuid,uuid) TO bitpos_app;
-- Replace only 022's wrapper; keep the original authentication/screen transport
-- routine intact. CANCELED is a matching, silent tombstone, not new guest delivery.
CREATE OR REPLACE FUNCTION device_validate_send(p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,p_connection_generation bigint,p_connection_id uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE result jsonb; allowed boolean; BEGIN
 result:=device_validate_send_pre_pickup(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id,p_event);
 IF NOT (result->>'allowed')::boolean OR p_event IS NULL THEN RETURN result; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM outbox_events e WHERE e.merchant_id=p_merchant AND e.id=p_event AND e.type='PICKUP_READY' AND NOT EXISTS(
  SELECT 1 FROM pickup_notifications n JOIN devices d ON d.merchant_id=n.merchant_id AND d.id=n.target_device_id
  JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
  JOIN device_capabilities c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
  WHERE n.merchant_id=p_merchant AND n.id=(e.payload->'payload'->>'notificationId')::uuid AND n.target_device_id=p_device
   AND n.order_id::text=e.payload->'payload'->>'orderId' AND n.effect_id::text=e.payload->'payload'->>'effectId'
   AND n.assignment_generation=d.assignment_generation AND n.auth_generation=d.auth_generation AND s.kind='idle'
   AND c.connection_generation=p_connection_generation AND 'pickup_ready_v1'=ANY(c.capabilities)
   AND ((e.payload->'payload'->>'state'='CANCELED' AND e.payload->'payload'->>'sound'='false' AND n.cancel_event_id=e.id AND n.state IN ('CANCELED','EXPIRED','ACKNOWLEDGED','TARGET_CHANGED')) OR
    (e.payload->'payload'->>'state'='READY' AND n.state IN ('DELIVERED','RENDERED') AND n.last_event_id=e.id AND n.expires_at>clock_timestamp()
     AND pickup_binding_current(n.merchant_id,n.id)))
 )) INTO allowed;
 IF NOT allowed THEN UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent'; END IF;
 RETURN jsonb_set(result,'{allowed}',to_jsonb(allowed));
END $$;
REVOKE ALL ON FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) TO bitpos_app;
