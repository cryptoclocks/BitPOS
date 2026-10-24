-- Private road-ranking authority. No provider I/O, raw coordinate history or synthetic mobile actor.
SET search_path=bitpos,public;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bitpos_food_search_worker') THEN CREATE ROLE bitpos_food_search_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;END IF;END $$;
GRANT USAGE ON SCHEMA bitpos TO bitpos_food_search_worker;
ALTER TABLE food_dispatch_search_cycles ADD origin text NOT NULL DEFAULT 'STAFF' CHECK(origin IN('STAFF','AUTOMATION'));
ALTER TABLE food_dispatch_search_cycles ADD delegation_id uuid REFERENCES platform_staff_role_grants;
ALTER TABLE food_dispatch_search_cycles ADD CHECK((origin='AUTOMATION')=(delegation_id IS NOT NULL));
CREATE INDEX food_search_due ON food_dispatch_searches(next_retry_at,shipment_id) WHERE mode='AUTO';
CREATE TABLE food_dispatch_rank_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shipment_id uuid NOT NULL REFERENCES food_dispatch_searches,epoch bigint NOT NULL CHECK(epoch>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 request jsonb,response jsonb,CHECK((request IS NULL)=(response IS NULL))
);
CREATE INDEX food_rank_inflight ON food_dispatch_rank_runs(shipment_id,expires_at) WHERE response IS NULL;
CREATE TABLE food_dispatch_rank_candidates(
 run_id uuid NOT NULL REFERENCES food_dispatch_rank_runs,driver_id uuid NOT NULL REFERENCES driver_profiles,source_digest text NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(run_id,driver_id)
);
CREATE TABLE food_dispatch_automatic_offers(
 offer_id uuid PRIMARY KEY REFERENCES food_dispatch_offers,run_id uuid NOT NULL UNIQUE REFERENCES food_dispatch_rank_runs,
 policy_id uuid NOT NULL REFERENCES food_dispatch_policy_versions,epoch bigint NOT NULL CHECK(epoch>0),
 driver_id uuid NOT NULL REFERENCES driver_profiles,source_digest text NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 0 AND 3600),distance_metres integer NOT NULL CHECK(distance_metres BETWEEN 0 AND 1000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['food_dispatch_rank_runs','food_dispatch_rank_candidates','food_dispatch_automatic_offers'] LOOP
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker',n);EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);END LOOP;END $$;
CREATE TRIGGER food_rank_candidate_immutable BEFORE UPDATE OR DELETE ON food_dispatch_rank_candidates FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER food_automatic_offer_immutable BEFORE UPDATE OR DELETE ON food_dispatch_automatic_offers FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_dispatch_search_worker() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=session_user AND pg_has_role(session_user,'bitpos_food_search_worker','USAGE') AND NOT pg_has_role(session_user,'bitpos_app','MEMBER') AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication)) THEN RAISE EXCEPTION 'FOOD_SEARCH_WORKER_ROLE_REQUIRED';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
END $$;
-- This private source is evaluated afresh; only its digest is persisted.
CREATE FUNCTION food_dispatch_candidate(driver uuid,policy uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('driverId',p.id,'latitudeE7',l.latitude_e7,'longitudeE7',l.longitude_e7,'sourceDigest',encode(sha256(convert_to(jsonb_build_array(
 p.id,p.version,p.status,p.verified_until,p.license_expires_at,m.disabled_at,v.vehicle_type,v.registration_expires_at,a.requested_online,a.heartbeat_expires_at,
 to_jsonb(c),ss.revoked_at,ss.access_expires_at,ss.refresh_expires_at,to_jsonb(l),to_jsonb(f),g.role,g.revoked_at,g.expires_at,issuer.disabled_at,sc.merchant_id,
 z.merchant_id,z.branch_id,o.assignment_generation,pol.id)::text,'UTF8')),'hex'))
 FROM food_dispatch_policy_versions pol JOIN driver_food_service_grants f ON(f.merchant_id,f.branch_id)=(pol.merchant_id,pol.branch_id)
 JOIN driver_profiles p ON p.id=f.driver_id JOIN mobile_accounts m ON m.id=p.account_id JOIN driver_vehicles v ON v.driver_id=p.id
 JOIN driver_availability a ON a.driver_id=p.id JOIN driver_occupancy o ON o.driver_id=p.id
 JOIN driver_food_discovery_consents c ON c.driver_id=p.id JOIN mobile_sessions ss ON ss.id=c.owner_session_id AND ss.account_id=p.account_id
 JOIN driver_food_discovery_zones z ON(z.driver_id,z.merchant_id,z.branch_id)=(p.id,pol.merchant_id,pol.branch_id)
 JOIN driver_food_idle_locations l ON l.driver_id=p.id AND l.consent_revision=c.revision
 JOIN platform_staff_role_grants g ON g.id=f.issued_grant_id JOIN mobile_accounts issuer ON issuer.id=g.account_id
 JOIN platform_role_scopes sc ON sc.grant_id=g.id AND sc.merchant_id=f.merchant_id
 WHERE pol.id=policy AND p.id=driver AND food_dispatch_policy_live(pol.id) AND dispatch_eligible_driver(p.id)
 AND food_discovery_grant_live(p.id,pol.merchant_id,pol.branch_id) AND v.vehicle_type=pol.vehicle_type
 AND c.enabled AND c.expires_at>clock_timestamp() AND ss.revoked_at IS NULL AND ss.access_expires_at>clock_timestamp() AND ss.refresh_expires_at>clock_timestamp()
 AND l.sequence=c.last_sequence AND l.captured_at=c.last_captured_at AND l.received_at=c.last_received_at
 AND l.captured_at>clock_timestamp()-interval '30 seconds' AND l.captured_at<=clock_timestamp()+interval '5 seconds' AND l.received_at>clock_timestamp()-interval '30 seconds'
 AND NOT EXISTS(SELECT 1 FROM driver_assignment_leases lease WHERE lease.driver_id=p.id AND lease.state='ACTIVE')
$$;
CREATE FUNCTION food_dispatch_lock_candidate(driver uuid,policy uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM 1 FROM food_dispatch_policy_versions pol JOIN driver_food_service_grants f ON(f.merchant_id,f.branch_id)=(pol.merchant_id,pol.branch_id)
 JOIN driver_profiles p ON p.id=f.driver_id JOIN mobile_accounts m ON m.id=p.account_id JOIN driver_vehicles v ON v.driver_id=p.id
 JOIN driver_availability a ON a.driver_id=p.id JOIN driver_food_discovery_consents c ON c.driver_id=p.id
 JOIN mobile_sessions ss ON ss.id=c.owner_session_id JOIN driver_food_discovery_zones z ON(z.driver_id,z.merchant_id,z.branch_id)=(p.id,pol.merchant_id,pol.branch_id)
 JOIN driver_food_idle_locations l ON l.driver_id=p.id JOIN platform_staff_role_grants g ON g.id=f.issued_grant_id
 JOIN mobile_accounts issuer ON issuer.id=g.account_id JOIN platform_role_scopes sc ON sc.grant_id=g.id AND sc.merchant_id=f.merchant_id
 WHERE p.id=driver AND pol.id=policy FOR SHARE OF f,p,m,v,a,c,ss,z,l,g,issuer,sc NOWAIT;
 PERFORM 1 FROM food_dispatch_policy_versions pol JOIN platform_staff_role_grants g ON g.id=pol.issued_grant_id
 JOIN mobile_accounts issuer ON issuer.id=pol.issued_by JOIN platform_role_scopes sc ON sc.grant_id=g.id AND sc.merchant_id=pol.merchant_id
 WHERE pol.id=policy FOR SHARE OF g,issuer,sc NOWAIT;
END $$;
-- Canonical offer creation is private and shared by live manual/automatic wrappers.
CREATE FUNCTION dispatch_create_offer_locked(shipment uuid,driver uuid,expires timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;offer uuid:=gen_random_uuid();at timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO STRICT s FROM food_shipments WHERE id=shipment;
 IF s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF expires<=at OR expires>at+interval '46 seconds' OR NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 UPDATE food_dispatch_offers SET state='EXPIRED',version=version+1 WHERE shipment_id=s.id AND state='OFFERED' AND expires_at<=at;
 IF EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED') THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
 UPDATE food_shipments SET generation=generation+1,state='OFFERING' WHERE id=s.id RETURNING * INTO s;
 INSERT INTO food_dispatch_offers(id,shipment_id,generation,driver_id,state,expires_at) VALUES(offer,s.id,s.generation,driver,'OFFERED',expires);
 PERFORM dispatch_event(s.id,'OFFERED',jsonb_build_object('offerId',offer));
 RETURN jsonb_build_object('offerId',offer,'shipmentId',s.id,'generation',s.generation::text,'version',(s.version+1)::text);
END $$;
CREATE FUNCTION food_dispatch_search_jobs() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE candidate uuid;s food_shipments;p food_dispatch_policy_versions;at timestamptz;result jsonb;
BEGIN
 PERFORM food_dispatch_search_worker();
 -- Source-first admission survives worker restarts without an ephemeral webhook.
 SELECT fs.id INTO candidate FROM food_shipments fs JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(fs.merchant_id,fs.quote_id)
 JOIN food_dispatch_policy_heads h ON(h.merchant_id,h.branch_id)=(q.merchant_id,q.branch_id)
 WHERE fs.active_assignment_id IS NULL AND fs.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING')
 AND NOT EXISTS(SELECT 1 FROM food_dispatch_searches t WHERE t.shipment_id=fs.id) AND food_dispatch_policy_live(h.version_id) AND dispatch_verified_sale(fs.id)
 ORDER BY fs.created_at,fs.id LIMIT 1;
 IF candidate IS NOT NULL THEN
  s:=dispatch_lock_root(candidate);
  SELECT v.* INTO p FROM quote_delivery_snapshots q JOIN food_dispatch_policy_heads h ON(h.merchant_id,h.branch_id)=(q.merchant_id,q.branch_id)
  JOIN food_dispatch_policy_versions v ON v.id=h.version_id WHERE q.merchant_id=s.merchant_id AND q.quote_id=s.quote_id;
  at:=clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM food_dispatch_searches t WHERE t.shipment_id=s.id) AND s.active_assignment_id IS NULL AND s.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') AND dispatch_verified_sale(s.id) AND food_dispatch_policy_live(p.id)
  AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers f WHERE f.shipment_id=s.id AND f.state='OFFERED' AND f.expires_at>at) THEN
   INSERT INTO food_dispatch_searches(shipment_id,policy_id,version,epoch,mode,opened_at,absolute_deadline,cycle_number,cycle_started_at,cycle_deadline,offers_remaining,next_retry_at)
   VALUES(s.id,p.id,1,1,'AUTO',at,at+make_interval(secs=>p.overall_seconds),1,at,at+make_interval(secs=>p.cycle_seconds),p.offer_budget,at);
   INSERT INTO food_dispatch_search_cycles(shipment_id,cycle_number,epoch,started_at,deadline,offer_budget,actor_account_id,reason,origin,delegation_id)
   VALUES(s.id,1,1,at,at+make_interval(secs=>p.cycle_seconds),p.offer_budget,p.issued_by,'Automatic admission under published branch delegation','AUTOMATION',p.issued_grant_id);
  END IF;
 END IF;
 SELECT coalesce(jsonb_agg(eligible.shipment_id),'[]'::jsonb) INTO result FROM(
 SELECT t.shipment_id FROM food_dispatch_searches t JOIN food_shipments fs ON fs.id=t.shipment_id
 WHERE t.mode='AUTO' AND t.offers_remaining>0 AND t.next_retry_at<=clock_timestamp() AND t.cycle_deadline>clock_timestamp() AND t.absolute_deadline>clock_timestamp()
 AND food_dispatch_policy_live(t.policy_id) AND fs.active_assignment_id IS NULL AND dispatch_verified_sale(fs.id)
 AND fs.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING')
 AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers f WHERE f.shipment_id=fs.id AND f.state='OFFERED' AND f.expires_at>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM food_dispatch_rank_runs r WHERE r.shipment_id=fs.id AND r.response IS NULL AND r.expires_at>clock_timestamp())
 ORDER BY t.next_retry_at,t.shipment_id LIMIT 16) eligible;RETURN result;
