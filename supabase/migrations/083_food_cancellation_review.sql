-- Customer cancellation review is triage, never order cancellation/refund execution.
SET search_path=bitpos,public;
CREATE TABLE food_cancellation_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shipment_id uuid NOT NULL REFERENCES food_shipments,requested_by uuid NOT NULL REFERENCES mobile_accounts,
 request_session_id uuid NOT NULL REFERENCES mobile_sessions,reason_code text NOT NULL CHECK(reason_code IN('NO_DRIVER','LATE_ORDER','WRONG_ORDER','CHANGE_OF_PLANS','OTHER')),
 private_detail text NOT NULL CHECK(length(btrim(private_detail)) BETWEEN 1 AND 2000),requested_shipment_version bigint NOT NULL CHECK(requested_shipment_version>0),
 requested_shipment_state text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES mobile_accounts,review_session_id uuid REFERENCES mobile_sessions,review_grant_id uuid REFERENCES platform_staff_role_grants,
 reviewed_at timestamptz,decision text CHECK(decision IN('COMPENSATION_REVIEW_REQUIRED','DECLINED')),customer_explanation text,
 reviewed_shipment_version bigint,reviewed_shipment_state text,
 CHECK((reviewed_at IS NULL AND reviewed_by IS NULL AND review_session_id IS NULL AND review_grant_id IS NULL AND decision IS NULL AND customer_explanation IS NULL AND reviewed_shipment_version IS NULL AND reviewed_shipment_state IS NULL)
 OR(reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_session_id IS NOT NULL AND review_grant_id IS NOT NULL AND decision IS NOT NULL AND customer_explanation IS NOT NULL AND length(btrim(customer_explanation)) BETWEEN 1 AND 500 AND reviewed_shipment_version IS NOT NULL AND reviewed_shipment_version>0 AND reviewed_shipment_state IS NOT NULL))
);
CREATE UNIQUE INDEX food_cancellation_one_open ON food_cancellation_reviews(shipment_id) WHERE reviewed_at IS NULL;
CREATE INDEX food_cancellation_own_history ON food_cancellation_reviews(requested_by,shipment_id,created_at DESC,id);
CREATE TABLE food_cancellation_review_access_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_id uuid NOT NULL REFERENCES food_cancellation_reviews,
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,
 purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE food_cancellation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_cancellation_review_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_cancellation_reviews,food_cancellation_review_access_audit FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
CREATE FUNCTION food_cancellation_review_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_CANCELLATION_REVIEW';END IF;
 IF(to_jsonb(NEW)-ARRAY['version','reviewed_by','review_session_id','review_grant_id','reviewed_at','decision','customer_explanation','reviewed_shipment_version','reviewed_shipment_state'])
 IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['version','reviewed_by','review_session_id','review_grant_id','reviewed_at','decision','customer_explanation','reviewed_shipment_version','reviewed_shipment_state'])
 OR OLD.reviewed_at IS NOT NULL OR NEW.reviewed_at IS NULL OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'IMMUTABLE_CANCELLATION_REVIEW';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_cancellation_review_history BEFORE UPDATE OR DELETE ON food_cancellation_reviews FOR EACH ROW EXECUTE FUNCTION food_cancellation_review_history_guard();
CREATE TRIGGER food_cancellation_review_access_immutable BEFORE UPDATE OR DELETE ON food_cancellation_review_access_audit FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_cancellation_review_safe(r food_cancellation_reviews) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('reviewId',(r).id,'shipmentId',(r).shipment_id,'reviewVersion',(r).version::text,'reasonCode',(r).reason_code,
 'requestedShipmentVersion',(r).requested_shipment_version::text,'requestedShipmentState',(r).requested_shipment_state,'requestedAt',(r).created_at,
 'state',CASE WHEN(r).reviewed_at IS NULL THEN 'OPEN' ELSE 'REVIEWED' END)
 ||CASE WHEN(r).reviewed_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reviewedAt',(r).reviewed_at,'decision',(r).decision,'customerExplanation',(r).customer_explanation,
 'reviewedShipmentVersion',(r).reviewed_shipment_version::text,'reviewedShipmentState',(r).reviewed_shipment_state) END
