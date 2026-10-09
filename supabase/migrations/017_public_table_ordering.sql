SET search_path TO bitpos, extensions, public;
DO $$ DECLARE ns text; BEGIN SELECT n.nspname INTO ns FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'; EXECUTE format('GRANT USAGE ON SCHEMA %I TO bitpos_app',ns); END $$;
CREATE TABLE table_entries(
 merchant_id uuid NOT NULL REFERENCES merchants,id uuid NOT NULL DEFAULT gen_random_uuid(),
 device_id uuid NOT NULL,table_id uuid NOT NULL,assignment_generation bigint NOT NULL CHECK(assignment_generation>0),auth_generation bigint NOT NULL CHECK(auth_generation>0),
 entry_token text NOT NULL UNIQUE DEFAULT rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=') CHECK(entry_token ~ '^[A-Za-z0-9_-]{43}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,device_id,assignment_generation,auth_generation),
 FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id),FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id)
);
CREATE TRIGGER immutable_entry BEFORE UPDATE OR DELETE ON table_entries FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION ensure_table_entry() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.table_id IS NOT NULL AND NEW.revoked_at IS NULL THEN
  INSERT INTO table_entries(merchant_id,device_id,table_id,assignment_generation,auth_generation)
  SELECT NEW.merchant_id,NEW.id,NEW.table_id,NEW.assignment_generation,NEW.auth_generation
  WHERE EXISTS(SELECT 1 FROM merchant_tables WHERE merchant_id=NEW.merchant_id AND id=NEW.table_id AND retired_at IS NULL)
  ON CONFLICT(merchant_id,device_id,assignment_generation,auth_generation) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER current_table_entry AFTER INSERT OR UPDATE OF table_id,assignment_generation,auth_generation ON devices FOR EACH ROW EXECUTE FUNCTION ensure_table_entry();
INSERT INTO table_entries(merchant_id,device_id,table_id,assignment_generation,auth_generation)
SELECT d.merchant_id,d.id,d.table_id,d.assignment_generation,d.auth_generation FROM devices d JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.revoked_at IS NULL AND t.retired_at IS NULL;
CREATE FUNCTION resolve_table_entry(token text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$ SELECT merchant_id FROM table_entries WHERE entry_token=token $$;
REVOKE ALL ON FUNCTION resolve_table_entry(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_table_entry(text) TO bitpos_app;
CREATE TABLE table_visits(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),entry_id uuid NOT NULL,request_id uuid NOT NULL,
 access_token text NOT NULL UNIQUE DEFAULT rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=') CHECK(access_token ~ '^[A-Za-z0-9_-]{43}$'),
 session_id uuid,review_quote_id uuid,order_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,entry_id,request_id),UNIQUE(merchant_id,order_id),
 FOREIGN KEY(merchant_id,entry_id) REFERENCES table_entries(merchant_id,id),FOREIGN KEY(merchant_id,session_id) REFERENCES device_sessions(merchant_id,id),
 FOREIGN KEY(merchant_id,review_quote_id) REFERENCES order_quotes(merchant_id,id),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 CHECK(review_quote_id IS NULL OR session_id IS NOT NULL),CHECK(order_id IS NULL OR review_quote_id IS NOT NULL),CHECK(expires_at>created_at)
);
CREATE INDEX table_visit_issuance ON table_visits(merchant_id,entry_id,created_at);
ALTER TABLE device_sessions ADD COLUMN public_visit_id uuid,ADD FOREIGN KEY(merchant_id,public_visit_id) REFERENCES table_visits(merchant_id,id);
CREATE FUNCTION guard_device_session_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.merchant_id,NEW.id,NEW.device_id,NEW.assignment_generation,NEW.public_visit_id) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.device_id,OLD.assignment_generation,OLD.public_visit_id) THEN RAISE EXCEPTION 'immutable session identity/origin' USING ERRCODE='23514'; END IF;
 IF NEW.public_visit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM table_visits v JOIN table_entries e ON e.merchant_id=v.merchant_id AND e.id=v.entry_id WHERE v.merchant_id=NEW.merchant_id AND v.id=NEW.public_visit_id AND e.device_id=NEW.device_id AND e.assignment_generation=NEW.assignment_generation) THEN RAISE EXCEPTION 'wrong mobile session origin' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_identity BEFORE INSERT OR UPDATE ON device_sessions FOR EACH ROW EXECUTE FUNCTION guard_device_session_identity();