END $$;
CREATE FUNCTION food_dispatch_rank_claim(shipment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;t food_dispatch_searches;p food_dispatch_policy_versions;q quote_delivery_snapshots;run uuid:=gen_random_uuid();until_at timestamptz;candidate jsonb;candidates jsonb:='[]';driver uuid;
BEGIN
 PERFORM food_dispatch_search_worker();s:=dispatch_lock_root(shipment);SELECT * INTO t FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 IF t.shipment_id IS NULL OR t.mode<>'AUTO' OR t.offers_remaining=0 OR t.next_retry_at>clock_timestamp() OR least(t.cycle_deadline,t.absolute_deadline)<=clock_timestamp() OR NOT food_dispatch_policy_live(t.policy_id)
 OR s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id)
 OR EXISTS(SELECT 1 FROM food_dispatch_offers f WHERE f.shipment_id=s.id AND f.state='OFFERED' AND f.expires_at>clock_timestamp())
 OR EXISTS(SELECT 1 FROM food_dispatch_rank_runs r WHERE r.shipment_id=s.id AND r.response IS NULL AND r.expires_at>clock_timestamp()) THEN RETURN NULL;END IF;
 SELECT * INTO STRICT p FROM food_dispatch_policy_versions WHERE id=t.policy_id;SELECT * INTO STRICT q FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 until_at:=least(t.cycle_deadline,t.absolute_deadline,clock_timestamp()+interval '45 seconds');INSERT INTO food_dispatch_rank_runs(id,shipment_id,epoch,expires_at) VALUES(run,s.id,t.epoch,until_at);
 FOR driver IN SELECT f.driver_id FROM driver_food_service_grants f JOIN driver_food_idle_locations l ON l.driver_id=f.driver_id
 WHERE f.merchant_id=p.merchant_id AND f.branch_id=p.branch_id AND food_dispatch_candidate(f.driver_id,p.id) IS NOT NULL
 -- Geographical preselection only. Published ETA/rank comes exclusively from road-provider metrics.
 ORDER BY power((l.latitude_e7::double precision-q.origin_latitude_e7)/10000000,2)+power((l.longitude_e7::double precision-q.origin_longitude_e7)/10000000*cos(radians(q.origin_latitude_e7::double precision/10000000)),2),f.driver_id LIMIT p.shortlist_size LOOP
  candidate:=food_dispatch_candidate(driver,p.id);IF candidate IS NOT NULL THEN
   INSERT INTO food_dispatch_rank_candidates(run_id,driver_id,source_digest) VALUES(run,driver,candidate->>'sourceDigest');candidates:=candidates||jsonb_build_array(candidate);
  END IF;
 END LOOP;
 UPDATE food_dispatch_searches SET next_retry_at=until_at WHERE shipment_id=s.id;
 RETURN jsonb_build_object('runId',run,'shipmentId',s.id,'epoch',t.epoch::text,'deadline',until_at,'origin',jsonb_build_object('latitudeE7',q.origin_latitude_e7,'longitudeE7',q.origin_longitude_e7),'vehicleType',p.vehicle_type,'maxPickupSeconds',p.max_pickup_seconds,'fixture',q.fixture,'candidates',candidates);
