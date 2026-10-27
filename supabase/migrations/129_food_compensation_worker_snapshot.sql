-- Private restricted worker read, not submission authority.
SET search_path=bitpos,public;
CREATE FUNCTION food_compensation129_snapshot(attempt uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE i food_compensation126_intents;r food_compensation124_reservations;f food_compensation127_fee_claims;c settlement088_provider_configs;b settlement088_beneficiaries;prepared jsonb;ready boolean;
BEGIN
 IF NOT pg_has_role(session_user,'bitpos_compensation_worker','MEMBER')OR pg_has_role(session_user,'bitpos_app','MEMBER')THEN RAISE EXCEPTION 'COMPENSATION_WORKER_REQUIRED';END IF;
 SELECT * INTO i FROM food_compensation126_intents WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT r FROM food_compensation124_reservations WHERE id=i.reservation_id;
 PERFORM dispatch_lock_root((SELECT shipment_id FROM food_return108_cases WHERE id=r.case_id));
 SELECT * INTO STRICT i FROM food_compensation126_intents WHERE id=attempt FOR SHARE;
 SELECT * INTO f FROM food_compensation127_fee_claims WHERE attempt_id=i.id;
 SELECT * INTO STRICT c FROM settlement088_provider_configs WHERE id=i.config_id FOR SHARE;
 SELECT * INTO STRICT b FROM settlement088_beneficiaries WHERE id=r.beneficiary_id FOR SHARE;
 SELECT payload INTO prepared FROM food_compensation128_prepared WHERE attempt_id=i.id;
 ready:=c.enabled AND c.version=i.config_version AND b.state='VERIFIED'AND b.version=r.beneficiary_version AND b.public_key=i.recipient_owner
 AND f.attempt_id IS NOT NULL AND EXISTS(SELECT 1 FROM food_compensation125_claims WHERE reservation_id=r.id AND amount_minor=i.amount_minor AND config_id=c.id AND config_version=c.version)
 AND EXISTS(SELECT 1 FROM payment_assets WHERE descriptor=i.asset AND enabled AND verified_at IS NOT NULL);
 RETURN jsonb_build_object('attemptId',i.id,'reservationId',r.id,'recipientOwner',i.recipient_owner,'sourceOwner',i.source_owner,'feePayerOwner',i.fee_payer_owner,'amountMinor',i.amount_minor::text,'asset',i.asset,'maxFeeLamports',f.max_fee_lamports,'maxTotalLamports',f.amount_lamports,'fundingAvailable',coalesce(ready,false),'prepared',prepared);
END $$;
REVOKE ALL ON FUNCTION food_compensation129_snapshot(uuid)FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
