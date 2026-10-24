-- Private latest-state subscriptions. Notifications carry no data and are not authority.
SET search_path=bitpos,public;
CREATE FUNCTION dispatch_realtime_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM mobile_sessions WHERE id=nullif(current_setting('bitpos.mobile_session',true),'')::uuid
  AND access_hash=current_setting('bitpos.mobile_access_hash',true) AND access_expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'AUTH_REQUIRED';
 END IF;
END $$;
CREATE FUNCTION dispatch_customer_realtime(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE work jsonb;
BEGIN
 work:=dispatch_customer_work(oid);
 PERFORM dispatch_realtime_actor();
 RETURN jsonb_build_object('work',work,'serverTime',clock_timestamp());
END $$;
CREATE FUNCTION dispatch_driver_realtime() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE work jsonb;point driver_latest_locations;location jsonb:=NULL;
BEGIN
 -- Work owns the driver/lease locks. Do not acquire a shipment root afterward.
 work:=dispatch_driver_work();
 IF work->'assignment'<>'null'::jsonb THEN
  SELECT * INTO point FROM driver_latest_locations
  WHERE assignment_id=(work#>>'{assignment,id}')::uuid
   AND generation=(work#>>'{assignment,generation}')::bigint
   AND lease_generation=(work#>>'{assignment,leaseGeneration}')::bigint;
  IF FOUND THEN
   location:=jsonb_build_object('sequence',point.seq::text,'latitudeE7',point.latitude_e7,'longitudeE7',point.longitude_e7,
    'accuracyMm',point.accuracy_mm,'capturedAt',point.captured_at,'receivedAt',point.received_at,
    'stale',least(point.captured_at,point.received_at)<clock_timestamp()-interval '30 seconds');
  END IF;
 END IF;
 PERFORM dispatch_realtime_actor();
 RETURN jsonb_build_object('work',work,'location',location,'serverTime',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION dispatch_realtime_actor(),dispatch_customer_realtime(uuid),dispatch_driver_realtime() FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_customer_realtime(uuid),dispatch_driver_realtime() TO bitpos_app;
CREATE FUNCTION dispatch_realtime_wake() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM pg_notify('bitpos_food_realtime','');
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION dispatch_realtime_wake() FROM PUBLIC,bitpos_app;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['food_shipments','food_assignments','food_dispatch_offers','driver_assignment_leases','driver_occupancy','driver_latest_locations','fulfillment_proofs','mobile_sessions','mobile_accounts','driver_profiles','driver_vehicles'] LOOP
  EXECUTE format('CREATE TRIGGER food_realtime_wake AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION dispatch_realtime_wake()',name);
 END LOOP;
END $$;
