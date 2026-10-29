-- Verified owned-order reviews. No client claims of paid/delivered/driver identity.
SET search_path=bitpos,public;
CREATE TABLE mobile_food_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES mobile_accounts,
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,branch_id uuid NOT NULL,driver_id uuid REFERENCES driver_profiles,
 stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),driver_stars integer CHECK(driver_stars BETWEEN 1 AND 5),
 body text NOT NULL CHECK(length(body)<=2000),state text NOT NULL CHECK(state IN('PENDING','PUBLISHED','REJECTED','WITHDRAWN')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),feedback text NOT NULL DEFAULT '' CHECK(length(feedback)<=300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id)REFERENCES online_food_orders,
 FOREIGN KEY(merchant_id,branch_id)REFERENCES marketplace_branches, CHECK(driver_stars IS NULL OR driver_id IS NOT NULL)
);
CREATE INDEX mobile_review_public_branch ON mobile_food_reviews(branch_id,created_at,id)WHERE state='PUBLISHED';
CREATE TABLE mobile_food_review_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,request_hash text NOT NULL,
 review_id uuid NOT NULL REFERENCES mobile_food_reviews,session_id uuid NOT NULL REFERENCES mobile_sessions,
 grant_id uuid REFERENCES platform_staff_role_grants,operation text NOT NULL CHECK(operation IN('SUBMIT','WITHDRAW','PUBLISH','REJECT')),
 reason text NOT NULL CHECK(length(reason)<=300),receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,command_id)
);
ALTER TABLE mobile_food_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_food_review_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_food_reviews,mobile_food_review_commands FROM PUBLIC,bitpos_app;
CREATE TRIGGER mobile_review_commands_immutable BEFORE UPDATE OR DELETE ON mobile_food_review_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_review_safe(r mobile_food_reviews) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',(r).id,'orderId',(r).order_id,'stars',(r).stars,'driverStars',(r).driver_stars,'body',(r).body,'state',(r).state,'version',(r).version::text,'feedback',(r).feedback,'createdAt',(r).created_at,'updatedAt',(r).updated_at)
$$;
CREATE FUNCTION food_review_eligible(oid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM online_food_orders f JOIN orders o ON(o.merchant_id,o.id)=(f.merchant_id,f.order_id)
 JOIN order_fulfillment k ON(k.merchant_id,k.order_id)=(f.merchant_id,f.order_id)
 JOIN order_authority a ON(a.merchant_id,a.order_id)=(f.merchant_id,f.order_id)
 WHERE f.order_id=oid AND o.status='PAID' AND f.acceptance_status='ACCEPTED' AND k.status='COLLECTED'
 AND(a.serving_kind<>'delivery' OR EXISTS(SELECT 1 FROM food_shipments s JOIN food_assignments d ON d.shipment_id=s.id
 WHERE s.merchant_id=f.merchant_id AND s.order_id=f.order_id AND s.state='DELIVERED' AND d.state='DELIVERED' AND d.closed_at IS NOT NULL)))
$$;
CREATE FUNCTION food_review_snapshot(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;r mobile_food_reviews;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM online_food_orders WHERE order_id=oid AND account_id=actor)THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO r FROM mobile_food_reviews WHERE order_id=oid AND account_id=actor;
 RETURN jsonb_build_object('orderId',oid,'eligible',food_review_eligible(oid),'canRateDriver',EXISTS(SELECT 1 FROM food_shipments s JOIN food_assignments d ON d.shipment_id=s.id WHERE s.order_id=oid AND s.state='DELIVERED' AND d.state='DELIVERED' AND d.closed_at IS NOT NULL),'review',CASE WHEN r.id IS NULL THEN NULL ELSE food_review_safe(r)END);
