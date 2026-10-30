-- Longer demo-friendly windows (owner decision 2026-10-31, "extend to 5 minutes"). Additive; no table, grant or status change.
-- 1) Merchant acceptance: the deadline was created+2 minutes (capped by the quote), measured from ORDER CREATION, so a customer who
--    took a minute to pay left the merchant one minute. It is now quote expiry + 5 minutes: payment is only possible before quote
--    expiry, so the merchant always has at least 5 minutes after payment. Paid-but-unaccepted orders still time out and open the
--    refund obligation exactly as before.
-- 2) Rider offers: a standard full-length offer (45 s) is lengthened to 2 minutes inside the single offer-creation function; offers
--    already shortened by a search cycle deadline are untouched. The hard upper bound moves 46 s -> 121 s.
-- Rollback: re-run initialize_online_food from migration 052 and dispatch_create_offer_locked from migration 078.
CREATE OR REPLACE FUNCTION initialize_online_food() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.source_kind='online' THEN
  INSERT INTO online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_deadline)
  SELECT NEW.merchant_id,NEW.order_id,NEW.source_account_id,NEW.source_branch_id,
   quote_expires_at+interval '5 minutes' FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id;
  PERFORM online_food_event(NEW.merchant_id,NEW.order_id,'CREATED');
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dispatch_create_offer_locked(shipment uuid,driver uuid,expires timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE s food_shipments;offer uuid:=gen_random_uuid();at timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO STRICT s FROM food_shipments WHERE id=shipment;PERFORM food_driver_require_authority(driver,s.id);
 IF s.active_assignment_id IS NOT NULL OR s.state NOT IN('WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING') OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF expires>at+interval '44 seconds' AND expires<=at+interval '46 seconds' THEN expires:=at+interval '120 seconds';END IF;
 IF expires<=at OR expires>at+interval '121 seconds' OR NOT dispatch_eligible_driver(driver) OR EXISTS(SELECT 1 FROM driver_assignment_leases WHERE driver_id=driver AND state='ACTIVE') THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE';END IF;
 UPDATE food_dispatch_offers SET state='EXPIRED',version=version+1 WHERE shipment_id=s.id AND state='OFFERED' AND expires_at<=at;
 IF EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED') THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;
 UPDATE food_shipments SET generation=generation+1,state='OFFERING' WHERE id=s.id RETURNING * INTO s;
 INSERT INTO food_dispatch_offers(id,shipment_id,generation,driver_id,state,expires_at) VALUES(offer,s.id,s.generation,driver,'OFFERED',expires);
 PERFORM dispatch_event(s.id,'OFFERED',jsonb_build_object('offerId',offer));
 PERFORM food_driver_require_authority(driver,s.id);
 RETURN jsonb_build_object('offerId',offer,'shipmentId',s.id,'generation',s.generation::text,'version',(s.version+1)::text);
END $$;

