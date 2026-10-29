CREATE FUNCTION bitpos.validate_refund_obligation() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.status<>'REQUESTED' OR NEW.signature IS NOT NULL OR NEW.version<>1 OR NOT EXISTS(
  SELECT 1 FROM payments p JOIN payment_attempt_assets a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id AND a.attempt_id=p.attempt_id
  WHERE p.merchant_id=NEW.merchant_id AND p.order_id=NEW.order_id AND p.id=NEW.payment_id
  AND p.amount_minor=NEW.amount_minor AND a.descriptor=NEW.asset_descriptor AND a.settlement=NEW.settlement AND a.payer=NEW.beneficiary)
 THEN RAISE EXCEPTION 'refund obligation must match received payment' USING ERRCODE='23514'; END IF;
 IF NEW.cause IS DISTINCT FROM (SELECT CASE WHEN acceptance_status='REJECTED' THEN 'ONLINE_ACCEPTANCE_REJECTED' ELSE 'ONLINE_ACCEPTANCE_TIMED_OUT' END FROM online_food_orders WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id) OR NOT bitpos.online_acceptance_ended(NEW.merchant_id,NEW.order_id)
 THEN RAISE EXCEPTION 'refund obligation requires terminal online acceptance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_refund_obligation BEFORE INSERT ON bitpos.refunds FOR EACH ROW EXECUTE FUNCTION bitpos.validate_refund_obligation();
