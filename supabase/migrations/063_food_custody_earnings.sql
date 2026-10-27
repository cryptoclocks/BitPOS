-- Food custody and durable earning obligations, not external payout proof.
SET search_path=bitpos,public;
CREATE FUNCTION food_finalize_earning(assignment uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;d quote_delivery_snapshots;doc jsonb;line jsonb;accrual uuid:=gen_random_uuid();posting uuid;debit uuid;credit uuid;party record;amount bigint;delivery_left bigint;part bigint;
 platform_id constant uuid:='00000000-0000-4000-8000-000000000001';
BEGIN
 SELECT * INTO STRICT a FROM food_assignments WHERE id=assignment;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=a.shipment_id;
 IF a.state<>'DELIVERED' OR s.state<>'DELIVERED' OR a.closed_at IS NULL THEN RAISE EXCEPTION 'EARNING_REQUIRES_DELIVERY';END IF;
 SELECT id INTO accrual FROM earning_accruals WHERE food_assignment_id=a.id;
 IF FOUND THEN RETURN accrual;END IF;accrual:=gen_random_uuid();
 SELECT * INTO STRICT d FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 SELECT snapshot INTO STRICT doc FROM quote_configured_food WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 IF d.driver_minor>0 THEN
  INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals) VALUES('PLATFORM',platform_id,'RECEIVABLE',d.currency,d.decimals) ON CONFLICT DO NOTHING;
  INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals) VALUES('DRIVER',a.driver_id,'PAYABLE',d.currency,d.decimals) ON CONFLICT DO NOTHING;
  SET CONSTRAINTS ledger_transaction_balanced,ledger_entries_balanced DEFERRED;
  SELECT id INTO STRICT debit FROM ledger_accounts WHERE owner_kind='PLATFORM' AND owner_id=platform_id AND purpose='RECEIVABLE' AND currency=d.currency AND decimals=d.decimals;
  SELECT id INTO STRICT credit FROM ledger_accounts WHERE owner_kind='DRIVER' AND owner_id=a.driver_id AND purpose='PAYABLE' AND currency=d.currency AND decimals=d.decimals;
  INSERT INTO ledger_transactions(source_kind,source_id,reason,currency,decimals) VALUES('EARNING_ACCRUAL',accrual,'Food delivery earning obligation; payout not confirmed',d.currency,d.decimals) RETURNING id INTO posting;
  INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES(posting,1,debit,d.currency,d.decimals,d.driver_minor,0),(posting,2,credit,d.currency,d.decimals,0,d.driver_minor);
  SET CONSTRAINTS ledger_transaction_balanced,ledger_entries_balanced IMMEDIATE;
 END IF;
 INSERT INTO earning_accruals(id,food_assignment_id,driver_id,ledger_transaction_id,state,available_at) VALUES(accrual,a.id,a.driver_id,posting,'ACCRUED',a.closed_at);
 INSERT INTO earning_accrual_facts(accrual_id,amount_minor,currency,decimals) VALUES(accrual,d.driver_minor,d.currency,d.decimals);
 SET CONSTRAINTS food_allocation_complete,food_allocation_final_complete DEFERRED;
 FOR line IN SELECT value FROM jsonb_array_elements(doc->'lines') LOOP
  INSERT INTO order_allocations(merchant_id,order_id,line_id,party_kind,party_id,kind,currency,decimals,amount_minor,source_quote_id)
  VALUES(s.merchant_id,s.order_id,line->>'lineId','MERCHANT',s.merchant_id,'ITEM',d.currency,d.decimals,(line->'basePrice'->>'amountMinor')::bigint*(line->>'qty')::bigint,s.quote_id);
  amount:=((line->'basePrice'->>'amountMinor')::bigint-(line->'unitPrice'->>'amountMinor')::bigint)*(line->>'qty')::bigint;
  IF amount>0 THEN INSERT INTO order_allocations(merchant_id,order_id,line_id,party_kind,party_id,kind,currency,decimals,amount_minor,source_quote_id) VALUES(s.merchant_id,s.order_id,line->>'lineId','MERCHANT',s.merchant_id,'DISCOUNT',d.currency,d.decimals,amount,s.quote_id);END IF;
 END LOOP;
 amount:=(doc->'tax'->>'amountMinor')::bigint;
 IF amount>0 THEN INSERT INTO order_allocations(merchant_id,order_id,line_id,party_kind,party_id,kind,currency,decimals,amount_minor,source_quote_id) VALUES(s.merchant_id,s.order_id,'@tax','MERCHANT',s.merchant_id,'TAX',d.currency,d.decimals,amount,s.quote_id);END IF;
 delivery_left:=d.delivery_minor;
 FOR party IN SELECT * FROM (VALUES('DRIVER',a.driver_id,d.driver_minor),('MERCHANT',s.merchant_id,d.merchant_minor),('PLATFORM',platform_id,d.platform_minor)) AS parties(kind,id,minor) LOOP
  part:=least(delivery_left,party.minor);delivery_left:=delivery_left-part;
  IF part>0 THEN INSERT INTO order_allocations(merchant_id,order_id,line_id,party_kind,party_id,kind,currency,decimals,amount_minor,source_quote_id) VALUES(s.merchant_id,s.order_id,'@fees',party.kind,party.id,'DELIVERY',d.currency,d.decimals,part,s.quote_id);END IF;
  IF party.minor>part THEN INSERT INTO order_allocations(merchant_id,order_id,line_id,party_kind,party_id,kind,currency,decimals,amount_minor,source_quote_id) VALUES(s.merchant_id,s.order_id,'@fees',party.kind,party.id,'SERVICE',d.currency,d.decimals,party.minor-part,s.quote_id);END IF;
 END LOOP;
 INSERT INTO order_allocation_finalizations(merchant_id,order_id,quote_id,currency,decimals,total_minor) VALUES(s.merchant_id,s.order_id,s.quote_id,d.currency,d.decimals,(doc->'total'->>'amountMinor')::bigint);
 SET CONSTRAINTS food_allocation_complete,food_allocation_final_complete IMMEDIATE;
 RETURN accrual;
