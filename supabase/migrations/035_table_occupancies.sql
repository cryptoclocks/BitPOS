-- Rollback before COMMIT: ROLLBACK. After COMMIT retain historical sidecars;
-- pause new occupancy writers and roll forward, never restore/drop financial rows.
SET search_path TO bitpos,extensions,public;
ALTER TABLE merchant_tables ADD COLUMN occupancy_generation bigint NOT NULL DEFAULT 1 CHECK(occupancy_generation>0),
 ADD COLUMN occupancy_timeout_minutes integer NOT NULL DEFAULT 240 CHECK(occupancy_timeout_minutes BETWEEN 30 AND 1440);
CREATE TABLE table_occupancies(
 merchant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), table_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0), join_token text NOT NULL DEFAULT rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'='),
 opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz,close_reason text CHECK(close_reason IN ('STAFF_CLEAR','INACTIVITY')),
 PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,table_id,generation),UNIQUE(merchant_id,id,table_id,generation),
 FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id),
 CHECK((closed_at IS NULL)=(close_reason IS NULL)),CHECK(join_token ~ '^[A-Za-z0-9_-]{43}$')
);
CREATE UNIQUE INDEX current_table_occupancy ON table_occupancies(merchant_id,table_id) WHERE closed_at IS NULL;
CREATE TABLE table_visit_epochs(
 merchant_id uuid NOT NULL,visit_id uuid NOT NULL,table_id uuid NOT NULL,generation bigint NOT NULL CHECK(generation>0),
 PRIMARY KEY(merchant_id,visit_id),FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id),
 FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id)
);
CREATE TRIGGER immutable_visit_epoch BEFORE UPDATE OR DELETE ON table_visit_epochs FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION capture_table_visit_epoch() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 INSERT INTO table_visit_epochs SELECT NEW.merchant_id,NEW.id,e.table_id,t.occupancy_generation
 FROM table_entries e JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id
 WHERE e.merchant_id=NEW.merchant_id AND e.id=NEW.entry_id;
 RETURN NEW;
END $$;
CREATE TRIGGER visit_epoch AFTER INSERT ON table_visits FOR EACH ROW EXECUTE FUNCTION capture_table_visit_epoch();
-- Preserve old visits and bills verbatim; only their independent epoch sidecar is new.
INSERT INTO table_visit_epochs SELECT v.merchant_id,v.id,e.table_id,t.occupancy_generation FROM table_visits v
 JOIN table_entries e ON e.merchant_id=v.merchant_id AND e.id=v.entry_id
 JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id;
CREATE TABLE table_occupancy_visits(
 merchant_id uuid NOT NULL,occupancy_id uuid NOT NULL,visit_id uuid NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,visit_id),
 FOREIGN KEY(merchant_id,occupancy_id) REFERENCES table_occupancies(merchant_id,id),
 FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id)
);
CREATE TRIGGER immutable_occupancy_visit BEFORE UPDATE OR DELETE ON table_occupancy_visits FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE quote_table_occupancies(
 merchant_id uuid NOT NULL,quote_id uuid NOT NULL,occupancy_id uuid NOT NULL,table_id uuid NOT NULL,generation bigint NOT NULL,
 target_device_id uuid NOT NULL,assignment_generation bigint NOT NULL,auth_generation bigint NOT NULL,
 PRIMARY KEY(merchant_id,quote_id),FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),
 FOREIGN KEY(merchant_id,occupancy_id,table_id,generation) REFERENCES table_occupancies(merchant_id,id,table_id,generation),
 FOREIGN KEY(merchant_id,target_device_id) REFERENCES devices(merchant_id,id)
);
CREATE TRIGGER immutable_quote_occupancy BEFORE UPDATE OR DELETE ON quote_table_occupancies FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION capture_quote_occupancy() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE place merchant_tables;occupied table_occupancies;guest uuid;epoch table_visit_epochs;target devices;place_id uuid;
BEGIN
 IF NEW.authority->'serving'->>'kind' IS DISTINCT FROM 'table' THEN RETURN NEW; END IF;
 place_id:=(NEW.authority->'serving'->>'tableId')::uuid;
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT place FROM merchant_tables WHERE merchant_id=NEW.merchant_id AND id=place_id AND retired_at IS NULL FOR UPDATE;
 SELECT public_visit_id INTO guest FROM device_sessions WHERE merchant_id=NEW.merchant_id AND id=NEW.session_id;
 IF guest IS NOT NULL THEN
  SELECT * INTO STRICT epoch FROM table_visit_epochs WHERE merchant_id=NEW.merchant_id AND visit_id=guest;
  IF epoch.table_id<>place.id OR epoch.generation<>place.occupancy_generation THEN RAISE EXCEPTION 'TABLE_OCCUPANCY_CHANGED' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO occupied FROM table_occupancies WHERE merchant_id=NEW.merchant_id AND table_id=place.id AND closed_at IS NULL;
 IF occupied.id IS NULL THEN
  INSERT INTO table_occupancies(merchant_id,table_id,generation) VALUES(NEW.merchant_id,place.id,place.occupancy_generation) RETURNING * INTO occupied;
 END IF;
 SELECT * INTO STRICT target FROM devices WHERE merchant_id=NEW.merchant_id AND id=(NEW.authority->'target'->>'deviceId')::uuid;
 IF target.revoked_at IS NOT NULL OR target.assignment_generation<>(NEW.authority->'target'->>'assignmentGeneration')::bigint THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED' USING ERRCODE='23514'; END IF;
 INSERT INTO quote_table_occupancies VALUES(NEW.merchant_id,NEW.id,occupied.id,place.id,occupied.generation,target.id,target.assignment_generation,target.auth_generation);
 IF guest IS NOT NULL THEN INSERT INTO table_occupancy_visits(merchant_id,occupancy_id,visit_id) VALUES(NEW.merchant_id,occupied.id,guest) ON CONFLICT DO NOTHING; END IF;
 UPDATE table_occupancies SET last_activity_at=clock_timestamp() WHERE merchant_id=NEW.merchant_id AND id=occupied.id;
 RETURN NEW;
