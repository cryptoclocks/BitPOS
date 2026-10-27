SET search_path TO bitpos,public;
CREATE TABLE order_fulfillment(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','PREPARING','READY','COLLECTED')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE TABLE device_capabilities(
 merchant_id uuid NOT NULL,device_id uuid NOT NULL,connection_generation bigint NOT NULL,capabilities text[] NOT NULL CHECK(capabilities <@ ARRAY['pickup_ready_v1','promotion_v1']::text[]),
 PRIMARY KEY(merchant_id,device_id),FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id)
);
CREATE TABLE pickup_notifications(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),order_id uuid NOT NULL,target_device_id uuid NOT NULL,
 assignment_generation bigint NOT NULL,auth_generation bigint NOT NULL,serving_table_id uuid,visit_id uuid,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','RENDERED','ACKNOWLEDGED','EXPIRED','CANCELED','TARGET_CHANGED','UNSUPPORTED')),
 effect_id uuid NOT NULL DEFAULT gen_random_uuid(),sound_consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 last_event_id uuid,last_screen_generation bigint,last_connection_generation bigint,rendered_at timestamptz,acknowledged_at timestamptz,
 PRIMARY KEY(merchant_id,id),UNIQUE(effect_id),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,target_device_id) REFERENCES devices(merchant_id,id),FOREIGN KEY(merchant_id,serving_table_id) REFERENCES merchant_tables(merchant_id,id),
 FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id),FOREIGN KEY(merchant_id,last_event_id) REFERENCES outbox_events(merchant_id,id),CHECK(expires_at>created_at)
);
CREATE INDEX pickup_pending ON pickup_notifications(merchant_id,target_device_id,created_at) WHERE state IN ('PENDING','DELIVERED','RENDERED','UNSUPPORTED');
CREATE TABLE fulfillment_requests(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,idempotency_key text NOT NULL CHECK(octet_length(idempotency_key) BETWEEN 1 AND 128),request_hash text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(merchant_id,order_id,idempotency_key),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['order_fulfillment','device_capabilities','pickup_notifications','fulfillment_requests'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',t);
END LOOP; END $$;
CREATE TRIGGER immutable_request BEFORE UPDATE OR DELETE ON fulfillment_requests FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
-- Preserve the prior transport boundary. Additional pickup checks are inside the
-- same routing transaction and final send fence, never only scheduling hints.
ALTER FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) RENAME TO device_validate_send_pre_pickup;
CREATE FUNCTION device_validate_send(p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,p_connection_generation bigint,p_connection_id uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE result jsonb; allowed boolean; BEGIN
 result:=device_validate_send_pre_pickup(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id,p_event);
 IF NOT (result->>'allowed')::boolean OR p_event IS NULL THEN RETURN result; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM outbox_events e WHERE e.merchant_id=p_merchant AND e.id=p_event AND e.type='PICKUP_READY' AND NOT EXISTS(
  SELECT 1 FROM pickup_notifications n JOIN devices d ON d.merchant_id=n.merchant_id AND d.id=n.target_device_id
  JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
  JOIN device_capabilities c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
  WHERE n.merchant_id=p_merchant AND n.id=(e.payload->'payload'->>'notificationId')::uuid AND n.target_device_id=p_device
   AND n.assignment_generation=d.assignment_generation AND n.auth_generation=d.auth_generation AND s.kind='idle'
   AND c.connection_generation=p_connection_generation AND 'pickup_ready_v1'=ANY(c.capabilities)
   AND ((e.payload->'payload'->>'state'='CANCELED' AND n.state IN ('CANCELED','EXPIRED','ACKNOWLEDGED')) OR
    (e.payload->'payload'->>'state'='READY' AND n.state IN ('DELIVERED','RENDERED') AND n.last_event_id=e.id AND n.expires_at>clock_timestamp()
     AND d.table_id IS NOT DISTINCT FROM n.serving_table_id
     AND (n.visit_id IS NULL OR NOT EXISTS(SELECT 1 FROM table_visits v JOIN table_entries te ON te.merchant_id=v.merchant_id AND te.id=v.entry_id WHERE v.merchant_id=n.merchant_id AND te.device_id=n.target_device_id AND v.created_at>(SELECT created_at FROM table_visits WHERE merchant_id=n.merchant_id AND id=n.visit_id)))))
 )) INTO allowed;
 IF NOT allowed THEN UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent'; END IF;
 RETURN jsonb_set(result,'{allowed}',to_jsonb(allowed));
END $$;
REVOKE ALL ON FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) TO bitpos_app;