END $$;
CREATE FUNCTION food_review_command(oid uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;f online_food_orders;r mobile_food_reviews;prior mobile_food_review_commands;key uuid;digest text;receipt jsonb;driver uuid;action text;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['commandId','expectedVersion','action','stars','driverStars','body'] OR(SELECT count(*)FROM jsonb_object_keys(payload))<>6
 OR jsonb_typeof(payload->'commandId') IS DISTINCT FROM 'string' OR NOT coalesce(canonical_online_option_uuid(payload->>'commandId'),false)
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR(payload->>'expectedVersion')!~'^(0|[1-9][0-9]{0,18})$' OR(payload->>'expectedVersion')::numeric>9223372036854775807
 OR jsonb_typeof(payload->'action') IS DISTINCT FROM 'string' OR(payload->>'action') NOT IN('SUBMIT','WITHDRAW')
 OR jsonb_typeof(payload->'body') IS DISTINCT FROM 'string' OR length(payload->>'body')>2000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 action:=payload->>'action';
 IF action='SUBMIT' AND(jsonb_typeof(payload->'stars') IS DISTINCT FROM 'number' OR(payload->>'stars')!~'^[1-5]$' OR NOT(jsonb_typeof(payload->'driverStars')='null' OR jsonb_typeof(payload->'driverStars')='number' AND(payload->>'driverStars')~'^[1-5]$'))
 OR action='WITHDRAW' AND(payload->'stars'<>'null'::jsonb OR payload->'driverStars'<>'null'::jsonb OR payload->>'body'<>'')THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO f FROM online_food_orders WHERE order_id=oid AND account_id=actor;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM 1 FROM orders WHERE merchant_id=f.merchant_id AND id=oid FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||oid::text,95));
 key:=(payload->>'commandId')::uuid;PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,95));digest:=encode(sha256(convert_to(jsonb_build_array(oid,payload)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM mobile_food_review_commands WHERE actor_account_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 SELECT * INTO r FROM mobile_food_reviews WHERE merchant_id=f.merchant_id AND order_id=oid FOR UPDATE;
 IF coalesce(r.version,0)<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF action='WITHDRAW' THEN
  IF r.id IS NULL OR r.state='WITHDRAWN' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE mobile_food_reviews SET state='WITHDRAWN',version=version+1,body='',feedback='',updated_at=clock_timestamp()WHERE id=r.id RETURNING * INTO r;
 ELSE
  IF NOT food_review_eligible(oid)THEN RAISE EXCEPTION 'REVIEW_NOT_ELIGIBLE';END IF;
  SELECT d.driver_id INTO driver FROM food_shipments s JOIN food_assignments d ON d.shipment_id=s.id WHERE s.merchant_id=f.merchant_id AND s.order_id=oid AND s.state='DELIVERED' AND d.state='DELIVERED' AND d.closed_at IS NOT NULL ORDER BY d.closed_at DESC,d.id LIMIT 1;
  IF payload->'driverStars'<>'null'::jsonb AND driver IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  INSERT INTO mobile_food_reviews(account_id,merchant_id,order_id,branch_id,driver_id,stars,driver_stars,body,state)
  VALUES(actor,f.merchant_id,oid,f.branch_id,driver,(payload->>'stars')::integer,(payload->>'driverStars')::integer,btrim(payload->>'body'),'PENDING')
  ON CONFLICT(merchant_id,order_id)DO UPDATE SET stars=EXCLUDED.stars,driver_stars=EXCLUDED.driver_stars,body=EXCLUDED.body,state='PENDING',feedback='',version=mobile_food_reviews.version+1,updated_at=clock_timestamp()RETURNING * INTO r;
 END IF;
 receipt:=food_review_safe(r);
 INSERT INTO mobile_food_review_commands(actor_account_id,command_id,request_hash,review_id,session_id,operation,reason,receipt)VALUES(actor,key,digest,r.id,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,action,'',receipt);
 RETURN receipt;
END $$;
CREATE FUNCTION food_review_public(branch uuid,after_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE items jsonb;next_id uuid;at timestamptz;counted bigint;total bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM mobile_public_branches(branch,NULL,1,'','all'))THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF after_id IS NOT NULL THEN SELECT created_at INTO at FROM mobile_food_reviews WHERE id=after_id AND branch_id=branch AND state='PUBLISHED';IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;END IF;
 SELECT count(*),coalesce(sum(stars),0)INTO counted,total FROM mobile_food_reviews WHERE branch_id=branch AND state='PUBLISHED';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'stars',r.stars,'driverStars',r.driver_stars,'body',r.body,'createdAt',r.created_at)ORDER BY r.created_at,r.id),'[]')INTO items
 FROM(SELECT * FROM mobile_food_reviews WHERE branch_id=branch AND state='PUBLISHED' AND(after_id IS NULL OR(created_at,id)>(at,after_id))ORDER BY created_at,id LIMIT 51)r;
 IF jsonb_array_length(items)>50 THEN next_id:=(items->49->>'id')::uuid;items:=items-50;END IF;
 RETURN jsonb_build_object('branchId',branch,'count',counted::text,'starTotal',total::text,'items',items,'nextCursor',next_id);
