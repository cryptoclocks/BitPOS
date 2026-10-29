-- Food incidents interrupt work, never invent a physical custody transition.
SET search_path=bitpos,public;
CREATE TABLE food_assignment_incidents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL,shipment_id uuid NOT NULL,driver_id uuid NOT NULL,
 generation bigint NOT NULL,lease_id uuid NOT NULL,lease_generation bigint NOT NULL,reported_by uuid NOT NULL REFERENCES mobile_accounts,
 reported_session_id uuid NOT NULL REFERENCES mobile_sessions,kind text NOT NULL CHECK(kind IN('SUPPORT','SOS','COLLISION','HARASSMENT','MISSING_ITEM','CUSTODY','FRAUD')),
 private_body text NOT NULL CHECK(length(btrim(private_body)) BETWEEN 1 AND 4000),
 phase_at_report text NOT NULL CHECK(phase_at_report IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT')),
 blocks_duty boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 acknowledged_by uuid REFERENCES mobile_accounts,acknowledged_session_id uuid REFERENCES mobile_sessions,acknowledged_grant_id uuid REFERENCES platform_staff_role_grants,
 acknowledged_at timestamptz,acknowledgement_reason text,
 resolution text CHECK(resolution='SAME_CUSTODY_RESUMED'),resolved_by uuid REFERENCES mobile_accounts,resolved_session_id uuid REFERENCES mobile_sessions,
 resolved_grant_id uuid REFERENCES platform_staff_role_grants,resolved_at timestamptz,resolution_reason text,
 FOREIGN KEY(assignment_id,shipment_id) REFERENCES food_assignments(id,shipment_id),
 FOREIGN KEY(assignment_id,driver_id,generation) REFERENCES food_assignments(id,driver_id,generation),
 FOREIGN KEY(assignment_id,lease_id,driver_id,lease_generation) REFERENCES food_assignments(id,lease_id,driver_id,lease_generation),
 CHECK((acknowledged_at IS NULL AND acknowledged_by IS NULL AND acknowledged_session_id IS NULL AND acknowledged_grant_id IS NULL AND acknowledgement_reason IS NULL)
 OR(acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL AND acknowledged_session_id IS NOT NULL AND acknowledged_grant_id IS NOT NULL AND acknowledgement_reason IS NOT NULL AND length(btrim(acknowledgement_reason)) BETWEEN 1 AND 500)),
 CHECK((resolved_at IS NULL AND resolution IS NULL AND resolved_by IS NULL AND resolved_session_id IS NULL AND resolved_grant_id IS NULL AND resolution_reason IS NULL)
 OR(resolved_at IS NOT NULL AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_session_id IS NOT NULL AND resolved_grant_id IS NOT NULL AND resolution_reason IS NOT NULL AND length(btrim(resolution_reason)) BETWEEN 1 AND 500 AND acknowledged_at IS NOT NULL AND blocks_duty))
);
CREATE INDEX food_incident_blocking ON food_assignment_incidents(assignment_id,id) WHERE blocks_duty AND resolved_at IS NULL;
CREATE INDEX food_incident_reporter ON food_assignment_incidents(reported_by,id);
CREATE TABLE food_incident_access_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL REFERENCES food_assignment_incidents,
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,
 grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_assignment_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_incident_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_assignment_incidents,food_incident_access_audit FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
CREATE FUNCTION food_incident_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_INCIDENT_HISTORY';END IF;
 IF (to_jsonb(NEW)-ARRAY['version','acknowledged_by','acknowledged_session_id','acknowledged_grant_id','acknowledged_at','acknowledgement_reason','resolution','resolved_by','resolved_session_id','resolved_grant_id','resolved_at','resolution_reason'])
 IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['version','acknowledged_by','acknowledged_session_id','acknowledged_grant_id','acknowledged_at','acknowledgement_reason','resolution','resolved_by','resolved_session_id','resolved_grant_id','resolved_at','resolution_reason'])
 OR OLD.acknowledged_at IS NOT NULL AND(NEW.acknowledged_by,NEW.acknowledged_session_id,NEW.acknowledged_grant_id,NEW.acknowledged_at,NEW.acknowledgement_reason) IS DISTINCT FROM(OLD.acknowledged_by,OLD.acknowledged_session_id,OLD.acknowledged_grant_id,OLD.acknowledged_at,OLD.acknowledgement_reason)
 OR OLD.resolved_at IS NOT NULL AND(NEW.resolution,NEW.resolved_by,NEW.resolved_session_id,NEW.resolved_grant_id,NEW.resolved_at,NEW.resolution_reason) IS DISTINCT FROM(OLD.resolution,OLD.resolved_by,OLD.resolved_session_id,OLD.resolved_grant_id,OLD.resolved_at,OLD.resolution_reason)
 OR NEW.version<>OLD.version+1 OR NOT(OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL OR OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL)
 THEN RAISE EXCEPTION 'IMMUTABLE_INCIDENT_HISTORY';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_incident_history BEFORE UPDATE OR DELETE ON food_assignment_incidents FOR EACH ROW EXECUTE FUNCTION food_incident_history_guard();
