SET search_path=bitpos,public;
ALTER TABLE device_capabilities DROP CONSTRAINT device_capabilities_capabilities_check;
ALTER TABLE device_capabilities ADD CONSTRAINT device_capabilities_capabilities_check CHECK(capabilities <@ ARRAY['pickup_ready_v1','promotion_v1','promotion_playlist_v1','promotion_playlist_v2']::text[]);
CREATE TABLE promotion_generation_destinations(
 merchant_id uuid NOT NULL,job_id uuid NOT NULL,destination jsonb NOT NULL,
 PRIMARY KEY(merchant_id,job_id),FOREIGN KEY(merchant_id,job_id) REFERENCES ai_generation_jobs(merchant_id,id),
 CHECK(jsonb_typeof(destination)='object' AND octet_length(destination::text)<2000)
);
ALTER TABLE promotion_generation_destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON promotion_generation_destinations FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON promotion_generation_destinations TO bitpos_app;
CREATE TRIGGER immutable_destination BEFORE UPDATE OR DELETE ON promotion_generation_destinations FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION promotion_destination_current(m uuid,b jsonb) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM devices d JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.merchant_id=m AND d.id=(b->>'deviceId')::uuid AND d.table_id=(b->>'tableId')::uuid AND d.assignment_generation=(b->>'assignmentGeneration')::bigint AND d.auth_generation=(b->>'authGeneration')::bigint AND d.revoked_at IS NULL AND t.retired_at IS NULL)
$$;
CREATE FUNCTION guard_generated_destination() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE j ai_generation_jobs;BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT j FROM ai_generation_jobs WHERE merchant_id=NEW.merchant_id AND id=NEW.job_id;
 IF j.input->>'audience'<>'daily' OR j.input->'destination' IS DISTINCT FROM NEW.destination OR NOT promotion_destination_current(NEW.merchant_id,NEW.destination) THEN RAISE EXCEPTION 'invalid generated destination' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_destination BEFORE INSERT ON promotion_generation_destinations FOR EACH ROW EXECUTE FUNCTION guard_generated_destination();
CREATE FUNCTION complete_generated_destination() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NEW.input ? 'destination' AND NOT EXISTS(SELECT 1 FROM promotion_generation_destinations WHERE merchant_id=NEW.merchant_id AND job_id=NEW.id AND destination=NEW.input->'destination') THEN RAISE EXCEPTION 'missing generation destination' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER complete_destination AFTER INSERT ON ai_generation_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_generated_destination();
CREATE VIEW promotion_scope_placements WITH(security_invoker=true) AS
 SELECT merchant_id,campaign_id,binding FROM promotion_derivations
 UNION ALL SELECT c.merchant_id,c.id,jsonb_build_object('placement',jsonb_build_object('kind','table','tableId',g.destination->>'tableId','deviceIds',jsonb_build_array(g.destination->>'deviceId'),'priceAuthority','table'),'generatedDestination',g.destination)
 FROM promotion_generation_destinations g JOIN promotion_campaigns c ON c.merchant_id=g.merchant_id AND c.job_id=g.job_id WHERE NOT c.manual_derived AND NOT EXISTS(SELECT 1 FROM promotion_derivations x WHERE x.merchant_id=c.merchant_id AND x.campaign_id=c.id);
GRANT SELECT ON promotion_scope_placements TO bitpos_app;
ALTER FUNCTION promotion_table_binding_current(uuid,uuid) RENAME TO promotion_table_binding_current_legacy;
CREATE FUNCTION promotion_table_binding_current(m uuid,c uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT promotion_table_binding_current_legacy(m,c) OR EXISTS(SELECT 1 FROM promotion_generation_destinations g JOIN promotion_campaigns p ON p.merchant_id=g.merchant_id AND p.job_id=g.job_id WHERE p.merchant_id=m AND p.id=c AND NOT p.manual_derived AND NOT EXISTS(SELECT 1 FROM promotion_derivations x WHERE x.merchant_id=p.merchant_id AND x.campaign_id=p.id) AND promotion_destination_current(m,g.destination))
$$;
-- Keep existing complete integer quote/send guards, extending only their placement lookup.
DO $$DECLARE f regprocedure;definition text;BEGIN
 FOREACH f IN ARRAY ARRAY['bitpos.promotion_applicable_price(uuid,uuid,uuid,uuid)'::regprocedure,'bitpos.playlist_target_current(uuid,uuid)'::regprocedure,'bitpos.guard_daily_quote()'::regprocedure] LOOP
  definition:=pg_get_functiondef(f);IF position('promotion_derivations' in definition)=0 THEN RAISE EXCEPTION 'expected placement lookup absent';END IF;
  EXECUTE replace(definition,'promotion_derivations','promotion_scope_placements');
 END LOOP;
END $$;
CREATE FUNCTION guard_generated_target() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE b jsonb;BEGIN
 SELECT g.destination INTO b FROM promotion_generation_destinations g JOIN promotion_campaigns c ON c.merchant_id=g.merchant_id AND c.job_id=g.job_id WHERE c.merchant_id=NEW.merchant_id AND c.id=NEW.campaign_id AND NOT c.manual_derived AND NOT EXISTS(SELECT 1 FROM promotion_derivations x WHERE x.merchant_id=c.merchant_id AND x.campaign_id=c.id);
 IF b IS NOT NULL AND (NOT promotion_destination_current(NEW.merchant_id,b) OR NEW.target_device_id IS DISTINCT FROM (b->>'deviceId')::uuid OR NEW.table_id IS DISTINCT FROM (b->>'tableId')::uuid OR NEW.assignment_generation IS DISTINCT FROM (b->>'assignmentGeneration')::bigint OR NEW.auth_generation IS DISTINCT FROM (b->>'authGeneration')::bigint) THEN RAISE EXCEPTION 'generated target escaped destination' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER generated_target BEFORE INSERT ON promotion_playlist_targets FOR EACH ROW EXECUTE FUNCTION guard_generated_target();
REVOKE ALL ON FUNCTION promotion_destination_current(uuid,jsonb),promotion_table_binding_current_legacy(uuid,uuid),promotion_table_binding_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promotion_destination_current(uuid,jsonb),promotion_table_binding_current_legacy(uuid,uuid),promotion_table_binding_current(uuid,uuid) TO bitpos_app;
