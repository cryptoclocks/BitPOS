-- Private failure/return evidence candidate. No public route or checkout/custody
-- admission until terminal resolution and financial policy are joined/reviewed.
SET search_path=bitpos,public;
CREATE TABLE food_return108_cases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shipment_id uuid NOT NULL,assignment_id uuid NOT NULL UNIQUE,
 generation bigint NOT NULL,lease_generation bigint NOT NULL,requested_by uuid NOT NULL REFERENCES mobile_accounts,
 requested_session uuid NOT NULL REFERENCES mobile_sessions,requested_grant uuid NOT NULL REFERENCES platform_staff_role_grants,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500),
 FOREIGN KEY(assignment_id,shipment_id)REFERENCES food_assignments(id,shipment_id)
);
CREATE TABLE food_return108_receipts(
 case_id uuid PRIMARY KEY REFERENCES food_return108_cases,merchant_id uuid NOT NULL REFERENCES merchants,
 received_by uuid NOT NULL,received_session_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 condition text NOT NULL CHECK(condition IN('SEALED','OPENED','DAMAGED')),reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500)
);
CREATE TABLE food_return108_commands(
 actor_key text NOT NULL,command_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('REQUEST','RECEIVE')),
 request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_key,command_id)
);
ALTER TABLE food_return108_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_return108_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_return108_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_return108_cases,food_return108_receipts,food_return108_commands FROM PUBLIC,bitpos_app;
CREATE TRIGGER food_return108_cases_immutable BEFORE UPDATE OR DELETE ON food_return108_cases FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER food_return108_receipts_immutable BEFORE UPDATE OR DELETE ON food_return108_receipts FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER food_return108_commands_immutable BEFORE UPDATE OR DELETE ON food_return108_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_return108_request(assignment uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;actor uuid;grant_id uuid;key uuid;digest text;c food_return108_cases;prior food_return108_commands;receipt jsonb;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);grant_id:=food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','generation','leaseGeneration','reason'],ARRAY['expectedVersion','generation','leaseGeneration']);
 IF jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(assignment,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('return108:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_return108_commands WHERE actor_key='mobile:'||actor::text AND command_id=key;
 IF FOUND THEN
  IF prior.operation<>'REQUEST'OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;
 END IF;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=assignment FOR UPDATE;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF a.generation<>(payload->>'generation')::bigint OR a.lease_generation<>(payload->>'leaseGeneration')::bigint THEN RAISE EXCEPTION 'ASSIGNMENT_CHANGED';END IF;
 IF s.active_assignment_id IS DISTINCT FROM a.id OR a.closed_at IS NOT NULL OR a.picked_up_at IS NULL OR a.state NOT IN('PICKED_UP','AT_DROPOFF')
 OR NOT EXISTS(SELECT 1 FROM driver_assignment_leases WHERE id=a.lease_id AND state='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL)
 THEN RAISE EXCEPTION 'RETURN_REQUIRES_RETAINED_INCIDENT';END IF;
 IF EXISTS(SELECT 1 FROM food_return108_cases WHERE assignment_id=a.id)THEN RAISE EXCEPTION 'RETURN_CASE_EXISTS';END IF;
 INSERT INTO food_return108_cases(shipment_id,assignment_id,generation,lease_generation,requested_by,requested_session,requested_grant,reason)
 VALUES(s.id,a.id,a.generation,a.lease_generation,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,grant_id,payload->>'reason')RETURNING * INTO c;
 PERFORM dispatch_event(s.id,'RETURN_REQUESTED',jsonb_build_object('caseId',c.id,'assignmentId',a.id));
 receipt:=jsonb_build_object('caseId',c.id,'assignmentId',a.id,'state','RETURN_REQUESTED','custodyReleased',false,'financialResolutionReady',false);
 INSERT INTO food_return108_commands(actor_key,command_id,operation,request_hash,response)VALUES('mobile:'||actor::text,key,'REQUEST',digest,receipt);
 PERFORM food_incident_staff(s.merchant_id,true);RETURN receipt;
END $$;
CREATE FUNCTION food_return108_receive(case_id uuid,session_hash text,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;a food_assignments;actor uuid;merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;key uuid;digest text;prior food_return108_commands;receipt jsonb;
BEGIN
 SELECT r.* INTO c FROM food_return108_cases r JOIN food_shipments fs ON fs.id=r.shipment_id WHERE r.id=case_id AND fs.merchant_id=merchant;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(c.shipment_id);
 -- Live merchant membership is checked server-side, including exact retries.
 BEGIN
  SELECT se.user_id INTO actor FROM sessions se JOIN members m ON(m.merchant_id,m.user_id)=(se.merchant_id,se.user_id)
  WHERE se.token_hash=session_hash AND se.merchant_id=merchant AND se.expires_at>clock_timestamp()AND m.role IN('owner','manager')FOR SHARE OF se,m NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 IF actor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','condition','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'condition')IS DISTINCT FROM 'string'OR payload->>'condition'NOT IN('SEALED','OPENED','DAMAGED')
 OR jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(case_id,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('return108:merchant:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_return108_commands WHERE actor_key='merchant:'||actor::text AND command_id=key;
 IF FOUND THEN
  IF prior.operation<>'RECEIVE'OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;
 END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=c.assignment_id FOR UPDATE;
 IF s.active_assignment_id IS DISTINCT FROM a.id OR a.closed_at IS NOT NULL OR a.picked_up_at IS NULL OR a.generation<>c.generation OR a.lease_generation<>c.lease_generation
 OR NOT EXISTS(SELECT 1 FROM driver_assignment_leases WHERE id=a.lease_id AND state='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL)
 THEN RAISE EXCEPTION 'RETURN_ASSIGNMENT_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM food_return108_receipts WHERE food_return108_receipts.case_id=c.id)THEN RAISE EXCEPTION 'RETURN_ALREADY_RECORDED';END IF;
 INSERT INTO food_return108_receipts(case_id,merchant_id,received_by,received_session_hash,condition,reason)VALUES(c.id,merchant,actor,session_hash,payload->>'condition',payload->>'reason');
 PERFORM dispatch_event(s.id,'RETURN_RECEIVED',jsonb_build_object('caseId',c.id,'assignmentId',a.id));
 receipt:=jsonb_build_object('caseId',c.id,'assignmentId',a.id,'state','RETURN_RECORDED','custodyReleased',false,'financialResolutionReady',false);
 INSERT INTO food_return108_commands(actor_key,command_id,operation,request_hash,response)VALUES('merchant:'||actor::text,key,'RECEIVE',digest,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_return108_request(uuid,jsonb),food_return108_receive(uuid,text,jsonb)FROM PUBLIC,bitpos_app;
-- Preserve the current authority routine byte-for-byte as a private delegate;
-- keep the public function OID/grants so existing callers acquire the new gate.
DO $migration$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('bitpos.dispatch_food_resume_incidents(uuid,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'f74fd908b999463746dd4a3c7acc2e693b61dae5c56a9d3beee76afe9114acbf'
 THEN RAISE EXCEPTION 'RETURN108_RESUME_SOURCE_REVIEW_REQUIRED';END IF;
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION bitpos.dispatch_food_resume_incidents(', 'CREATE OR REPLACE FUNCTION bitpos.food_return108_resume_base(');
 EXECUTE definition;
END $migration$;
REVOKE ALL ON FUNCTION food_return108_resume_base(uuid,jsonb)FROM PUBLIC,bitpos_app;
CREATE OR REPLACE FUNCTION dispatch_food_resume_incidents(assignment uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 -- Same root order as request/receive: return request and resume serialize.
 s:=dispatch_lock_root(a.shipment_id);
 PERFORM food_incident_staff(s.merchant_id,true);
 IF EXISTS(SELECT 1 FROM food_return108_cases WHERE assignment_id=a.id)THEN RAISE EXCEPTION 'RETURN_CASE_REQUIRES_RESOLUTION';END IF;
 RETURN food_return108_resume_base(assignment,payload);
END $$;

-- Operational return completion is distinct from money execution. No refund,
-- earning, restock or compensated amount is inferred from this decision.
ALTER TABLE food_assignments DROP CONSTRAINT food_assignments_state_check;
ALTER TABLE food_assignments ADD CONSTRAINT food_assignments_state_check CHECK(state IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT','RETURNED'));
ALTER TABLE food_assignment_incidents DROP CONSTRAINT food_assignment_incidents_resolution_check;
ALTER TABLE food_assignment_incidents ADD CONSTRAINT food_assignment_incidents_resolution_check CHECK(resolution IN('SAME_CUSTODY_RESUMED','RETURNED_TO_MERCHANT'));
CREATE TABLE food_return108_resolutions(
 case_id uuid PRIMARY KEY REFERENCES food_return108_receipts(case_id),resolved_by uuid NOT NULL REFERENCES mobile_accounts,
 resolved_session uuid NOT NULL REFERENCES mobile_sessions,resolved_grant uuid NOT NULL REFERENCES platform_staff_role_grants,
 resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500)
);
CREATE TABLE food_return108_financial_reviews(
 case_id uuid PRIMARY KEY REFERENCES food_return108_resolutions,merchant_id uuid NOT NULL,order_id uuid NOT NULL,
 quote_id uuid NOT NULL,catalog_currency text NOT NULL,catalog_decimals integer NOT NULL,catalog_total_minor bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,order_id)REFERENCES order_authority(merchant_id,order_id),
 FOREIGN KEY(merchant_id,quote_id)REFERENCES order_quotes(merchant_id,id),
 CHECK(catalog_total_minor>=0)
);
ALTER TABLE food_return108_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_return108_financial_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_return108_resolutions,food_return108_financial_reviews FROM PUBLIC,bitpos_app;
CREATE TRIGGER food_return108_resolution_immutable BEFORE UPDATE OR DELETE ON food_return108_resolutions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER food_return108_review_immutable BEFORE UPDATE OR DELETE ON food_return108_financial_reviews FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
-- Widen only the private command operation domain for an explicit resolution.
ALTER TABLE food_return108_commands DROP CONSTRAINT food_return108_commands_operation_check;
ALTER TABLE food_return108_commands ADD CONSTRAINT food_return108_commands_operation_check CHECK(operation IN('REQUEST','RECEIVE','RESOLVE'));
CREATE FUNCTION food_return108_resolve(case_id uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;a food_assignments;authority order_authority;
 actor uuid;sponsor uuid;key uuid;digest text;prior food_return108_commands;receipt jsonb;at timestamptz;
BEGIN
 SELECT * INTO c FROM food_return108_cases WHERE id=case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(c.shipment_id);sponsor:=food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(case_id,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('return108:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_return108_commands WHERE actor_key='mobile:'||actor::text AND command_id=key;
 IF FOUND THEN
  IF prior.operation<>'RESOLVE'OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;
 END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM food_return108_receipts r WHERE r.case_id=c.id)THEN RAISE EXCEPTION 'RETURN_RECEIPT_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM food_return108_resolutions r WHERE r.case_id=c.id)THEN RAISE EXCEPTION 'RETURN_ALREADY_RESOLVED';END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=(SELECT driver_id FROM food_assignments WHERE id=c.assignment_id)FOR UPDATE;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=c.assignment_id FOR UPDATE;
 PERFORM 1 FROM driver_assignment_leases WHERE id=a.lease_id FOR UPDATE;
 IF s.active_assignment_id IS DISTINCT FROM a.id OR a.closed_at IS NOT NULL OR a.picked_up_at IS NULL OR a.state NOT IN('PICKED_UP','AT_DROPOFF')
 OR a.generation<>c.generation OR a.lease_generation<>c.lease_generation
 OR NOT EXISTS(SELECT 1 FROM driver_assignment_leases WHERE id=a.lease_id AND state='ACTIVE')THEN RAISE EXCEPTION 'RETURN_ASSIGNMENT_CHANGED';END IF;
 IF NOT EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL AND acknowledged_at IS NULL)THEN RAISE EXCEPTION 'INCIDENT_ACK_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM earning_accruals WHERE food_assignment_id=a.id)THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT * INTO STRICT authority FROM order_authority WHERE merchant_id=s.merchant_id AND order_id=s.order_id;
 at:=clock_timestamp();
 INSERT INTO food_return108_resolutions(case_id,resolved_by,resolved_session,resolved_grant,resolved_at,reason)VALUES(c.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,sponsor,at,payload->>'reason');
 INSERT INTO food_return108_financial_reviews(case_id,merchant_id,order_id,quote_id,catalog_currency,catalog_decimals,catalog_total_minor)
 VALUES(c.id,s.merchant_id,s.order_id,s.quote_id,authority.catalog_currency,authority.catalog_decimals,authority.total_minor);
 UPDATE fulfillment_proofs SET revoked_at=at,revocation_reason='RETURN_CONFIRMED'WHERE assignment_id=a.id AND consumed_at IS NULL AND revoked_at IS NULL;
 UPDATE food_assignment_incidents SET version=version+1,resolution='RETURNED_TO_MERCHANT',resolved_by=actor,
 resolved_session_id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid,resolved_grant_id=sponsor,resolved_at=at,resolution_reason=payload->>'reason'
 WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL;
 UPDATE food_assignments SET state='RETURNED',closed_at=at WHERE id=a.id;
 UPDATE driver_assignment_leases SET state='RELEASED',released_at=at WHERE id=a.lease_id;
 UPDATE food_shipments SET state='FAILED',active_assignment_id=NULL WHERE id=s.id;
 PERFORM dispatch_event(s.id,'DELIVERY_RETURN_RESOLVED',jsonb_build_object('caseId',c.id,'assignmentId',a.id,'financialReview','PENDING'));
 receipt:=jsonb_build_object('caseId',c.id,'assignmentId',a.id,'state','RETURN_RESOLVED','custodyReleased',true,'financialReview','PENDING','fundsTransferred',false,'stockRestored',false);
 INSERT INTO food_return108_commands(actor_key,command_id,operation,request_hash,response)VALUES('mobile:'||actor::text,key,'RESOLVE',digest,receipt);
 PERFORM food_incident_staff(s.merchant_id,true);RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_return108_resolve(uuid,jsonb)FROM PUBLIC,bitpos_app;
-- Add RETURNED to the existing immutable-history closure predicate without
-- replacing or relaxing any of its other identity/custody checks.
DO $migration$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('bitpos.food_assignment_recovery_identity()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'8987b9b5d709376894a9ac0f71c50c150417a6a36c680bdbd93cab3ec3ac8e22'
 OR position('NEW.state IN(''RELEASED'',''DELIVERED'')'IN definition)=0 THEN RAISE EXCEPTION 'RETURN108_IDENTITY_SOURCE_REVIEW_REQUIRED';END IF;
 EXECUTE replace(definition,'NEW.state IN(''RELEASED'',''DELIVERED'')','NEW.state IN(''RELEASED'',''DELIVERED'',''RETURNED'')');
END $migration$;
CREATE FUNCTION food_return108_assignment_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NEW.state='RETURNED'AND OLD.state<>'RETURNED'AND(
 OLD.state NOT IN('PICKED_UP','AT_DROPOFF')OR NEW.picked_up_at IS NULL OR NEW.closed_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM food_return108_cases c JOIN food_return108_receipts r ON r.case_id=c.id
 JOIN food_return108_resolutions done ON done.case_id=c.id JOIN food_return108_financial_reviews review ON review.case_id=c.id
 WHERE c.assignment_id=NEW.id AND c.generation=NEW.generation AND c.lease_generation=NEW.lease_generation AND done.resolved_at=NEW.closed_at))
 THEN RAISE EXCEPTION 'RETURN_RESOLUTION_REQUIRED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_return108_assignment_guard BEFORE UPDATE ON food_assignments FOR EACH ROW EXECUTE FUNCTION food_return108_assignment_guard();
CREATE FUNCTION food_return108_graph()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE target uuid;a food_assignments;s food_shipments;l driver_assignment_leases;r food_return108_resolutions;
BEGIN
 IF TG_TABLE_NAME='food_shipments'THEN
  SELECT id INTO target FROM food_assignments WHERE shipment_id=NEW.id AND state='RETURNED';
 ELSIF TG_TABLE_NAME='driver_assignment_leases'THEN target:=NEW.food_assignment_id;
 ELSIF TG_TABLE_NAME='food_return108_resolutions'THEN SELECT assignment_id INTO target FROM food_return108_cases WHERE id=NEW.case_id;
 ELSE target:=NEW.id;END IF;
 IF target IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO a FROM food_assignments WHERE id=target;
 SELECT done.* INTO r FROM food_return108_resolutions done JOIN food_return108_cases c ON c.id=done.case_id WHERE c.assignment_id=target;
 IF a.state<>'RETURNED'AND r.case_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO s FROM food_shipments WHERE id=a.shipment_id;SELECT * INTO l FROM driver_assignment_leases WHERE id=a.lease_id;
 IF a.state<>'RETURNED'OR a.closed_at IS NULL OR r.case_id IS NULL OR r.resolved_at IS DISTINCT FROM a.closed_at
 OR s.state<>'FAILED'OR s.active_assignment_id IS NOT NULL OR l.state<>'RELEASED'OR l.released_at IS DISTINCT FROM a.closed_at
 OR EXISTS(SELECT 1 FROM earning_accruals WHERE food_assignment_id=a.id)
 THEN RAISE EXCEPTION 'RETURN_RESOLUTION_GRAPH' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER food_return108_assignment_graph AFTER INSERT OR UPDATE ON food_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_return108_graph();
CREATE CONSTRAINT TRIGGER food_return108_shipment_graph AFTER UPDATE ON food_shipments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_return108_graph();
CREATE CONSTRAINT TRIGGER food_return108_lease_graph AFTER UPDATE ON driver_assignment_leases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_return108_graph();
CREATE CONSTRAINT TRIGGER food_return108_resolution_graph AFTER INSERT ON food_return108_resolutions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION food_return108_graph();
REVOKE ALL ON FUNCTION food_return108_assignment_guard(),food_return108_graph()FROM PUBLIC,bitpos_app;
ALTER TABLE food_assignment_incidents DROP CONSTRAINT food_assignment_incidents_phase_at_report_check;
ALTER TABLE food_assignment_incidents ADD CONSTRAINT food_assignment_incidents_phase_at_report_check CHECK(phase_at_report IN('ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT','RETURNED'));
-- Prevent later earning insertion from bypassing the returned-assignment graph.
CREATE FUNCTION food_return108_earning_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM food_assignments WHERE id=NEW.food_assignment_id AND state='RETURNED')
 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_return108_earning_guard BEFORE INSERT OR UPDATE ON earning_accruals FOR EACH ROW EXECUTE FUNCTION food_return108_earning_guard();
REVOKE ALL ON FUNCTION food_return108_earning_guard()FROM PUBLIC,bitpos_app;
CREATE FUNCTION food_return108_snapshot(assignment uuid,merchant_session_hash text DEFAULT NULL)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;c food_return108_cases;r food_return108_receipts;done food_return108_resolutions;actor uuid;
BEGIN
 SELECT * INTO a FROM food_assignments WHERE id=assignment;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);
 IF merchant_session_hash IS NULL THEN PERFORM food_incident_staff(s.merchant_id);
 ELSE
  IF s.merchant_id::text IS DISTINCT FROM current_setting('bitpos.merchant',true)THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  BEGIN
   SELECT se.user_id INTO actor FROM sessions se JOIN members m ON(m.merchant_id,m.user_id)=(se.merchant_id,se.user_id)
   WHERE se.token_hash=merchant_session_hash AND se.merchant_id=s.merchant_id AND se.expires_at>clock_timestamp()AND m.role IN('owner','manager')FOR SHARE OF se,m NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
  IF actor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 END IF;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=assignment;
 SELECT * INTO c FROM food_return108_cases WHERE assignment_id=a.id;
 IF c.id IS NULL THEN RETURN jsonb_build_object('assignmentId',a.id,'shipmentVersion',s.version::text,'case',NULL);END IF;
 SELECT * INTO r FROM food_return108_receipts WHERE case_id=c.id;SELECT * INTO done FROM food_return108_resolutions WHERE case_id=c.id;
 RETURN jsonb_build_object('assignmentId',a.id,'shipmentVersion',s.version::text,'case',jsonb_build_object(
 'caseId',c.id,'state',CASE WHEN done.case_id IS NOT NULL THEN 'RETURN_RESOLVED'WHEN r.case_id IS NOT NULL THEN 'RETURN_RECORDED'ELSE 'RETURN_REQUESTED'END,
 'requestedAt',c.requested_at,'receivedAt',r.received_at,'condition',r.condition,'resolvedAt',done.resolved_at,
 'custodyReleased',done.case_id IS NOT NULL,'financialReview',CASE WHEN done.case_id IS NOT NULL THEN 'PENDING'ELSE 'NOT_OPENED'END));
END $$;
REVOKE ALL ON FUNCTION food_return108_snapshot(uuid,text)FROM PUBLIC,bitpos_app;
