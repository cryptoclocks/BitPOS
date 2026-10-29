-- Scoped operational snapshot, not recipient/location tracking or financial authority.
SET search_path=bitpos,public;
CREATE FUNCTION food_dispatch_console_queue(merchant uuid,branch uuid,after_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE sponsor uuid;items jsonb;more boolean;next_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 -- Canonical merchant root before any retained mobile identity or role lock.
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;sponsor:=food_dispatch_policy_staff(merchant);
 IF NOT EXISTS(SELECT 1 FROM branch_delivery_policies WHERE merchant_id=merchant AND branch_id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 WITH page AS MATERIALIZED(
  SELECT s.* FROM food_shipments s JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
  WHERE s.merchant_id=merchant AND q.branch_id=branch AND s.state NOT IN('DELIVERED','CANCELLED','FAILED') AND(after_id IS NULL OR s.id>after_id)
  ORDER BY s.id LIMIT 51
 ),visible AS(SELECT * FROM page ORDER BY id LIMIT 50)
 SELECT coalesce(jsonb_agg(jsonb_build_object('shipmentId',s.id,'orderId',s.order_id,'shipmentState',s.state,'shipmentVersion',s.version::text,'generation',s.generation::text,'createdAt',s.created_at,
  'search',food_dispatch_search_value(s.id),
  'offers',(SELECT coalesce(jsonb_agg(jsonb_build_object('offerId',o.id,'driverId',o.driver_id,'generation',o.generation::text,'state',o.state,'expiresAt',o.expires_at) ORDER BY o.id),'[]'::jsonb) FROM food_dispatch_offers o WHERE o.shipment_id=s.id AND o.state='OFFERED'),
  'assignment',(SELECT jsonb_build_object('assignmentId',a.id,'driverId',a.driver_id,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'state',a.state) FROM food_assignments a WHERE a.id=s.active_assignment_id)) ORDER BY s.id),'[]'::jsonb),
  (SELECT count(*)>50 FROM page),(SELECT id FROM visible ORDER BY id DESC LIMIT 1)
 INTO items,more,next_id FROM visible s;
 IF food_dispatch_policy_staff(merchant)<>sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN jsonb_build_object('merchantId',merchant,'branchId',branch,'items',items,'nextAfterId',CASE WHEN more THEN next_id ELSE NULL END,'snapshotAt',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION food_dispatch_console_queue(uuid,uuid,uuid) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION food_dispatch_console_queue(uuid,uuid,uuid) TO bitpos_app;