END $$;
CREATE FUNCTION food_dispatch_automatic_offer_live(offer uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM food_dispatch_automatic_offers a JOIN food_dispatch_offers f ON f.id=a.offer_id
 JOIN food_dispatch_searches t ON t.shipment_id=f.shipment_id JOIN food_dispatch_policy_versions p ON p.id=a.policy_id
 JOIN driver_profiles d ON d.id=a.driver_id JOIN mobile_accounts m ON m.id=d.account_id
 JOIN driver_food_discovery_consents c ON c.driver_id=d.id JOIN mobile_sessions ss ON ss.id=c.owner_session_id AND ss.account_id=d.account_id
 JOIN driver_food_discovery_zones z ON(z.driver_id,z.merchant_id,z.branch_id)=(d.id,p.merchant_id,p.branch_id)
 WHERE a.offer_id=offer AND t.epoch=a.epoch AND t.mode='AUTO' AND t.policy_id=p.id AND food_dispatch_policy_live(p.id)
 AND least(t.absolute_deadline,t.cycle_deadline)>clock_timestamp() AND c.enabled AND c.expires_at>clock_timestamp() AND m.disabled_at IS NULL
 AND ss.revoked_at IS NULL AND ss.access_expires_at>clock_timestamp() AND ss.refresh_expires_at>clock_timestamp()
 AND food_discovery_grant_live(d.id,p.merchant_id,p.branch_id) AND dispatch_eligible_driver(d.id))
