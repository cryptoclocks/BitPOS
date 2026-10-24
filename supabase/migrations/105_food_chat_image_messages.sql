-- Candidate: publish private uploads atomically with a scoped chat message.
SET search_path=bitpos,public;
CREATE TABLE food_chat105_attachments(
 message_id uuid NOT NULL REFERENCES food_chat102_messages ON DELETE CASCADE,
 upload_id uuid NOT NULL UNIQUE REFERENCES food_chat104_uploads,
 position smallint NOT NULL CHECK(position BETWEEN 0 AND 3),PRIMARY KEY(message_id,position)
);
ALTER TABLE food_chat105_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_chat105_attachments FROM PUBLIC,bitpos_app;
ALTER TABLE food_chat102_messages DROP CONSTRAINT food_chat102_messages_body_check;
ALTER TABLE food_chat102_messages ADD CHECK(length(body) BETWEEN 0 AND 4000 AND octet_length(body)<=16000 AND (body='' OR length(btrim(body))>0));
CREATE FUNCTION food_chat105_content_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE m food_chat102_messages;i food_chat104_uploads;
BEGIN
 IF TG_TABLE_NAME='food_chat102_messages' THEN
  SELECT * INTO m FROM food_chat102_messages WHERE id=NEW.id;
  IF FOUND AND m.body='' AND NOT EXISTS(SELECT 1 FROM food_chat105_attachments WHERE message_id=m.id) THEN RAISE EXCEPTION 'EMPTY_CHAT_MESSAGE';END IF;
 ELSE
  SELECT * INTO STRICT m FROM food_chat102_messages WHERE id=NEW.message_id;
  SELECT * INTO STRICT i FROM food_chat104_uploads WHERE id=NEW.upload_id;
  IF (m.assignment_id,m.sender_id) IS DISTINCT FROM (i.assignment_id,i.owner_account_id) OR i.state<>'READY' OR i.body IS NULL THEN RAISE EXCEPTION 'INVALID_CHAT_ATTACHMENT';END IF;
 END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER food_chat105_message_content AFTER INSERT OR UPDATE ON food_chat102_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_chat105_content_guard();
CREATE CONSTRAINT TRIGGER food_chat105_attachment_scope AFTER INSERT OR UPDATE ON food_chat105_attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_chat105_content_guard();
CREATE OR REPLACE FUNCTION food_chat102_message_value(m food_chat102_messages,actor uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',m.id,'assignmentId',m.assignment_id,'commandId',m.command_id,'sequence',m.sequence::text,'senderRole',m.sender_role,'mine',m.sender_id=actor,'body',m.body,'createdAt',m.created_at,
 'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'mime',i.mime,'byteLength',i.byte_length,'width',i.width,'height',i.height,'sha256',i.sha256,'state',i.state) ORDER BY a.position)
 FROM food_chat105_attachments a JOIN food_chat104_uploads i ON i.id=a.upload_id WHERE a.message_id=m.id),'[]'::jsonb))
