-- Merchant-only current approved rider display. No profile/contact/location grant.
-- Local migration draft; deploy with regenerated merchant contracts, never independently.
SET search_path=bitpos,public;
CREATE OR REPLACE FUNCTION dispatch_merchant_work(oid uuid,session_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid:=nullif(current_setting('bitpos.merchant',true),'')::uuid;s food_shipments;a food_assignments;actor uuid;active jsonb:=NULL;rider jsonb:=NULL;
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
  -- Root first, then the established occupancy/assignment/lease fence. Never use a previous rider.
  a:=dispatch_lock_assignment(a.id,s.generation,a.lease_generation);
  -- This gate locks identity/service authority NOWAIT and returns a reason for restricted duty.
  -- Restricted custody metadata remains visible, but unapproved application data does not.
  IF food_driver_authority(a.driver_id,s.id) IS NULL THEN
   SELECT jsonb_build_object('displayName',btrim(p.display_name)) INTO rider FROM driver_profiles p WHERE p.id=a.driver_id;
  END IF;
  SELECT jsonb_build_object('id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,'rider',rider,
   'pickupProof',(SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='PICKUP' AND f.revoked_at IS NULL AND f.consumed_at IS NULL)) INTO active;
 END IF;
 RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active);
END $$;
