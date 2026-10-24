-- Candidate; food assignment text chat closure only. Attachments/calls/merchant chat remain separate work.
SET search_path=bitpos,public;
CREATE TABLE food_chat102_threads(
 assignment_id uuid PRIMARY KEY REFERENCES food_assignments,
 sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE food_chat102_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL REFERENCES food_chat102_threads,
 sender_id uuid NOT NULL REFERENCES mobile_accounts,sender_role text NOT NULL CHECK(sender_role IN('CUSTOMER','DRIVER')),
 command_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000 AND octet_length(body)<=16000 AND length(btrim(body))>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(assignment_id,sequence),UNIQUE(assignment_id,sender_id,command_id)
);
CREATE INDEX food_chat102_rate ON food_chat102_messages(sender_id,created_at);
ALTER TABLE food_chat102_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_chat102_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_chat102_threads,food_chat102_messages FROM PUBLIC,bitpos_app;
-- Resolve current assignment every request; a stored participant list never grants old-driver access.
-- Use existing dispatch root order. These locks do not accept/release/complete any assignment.
CREATE FUNCTION food_chat102_actor(target uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;a food_assignments;s food_shipments;role_name text;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 SELECT * INTO a FROM food_assignments WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 -- Reject unrelated actors before obtaining another order's root locks.
 IF NOT EXISTS(SELECT 1 FROM food_shipments WHERE id=a.shipment_id AND account_id=actor)
 AND NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);
 SELECT * INTO STRICT a FROM food_assignments WHERE id=target FOR SHARE;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF a.closed_at IS NOT NULL OR s.active_assignment_id IS DISTINCT FROM a.id OR s.generation<>a.generation
 OR a.state NOT IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF') OR food_driver_authority(a.driver_id,a.shipment_id) IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM driver_assignment_leases l WHERE l.id=a.lease_id AND l.driver_id=a.driver_id AND l.generation=a.lease_generation AND l.food_assignment_id=a.id AND l.state='ACTIVE')
 THEN RAISE EXCEPTION 'CHAT_UNAVAILABLE';END IF;
 IF s.account_id=actor THEN role_name:='CUSTOMER';
 ELSIF EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN role_name:='DRIVER';
 ELSE RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 RETURN role_name;
