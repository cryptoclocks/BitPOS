-- Private merchant owner/manager projection, no global staff impersonation.
SET search_path=bitpos,public;
CREATE FUNCTION food_refund118_merchant(order_uuid uuid,session_hash text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid;actor uuid;shipment uuid;selected uuid;review uuid;
BEGIN
 merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 SELECT se.user_id INTO actor FROM sessions se JOIN members m ON(m.merchant_id,m.user_id)=(se.merchant_id,se.user_id)
 WHERE se.token_hash=session_hash AND se.merchant_id=merchant AND se.expires_at>clock_timestamp()AND m.role IN('owner','manager')FOR SHARE OF se,m NOWAIT;
 IF actor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT s.id INTO shipment FROM food_shipments s WHERE s.order_id=order_uuid AND s.merchant_id=merchant;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 PERFORM dispatch_lock_root(shipment);
 SELECT r.case_id INTO review FROM food_return108_financial_reviews r JOIN food_return108_cases c ON c.id=r.case_id WHERE r.order_id=order_uuid AND r.merchant_id=merchant AND c.shipment_id=shipment;
 RETURN jsonb_build_object('orderId',order_uuid,'execution',CASE WHEN review IS NULL THEN NULL ELSE food_refund117_safe_execution(review)END);
END$$;
REVOKE ALL ON FUNCTION food_refund118_merchant(uuid,text)FROM PUBLIC,bitpos_app,bitpos_refund_worker;