END $$;
CREATE FUNCTION food_review_moderate(target uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r mobile_food_reviews;actor uuid;grant_id uuid;key uuid;digest text;prior mobile_food_review_commands;receipt jsonb;
BEGIN
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['commandId','expectedVersion','decision','reason'] OR(SELECT count(*)FROM jsonb_object_keys(payload))<>4
 OR jsonb_typeof(payload->'commandId') IS DISTINCT FROM 'string' OR NOT coalesce(canonical_online_option_uuid(payload->>'commandId'),false)
 OR jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR(payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR(payload->>'expectedVersion')::numeric>9223372036854775807
 OR jsonb_typeof(payload->'decision') IS DISTINCT FROM 'string' OR(payload->>'decision')NOT IN('PUBLISH','REJECT')
 OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO r FROM mobile_food_reviews WHERE id=target;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 grant_id:=food_incident_staff(r.merchant_id,false);actor:=dispatch_live_actor();IF actor=r.account_id THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;key:=(payload->>'commandId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,95));SELECT * INTO STRICT r FROM mobile_food_reviews WHERE id=target FOR UPDATE;
 digest:=encode(sha256(convert_to(jsonb_build_array(target,payload)::text,'UTF8')),'hex');SELECT * INTO prior FROM mobile_food_review_commands WHERE actor_account_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF r.version<>(payload->>'expectedVersion')::bigint OR r.state='WITHDRAWN'THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 UPDATE mobile_food_reviews SET state=CASE payload->>'decision' WHEN 'PUBLISH'THEN 'PUBLISHED'ELSE 'REJECTED'END,feedback=CASE payload->>'decision'WHEN 'REJECT'THEN btrim(payload->>'reason')ELSE ''END,version=version+1,updated_at=clock_timestamp()WHERE id=target RETURNING * INTO r;
 receipt:=food_review_safe(r);INSERT INTO mobile_food_review_commands(actor_account_id,command_id,request_hash,review_id,session_id,grant_id,operation,reason,receipt)VALUES(actor,key,digest,r.id,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,grant_id,payload->>'decision',btrim(payload->>'reason'),receipt);RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_review_safe(mobile_food_reviews),food_review_eligible(uuid),food_review_snapshot(uuid),food_review_command(uuid,jsonb),food_review_public(uuid,uuid),food_review_moderate(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_review_snapshot(uuid),food_review_command(uuid,jsonb),food_review_public(uuid,uuid),food_review_moderate(uuid,jsonb) TO bitpos_app;

CREATE TABLE mobile_review_access_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_account_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,
 grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,merchant_id uuid NOT NULL REFERENCES merchants,purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 300),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE mobile_review_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_review_access_audit FROM PUBLIC,bitpos_app;
CREATE TRIGGER mobile_review_access_immutable BEFORE UPDATE OR DELETE ON mobile_review_access_audit FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_review_queue(merchant uuid,after_id uuid,purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE selected uuid;items jsonb;next_id uuid;at timestamptz;
BEGIN
 IF purpose IS NULL OR length(btrim(purpose))NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 selected:=food_incident_staff(merchant,false);
 IF after_id IS NOT NULL THEN SELECT created_at INTO at FROM mobile_food_reviews WHERE id=after_id AND merchant_id=merchant;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;END IF;
 SELECT coalesce(jsonb_agg(food_review_safe(r)ORDER BY r.created_at,r.id),'[]')INTO items FROM(SELECT * FROM mobile_food_reviews WHERE merchant_id=merchant AND(after_id IS NULL OR(created_at,id)>(at,after_id))ORDER BY created_at,id LIMIT 51)r;
 IF jsonb_array_length(items)>50 THEN next_id:=(items->49->>'id')::uuid;items:=items-50;END IF;
 INSERT INTO mobile_review_access_audit(actor_account_id,session_id,grant_id,merchant_id,purpose)VALUES(dispatch_live_actor(),nullif(current_setting('bitpos.mobile_session',true),'')::uuid,selected,merchant,btrim(purpose));
 RETURN jsonb_build_object('items',items,'nextCursor',next_id);
END $$;
REVOKE ALL ON FUNCTION food_review_queue(uuid,uuid,text)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION food_review_queue(uuid,uuid,text)TO bitpos_app;
