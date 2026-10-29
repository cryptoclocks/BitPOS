SET search_path=bitpos,public;
-- Queue metadata is historical: never derive current custody/CAS from a report receipt.
CREATE FUNCTION dispatch_food_incident_review(incident uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_assignment_incidents;s food_shipments;a food_assignments;l driver_assignment_leases;o driver_occupancy;sponsor uuid;result jsonb;
BEGIN
 SELECT * INTO i FROM food_assignment_incidents WHERE id=incident;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(i.shipment_id);sponsor:=food_incident_staff(s.merchant_id);
 PERFORM 1 FROM food_dispatch_searches WHERE shipment_id=s.id FOR UPDATE;
 SELECT * INTO STRICT o FROM driver_occupancy WHERE driver_id=i.driver_id FOR UPDATE;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=i.assignment_id FOR UPDATE;
 SELECT * INTO STRICT l FROM driver_assignment_leases WHERE id=a.lease_id FOR UPDATE;
 SELECT * INTO STRICT i FROM food_assignment_incidents WHERE id=incident;
 result:=jsonb_build_object('incident',food_incident_safe(i),'shipmentVersion',s.version::text,'assignmentState',a.state,'leaseState',l.state,
  'currentDuty',coalesce(s.active_assignment_id=a.id AND l.state='ACTIVE' AND o.assignment_generation=l.generation,false),
  'unresolvedBlocking',(SELECT count(*) FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL),
  'unacknowledgedBlocking',(SELECT count(*) FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL AND acknowledged_at IS NULL));
 IF food_incident_staff(s.merchant_id) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION dispatch_food_incident_review(uuid) FROM PUBLIC,bitpos_app,bitpos_food_search_worker,bitpos_food_dispatch_worker;
GRANT EXECUTE ON FUNCTION dispatch_food_incident_review(uuid) TO bitpos_app;