$$;
CREATE FUNCTION food_dispatch_rank_finish(run uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_dispatch_rank_runs;s food_shipments;t food_dispatch_searches;p food_dispatch_policy_versions;entry jsonb;current_source jsonb;choice jsonb;receipt jsonb;outcome text:='STALE';offer_receipt jsonb;driver uuid;locked boolean:=true;
BEGIN
 PERFORM food_dispatch_search_worker();SELECT * INTO r FROM food_dispatch_rank_runs WHERE id=run;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(r.shipment_id);SELECT * INTO STRICT r FROM food_dispatch_rank_runs WHERE id=run FOR UPDATE;SELECT * INTO STRICT t FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR NOT payload ?& ARRAY['status','results'] OR payload->>'status' NOT IN('ROUTES','PROVIDER_UNAVAILABLE')
 OR jsonb_typeof(payload->'status') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'results') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'results')>6 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF r.response IS NOT NULL THEN IF r.request<>payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN r.response;END IF;
 IF jsonb_array_length(payload->'results')<>(SELECT count(*) FROM food_dispatch_rank_candidates c WHERE c.run_id=run) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'results') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(entry))<>5 OR NOT entry ?& ARRAY['driverId','sourceDigest','status','durationSeconds','distanceMetres']
  OR NOT coalesce(canonical_online_option_uuid(entry->>'driverId'),false) OR jsonb_typeof(entry->'driverId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(entry->'sourceDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'status') IS DISTINCT FROM 'string' OR entry->>'status' NOT IN('ROUTE','UNAVAILABLE')
  OR NOT EXISTS(SELECT 1 FROM food_dispatch_rank_candidates c WHERE c.run_id=run AND c.driver_id=(entry->>'driverId')::uuid AND c.source_digest=entry->>'sourceDigest')
  OR (SELECT count(*) FROM jsonb_array_elements(payload->'results') other WHERE other->>'driverId'=entry->>'driverId')<>1 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  IF entry->>'status'='UNAVAILABLE' THEN IF entry->'durationSeconds'<>'null'::jsonb OR entry->'distanceMetres'<>'null'::jsonb THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
  ELSE IF payload->>'status'='PROVIDER_UNAVAILABLE' OR jsonb_typeof(entry->'durationSeconds') IS DISTINCT FROM 'number' OR jsonb_typeof(entry->'distanceMetres') IS DISTINCT FROM 'number'
   OR (entry->>'durationSeconds')!~'^(0|[1-9][0-9]{0,5})$' OR (entry->>'distanceMetres')!~'^(0|[1-9][0-9]{0,6})$'
   OR (entry->>'durationSeconds')::numeric>86400 OR (entry->>'distanceMetres')::numeric>1000000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM food_dispatch_policy_versions WHERE id=t.policy_id;
 IF r.epoch=t.epoch AND t.mode='AUTO' AND t.offers_remaining>0 AND least(r.expires_at,t.cycle_deadline,t.absolute_deadline)>clock_timestamp() AND food_dispatch_policy_live(p.id)
 AND s.active_assignment_id IS NULL AND s.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') AND dispatch_verified_sale(s.id)
 AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers f WHERE f.shipment_id=s.id AND f.state='OFFERED' AND f.expires_at>clock_timestamp()) THEN
  IF payload->>'status'='PROVIDER_UNAVAILABLE' THEN outcome:='UNAVAILABLE';
  ELSE
   outcome:=CASE WHEN jsonb_array_length(payload->'results')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'results') e WHERE e->>'status'='ROUTE') THEN 'UNAVAILABLE' ELSE 'NO_CANDIDATE' END;
   BEGIN
    PERFORM 1 FROM driver_occupancy o WHERE o.driver_id IN(SELECT c.driver_id FROM food_dispatch_rank_candidates c WHERE c.run_id=run) ORDER BY o.driver_id FOR UPDATE NOWAIT;
   EXCEPTION WHEN lock_not_available THEN locked:=false;outcome:='STALE';END;
   IF locked THEN
   FOR entry IN SELECT value FROM jsonb_array_elements(payload->'results') WHERE value->>'status'='ROUTE' AND (value->>'durationSeconds')::integer<=p.max_pickup_seconds
   ORDER BY (value->>'durationSeconds')::integer,(value->>'distanceMetres')::integer,value->>'driverId' LOOP
    driver:=(entry->>'driverId')::uuid;
    BEGIN
     PERFORM food_dispatch_lock_candidate(driver,p.id);locked:=true;
    EXCEPTION WHEN lock_not_available THEN locked:=false;END;
    IF NOT locked THEN outcome:='STALE';CONTINUE;END IF;
    current_source:=food_dispatch_candidate(driver,p.id);
    IF current_source IS NULL OR current_source->>'sourceDigest'<>entry->>'sourceDigest' OR NOT food_dispatch_policy_live(p.id) THEN outcome:='STALE';CONTINUE;END IF;
    choice:=entry;EXIT;
   END LOOP;
   END IF;
   IF choice IS NOT NULL AND least(r.expires_at,t.cycle_deadline,t.absolute_deadline)>clock_timestamp() THEN
    offer_receipt:=dispatch_create_offer_locked(s.id,(choice->>'driverId')::uuid,least(clock_timestamp()+interval '45 seconds',t.cycle_deadline,t.absolute_deadline));
    INSERT INTO food_dispatch_automatic_offers(offer_id,run_id,policy_id,epoch,driver_id,source_digest,duration_seconds,distance_metres)
    VALUES((offer_receipt->>'offerId')::uuid,run,p.id,t.epoch,(choice->>'driverId')::uuid,choice->>'sourceDigest',(choice->>'durationSeconds')::integer,(choice->>'distanceMetres')::integer);
    UPDATE food_dispatch_searches SET offers_remaining=offers_remaining-1,attention_reason=NULL,version=version+1,next_retry_at=least(clock_timestamp()+interval '45 seconds',cycle_deadline,absolute_deadline) WHERE shipment_id=s.id;
    outcome:='OFFERED';
   END IF;
  END IF;
 END IF;
 IF outcome IN('UNAVAILABLE','NO_CANDIDATE') THEN UPDATE food_dispatch_searches SET attention_reason=CASE WHEN outcome='UNAVAILABLE' THEN 'PROVIDER_UNAVAILABLE' ELSE 'NO_CANDIDATE' END,version=version+1,next_retry_at=least(clock_timestamp()+interval '15 seconds',cycle_deadline,absolute_deadline) WHERE shipment_id=s.id;
 ELSIF outcome='STALE' AND r.epoch=t.epoch THEN UPDATE food_dispatch_searches SET next_retry_at=least(clock_timestamp()+interval '1 second',cycle_deadline,absolute_deadline) WHERE shipment_id=s.id;END IF;
 receipt:=jsonb_build_object('status',outcome,'offerId',offer_receipt->'offerId');UPDATE food_dispatch_rank_runs SET request=payload,response=receipt WHERE id=run;RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_dispatch_search_worker(),food_dispatch_candidate(uuid,uuid),food_dispatch_lock_candidate(uuid,uuid),dispatch_create_offer_locked(uuid,uuid,timestamptz),food_dispatch_search_jobs(),food_dispatch_rank_claim(uuid),food_dispatch_automatic_offer_live(uuid),food_dispatch_rank_finish(uuid,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
GRANT EXECUTE ON FUNCTION food_dispatch_search_jobs(),food_dispatch_rank_claim(uuid),food_dispatch_rank_finish(uuid,jsonb) TO bitpos_food_search_worker;
-- Generated canonical wrapper cutover; source061, generated by tools/runtime/generate-food-ranking-wrappers.ts.
CREATE OR REPLACE FUNCTION dispatch_food_offer(shipment uuid,driver uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;actor uuid;key uuid;digest text;prior food_dispatch_commands;receipt jsonb;
BEGIN
 s:=dispatch_lock_root(shipment);actor:=dispatch_live_actor();
 PERFORM 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.account_id=actor AND sc.merchant_id=s.merchant_id FOR SHARE OF g,sc;
 IF NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.account_id=actor AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=s.merchant_id)
 THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion'] OR (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false) OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR (payload->>'expectedVersion')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;
 digest:=encode(sha256(convert_to(jsonb_build_array(shipment,driver,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'offer' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
 IF NOT FOUND OR NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id WHERE g.account_id=actor AND g.role IN('dispatcher','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND sc.merchant_id=s.merchant_id) THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 receipt:=dispatch_create_offer_locked(s.id,driver,clock_timestamp()+interval '45 seconds');
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'offer',digest,receipt);
 RETURN receipt;
END $$;
CREATE OR REPLACE FUNCTION dispatch_food_claim(offer uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE f food_dispatch_offers;s food_shipments;actor uuid;driver uuid;key uuid;digest text;prior food_dispatch_commands;lease uuid:=gen_random_uuid();assignment uuid:=gen_random_uuid();lease_gen bigint;vehicle driver_vehicles;receipt jsonb;at timestamptz;
BEGIN
 SELECT * INTO f FROM food_dispatch_offers WHERE id=offer;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(f.shipment_id);actor:=dispatch_live_actor();
 SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS DISTINCT FROM f.driver_id THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT payload ?& ARRAY['idempotencyKey','expectedVersion','generation'] OR (SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT coalesce(canonical_online_option_uuid(payload->>'idempotencyKey'),false)
 OR (payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR (payload->>'generation')!~'^[1-9][0-9]{0,18}$'
 OR (payload->>'expectedVersion')::numeric>9223372036854775807 OR (payload->>'generation')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'generation') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 key:=(payload->>'idempotencyKey')::uuid;digest:=encode(sha256(convert_to(jsonb_build_array(offer,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'claim' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 PERFORM 1 FROM driver_occupancy WHERE driver_id=driver FOR UPDATE;
 SELECT * INTO STRICT f FROM food_dispatch_offers WHERE id=offer FOR UPDATE;
 actor:=dispatch_live_actor();at:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM food_dispatch_automatic_offers WHERE offer_id=f.id) THEN
  PERFORM food_dispatch_lock_candidate(driver,(SELECT policy_id FROM food_dispatch_automatic_offers WHERE offer_id=f.id));
  IF NOT food_dispatch_automatic_offer_live(f.id) THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 END IF;
 IF f.version<>(payload->>'expectedVersion')::bigint OR f.generation<>(payload->>'generation')::bigint OR s.generation<>f.generation THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF f.state<>'OFFERED' OR f.expires_at<=at OR s.state<>'OFFERING' OR s.active_assignment_id IS NOT NULL OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE';END IF;
 IF NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 UPDATE driver_occupancy SET assignment_generation=assignment_generation+1 WHERE driver_id=driver RETURNING assignment_generation INTO STRICT lease_gen;
 SELECT * INTO STRICT vehicle FROM driver_vehicles WHERE driver_id=driver;
 SET CONSTRAINTS driver_assignment_leases_food_assignment_id_id_driver_id_g_fkey DEFERRED;
 INSERT INTO driver_assignment_leases(id,driver_id,generation,food_assignment_id,state,created_at) VALUES(lease,driver,lease_gen,assignment,'ACTIVE',at);
 INSERT INTO food_assignments(id,shipment_id,driver_id,generation,lease_id,lease_generation,offer_id,vehicle_type,plate_snapshot,registration_expires_at,state,accepted_at)
 VALUES(assignment,s.id,driver,s.generation,lease,lease_gen,f.id,vehicle.vehicle_type,vehicle.plate,vehicle.registration_expires_at,'ACCEPTED',at);
 SET CONSTRAINTS driver_assignment_leases_food_assignment_id_id_driver_id_g_fkey IMMEDIATE;
 UPDATE food_dispatch_offers SET state='ACCEPTED',version=version+1 WHERE id=f.id;
 UPDATE food_shipments SET state='ASSIGNED',active_assignment_id=assignment WHERE id=s.id;
 PERFORM dispatch_event(s.id,'ASSIGNED',jsonb_build_object('assignmentId',assignment));
 receipt:=jsonb_build_object('shipmentId',s.id,'assignmentId',assignment,'generation',s.generation::text,'leaseId',lease,'leaseGeneration',lease_gen::text,'version',(s.version+1)::text);
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'claim',digest,receipt);
 RETURN receipt;
END $$;