$$;
CREATE FUNCTION dispatch_customer_cancellation_review_request(oid uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;actor uuid;key uuid;digest text;prior food_dispatch_commands;r food_cancellation_reviews;receipt jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;s:=dispatch_lock_root(s.id);PERFORM dispatch_realtime_actor();
 IF s.account_id<>dispatch_live_actor() THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','reasonCode','detail'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'reasonCode') IS DISTINCT FROM 'string' OR payload->>'reasonCode' NOT IN('NO_DRIVER','LATE_ORDER','WRONG_ORDER','CHANGE_OF_PLANS','OTHER')
 OR jsonb_typeof(payload->'detail') IS DISTINCT FROM 'string' OR length(btrim(payload->>'detail')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(oid,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'cancellation-review-request' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;PERFORM dispatch_realtime_actor();RETURN prior.response;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM food_cancellation_reviews WHERE shipment_id=s.id AND reviewed_at IS NULL) THEN RAISE EXCEPTION 'CANCELLATION_REVIEW_OPEN';END IF;
 INSERT INTO food_cancellation_reviews(shipment_id,requested_by,request_session_id,reason_code,private_detail,requested_shipment_version,requested_shipment_state)
 VALUES(s.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,payload->>'reasonCode',payload->>'detail',s.version,s.state) RETURNING * INTO r;
 PERFORM dispatch_event(s.id,'CANCELLATION_REVIEW_REQUESTED',jsonb_build_object('reviewId',r.id,'reasonCode',r.reason_code));
 SELECT * INTO STRICT s FROM food_shipments WHERE id=s.id;
 receipt:=jsonb_build_object('review',food_cancellation_review_safe(r),'shipmentVersion',s.version::text,'orderCancelled',false,'refundExecuted',false,'custodyReleased',false,'stockReturned',false);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'cancellation-review-request',digest,receipt);
 PERFORM dispatch_realtime_actor();RETURN receipt;
END $$;
CREATE FUNCTION dispatch_customer_cancellation_reviews(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;s food_shipments;items jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;s:=dispatch_lock_root(s.id);PERFORM dispatch_realtime_actor();
 IF s.account_id<>dispatch_live_actor() THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT coalesce(jsonb_agg(food_cancellation_review_safe(r) ORDER BY r.created_at DESC,r.id),'[]') INTO items FROM(SELECT * FROM food_cancellation_reviews WHERE shipment_id=s.id AND requested_by=actor ORDER BY created_at DESC,id LIMIT 20)r;
 PERFORM dispatch_realtime_actor();RETURN jsonb_build_object('items',items,'historyLimit',20,'shipmentVersion',s.version::text,'shipmentState',s.state);
END $$;
CREATE FUNCTION dispatch_food_cancellation_review_queue(merchant uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE items jsonb;
BEGIN
 -- Reuse081's exact live scoped support/dispatcher/administrator authority policy.
 PERFORM food_incident_staff(merchant);
 SELECT coalesce(jsonb_agg(food_cancellation_review_safe(r) ORDER BY r.created_at DESC,r.id),'[]') INTO items FROM(
 SELECT r.* FROM food_cancellation_reviews r JOIN food_shipments s ON s.id=r.shipment_id WHERE s.merchant_id=merchant ORDER BY r.created_at DESC,r.id LIMIT 50)r;
 PERFORM food_incident_staff(merchant);RETURN jsonb_build_object('items',items,'historyLimit',50);
END $$;
CREATE FUNCTION dispatch_food_cancellation_review_snapshot(review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_cancellation_reviews;s food_shipments;result jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();SELECT * INTO r FROM food_cancellation_reviews WHERE id=review;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);PERFORM food_incident_staff(s.merchant_id);SELECT * INTO STRICT r FROM food_cancellation_reviews WHERE id=review FOR SHARE;
 result:=jsonb_build_object('review',food_cancellation_review_safe(r),'shipmentVersion',s.version::text,'shipmentState',s.state);
 PERFORM food_incident_staff(s.merchant_id);RETURN result;
END $$;
CREATE FUNCTION dispatch_food_cancellation_review_inspect(review uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_cancellation_reviews;s food_shipments;grant_id uuid;audit_id uuid;actor uuid;
BEGIN
 PERFORM dispatch_realtime_actor();SELECT * INTO r FROM food_cancellation_reviews WHERE id=review;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);grant_id:=food_incident_staff(s.merchant_id);actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ? 'purpose' OR(SELECT count(*) FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'purpose') IS DISTINCT FROM 'string' OR length(btrim(payload->>'purpose')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 INSERT INTO food_cancellation_review_access_audit(review_id,actor_account_id,session_id,grant_id,purpose)
 VALUES(r.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,grant_id,payload->>'purpose') RETURNING id INTO audit_id;
 IF food_incident_staff(s.merchant_id)<>grant_id THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN jsonb_build_object('reviewId',r.id,'detail',r.private_detail,'inspectionId',audit_id);
END $$;
CREATE FUNCTION dispatch_food_cancellation_review_disposition(review uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_cancellation_reviews;s food_shipments;grant_id uuid;actor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();SELECT * INTO r FROM food_cancellation_reviews WHERE id=review;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);grant_id:=food_incident_staff(s.merchant_id);actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedReviewVersion','expectedShipmentVersion','decision','customerExplanation'],ARRAY['expectedReviewVersion','expectedShipmentVersion']);
 IF jsonb_typeof(payload->'decision') IS DISTINCT FROM 'string' OR payload->>'decision' NOT IN('COMPENSATION_REVIEW_REQUIRED','DECLINED') OR jsonb_typeof(payload->'customerExplanation') IS DISTINCT FROM 'string' OR length(btrim(payload->>'customerExplanation')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(review,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'cancellation-review-disposition' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;PERFORM food_incident_staff(s.merchant_id);RETURN prior.response;END IF;
 SELECT * INTO STRICT r FROM food_cancellation_reviews WHERE id=review FOR UPDATE;
 IF r.version<>(payload->>'expectedReviewVersion')::bigint OR s.version<>(payload->>'expectedShipmentVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF r.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_REVIEW_CLOSED';END IF;
 UPDATE food_cancellation_reviews SET version=version+1,reviewed_by=actor,review_session_id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid,
 review_grant_id=grant_id,reviewed_at=clock_timestamp(),decision=payload->>'decision',customer_explanation=payload->>'customerExplanation',reviewed_shipment_version=s.version,reviewed_shipment_state=s.state WHERE id=r.id RETURNING * INTO r;
 PERFORM dispatch_event(s.id,'CANCELLATION_REVIEW_DISPOSITION',jsonb_build_object('reviewId',r.id,'decision',r.decision));SELECT * INTO STRICT s FROM food_shipments WHERE id=s.id;
 receipt:=jsonb_build_object('review',food_cancellation_review_safe(r),'shipmentVersion',s.version::text,'orderCancelled',false,'refundExecuted',false,'custodyReleased',false,'stockReturned',false);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'cancellation-review-disposition',digest,receipt);
 IF food_incident_staff(s.merchant_id)<>grant_id THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_cancellation_review_history_guard(),food_cancellation_review_safe(food_cancellation_reviews),dispatch_customer_cancellation_review_request(uuid,jsonb),dispatch_customer_cancellation_reviews(uuid),dispatch_food_cancellation_review_queue(uuid),dispatch_food_cancellation_review_snapshot(uuid),dispatch_food_cancellation_review_inspect(uuid,jsonb),dispatch_food_cancellation_review_disposition(uuid,jsonb) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_customer_cancellation_review_request(uuid,jsonb),dispatch_customer_cancellation_reviews(uuid),dispatch_food_cancellation_review_queue(uuid),dispatch_food_cancellation_review_snapshot(uuid),dispatch_food_cancellation_review_inspect(uuid,jsonb),dispatch_food_cancellation_review_disposition(uuid,jsonb) TO bitpos_app;