END $$;
CREATE TRIGGER quote_occupancy AFTER INSERT ON order_quotes FOR EACH ROW EXECUTE FUNCTION capture_quote_occupancy();
CREATE TABLE order_table_occupancies(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,occupancy_id uuid NOT NULL,quote_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id) REFERENCES order_authority(merchant_id,order_id),
 FOREIGN KEY(merchant_id,occupancy_id) REFERENCES table_occupancies(merchant_id,id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES quote_table_occupancies(merchant_id,quote_id)
);
CREATE TRIGGER immutable_order_occupancy BEFORE UPDATE OR DELETE ON order_table_occupancies FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION capture_order_occupancy() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.serving_table_id IS NOT NULL THEN
  INSERT INTO order_table_occupancies SELECT NEW.merchant_id,NEW.order_id,q.occupancy_id,NEW.quote_id FROM quote_table_occupancies q
  JOIN table_occupancies o ON o.merchant_id=q.merchant_id AND o.id=q.occupancy_id
  JOIN merchant_tables t ON t.merchant_id=q.merchant_id AND t.id=q.table_id
  WHERE q.merchant_id=NEW.merchant_id AND q.quote_id=NEW.quote_id AND o.closed_at IS NULL AND o.generation=t.occupancy_generation;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_OCCUPANCY_CHANGED' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_occupancy AFTER INSERT ON order_authority FOR EACH ROW EXECUTE FUNCTION capture_order_occupancy();
CREATE TABLE table_clear_requests(
 merchant_id uuid NOT NULL,table_id uuid NOT NULL,idempotency_key text NOT NULL,request_hash text NOT NULL,
 actor_id text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,table_id,idempotency_key),FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id)
);
CREATE TRIGGER immutable_clear_request BEFORE UPDATE OR DELETE ON table_clear_requests FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE table_clear_effects(
 merchant_id uuid NOT NULL,table_id uuid NOT NULL,generation bigint NOT NULL,device_id uuid NOT NULL,event_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,table_id,generation,device_id),FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id),
 FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id),FOREIGN KEY(merchant_id,event_id) REFERENCES outbox_events(merchant_id,id)
);
CREATE TRIGGER immutable_clear_effect BEFORE UPDATE OR DELETE ON table_clear_effects FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION guard_table_occupancy() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.closed_at IS NOT NULL OR ROW(NEW.merchant_id,NEW.id,NEW.table_id,NEW.generation,NEW.join_token,NEW.opened_at)
  IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.table_id,OLD.generation,OLD.join_token,OLD.opened_at) THEN RAISE EXCEPTION 'immutable occupancy identity/history' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER occupancy_history BEFORE UPDATE OR DELETE ON table_occupancies FOR EACH ROW EXECUTE FUNCTION guard_table_occupancy();
DO $$ DECLARE relation text; BEGIN FOREACH relation IN ARRAY ARRAY['table_occupancies','table_visit_epochs','table_occupancy_visits','quote_table_occupancies','order_table_occupancies','table_clear_requests','table_clear_effects'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',relation);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',relation);
END LOOP; END $$;
CREATE FUNCTION touch_paid_occupancy() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.status='PAID' AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE table_occupancies o SET last_activity_at=clock_timestamp()
  FROM order_table_occupancies b WHERE b.merchant_id=NEW.merchant_id AND b.order_id=NEW.id
   AND o.merchant_id=b.merchant_id AND o.id=b.occupancy_id AND o.closed_at IS NULL;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER paid_occupancy_activity AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION touch_paid_occupancy();
CREATE FUNCTION table_occupancy_work_queue() RETURNS TABLE(merchant_id uuid,table_id uuid,generation text)
 LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT o.merchant_id,o.table_id,o.generation::text FROM table_occupancies o
 JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id
 WHERE o.closed_at IS NULL AND t.retired_at IS NULL AND o.generation=t.occupancy_generation
  AND o.last_activity_at+make_interval(mins=>t.occupancy_timeout_minutes)<=clock_timestamp()
$$;
REVOKE ALL ON FUNCTION table_occupancy_work_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION table_occupancy_work_queue() TO bitpos_app;
