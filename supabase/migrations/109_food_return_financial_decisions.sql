-- Private candidate: explicit financial decision, never proof of execution.
-- Requires108. Application grants remain revoked until scoped admission review.
SET search_path=bitpos,public;
CREATE TABLE food_return109_decisions(
 case_id uuid PRIMARY KEY REFERENCES food_return108_financial_reviews,
 actor_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,
 grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,command_id uuid NOT NULL,
 request_hash text NOT NULL,decision text NOT NULL CHECK(decision IN('FULL_REFUND','NO_REFUND')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,command_id)
);
CREATE TABLE food_return109_allocations(
 case_id uuid NOT NULL REFERENCES food_return109_decisions,
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,payment_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),asset_descriptor jsonb NOT NULL,
 settlement jsonb NOT NULL,beneficiary text NOT NULL,
 PRIMARY KEY(case_id,payment_id),UNIQUE(payment_id),
 FOREIGN KEY(merchant_id,order_id,payment_id) REFERENCES payments(merchant_id,order_id,id)
);
ALTER TABLE food_return109_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_return109_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_return109_decisions,food_return109_allocations FROM PUBLIC,bitpos_app;
CREATE TRIGGER immutable_return109_decision BEFORE UPDATE OR DELETE ON food_return109_decisions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_return109_allocation BEFORE UPDATE OR DELETE ON food_return109_allocations FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_return109_decide(case_id uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;actor uuid;sponsor uuid;key uuid;digest text;
 prior food_return109_decisions;receipt jsonb;count_payments integer;
BEGIN
 SELECT * INTO c FROM food_return108_cases WHERE id=case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(c.shipment_id);PERFORM food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 SELECT g.id INTO sponsor FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
 WHERE g.account_id=actor AND g.role='administrator' AND sc.merchant_id=s.merchant_id
 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() ORDER BY g.id LIMIT 1 FOR SHARE OF g,sc NOWAIT;
 IF sponsor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','decision','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'decision')IS DISTINCT FROM 'string' OR payload->>'decision' NOT IN('FULL_REFUND','NO_REFUND')
 OR jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(case_id,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('return109:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_return109_decisions d WHERE d.actor_id=actor AND d.command_id=key;
 IF FOUND THEN IF prior.case_id<>case_id OR prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM food_return108_financial_reviews r WHERE r.case_id=c.id) OR s.state<>'FAILED' THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM food_return109_decisions d WHERE d.case_id=c.id) THEN RAISE EXCEPTION 'RETURN_FINANCIAL_ALREADY_DECIDED';END IF;
 -- Existing obligations/ambiguous payment assets require reconciliation, never a second allocation.
 IF EXISTS(SELECT 1 FROM refunds r WHERE r.merchant_id=s.merchant_id AND r.order_id=s.order_id) THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 PERFORM 1 FROM payments p WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id ORDER BY p.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM payments p LEFT JOIN payment_attempt_assets a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id AND a.attempt_id=p.attempt_id
 WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id AND (a.attempt_id IS NULL OR a.payer IS NULL OR p.amount_minor<=0))THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 SELECT count(*) INTO count_payments FROM payments p WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id;
 IF count_payments=0 THEN RAISE EXCEPTION 'RETURN_FINANCIAL_RECONCILIATION_REQUIRED';END IF;
 receipt:=jsonb_build_object('caseId',c.id,'decision',payload->>'decision','paymentCount',count_payments,'executionState',CASE WHEN payload->>'decision'='FULL_REFUND' THEN 'PENDING' ELSE 'NOT_REQUESTED' END,'fundsTransferred',false,'stockRestored',false);
 INSERT INTO food_return109_decisions(case_id,actor_id,session_id,grant_id,command_id,request_hash,decision,reason,receipt)
 VALUES(c.id,actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,sponsor,key,digest,payload->>'decision',payload->>'reason',receipt);
 IF payload->>'decision'='FULL_REFUND' THEN
 INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary)
 SELECT c.id,p.merchant_id,p.order_id,p.id,p.amount_minor,a.descriptor,a.settlement,a.payer FROM payments p JOIN payment_attempt_assets a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id AND a.attempt_id=p.attempt_id WHERE p.merchant_id=s.merchant_id AND p.order_id=s.order_id;
 END IF;
 PERFORM dispatch_event(s.id,'RETURN_FINANCIAL_DECIDED',jsonb_build_object('caseId',c.id,'fundsTransferred',false));
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION food_return109_decide(uuid,jsonb) FROM PUBLIC,bitpos_app;
CREATE FUNCTION guard_food_return109_allocation()RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM food_return109_decisions d JOIN food_return108_financial_reviews r ON r.case_id=d.case_id JOIN payments p ON p.merchant_id=r.merchant_id AND p.order_id=r.order_id JOIN payment_attempt_assets a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id AND a.attempt_id=p.attempt_id
 WHERE d.case_id=NEW.case_id AND d.decision='FULL_REFUND' AND p.id=NEW.payment_id
 AND (p.merchant_id,p.order_id,p.amount_minor,a.descriptor,a.settlement,a.payer) IS NOT DISTINCT FROM (NEW.merchant_id,NEW.order_id,NEW.amount_minor,NEW.asset_descriptor,NEW.settlement,NEW.beneficiary))THEN RAISE EXCEPTION 'RETURN_ALLOCATION_MUST_MATCH_PAYMENT' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_food_return109_allocation() FROM PUBLIC,bitpos_app;
CREATE TRIGGER canonical_return109_allocation BEFORE INSERT ON food_return109_allocations FOR EACH ROW EXECUTE FUNCTION guard_food_return109_allocation();
CREATE FUNCTION food_return109_snapshot(case_id uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;r food_return108_financial_reviews;actor uuid;sponsor uuid;decision jsonb;
BEGIN
 SELECT * INTO c FROM food_return108_cases WHERE id=case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(c.shipment_id);PERFORM food_incident_staff(s.merchant_id,true);actor:=dispatch_live_actor();
 SELECT g.id INTO sponsor FROM platform_staff_role_grants g JOIN platform_role_scopes sc ON sc.grant_id=g.id
 WHERE g.account_id=actor AND g.role='administrator' AND sc.merchant_id=s.merchant_id AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
 ORDER BY g.id LIMIT 1 FOR SHARE OF g,sc NOWAIT;
 IF sponsor IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT * INTO r FROM food_return108_financial_reviews review WHERE review.case_id=c.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_FINANCIAL_REVIEW_REQUIRED';END IF;
 SELECT d.receipt INTO decision FROM food_return109_decisions d WHERE d.case_id=c.id;
 RETURN jsonb_build_object('caseId',c.id,'shipmentVersion',s.version::text,'catalogTotal',jsonb_build_object('currency',r.catalog_currency,'decimals',r.catalog_decimals,'amountMinor',r.catalog_total_minor::text),'paymentCount',(SELECT count(*) FROM payments p WHERE p.merchant_id=r.merchant_id AND p.order_id=r.order_id),'decision',decision);
END $$;
REVOKE ALL ON FUNCTION food_return109_snapshot(uuid) FROM PUBLIC,bitpos_app;