$$;
CREATE FUNCTION food_chat105_send(target uuid,command uuid,message_body text,images uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;role_name text;prior food_chat102_messages;result food_chat102_messages;image food_chat104_uploads;old_images uuid[];seq bigint;image_id uuid;pos smallint:=0;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT pg_try_advisory_xact_lock(hashtextextended('bitpos.chat102.rate.'||actor::text,0)) THEN RAISE EXCEPTION 'CHAT_RETRY';END IF;
 role_name:=food_chat102_actor(target);
 IF command IS NULL OR message_body IS NULL OR length(message_body)>4000 OR octet_length(message_body)>16000
 OR (message_body<>'' AND length(btrim(message_body))=0) OR images IS NULL OR cardinality(images)>4 OR array_position(images,NULL) IS NOT NULL
 OR (SELECT count(DISTINCT id) FROM unnest(images) id)<>cardinality(images) OR (message_body='' AND cardinality(images)=0) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO prior FROM food_chat102_messages WHERE assignment_id=target AND sender_id=actor AND command_id=command;
 IF FOUND THEN
  SELECT coalesce(array_agg(upload_id ORDER BY position),'{}'::uuid[]) INTO old_images FROM food_chat105_attachments WHERE message_id=prior.id;
  IF prior.body<>message_body OR old_images IS DISTINCT FROM images THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN food_chat102_message_value(prior,actor);
 END IF;
 FOREACH image_id IN ARRAY images LOOP
  SELECT * INTO image FROM food_chat104_uploads WHERE id=image_id AND assignment_id=target AND owner_account_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  IF image.state<>'READY' OR image.body IS NULL OR image.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CHAT_IMAGE_EXPIRED';END IF;
  IF EXISTS(SELECT 1 FROM food_chat105_attachments WHERE upload_id=image_id) THEN RAISE EXCEPTION 'CHAT_IMAGE_IN_USE';END IF;
 END LOOP;
 IF (SELECT count(*) FROM food_chat102_messages WHERE sender_id=actor AND created_at>clock_timestamp()-interval '24 hours')>=200 THEN RAISE EXCEPTION 'CHAT_RATE_LIMITED';END IF;
 INSERT INTO food_chat102_threads(assignment_id) VALUES(target) ON CONFLICT DO NOTHING;
 UPDATE food_chat102_threads SET sequence=sequence+1 WHERE assignment_id=target AND sequence<5000 RETURNING sequence INTO seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_LIMIT_REACHED';END IF;
 INSERT INTO food_chat102_messages(assignment_id,sender_id,sender_role,command_id,sequence,body) VALUES(target,actor,role_name,command,seq,message_body) RETURNING * INTO result;
 FOREACH image_id IN ARRAY images LOOP
  INSERT INTO food_chat105_attachments(message_id,upload_id,position) VALUES(result.id,image_id,pos);pos:=pos+1;
 END LOOP;
 IF EXISTS(SELECT 1 FROM food_chat104_uploads WHERE id=ANY(images) AND expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'CHAT_IMAGE_EXPIRED';END IF;
 PERFORM food_chat102_actor(target);
 RETURN food_chat102_message_value(result,actor);
END $$;
CREATE OR REPLACE FUNCTION food_chat104_bytes(target uuid,image_id uuid) RETURNS TABLE(mime text,sha256 text,body bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;image food_chat104_uploads;linked boolean;
BEGIN
 PERFORM food_chat102_actor(target);actor:=dispatch_live_actor();
 SELECT * INTO image FROM food_chat104_uploads WHERE id=image_id AND assignment_id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT EXISTS(SELECT 1 FROM food_chat105_attachments WHERE upload_id=image.id) INTO linked;
 IF NOT linked AND image.owner_account_id<>actor THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF image.state<>'READY' OR image.body IS NULL OR (NOT linked AND image.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'CHAT_IMAGE_EXPIRED';END IF;
 PERFORM food_chat102_actor(target);RETURN QUERY SELECT image.mime,image.sha256,image.body;
END $$;
CREATE OR REPLACE FUNCTION food_chat104_dispose_expired(batch_size integer DEFAULT 50) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 WITH expired AS(SELECT i.id FROM food_chat104_uploads i WHERE i.state='READY' AND i.expires_at<=clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM food_chat105_attachments a WHERE a.upload_id=i.id)
 ORDER BY i.expires_at,i.id LIMIT batch_size FOR UPDATE OF i SKIP LOCKED)
 UPDATE food_chat104_uploads i SET body=NULL,state='DISPOSED' FROM expired e WHERE i.id=e.id;
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed;
END $$;
REVOKE ALL ON FUNCTION food_chat105_content_guard(),food_chat105_send(uuid,uuid,text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_chat105_send(uuid,uuid,text,uuid[]) TO bitpos_app;