CREATE TRIGGER food_incident_access_immutable BEFORE UPDATE OR DELETE ON food_incident_access_audit FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_incident_payload_key(payload jsonb,fields text[],numbers text[]) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE name text;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& fields OR(SELECT count(*) FROM jsonb_object_keys(payload))<>cardinality(fields)
 OR jsonb_typeof(payload->'idempotencyKey') IS DISTINCT FROM 'string' OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOREACH name IN ARRAY numbers LOOP
  IF jsonb_typeof(payload->name) IS DISTINCT FROM 'string' OR(payload->>name)!~'^[1-9][0-9]{0,18}$' OR(payload->>name)::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 END LOOP;
 RETURN(payload->>'idempotencyKey')::uuid;
END $$;
CREATE FUNCTION food_incident_staff(merchant uuid,management boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;selected uuid;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 BEGIN
  SELECT g.id INTO selected FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
  WHERE g.account_id=actor AND g.role=ANY(CASE WHEN management THEN ARRAY['dispatcher','administrator'] ELSE ARRAY['support','dispatcher','administrator'] END)
  AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=merchant ORDER BY g.id LIMIT 1 FOR SHARE OF g,sc NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 IF selected IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 PERFORM dispatch_realtime_actor();
 IF NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.id=selected AND g.account_id=actor
 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=merchant) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN selected;
END $$;
CREATE FUNCTION food_incident_safe(i food_assignment_incidents) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('incidentId',(i).id,'assignmentId',(i).assignment_id,'shipmentId',(i).shipment_id,'generation',(i).generation::text,'leaseGeneration',(i).lease_generation::text,
 'incidentVersion',(i).version::text,'kind',(i).kind,'custodyPhase',(i).phase_at_report,'blocksDuty',(i).blocks_duty,'reportedAt',(i).created_at,
 'acknowledgedAt',(i).acknowledged_at,'resolvedAt',(i).resolved_at,'resolution',(i).resolution)
