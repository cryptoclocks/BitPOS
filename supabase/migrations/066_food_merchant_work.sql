-- Store pickup custody metadata only; no driver/customer location stream or secret.
SET search_path=bitpos,public;
CREATE FUNCTION dispatch_merchant_work(oid uuid,session_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;s food_shipments;a food_assignments;actor uuid;active jsonb:=NULL;
BEGIN
 SELECT * INTO s FROM food_shipments WHERE merchant_id=merchant AND order_id=oid;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(s.id);
 BEGIN
  PERFORM 1 FROM sessions WHERE token_hash=session_hash AND merchant_id=merchant FOR SHARE NOWAIT;
  SELECT se.user_id INTO actor FROM sessions se JOIN members m ON (m.merchant_id,m.user_id)=(se.merchant_id,se.user_id)
  WHERE se.token_hash=session_hash AND se.merchant_id=merchant AND se.expires_at>clock_timestamp() AND m.role IN('owner','manager') FOR SHARE OF m NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 IF actor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
 IF FOUND THEN
  SELECT jsonb_build_object('id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
   'pickupProof',(SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='PICKUP' AND f.revoked_at IS NULL AND f.consumed_at IS NULL AND f.expires_at>clock_timestamp())) INTO active;
 END IF;
 RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active);
END $$;
REVOKE ALL ON FUNCTION dispatch_merchant_work(uuid,text) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_merchant_work(uuid,text) TO bitpos_app;
CREATE FUNCTION dispatch_merchant_issue_proof(oid uuid,assignment uuid,service_gen bigint,lease_gen bigint,key uuid,secret_hash text,rotate boolean,session_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM food_assignments a JOIN food_shipments s ON s.id=a.shipment_id WHERE a.id=assignment AND s.order_id=oid AND s.merchant_id=nullif(current_setting('bitpos.merchant',true),'')::uuid) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 RETURN dispatch_issue_proof(assignment,'PICKUP',service_gen,lease_gen,key,secret_hash,rotate,session_hash);
END $$;
REVOKE ALL ON FUNCTION dispatch_merchant_issue_proof(uuid,uuid,bigint,bigint,uuid,text,boolean,text) FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_merchant_issue_proof(uuid,uuid,bigint,bigint,uuid,text,boolean,text) TO bitpos_app;
