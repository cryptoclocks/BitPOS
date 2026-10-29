-- Own online order -> current shipment/assignment snapshot; no global merchant access.
SET search_path=bitpos,public;
CREATE FUNCTION dispatch_customer_work(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;s food_shipments;a food_assignments;tracking jsonb;active jsonb:=NULL;
BEGIN
 actor:=dispatch_live_actor();
 SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(s.id);actor:=dispatch_live_actor();
 IF s.account_id<>actor THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 tracking:=dispatch_food_tracking(s.id);
 SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
 IF FOUND THEN
  active:=jsonb_build_object('id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
   'location',tracking->'location',
   'deliveryProof',(SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='DELIVERY' AND f.revoked_at IS NULL AND f.consumed_at IS NULL AND f.expires_at>clock_timestamp()));
 END IF;
 RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active);
END $$;
REVOKE ALL ON FUNCTION dispatch_customer_work(uuid) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_customer_work(uuid) TO bitpos_app;
