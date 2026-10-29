-- Local candidate: scoped read-only suggestions; never reserves, offers or assigns work.
SET search_path=bitpos,public;
CREATE FUNCTION food_batch_candidates(merchant uuid,branch uuid,anchor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE sponsor uuid; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM 1 FROM merchants WHERE id=merchant FOR NO KEY UPDATE;
 sponsor:=food_dispatch_policy_staff(merchant);
 IF NOT EXISTS(SELECT 1 FROM branch_delivery_policies WHERE merchant_id=merchant AND branch_id=branch) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 -- A snapshot is intentionally bounded and omits recipient details and coordinates.
 -- READY's updated_at is the server-recorded ready time, not a preparation estimate.
 WITH eligible AS MATERIALIZED (
  SELECT s.id,s.version,s.generation,f.updated_at,q.currency,q.decimals,q.latitude_e7,q.longitude_e7
  FROM food_shipments s JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
  JOIN order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id)
  WHERE s.merchant_id=merchant AND q.branch_id=branch AND f.status='READY'
   AND s.active_assignment_id IS NULL AND s.state IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH')
   AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers o WHERE o.shipment_id=s.id AND o.state='OFFERED' AND o.expires_at>clock_timestamp())
   AND dispatch_verified_sale(s.id)
 ), root AS (SELECT * FROM eligible WHERE id=anchor), candidates AS (
  SELECT e.* FROM eligible e CROSS JOIN root r WHERE e.id<>r.id AND e.currency=r.currency AND e.decimals=r.decimals
   AND abs(extract(epoch FROM(e.updated_at-r.updated_at)))<=300
   AND 12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians((e.latitude_e7::double precision-r.latitude_e7)/10000000)/2),2)+cos(radians(e.latitude_e7::double precision/10000000))*cos(radians(r.latitude_e7::double precision/10000000))*power(sin(radians((e.longitude_e7::double precision-r.longitude_e7)/10000000)/2),2)))))<=2000
  ORDER BY e.updated_at,e.id LIMIT 50
 ), first_pick AS (SELECT * FROM candidates ORDER BY updated_at,id LIMIT 1), second_pick AS (
  SELECT c.* FROM candidates c CROSS JOIN first_pick p WHERE c.id<>p.id AND abs(extract(epoch FROM(c.updated_at-p.updated_at)))<=300
   AND 12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians((c.latitude_e7::double precision-p.latitude_e7)/10000000)/2),2)+cos(radians(c.latitude_e7::double precision/10000000))*cos(radians(p.latitude_e7::double precision/10000000))*power(sin(radians((c.longitude_e7::double precision-p.longitude_e7)/10000000)/2),2)))))<=2000
  ORDER BY c.updated_at,c.id LIMIT 1
 ), chosen AS (SELECT * FROM root UNION ALL SELECT * FROM first_pick UNION ALL SELECT * FROM second_pick)
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('shipmentId',id,'version',version::text,'generation',generation::text) ORDER BY CASE WHEN id=anchor THEN 0 ELSE 1 END,updated_at,id),'[]'::jsonb),'snapshotAt',clock_timestamp(),'assignmentCreated',false)
 INTO result FROM chosen;
 IF food_dispatch_policy_staff(merchant) IS DISTINCT FROM sponsor THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION food_batch_candidates(uuid,uuid,uuid) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION food_batch_candidates(uuid,uuid,uuid) TO bitpos_app;