$$;
CREATE FUNCTION dispatch_food_report_incident(assignment uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;actor uuid;key uuid;digest text;prior food_dispatch_commands;i food_assignment_incidents;receipt jsonb;blocking boolean;at timestamptz;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','generation','leaseGeneration','kind','body'],ARRAY['generation','leaseGeneration']);
 IF jsonb_typeof(payload->'kind') IS DISTINCT FROM 'string' OR payload->>'kind' NOT IN('SUPPORT','SOS','COLLISION','HARASSMENT','MISSING_ITEM','CUSTODY','FRAUD')
 OR jsonb_typeof(payload->'body') IS DISTINCT FROM 'string' OR length(btrim(payload->>'body')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(assignment,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN
  IF prior.operation<>'incident-report' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  PERFORM dispatch_realtime_actor();RETURN prior.response;
 END IF;
 PERFORM 1 FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=a.driver_id FOR UPDATE;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=assignment FOR UPDATE;
 IF a.generation<>(payload->>'generation')::bigint OR a.lease_generation<>(payload->>'leaseGeneration')::bigint THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED';END IF;
 at:=clock_timestamp();blocking:=payload->>'kind'<>'SUPPORT' AND s.active_assignment_id=a.id AND a.closed_at IS NULL
 AND EXISTS(SELECT 1 FROM driver_assignment_leases WHERE id=a.lease_id AND state='ACTIVE');
 INSERT INTO food_assignment_incidents(assignment_id,shipment_id,driver_id,generation,lease_id,lease_generation,reported_by,reported_session_id,kind,private_body,phase_at_report,blocks_duty,created_at)
 VALUES(a.id,s.id,a.driver_id,a.generation,a.lease_id,a.lease_generation,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,payload->>'kind',payload->>'body',a.state,blocking,at) RETURNING * INTO i;
 IF blocking THEN
  UPDATE fulfillment_proofs SET revoked_at=at,revocation_reason='INCIDENT_REPORTED' WHERE assignment_id=a.id AND consumed_at IS NULL AND revoked_at IS NULL;
 END IF;
 PERFORM dispatch_event(s.id,'INCIDENT_REPORTED',jsonb_build_object('incidentId',i.id,'assignmentId',a.id,'kind',i.kind,'blocksDuty',blocking));
 SELECT * INTO STRICT s FROM food_shipments WHERE id=s.id;
 receipt:=jsonb_build_object('incident',food_incident_safe(i),'shipmentVersion',s.version::text,'paused',coalesce(s.active_assignment_id=a.id,false) AND EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL));
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'incident-report',digest,receipt);
 PERFORM dispatch_realtime_actor();RETURN receipt;
END $$;
CREATE FUNCTION dispatch_food_ack_incident(incident uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_assignment_incidents;s food_shipments;actor uuid;sponsor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;
BEGIN
 SELECT * INTO i FROM food_assignment_incidents WHERE id=incident;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(i.shipment_id);sponsor:=food_incident_staff(s.merchant_id);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(incident,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN
  IF prior.operation<>'incident-ack' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF food_incident_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;RETURN prior.response;
 END IF;
 SELECT * INTO STRICT i FROM food_assignment_incidents WHERE id=incident FOR UPDATE;
 IF i.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF i.acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'INCIDENT_ALREADY_ACKNOWLEDGED';END IF;
 UPDATE food_assignment_incidents SET version=version+1,acknowledged_by=actor,acknowledged_session_id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid,
 acknowledged_grant_id=sponsor,acknowledged_at=clock_timestamp(),acknowledgement_reason=payload->>'reason' WHERE id=i.id RETURNING * INTO i;
 PERFORM dispatch_event(s.id,'INCIDENT_ACKNOWLEDGED',jsonb_build_object('incidentId',i.id,'assignmentId',i.assignment_id));
 receipt:=jsonb_build_object('incident',food_incident_safe(i),'shipmentVersion',(SELECT version::text FROM food_shipments WHERE id=s.id),'paused',EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=s.active_assignment_id AND blocks_duty AND resolved_at IS NULL));
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'incident-ack',digest,receipt);
 IF food_incident_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;RETURN receipt;
END $$;
CREATE FUNCTION dispatch_food_resume_incidents(assignment uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;actor uuid;sponsor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;resolved integer;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);sponsor:=food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','generation','leaseGeneration','reason'],ARRAY['expectedVersion','generation','leaseGeneration']);
 IF jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(assignment,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN
  IF prior.operation<>'incident-resume' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF food_incident_staff(s.merchant_id,true) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;RETURN prior.response;
 END IF;
 PERFORM 1 FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;PERFORM 1 FROM driver_occupancy WHERE driver_id=a.driver_id FOR UPDATE;
 a:=dispatch_lock_assignment(a.id,(payload->>'generation')::bigint,(payload->>'leaseGeneration')::bigint);
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF a.state NOT IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF') THEN RAISE EXCEPTION 'DISPATCH_TRANSITION_INVALID';END IF;
 PERFORM 1 FROM food_assignment_incidents WHERE assignment_id=a.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL AND acknowledged_at IS NULL) THEN RAISE EXCEPTION 'INCIDENT_ACK_REQUIRED';END IF;
 UPDATE food_assignment_incidents SET version=version+1,resolution='SAME_CUSTODY_RESUMED',resolved_by=actor,resolved_session_id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid,
 resolved_grant_id=sponsor,resolved_at=clock_timestamp(),resolution_reason=payload->>'reason' WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL;
 GET DIAGNOSTICS resolved=ROW_COUNT;IF resolved=0 THEN RAISE EXCEPTION 'INCIDENT_NOT_PAUSED';END IF;
 -- Resolve under the root first, then run the ordinary professional/service gate.
 -- A failure rolls back every resolution, event and receipt; custody never moved.
 PERFORM food_driver_require_authority(a.driver_id,s.id);
 PERFORM dispatch_event(s.id,'INCIDENTS_RESUMED',jsonb_build_object('assignmentId',a.id,'resolvedCount',resolved));
 receipt:=jsonb_build_object('assignmentId',a.id,'shipmentId',s.id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
 'shipmentVersion',(SELECT version::text FROM food_shipments WHERE id=s.id),'state',a.state,'resolvedCount',resolved);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'incident-resume',digest,receipt);
 IF food_incident_staff(s.merchant_id,true) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 PERFORM food_driver_require_authority(a.driver_id,s.id);RETURN receipt;
