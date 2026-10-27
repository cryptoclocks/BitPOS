-- Candidate upload foundation. Message attachment binding is separate forward work.
SET search_path=bitpos,public;
CREATE TABLE food_chat104_uploads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL REFERENCES food_assignments,
 owner_account_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),source_bytes integer NOT NULL CHECK(source_bytes BETWEEN 1 AND 4194304),
 source_mime text NOT NULL CHECK(source_mime IN('image/jpeg','image/png')),
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 4194304),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 1280),height integer NOT NULL CHECK(height BETWEEN 1 AND 1280),
 mime text NOT NULL DEFAULT 'image/jpeg' CHECK(mime='image/jpeg'),sanitizer text NOT NULL DEFAULT 'raster-reencode-v1' CHECK(sanitizer='raster-reencode-v1'),
 body bytea,state text NOT NULL DEFAULT 'READY' CHECK(state IN('READY','DISPOSED')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(assignment_id,owner_account_id,command_id),CHECK(isfinite(expires_at)),
 CHECK((state='READY' AND body IS NOT NULL AND octet_length(body)=byte_length) OR (state='DISPOSED' AND body IS NULL))
);
CREATE INDEX food_chat104_owner_budget ON food_chat104_uploads(owner_account_id,created_at);
CREATE INDEX food_chat104_expiry ON food_chat104_uploads(expires_at,id) WHERE state='READY';
ALTER TABLE food_chat104_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_chat104_uploads FROM PUBLIC,bitpos_app;
CREATE FUNCTION food_chat104_value(image food_chat104_uploads) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',image.id,'assignmentId',image.assignment_id,'mime',image.mime,'byteLength',image.byte_length,
 'width',image.width,'height',image.height,'sha256',image.sha256,'state',image.state,'expiresAt',image.expires_at,'sanitizer',image.sanitizer)
$$;
CREATE FUNCTION food_chat104_store(target uuid,command uuid,original_hash text,original_length integer,original_mime text,canonical_hash text,image_width integer,image_height integer,payload bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;prior food_chat104_uploads;result food_chat104_uploads;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT pg_try_advisory_xact_lock(hashtextextended('bitpos.chat104.upload.'||actor::text,0)) THEN RAISE EXCEPTION 'CHAT_RETRY';END IF;
 PERFORM food_chat102_actor(target);
 IF command IS NULL OR original_hash IS NULL OR original_hash!~'^[a-f0-9]{64}$' OR original_length IS NULL OR original_length NOT BETWEEN 1 AND 4194304
 OR original_mime IS NULL OR original_mime NOT IN('image/jpeg','image/png') OR canonical_hash IS NULL OR canonical_hash!~'^[a-f0-9]{64}$'
 OR image_width IS NULL OR image_width NOT BETWEEN 1 AND 1280 OR image_height IS NULL OR image_height NOT BETWEEN 1 AND 1280
 OR payload IS NULL OR octet_length(payload) NOT BETWEEN 1 AND 4194304 OR substring(payload FROM 1 FOR 3)<>decode('ffd8ff','hex')
 OR encode(sha256(payload),'hex')<>canonical_hash THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO prior FROM food_chat104_uploads WHERE assignment_id=target AND owner_account_id=actor AND command_id=command;
 IF FOUND THEN
  IF (prior.source_sha256,prior.source_bytes,prior.source_mime) IS DISTINCT FROM (original_hash,original_length,original_mime) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF prior.state<>'READY' OR prior.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CHAT_IMAGE_EXPIRED';END IF;
  RETURN food_chat104_value(prior);
 END IF;
 IF (SELECT count(*) FROM food_chat104_uploads WHERE owner_account_id=actor AND created_at>clock_timestamp()-interval '24 hours')>=100
 OR (SELECT coalesce(sum(byte_length),0) FROM food_chat104_uploads WHERE owner_account_id=actor AND created_at>clock_timestamp()-interval '24 hours')+octet_length(payload)>67108864
 OR (SELECT count(*) FROM food_chat104_uploads WHERE owner_account_id=actor AND assignment_id=target)>=20 THEN RAISE EXCEPTION 'CHAT_IMAGE_QUOTA';END IF;
 INSERT INTO food_chat104_uploads(assignment_id,owner_account_id,command_id,source_sha256,source_bytes,source_mime,sha256,byte_length,width,height,body)
 VALUES(target,actor,command,original_hash,original_length,original_mime,canonical_hash,octet_length(payload),image_width,image_height,payload) RETURNING * INTO result;
 PERFORM food_chat102_actor(target);
 RETURN food_chat104_value(result);
END $$;
CREATE FUNCTION food_chat104_recover(target uuid,command uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;image food_chat104_uploads;
BEGIN
 PERFORM food_chat102_actor(target);actor:=dispatch_live_actor();
 SELECT * INTO image FROM food_chat104_uploads WHERE assignment_id=target AND owner_account_id=actor AND command_id=command;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF image.state<>'READY' OR image.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CHAT_IMAGE_EXPIRED';END IF;
 RETURN food_chat104_value(image);
END $$;
CREATE FUNCTION food_chat104_bytes(target uuid,image_id uuid) RETURNS TABLE(mime text,sha256 text,body bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;image food_chat104_uploads;
BEGIN
 PERFORM food_chat102_actor(target);actor:=dispatch_live_actor();
 SELECT * INTO image FROM food_chat104_uploads WHERE id=image_id AND assignment_id=target AND owner_account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF image.state<>'READY' OR image.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CHAT_IMAGE_EXPIRED';END IF;
 PERFORM food_chat102_actor(target);
 RETURN QUERY SELECT image.mime,image.sha256,image.body;
END $$;
-- Restricted worker primitive: caller still needs a separately configured private worker identity.
CREATE FUNCTION food_chat104_dispose_expired(batch_size integer DEFAULT 50) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 WITH expired AS(SELECT id FROM food_chat104_uploads WHERE state='READY' AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT batch_size FOR UPDATE SKIP LOCKED)
 UPDATE food_chat104_uploads i SET body=NULL,state='DISPOSED' FROM expired e WHERE i.id=e.id;
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed;
END $$;
REVOKE ALL ON FUNCTION food_chat104_value(food_chat104_uploads),food_chat104_store(uuid,uuid,text,integer,text,text,integer,integer,bytea),food_chat104_recover(uuid,uuid),food_chat104_bytes(uuid,uuid),food_chat104_dispose_expired(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_chat104_store(uuid,uuid,text,integer,text,text,integer,integer,bytea),food_chat104_recover(uuid,uuid),food_chat104_bytes(uuid,uuid) TO bitpos_app;
