-- Bounded driver inbox and active-work recovery; offers contain no customer destination.
SET search_path=bitpos,public;
CREATE FUNCTION dispatch_driver_work() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;a food_assignments;s food_shipments;active jsonb:=NULL;offers jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 actor:=dispatch_live_actor();SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RETURN jsonb_build_object('offers','[]'::jsonb,'assignment',NULL);END IF;
 SELECT * INTO a FROM food_assignments WHERE driver_id=driver AND closed_at IS NULL;
 IF FOUND THEN
  a:=dispatch_lock_assignment(a.id,a.generation,a.lease_generation);actor:=dispatch_live_actor();
  SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
  SELECT jsonb_build_object('id',a.id,'shipmentId',s.id,'orderId',s.order_id,'merchantId',s.merchant_id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'state',a.state,
   'pickupLatitudeE7',d.origin_latitude_e7,'pickupLongitudeE7',d.origin_longitude_e7,
   'recipientName',d.recipient_name,'phone',d.phone,'addressText',d.address_text,'instructions',d.instructions,'latitudeE7',d.latitude_e7,'longitudeE7',d.longitude_e7,
   'earning',jsonb_build_object('amountMinor',d.driver_minor::text,'currency',d.currency,'decimals',d.decimals),'fixture',d.fixture,
   'proofs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) ORDER BY f.kind) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.consumed_at IS NULL AND f.revoked_at IS NULL AND f.expires_at>clock_timestamp()),'[]'::jsonb))
  INTO active FROM quote_delivery_snapshots d WHERE d.merchant_id=s.merchant_id AND d.quote_id=s.quote_id;
 END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY expiry,id),'[]'::jsonb) INTO offers FROM (
  SELECT f.id,f.expires_at AS expiry,jsonb_build_object('id',f.id,'shipmentId',f.shipment_id,'generation',f.generation::text,'version',f.version::text,'expiresAt',f.expires_at,
   'pickupLatitudeE7',d.origin_latitude_e7,'pickupLongitudeE7',d.origin_longitude_e7,
   'earning',jsonb_build_object('amountMinor',d.driver_minor::text,'currency',d.currency,'decimals',d.decimals),'fixture',d.fixture) AS row
  FROM food_dispatch_offers f JOIN food_shipments sh ON sh.id=f.shipment_id
  JOIN quote_delivery_snapshots d ON (d.merchant_id,d.quote_id)=(sh.merchant_id,sh.quote_id)
  WHERE f.driver_id=driver AND f.state='OFFERED' AND f.expires_at>clock_timestamp() AND sh.generation=f.generation AND sh.state='OFFERING' AND sh.active_assignment_id IS NULL
  ORDER BY f.expires_at,f.id LIMIT 10
 ) bounded;
 RETURN jsonb_build_object('offers',offers,'assignment',active);
END $$;
REVOKE ALL ON FUNCTION dispatch_driver_work() FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_driver_work() TO bitpos_app;