END $$;
REVOKE ALL ON FUNCTION food_finalize_earning(uuid) FROM PUBLIC,bitpos_app;
CREATE FUNCTION dispatch_consume_proof(assignment uuid,proof uuid,service_gen bigint,lease_gen bigint,key uuid,submitted_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a food_assignments;s food_shipments;p fulfillment_proofs;actor uuid;prior food_dispatch_commands;digest text;at timestamptz;receipt jsonb;accrual uuid;
BEGIN
 IF key IS NULL OR submitted_hash IS NULL OR submitted_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO a FROM food_assignments WHERE id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(a.shipment_id);actor:=dispatch_live_actor();
 IF NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=a.driver_id AND account_id=actor) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(assignment,proof,service_gen,lease_gen,submitted_hash)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,61));
 SELECT * INTO prior FROM food_dispatch_commands WHERE actor_account_id=actor AND idempotency_key=key;
 IF FOUND THEN IF prior.operation<>'consume-proof' OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.response;END IF;
 a:=dispatch_lock_assignment(assignment,service_gen,lease_gen);actor:=dispatch_live_actor();
 SELECT * INTO p FROM fulfillment_proofs WHERE id=proof AND assignment_id=a.id AND driver_id=a.driver_id AND generation=a.generation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 at:=clock_timestamp();
 IF p.consumed_at IS NOT NULL OR p.revoked_at IS NOT NULL OR p.expires_at<=at OR p.attempts>=10 THEN RAISE EXCEPTION 'PROOF_UNAVAILABLE';END IF;
 IF p.kind='PICKUP' AND (a.state<>'AT_PICKUP' OR NOT EXISTS(SELECT 1 FROM order_fulfillment WHERE merchant_id=s.merchant_id AND order_id=s.order_id AND status='READY'))
 OR p.kind='DELIVERY' AND a.state<>'AT_DROPOFF' OR NOT dispatch_verified_sale(s.id) THEN RAISE EXCEPTION 'DISPATCH_NOT_READY';END IF;
 IF p.secret_hash<>submitted_hash THEN
  UPDATE fulfillment_proofs SET attempts=attempts+1 WHERE id=p.id;
  receipt:=jsonb_build_object('accepted',false,'error','PROOF_INVALID','attemptsRemaining',9-p.attempts);
 ELSE
  UPDATE fulfillment_proofs SET consumed_at=at,consumed_by=actor WHERE id=p.id;
  IF p.kind='PICKUP' THEN
   UPDATE order_fulfillment SET status='COLLECTED',version=version+1,updated_at=at WHERE merchant_id=s.merchant_id AND order_id=s.order_id;
   UPDATE food_assignments SET state='PICKED_UP',picked_up_at=at WHERE id=a.id;
   UPDATE food_shipments SET state='PICKED_UP' WHERE id=s.id;
  ELSE
   UPDATE food_assignments SET state='DELIVERED',closed_at=at WHERE id=a.id;
   UPDATE driver_assignment_leases SET state='RELEASED',released_at=at WHERE id=a.lease_id;
   UPDATE food_shipments SET state='DELIVERED',active_assignment_id=NULL WHERE id=s.id;
   accrual:=food_finalize_earning(a.id);
  END IF;
  PERFORM dispatch_event(s.id,p.kind||'_PROOF_CONSUMED',jsonb_build_object('assignmentId',a.id,'proofId',p.id));
  receipt:=jsonb_build_object('accepted',true,'assignmentId',a.id,'proofId',p.id,'kind',p.kind,'consumedAt',at,'accrualId',accrual);
 END IF;
 INSERT INTO food_dispatch_commands(actor_account_id,idempotency_key,operation,request_hash,response) VALUES(actor,key,'consume-proof',digest,receipt);
 RETURN receipt;
END $$;
CREATE FUNCTION food_collection_requires_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NEW.status='COLLECTED' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) AND EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id AND serving_kind='delivery')
 AND NOT EXISTS(SELECT 1 FROM food_shipments s JOIN food_assignments a ON a.id=s.active_assignment_id JOIN fulfillment_proofs p ON p.assignment_id=a.id AND p.driver_id=a.driver_id AND p.generation=a.generation
 WHERE s.merchant_id=NEW.merchant_id AND s.order_id=NEW.order_id AND p.kind='PICKUP' AND p.consumed_at IS NOT NULL AND p.revoked_at IS NULL AND a.state='AT_PICKUP')
 THEN RAISE EXCEPTION 'DRIVER_PICKUP_PROOF_REQUIRED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER food_collection_proof BEFORE INSERT OR UPDATE OF status ON order_fulfillment FOR EACH ROW EXECUTE FUNCTION food_collection_requires_proof();
REVOKE ALL ON FUNCTION dispatch_consume_proof(uuid,uuid,bigint,bigint,uuid,text),food_collection_requires_proof() FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION dispatch_consume_proof(uuid,uuid,bigint,bigint,uuid,text) TO bitpos_app;
