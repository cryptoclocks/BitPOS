-- Rollback before COMMIT: ROLLBACK. After cutover retain target/event evidence;
-- disable new campaign publication and roll forward without repricing bills.
SET search_path TO bitpos,extensions,public;
ALTER TABLE device_capabilities DROP CONSTRAINT device_capabilities_capabilities_check;
ALTER TABLE device_capabilities ADD CONSTRAINT device_capabilities_capabilities_check CHECK(capabilities <@ ARRAY['pickup_ready_v1','promotion_v1','promotion_playlist_v1']::text[]);
CREATE TABLE promotion_playlist_targets(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL,campaign_version integer NOT NULL,
 audience text NOT NULL CHECK(audience IN ('daily','personal')),target_device_id uuid NOT NULL,
 assignment_generation bigint NOT NULL CHECK(assignment_generation>0),auth_generation bigint NOT NULL CHECK(auth_generation>0),
 table_id uuid,occupancy_id uuid,occupancy_generation bigint,recipient_id uuid,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','EXPIRED','REVOKED','TARGET_CHANGED','UNSUPPORTED')),
 failure text,expires_at timestamptz NOT NULL,last_event_id uuid,last_connection_generation bigint,rendered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,campaign_id,campaign_version,target_device_id),
 FOREIGN KEY(merchant_id,campaign_id,campaign_version) REFERENCES promotion_revisions(merchant_id,campaign_id,version),
 FOREIGN KEY(merchant_id,target_device_id) REFERENCES devices(merchant_id,id),
 FOREIGN KEY(merchant_id,occupancy_id,table_id,occupancy_generation) REFERENCES table_occupancies(merchant_id,id,table_id,generation),
 FOREIGN KEY(merchant_id,last_event_id) REFERENCES outbox_events(merchant_id,id),
 CHECK(expires_at>created_at),CHECK((audience='personal')=(occupancy_id IS NOT NULL AND table_id IS NOT NULL AND occupancy_generation IS NOT NULL AND recipient_id IS NOT NULL)),
 CHECK(audience<>'daily' OR occupancy_id IS NULL AND occupancy_generation IS NULL AND recipient_id IS NULL)
);
CREATE FUNCTION guard_playlist_target() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF ROW(NEW.merchant_id,NEW.id,NEW.campaign_id,NEW.campaign_version,NEW.audience,NEW.target_device_id,NEW.assignment_generation,NEW.auth_generation,NEW.table_id,NEW.occupancy_id,NEW.occupancy_generation,NEW.recipient_id,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.merchant_id,OLD.id,OLD.campaign_id,OLD.campaign_version,OLD.audience,OLD.target_device_id,OLD.assignment_generation,OLD.auth_generation,OLD.table_id,OLD.occupancy_id,OLD.occupancy_generation,OLD.recipient_id,OLD.expires_at,OLD.created_at)
 THEN RAISE EXCEPTION 'immutable playlist target' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER playlist_target_identity BEFORE UPDATE ON promotion_playlist_targets FOR EACH ROW EXECUTE FUNCTION guard_playlist_target();
CREATE TABLE device_promotion_playlist_state(
 merchant_id uuid NOT NULL,device_id uuid NOT NULL,generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
 content_hash text,content jsonb,last_event_id uuid,last_connection_generation bigint,
 PRIMARY KEY(merchant_id,device_id),FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id),
 FOREIGN KEY(merchant_id,last_event_id) REFERENCES outbox_events(merchant_id,id)
);
CREATE TABLE promotion_playlist_events(
 merchant_id uuid NOT NULL,event_id uuid NOT NULL,device_id uuid NOT NULL,generation bigint NOT NULL,
 auth_generation bigint NOT NULL,assignment_generation bigint NOT NULL,screen_generation bigint NOT NULL,
 table_id uuid,occupancy_generation bigint,target_ids uuid[] NOT NULL,
 PRIMARY KEY(merchant_id,event_id),FOREIGN KEY(merchant_id,event_id) REFERENCES outbox_events(merchant_id,id),
 FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id),CHECK(cardinality(target_ids)<=3)
);
CREATE TRIGGER immutable_playlist_event BEFORE UPDATE OR DELETE ON promotion_playlist_events FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
DO $$ DECLARE relation text; BEGIN FOREACH relation IN ARRAY ARRAY['promotion_playlist_targets','device_promotion_playlist_state','promotion_playlist_events'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',relation);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO bitpos_app',relation);
END LOOP;END $$;
CREATE FUNCTION playlist_target_current(p_merchant uuid,p_target uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM promotion_playlist_targets p JOIN devices d ON d.merchant_id=p.merchant_id AND d.id=p.target_device_id
 JOIN promotion_campaigns c ON c.merchant_id=p.merchant_id AND c.id=p.campaign_id
 LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
 LEFT JOIN table_occupancies o ON o.merchant_id=p.merchant_id AND o.id=p.occupancy_id
 WHERE p.merchant_id=p_merchant AND p.id=p_target AND d.revoked_at IS NULL AND d.assignment_generation=p.assignment_generation AND d.auth_generation=p.auth_generation
 AND c.state='APPROVED' AND c.approved_version=p.campaign_version AND c.expires_at>clock_timestamp() AND p.expires_at>clock_timestamp()
 AND (p.audience='daily' OR d.table_id=p.table_id AND t.retired_at IS NULL AND t.occupancy_generation=p.occupancy_generation AND o.closed_at IS NULL AND o.generation=p.occupancy_generation))