CREATE FUNCTION guard_table_visit() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE e table_entries; BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW.merchant_id,NEW.id,NEW.entry_id,NEW.request_id,NEW.access_token,NEW.created_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.entry_id,OLD.request_id,OLD.access_token,OLD.created_at,OLD.expires_at) OR OLD.order_id IS NOT NULL AND ROW(NEW.order_id,NEW.session_id,NEW.review_quote_id) IS DISTINCT FROM ROW(OLD.order_id,OLD.session_id,OLD.review_quote_id)) THEN RAISE EXCEPTION 'immutable visit identity/order' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT e FROM table_entries WHERE merchant_id=NEW.merchant_id AND id=NEW.entry_id;
 IF NEW.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM device_sessions WHERE merchant_id=NEW.merchant_id AND id=NEW.session_id AND device_id=e.device_id AND assignment_generation=e.assignment_generation AND public_visit_id=NEW.id) THEN RAISE EXCEPTION 'wrong visit session' USING ERRCODE='23514'; END IF;
 IF NEW.review_quote_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_quotes q WHERE q.merchant_id=NEW.merchant_id AND q.id=NEW.review_quote_id AND q.origin_kind='device' AND q.origin_id=e.device_id AND q.session_id=NEW.session_id AND q.serving_table_id=e.table_id AND q.target_device_id=e.device_id AND (q.authority->'target'->>'assignmentGeneration')::bigint=e.assignment_generation) THEN RAISE EXCEPTION 'wrong visit quote' USING ERRCODE='23514'; END IF;
 IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id AND a.source_kind='device' AND a.source_device_id=e.device_id AND a.target_device_id=e.device_id AND a.target_assignment_generation=e.assignment_generation AND a.serving_table_id=e.table_id AND a.quote_id=NEW.review_quote_id) THEN RAISE EXCEPTION 'wrong visit order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visit_scope BEFORE INSERT OR UPDATE ON table_visits FOR EACH ROW EXECUTE FUNCTION guard_table_visit();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['table_entries','table_visits'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t); EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',t); END LOOP; END $$;

CREATE OR REPLACE FUNCTION bitpos.device_stream_probe(
 p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,
 p_connection_generation bigint,p_connection_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE v_row jsonb;
BEGIN
 PERFORM set_config('bitpos.merchant',p_merchant::text,true);
 SELECT to_jsonb(state) INTO v_row FROM (
  SELECT d.label,d.table_id,d.assignment_generation::text,t.label AS table_label,
   CASE WHEN t.retired_at IS NULL THEN entry.entry_token ELSE NULL END AS table_entry_token,
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
  LEFT JOIN table_entries entry ON entry.merchant_id=d.merchant_id AND entry.device_id=d.id AND entry.table_id=d.table_id AND entry.assignment_generation=d.assignment_generation AND entry.auth_generation=d.auth_generation
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

CREATE OR REPLACE FUNCTION bitpos.device_heartbeat(
 p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,
 p_connection_generation bigint,p_connection_id uuid,p_session uuid,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE v_old bitpos.device_command_results%ROWTYPE;v_expired_session uuid;v_meta jsonb;v_screen jsonb;
BEGIN
 IF current_setting('bitpos.merchant',true) IS DISTINCT FROM p_merchant::text THEN RETURN NULL; END IF;
 PERFORM 1 FROM merchants WHERE id=p_merchant FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
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
 SELECT session_id INTO v_expired_session FROM device_screen_state
 WHERE merchant_id=p_merchant AND device_id=p_device AND kind='cart' AND lease_until<=clock_timestamp();
 IF FOUND THEN
  UPDATE device_sessions SET ended_at=clock_timestamp() WHERE merchant_id=p_merchant AND id=v_expired_session;
  UPDATE device_screen_state SET kind='idle',screen_generation=screen_generation+1,session_id=NULL,lease_until=NULL
  WHERE merchant_id=p_merchant AND device_id=p_device AND kind='cart' AND session_id=v_expired_session;
 END IF;
 IF p_session IS NOT NULL THEN
  UPDATE device_screen_state SET lease_until=clock_timestamp()+interval '120 seconds'
  WHERE merchant_id=p_merchant AND device_id=p_device AND kind='cart' AND session_id=p_session
   AND EXISTS(SELECT 1 FROM device_sessions ds WHERE ds.merchant_id=p_merchant AND ds.id=p_session AND ds.public_visit_id IS NULL);
 END IF;
 v_screen:=bitpos.device_current_screen_data(p_merchant,p_device);
 RETURN jsonb_build_object('kind','heartbeat','screenData',v_screen,
  'assignmentGeneration',v_screen->'assignment_generation','screenGeneration',v_screen->'screen_generation');
END;
$$;