END $$;
CREATE FUNCTION dispatch_food_incidents(assignment uuid,after_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;actor uuid;result jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT coalesce(jsonb_agg(food_incident_safe(i) ORDER BY i.id),'[]'::jsonb) INTO result FROM(SELECT * FROM food_assignment_incidents WHERE assignment_id=a.id AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT 31)i;
 PERFORM dispatch_realtime_actor();RETURN jsonb_build_object('incidents',CASE WHEN jsonb_array_length(result)>30 THEN result-30 ELSE result END,'nextCursor',CASE WHEN jsonb_array_length(result)>30 THEN result->29->>'incidentId' ELSE NULL END);
END $$;
CREATE FUNCTION dispatch_food_incident_queue(merchant uuid,after_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE sponsor uuid;result jsonb;
BEGIN
 sponsor:=food_incident_staff(merchant);
 SELECT coalesce(jsonb_agg(food_incident_safe(i) ORDER BY i.id),'[]'::jsonb) INTO result FROM(
 SELECT i.* FROM food_assignment_incidents i JOIN food_shipments s ON s.id=i.shipment_id WHERE s.merchant_id=merchant AND(after_id IS NULL OR i.id>after_id) ORDER BY i.id LIMIT 31)i;
 IF food_incident_staff(merchant) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN jsonb_build_object('incidents',CASE WHEN jsonb_array_length(result)>30 THEN result-30 ELSE result END,'nextCursor',CASE WHEN jsonb_array_length(result)>30 THEN result->29->>'incidentId' ELSE NULL END);
END $$;
CREATE FUNCTION dispatch_food_incident_inspect(incident uuid,purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_assignment_incidents;s food_shipments;actor uuid;sponsor uuid;audit uuid;
BEGIN
 IF purpose IS NULL OR length(btrim(purpose)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO i FROM food_assignment_incidents WHERE id=incident;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(i.shipment_id);sponsor:=food_incident_staff(s.merchant_id);actor:=dispatch_live_actor();
 SELECT * INTO STRICT i FROM food_assignment_incidents WHERE id=incident;
 INSERT INTO food_incident_access_audit(incident_id,actor_account_id,session_id,grant_id,purpose) VALUES(i.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,sponsor,purpose) RETURNING id INTO audit;
 IF food_incident_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN jsonb_build_object('incident',food_incident_safe(i),'body',i.private_body,'auditId',audit);
END $$;
REVOKE ALL ON FUNCTION food_incident_history_guard(),food_incident_payload_key(jsonb,text[],text[]),food_incident_staff(uuid,boolean),food_incident_safe(food_assignment_incidents),
 dispatch_food_report_incident(uuid,jsonb),dispatch_food_ack_incident(uuid,jsonb),dispatch_food_resume_incidents(uuid,jsonb),dispatch_food_incidents(uuid,uuid),dispatch_food_incident_queue(uuid,uuid),dispatch_food_incident_inspect(uuid,text)
 FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
GRANT EXECUTE ON FUNCTION dispatch_food_report_incident(uuid,jsonb),dispatch_food_ack_incident(uuid,jsonb),dispatch_food_resume_incidents(uuid,jsonb),dispatch_food_incidents(uuid,uuid),dispatch_food_incident_queue(uuid,uuid),dispatch_food_incident_inspect(uuid,text) TO bitpos_app;
CREATE OR REPLACE FUNCTION food_driver_authority(driver uuid,shipment uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid;branch uuid;p driver_profiles;v driver_vehicles;
BEGIN
 SELECT s.merchant_id,q.branch_id INTO merchant,branch FROM food_shipments s JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id) WHERE s.id=shipment;
 IF merchant IS NULL THEN RETURN 'FOOD_SERVICE_UNAVAILABLE';END IF;
 BEGIN
  PERFORM 1 FROM driver_profiles d JOIN driver_vehicles vehicle ON vehicle.driver_id=d.id JOIN mobile_accounts account ON account.id=d.account_id WHERE d.id=driver FOR SHARE OF d,vehicle,account NOWAIT;
  PERFORM 1 FROM driver_food_service_grants f JOIN platform_staff_role_grants g ON g.id=f.issued_grant_id JOIN mobile_accounts issuer ON issuer.id=g.account_id JOIN platform_role_scopes sc ON sc.grant_id=g.id AND sc.merchant_id=f.merchant_id
  WHERE f.driver_id=driver AND f.merchant_id=merchant AND f.branch_id=branch FOR SHARE OF f,g,issuer,sc NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 SELECT * INTO p FROM driver_profiles WHERE id=driver;SELECT * INTO v FROM driver_vehicles WHERE driver_id=driver;
 IF p.id IS NULL OR EXISTS(SELECT 1 FROM mobile_accounts WHERE id=p.account_id AND disabled_at IS NOT NULL) OR p.status='SUSPENDED' THEN RETURN 'DRIVER_SUSPENDED';END IF;
 IF p.status<>'APPROVED' OR p.verified_until IS NULL OR p.verified_until<=clock_timestamp() THEN RETURN 'DRIVER_VERIFICATION_REQUIRED';END IF;
 IF p.license_expires_at<=clock_timestamp() OR v.driver_id IS NULL OR v.registration_expires_at<=clock_timestamp() THEN RETURN 'DRIVER_DOCUMENT_EXPIRED';END IF;
 IF NOT food_discovery_grant_live(driver,merchant,branch) THEN RETURN 'FOOD_SERVICE_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM food_assignment_incidents i JOIN food_shipments s ON s.active_assignment_id=i.assignment_id WHERE s.id=shipment AND i.driver_id=driver AND i.blocks_duty AND i.resolved_at IS NULL) THEN RETURN 'INCIDENT';END IF;
 RETURN NULL;
END $$;
