-- Closed assignment history, independent of coupon096-098 candidates. Local admission only.
SET search_path=bitpos,public;
CREATE INDEX food_history100_driver_order ON food_assignments(driver_id,accepted_at DESC,id DESC) WHERE closed_at IS NOT NULL;
CREATE FUNCTION driver100_food_history(cursor_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;result jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 IF cursor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM food_assignments WHERE id=cursor_id AND driver_id=driver AND closed_at IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 WITH selected AS (
  SELECT a.*,row_number() OVER(ORDER BY a.accepted_at DESC,a.id DESC) AS n
  FROM food_assignments a WHERE a.driver_id=driver AND a.closed_at IS NOT NULL
  AND(cursor_id IS NULL OR(a.accepted_at,a.id)<(SELECT accepted_at,id FROM food_assignments WHERE id=cursor_id AND driver_id=driver))
  ORDER BY a.accepted_at DESC,a.id DESC LIMIT 31
 ), projected AS (
  SELECT a.n,a.id,jsonb_build_object('id',a.id,'shipmentId',a.shipment_id,'state',a.state,
   'acceptedAt',a.accepted_at,'closedAt',a.closed_at,
   'quotedDriverFee',jsonb_build_object('currency',q.currency,'decimals',q.decimals,'amountMinor',q.driver_minor::text)) AS item
  FROM selected a JOIN food_shipments s ON s.id=a.shipment_id
  JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
 ) SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY n) FILTER(WHERE n<=30),'[]'::jsonb),
  'nextCursor',CASE WHEN count(*)>30 THEN (array_agg(id ORDER BY n))[30] ELSE NULL END) INTO result FROM projected;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION driver100_food_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver100_food_history(uuid) TO bitpos_app;
