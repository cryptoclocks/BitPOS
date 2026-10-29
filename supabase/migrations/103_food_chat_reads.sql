-- Candidate forward migration: read cursors, never transport delivery == read.
SET search_path=bitpos,public;
CREATE TABLE food_chat103_read_cursors(
 assignment_id uuid NOT NULL REFERENCES food_chat102_threads,
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 last_sequence bigint NOT NULL CHECK(last_sequence>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(assignment_id,account_id),
 FOREIGN KEY(assignment_id,last_sequence) REFERENCES food_chat102_messages(assignment_id,sequence) ON DELETE CASCADE
);
ALTER TABLE food_chat103_read_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_chat103_read_cursors FROM PUBLIC,bitpos_app;
CREATE FUNCTION food_chat103_mark_read(target uuid,read_sequence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;result food_chat103_read_cursors;changed boolean;
BEGIN
 PERFORM food_chat102_actor(target);actor:=dispatch_live_actor();
 IF read_sequence IS NULL OR read_sequence<=0 OR NOT EXISTS(
 SELECT 1 FROM food_chat102_messages WHERE assignment_id=target AND sequence=read_sequence AND sender_id<>actor
 ) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 INSERT INTO food_chat103_read_cursors(assignment_id,account_id,last_sequence) VALUES(target,actor,read_sequence)
 ON CONFLICT(assignment_id,account_id) DO UPDATE SET last_sequence=excluded.last_sequence,updated_at=clock_timestamp()
 WHERE food_chat103_read_cursors.last_sequence<excluded.last_sequence RETURNING * INTO result;
 changed:=FOUND;
 IF NOT changed THEN SELECT * INTO STRICT result FROM food_chat103_read_cursors WHERE assignment_id=target AND account_id=actor;END IF;
 PERFORM food_chat102_actor(target);
 IF changed THEN PERFORM pg_notify('bitpos_food_realtime','');END IF;
 RETURN jsonb_build_object('assignmentId',target,'lastReadSequence',result.last_sequence::text,'updatedAt',result.updated_at);
END $$;
CREATE FUNCTION food_chat103_peer_read(target uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE role_name text;actor uuid;peer uuid;result bigint;
BEGIN
 role_name:=food_chat102_actor(target);actor:=dispatch_live_actor();
 IF role_name='CUSTOMER' THEN
 SELECT d.account_id INTO peer FROM food_assignments a JOIN driver_profiles d ON d.id=a.driver_id WHERE a.id=target;
 ELSE SELECT s.account_id INTO peer FROM food_assignments a JOIN food_shipments s ON s.id=a.shipment_id WHERE a.id=target;END IF;
 IF peer=actor THEN RETURN 0;END IF;
 SELECT last_sequence INTO result FROM food_chat103_read_cursors WHERE assignment_id=target AND account_id=peer;
 RETURN coalesce(result,0);
END $$;
CREATE FUNCTION food_chat103_signal(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE signal jsonb;read_sequence bigint;
BEGIN
 signal:=food_chat102_signal(target);read_sequence:=food_chat103_peer_read(target);
 PERFORM food_chat102_actor(target);
 RETURN signal||jsonb_build_object('peerReadSequence',read_sequence::text);
END $$;
REVOKE ALL ON FUNCTION food_chat103_mark_read(uuid,bigint),food_chat103_peer_read(uuid),food_chat103_signal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_chat103_mark_read(uuid,bigint),food_chat103_signal(uuid) TO bitpos_app;
