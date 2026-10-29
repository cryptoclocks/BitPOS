-- Forward083 correction: canonical root before retained account/session locks.
SET search_path=bitpos,public;
CREATE OR REPLACE FUNCTION dispatch_customer_cancellation_review_request(oid uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;actor uuid;key uuid;digest text;prior food_dispatch_commands;r food_cancellation_reviews;receipt jsonb;
BEGIN
 actor:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
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
CREATE OR REPLACE FUNCTION dispatch_customer_cancellation_reviews(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;s food_shipments;items jsonb;
BEGIN
 actor:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;s:=dispatch_lock_root(s.id);PERFORM dispatch_realtime_actor();
 IF s.account_id<>dispatch_live_actor() THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT coalesce(jsonb_agg(food_cancellation_review_safe(r) ORDER BY r.created_at DESC,r.id),'[]') INTO items FROM(SELECT * FROM food_cancellation_reviews WHERE shipment_id=s.id AND requested_by=actor ORDER BY created_at DESC,id LIMIT 20)r;
 PERFORM dispatch_realtime_actor();RETURN jsonb_build_object('items',items,'historyLimit',20,'shipmentVersion',s.version::text,'shipmentState',s.state);
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_cancellation_review_snapshot(review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_cancellation_reviews;s food_shipments;result jsonb;
BEGIN
 SELECT * INTO r FROM food_cancellation_reviews WHERE id=review;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);PERFORM food_incident_staff(s.merchant_id);SELECT * INTO STRICT r FROM food_cancellation_reviews WHERE id=review FOR SHARE;
 result:=jsonb_build_object('review',food_cancellation_review_safe(r),'shipmentVersion',s.version::text,'shipmentState',s.state);
 PERFORM food_incident_staff(s.merchant_id);RETURN result;
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_cancellation_review_inspect(review uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_cancellation_reviews;s food_shipments;grant_id uuid;audit_id uuid;actor uuid;
BEGIN
 SELECT * INTO r FROM food_cancellation_reviews WHERE id=review;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);grant_id:=food_incident_staff(s.merchant_id);actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ? 'purpose' OR(SELECT count(*) FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'purpose') IS DISTINCT FROM 'string' OR length(btrim(payload->>'purpose')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 INSERT INTO food_cancellation_review_access_audit(review_id,actor_account_id,session_id,grant_id,purpose)
 VALUES(r.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,grant_id,payload->>'purpose') RETURNING id INTO audit_id;
 IF food_incident_staff(s.merchant_id)<>grant_id THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN jsonb_build_object('reviewId',r.id,'detail',r.private_detail,'inspectionId',audit_id);
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_cancellation_review_disposition(review uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_cancellation_reviews;s food_shipments;grant_id uuid;actor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;
BEGIN
 SELECT * INTO r FROM food_cancellation_reviews WHERE id=review;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
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