END $$;
CREATE FUNCTION food_chat102_message_value(m food_chat102_messages,actor uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',m.id,'assignmentId',m.assignment_id,'commandId',m.command_id,'sequence',m.sequence::text,'senderRole',m.sender_role,'mine',m.sender_id=actor,'body',m.body,'createdAt',m.created_at)
$$;
CREATE FUNCTION food_chat102_page(target uuid,after_sequence bigint DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE role_name text;actor uuid;items jsonb;more boolean;last_sequence bigint;latest bigint;
BEGIN
 role_name:=food_chat102_actor(target);actor:=dispatch_live_actor();
 IF after_sequence IS NULL OR after_sequence<0 OR (after_sequence<>0 AND NOT EXISTS(SELECT 1 FROM food_chat102_messages WHERE assignment_id=target AND sequence=after_sequence)) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 WITH page AS MATERIALIZED(SELECT m AS message FROM food_chat102_messages m WHERE assignment_id=target AND sequence>after_sequence ORDER BY sequence LIMIT 51)
 SELECT coalesce(jsonb_agg(food_chat102_message_value(p.message,actor) ORDER BY (p.message).sequence) FILTER(WHERE n<=50),'[]'::jsonb),count(*)>50,max((p.message).sequence) FILTER(WHERE n<=50)
 INTO items,more,last_sequence FROM(SELECT message,row_number() OVER(ORDER BY (message).sequence) n FROM page)p;
 SELECT coalesce(max(sequence),0) INTO latest FROM food_chat102_messages WHERE assignment_id=target;
 PERFORM food_chat102_actor(target);
 RETURN jsonb_build_object('assignmentId',target,'myRole',role_name,'items',items,
 'nextAfterSequence',CASE WHEN more THEN last_sequence::text ELSE NULL END,'nextBeforeSequence',NULL,'latestSequence',latest::text);
END $$;
CREATE FUNCTION food_chat102_send(target uuid,command uuid,message_body text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE role_name text;actor uuid;prior food_chat102_messages;result food_chat102_messages;seq bigint;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT pg_try_advisory_xact_lock(hashtextextended('bitpos.chat102.rate.'||actor::text,0)) THEN RAISE EXCEPTION 'CHAT_RETRY';END IF;
 role_name:=food_chat102_actor(target);
 IF command IS NULL OR message_body IS NULL OR length(message_body) NOT BETWEEN 1 AND 4000 OR octet_length(message_body)>16000 OR length(btrim(message_body))=0 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO prior FROM food_chat102_messages WHERE assignment_id=target AND sender_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.body<>message_body THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN food_chat102_message_value(prior,actor);
 END IF;
 IF (SELECT count(*) FROM food_chat102_messages WHERE sender_id=actor AND created_at>clock_timestamp()-interval '24 hours')>=200 THEN RAISE EXCEPTION 'CHAT_RATE_LIMITED';END IF;
 INSERT INTO food_chat102_threads(assignment_id) VALUES(target) ON CONFLICT DO NOTHING;
 UPDATE food_chat102_threads SET sequence=sequence+1 WHERE assignment_id=target AND sequence<5000 RETURNING sequence INTO seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_LIMIT_REACHED';END IF;
 INSERT INTO food_chat102_messages(assignment_id,sender_id,sender_role,command_id,sequence,body)
 VALUES(target,actor,role_name,command,seq,message_body) RETURNING * INTO result;
 PERFORM food_chat102_actor(target);
 RETURN food_chat102_message_value(result,actor);
END $$;
REVOKE ALL ON FUNCTION food_chat102_actor(uuid),food_chat102_message_value(food_chat102_messages,uuid),food_chat102_page(uuid,bigint),food_chat102_send(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_chat102_page(uuid,bigint),food_chat102_send(uuid,uuid,text) TO bitpos_app;

-- Newest-first window for initial chat and older history; output stays chronological.
CREATE FUNCTION food_chat102_recent(target uuid,before_sequence bigint DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE role_name text;actor uuid;items jsonb;more boolean;oldest bigint;latest bigint;
BEGIN
 role_name:=food_chat102_actor(target);actor:=dispatch_live_actor();
 IF before_sequence IS NULL OR before_sequence<0 OR (before_sequence<>0 AND NOT EXISTS(SELECT 1 FROM food_chat102_messages WHERE assignment_id=target AND sequence=before_sequence)) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 WITH page AS MATERIALIZED(SELECT m AS message FROM food_chat102_messages m WHERE assignment_id=target AND (before_sequence=0 OR sequence<before_sequence) ORDER BY sequence DESC LIMIT 51)
 SELECT coalesce(jsonb_agg(food_chat102_message_value(p.message,actor) ORDER BY (p.message).sequence) FILTER(WHERE n<=50),'[]'::jsonb),count(*)>50,min((p.message).sequence) FILTER(WHERE n<=50)
 INTO items,more,oldest FROM(SELECT message,row_number() OVER(ORDER BY (message).sequence DESC) n FROM page)p;
 SELECT coalesce(max(sequence),0) INTO latest FROM food_chat102_messages WHERE assignment_id=target;
 PERFORM food_chat102_actor(target);
 RETURN jsonb_build_object('assignmentId',target,'myRole',role_name,'items',items,'nextAfterSequence',NULL,
 'nextBeforeSequence',CASE WHEN more THEN oldest::text ELSE NULL END,'latestSequence',latest::text);
END $$;
CREATE FUNCTION food_chat102_signal(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE latest bigint;
BEGIN
 PERFORM food_chat102_actor(target);
 SELECT coalesce(max(sequence),0) INTO latest FROM food_chat102_messages WHERE assignment_id=target;
 PERFORM food_chat102_actor(target);
 RETURN jsonb_build_object('assignmentId',target,'latestSequence',latest::text,'serverTime',clock_timestamp());
END $$;
CREATE FUNCTION food_chat102_wake() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN PERFORM pg_notify('bitpos_food_realtime','');RETURN NEW;END $$;
CREATE TRIGGER food_chat102_committed_wake AFTER INSERT ON food_chat102_messages FOR EACH STATEMENT EXECUTE FUNCTION food_chat102_wake();
REVOKE ALL ON FUNCTION food_chat102_recent(uuid,bigint),food_chat102_signal(uuid),food_chat102_wake() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_chat102_recent(uuid,bigint),food_chat102_signal(uuid) TO bitpos_app;
