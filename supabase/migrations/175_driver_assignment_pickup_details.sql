-- Rider pickup screen (docs/E2E_ORDER_RUN_20261030_TH.md P1-1): the normal-duty driver assignment and each offer now carry the
-- public branch name, branch address label and the order's item names with quantities, so the rider can identify
-- the shop and check the bag. Read-only addition to one existing SECURITY DEFINER function (same body as 078 plus three
-- keys); no table, grant or restricted-duty change. Rollback: re-run the dispatch_driver_work definition from migration 078.
SET search_path=bitpos,public;
CREATE OR REPLACE FUNCTION dispatch_driver_work() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;a food_assignments;s food_shipments;active jsonb:=NULL;offers jsonb;reason text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 actor:=dispatch_live_actor();SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RETURN jsonb_build_object('offers','[]'::jsonb,'assignment',NULL);END IF;
 SELECT * INTO a FROM food_assignments WHERE driver_id=driver AND closed_at IS NULL;
 IF FOUND THEN
  a:=dispatch_lock_assignment(a.id,a.generation,a.lease_generation);actor:=dispatch_live_actor();
  SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
  reason:=food_driver_authority(a.driver_id,a.shipment_id);
  IF reason IS NOT NULL OR a.state='INCIDENT' THEN
   active:=food_driver_restricted_duty(a,s,reason);
  ELSE
  SELECT jsonb_build_object('access','NORMAL','shipmentVersion',s.version::text,'id',a.id,'shipmentId',s.id,'orderId',s.order_id,'merchantId',s.merchant_id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'state',a.state,
   'pickupLatitudeE7',d.origin_latitude_e7,'pickupLongitudeE7',d.origin_longitude_e7,
   'pickupName',coalesce((SELECT nullif(btrim(b.name),'') FROM marketplace_branches b WHERE b.merchant_id=d.merchant_id AND b.id=d.branch_id),(SELECT m.name FROM merchants m WHERE m.id=d.merchant_id)),
   'pickupAddress',coalesce((SELECT b.address_label FROM marketplace_branches b WHERE b.merchant_id=d.merchant_id AND b.id=d.branch_id),''),
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('name',i.name,'qty',i.qty) ORDER BY i.name) FROM (SELECT oi.name,sum(oi.qty)::int AS qty FROM order_items oi WHERE oi.merchant_id=s.merchant_id AND oi.order_id=s.order_id GROUP BY oi.name LIMIT 100) i),'[]'::jsonb),
   'recipientName',d.recipient_name,'phone',d.phone,'addressText',d.address_text,'instructions',d.instructions,'latitudeE7',d.latitude_e7,'longitudeE7',d.longitude_e7,
   'earning',jsonb_build_object('amountMinor',d.driver_minor::text,'currency',d.currency,'decimals',d.decimals),'fixture',d.fixture,
   'proofs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) ORDER BY f.kind) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.consumed_at IS NULL AND f.revoked_at IS NULL AND f.expires_at>clock_timestamp()),'[]'::jsonb))
  INTO active FROM quote_delivery_snapshots d WHERE d.merchant_id=s.merchant_id AND d.quote_id=s.quote_id;
  END IF;
 END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY expiry,id),'[]'::jsonb) INTO offers FROM (
  SELECT f.id,f.expires_at AS expiry,jsonb_build_object('id',f.id,'shipmentId',f.shipment_id,'generation',f.generation::text,'version',f.version::text,'expiresAt',f.expires_at,
   'pickupLatitudeE7',d.origin_latitude_e7,'pickupLongitudeE7',d.origin_longitude_e7,
   'pickupName',coalesce((SELECT nullif(btrim(b.name),'') FROM marketplace_branches b WHERE b.merchant_id=d.merchant_id AND b.id=d.branch_id),(SELECT mm.name FROM merchants mm WHERE mm.id=d.merchant_id)),
   'earning',jsonb_build_object('amountMinor',d.driver_minor::text,'currency',d.currency,'decimals',d.decimals),'fixture',d.fixture) AS row
  FROM food_dispatch_offers f JOIN food_shipments sh ON sh.id=f.shipment_id
  JOIN quote_delivery_snapshots d ON (d.merchant_id,d.quote_id)=(sh.merchant_id,sh.quote_id)
  WHERE active IS NULL AND f.driver_id=driver AND f.state='OFFERED' AND food_discovery_grant_live(driver,sh.merchant_id,d.branch_id) AND (NOT EXISTS(SELECT 1 FROM food_dispatch_automatic_offers automatic WHERE automatic.offer_id=f.id) OR food_dispatch_automatic_offer_live(f.id)) AND f.expires_at>clock_timestamp() AND sh.generation=f.generation AND sh.state='OFFERING' AND sh.active_assignment_id IS NULL
  ORDER BY f.expires_at,f.id LIMIT 10
 ) bounded;
 IF active->>'access'='NORMAL' THEN
  reason:=food_driver_authority(a.driver_id,a.shipment_id);
  IF reason IS NOT NULL THEN active:=food_driver_restricted_duty(a,s,reason);offers:='[]'::jsonb;END IF;
 END IF;
 RETURN jsonb_build_object('offers',offers,'assignment',active);
END $$;
