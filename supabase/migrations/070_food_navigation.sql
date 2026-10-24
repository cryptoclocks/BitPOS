-- Routing consumes existing custody authority; it cannot change assignment, fare or payment.
SET search_path=bitpos,public;
CREATE FUNCTION dispatch_food_navigation(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE snapshot jsonb;work jsonb;assignment jsonb;point jsonb;s food_shipments;destination quote_delivery_snapshots;target text;
BEGIN
 IF oid IS NULL THEN
  snapshot:=dispatch_driver_realtime();work:=snapshot->'work';assignment:=work->'assignment';point:=snapshot->'location';
 ELSE
  snapshot:=dispatch_customer_realtime(oid);work:=snapshot->'work';assignment:=work->'assignment';point:=assignment->'location';
 END IF;
 IF assignment IS NULL OR assignment='null'::jsonb THEN RETURN NULL;END IF;
 -- Existing projection owns the root/lease locks; no inverse root lock acquisition here.
 SELECT * INTO STRICT s FROM food_shipments WHERE active_assignment_id=(assignment->>'id')::uuid;
 SELECT * INTO STRICT destination FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 target:=CASE WHEN assignment->>'state' IN('ACCEPTED','AT_PICKUP') THEN 'PICKUP' ELSE 'DROPOFF' END;
 PERFORM dispatch_realtime_actor();
 RETURN jsonb_build_object('assignmentId',assignment->>'id','generation',assignment->>'generation','leaseGeneration',assignment->>'leaseGeneration',
  'state',assignment->>'state','shipmentId',s.id,'fixture',destination.fixture,'target',target,
  'targetLatitudeE7',CASE WHEN target='PICKUP' THEN destination.origin_latitude_e7 ELSE destination.latitude_e7 END,
  'targetLongitudeE7',CASE WHEN target='PICKUP' THEN destination.origin_longitude_e7 ELSE destination.longitude_e7 END,
  'location',point);
END $$;
REVOKE ALL ON FUNCTION dispatch_food_navigation(uuid) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_food_navigation(uuid) TO bitpos_app;