$$;
REVOKE ALL ON FUNCTION playlist_target_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION playlist_target_current(uuid,uuid) TO bitpos_app;
CREATE OR REPLACE FUNCTION promotion_work_queue() RETURNS TABLE(merchant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT DISTINCT merchant_id FROM ai_generation_jobs WHERE state IN ('QUEUED','RUNNING')
 UNION SELECT DISTINCT merchant_id FROM promotion_targets WHERE state IN ('QUEUED','DELIVERED','RENDERED')
 UNION SELECT DISTINCT merchant_id FROM promotion_playlist_targets WHERE state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED')
$$;
-- Existing authenticated financial/pickup/legacy-promotion checks remain in the wrapped routine.
ALTER FUNCTION device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) RENAME TO device_validate_send_pre_playlist;
CREATE FUNCTION device_validate_send(p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,p_connection_generation bigint,p_connection_id uuid,p_event uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE event outbox_events;fence promotion_playlist_events;current device_promotion_playlist_state;device devices;screen device_screen_state;result jsonb;
BEGIN
 result:=device_validate_send_pre_playlist(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id,p_event);
 IF NOT (result->>'allowed')::boolean OR p_event IS NULL THEN RETURN result;END IF;
 SELECT * INTO event FROM outbox_events WHERE merchant_id=p_merchant AND id=p_event;
 IF event.type<>'PROMOTION_PLAYLIST' THEN
  IF event.type IN ('CONFIG','SNAPSHOT','CART') AND event.payload->'payload' ? 'promotionPlaylist' AND NOT EXISTS(
   SELECT 1 FROM device_promotion_playlist_state p WHERE p.merchant_id=p_merchant AND p.device_id=p_device AND p.generation::text=event.payload->'payload'->'promotionPlaylist'->>'generation'
  ) THEN
   UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent';
   RETURN jsonb_set(result,'{allowed}','false'::jsonb);
  END IF;RETURN result;
 END IF;
 SELECT * INTO fence FROM promotion_playlist_events WHERE merchant_id=p_merchant AND event_id=p_event AND device_id=p_device;
 SELECT * INTO current FROM device_promotion_playlist_state WHERE merchant_id=p_merchant AND device_id=p_device;
 SELECT * INTO device FROM devices WHERE merchant_id=p_merchant AND id=p_device;
 SELECT * INTO screen FROM device_screen_state WHERE merchant_id=p_merchant AND device_id=p_device;
 IF fence.event_id IS NULL OR fence.generation<>current.generation OR fence.auth_generation<>device.auth_generation OR fence.assignment_generation<>device.assignment_generation
  OR fence.screen_generation<>screen.screen_generation OR screen.kind<>'idle' OR device.revoked_at IS NOT NULL
  OR fence.table_id IS DISTINCT FROM device.table_id OR (fence.table_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM merchant_tables t WHERE t.merchant_id=p_merchant AND t.id=fence.table_id AND t.retired_at IS NULL AND t.occupancy_generation=fence.occupancy_generation))
  OR EXISTS(SELECT 1 FROM unnest(fence.target_ids) target_id WHERE NOT playlist_target_current(p_merchant,target_id))
  OR EXISTS(SELECT 1 FROM pickup_notifications n WHERE n.merchant_id=p_merchant AND n.target_device_id=p_device AND n.state IN ('PENDING','DELIVERED','RENDERED') AND n.expires_at>clock_timestamp() AND pickup_binding_current(n.merchant_id,n.id))
  OR NOT EXISTS(SELECT 1 FROM device_capabilities cap WHERE cap.merchant_id=p_merchant AND cap.device_id=p_device AND cap.connection_generation=p_connection_generation AND 'promotion_playlist_v1'=ANY(cap.capabilities))
 THEN
  UPDATE device_event_deliveries SET status='superseded' WHERE merchant_id=p_merchant AND device_id=p_device AND event_id=p_event AND connection_generation=p_connection_generation AND status='sent';
  RETURN jsonb_set(result,'{allowed}','false'::jsonb);
 END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION device_validate_send_pre_playlist(uuid,uuid,text,bigint,bigint,uuid,uuid),device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_validate_send_pre_playlist(uuid,uuid,text,bigint,bigint,uuid,uuid),device_validate_send(uuid,uuid,text,bigint,bigint,uuid,uuid) TO bitpos_app;
ALTER FUNCTION device_stream_probe(uuid,uuid,text,bigint,bigint,uuid) RENAME TO device_stream_probe_pre_playlist;
CREATE FUNCTION device_stream_probe(p_merchant uuid,p_device uuid,p_token_hash text,p_auth_generation bigint,p_connection_generation bigint,p_connection_id uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE row jsonb;playlist jsonb;
BEGIN
 row:=device_stream_probe_pre_playlist(p_merchant,p_device,p_token_hash,p_auth_generation,p_connection_generation,p_connection_id);
 IF row IS NULL THEN RETURN NULL;END IF;
 SELECT content INTO playlist FROM device_promotion_playlist_state WHERE merchant_id=p_merchant AND device_id=p_device;
 RETURN row||jsonb_build_object('promotion_playlist',playlist);
END $$;
REVOKE ALL ON FUNCTION device_stream_probe_pre_playlist(uuid,uuid,text,bigint,bigint,uuid),device_stream_probe(uuid,uuid,text,bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_stream_probe_pre_playlist(uuid,uuid,text,bigint,bigint,uuid),device_stream_probe(uuid,uuid,text,bigint,bigint,uuid) TO bitpos_app;
