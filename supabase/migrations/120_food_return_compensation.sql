-- Private candidate: explicit compensation liability, never delivered earnings.
SET search_path=bitpos,public;
CREATE TABLE food_compensation120_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants,
 enabled boolean NOT NULL DEFAULT false,currency text NOT NULL CHECK(currency IN('USD','USDG')),
 decimals smallint NOT NULL CHECK(decimals IN(2,4,6)),returned_rate_bps int NOT NULL CHECK(returned_rate_bps BETWEEN 0 AND 10000),
 max_minor bigint NOT NULL CHECK(max_minor>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE food_compensation120_decisions(
 case_id uuid PRIMARY KEY REFERENCES food_return108_cases,actor_id uuid NOT NULL REFERENCES mobile_accounts,
 command_id uuid NOT NULL,request_hash text NOT NULL,policy_id uuid NOT NULL REFERENCES food_compensation120_policies,
 driver_id uuid NOT NULL REFERENCES driver_occupancy,amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 currency text NOT NULL,decimals smallint NOT NULL,posting_id uuid UNIQUE REFERENCES ledger_transactions,
 reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500),receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(actor_id,command_id)
);
ALTER TABLE food_compensation120_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_compensation120_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation120_policies,food_compensation120_decisions FROM PUBLIC,bitpos_app;
CREATE TRIGGER immutable_compensation120_policy BEFORE UPDATE OR DELETE ON food_compensation120_policies FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_compensation120_decision BEFORE UPDATE OR DELETE ON food_compensation120_decisions FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation120_approve(return_case uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;a food_assignments;d quote_delivery_snapshots;p food_compensation120_policies;
 prior food_compensation120_decisions;actor uuid;key uuid;digest text;amount bigint;posting uuid;debit uuid;credit uuid;result jsonb;
BEGIN
 -- Existing snapshot rechecks live administrator, session and merchant scope and locks root.
 PERFORM food_return109_snapshot(return_case);
 SELECT * INTO STRICT c FROM food_return108_cases WHERE id=return_case;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=c.shipment_id;
 actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','policyId','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'policyId')IS DISTINCT FROM 'string'OR jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(return_case,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('compensation120:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_compensation120_decisions WHERE actor_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM food_compensation120_decisions WHERE case_id=return_case)THEN RAISE EXCEPTION 'COMPENSATION_ALREADY_DECIDED';END IF;
 SELECT * INTO STRICT a FROM food_assignments WHERE id=c.assignment_id FOR UPDATE;
 IF a.state<>'RETURNED'OR a.closed_at IS NULL OR s.state<>'FAILED'
 OR NOT EXISTS(SELECT 1 FROM food_return108_receipts WHERE case_id=c.id)
 OR NOT EXISTS(SELECT 1 FROM food_return108_financial_reviews WHERE case_id=c.id)
 OR EXISTS(SELECT 1 FROM food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM earning_accruals WHERE food_assignment_id=a.id)THEN RAISE EXCEPTION 'COMPENSATION_REVIEW_REQUIRED';END IF;
 SELECT * INTO p FROM food_compensation120_policies WHERE id=(payload->>'policyId')::uuid AND merchant_id=s.merchant_id;
 IF NOT FOUND OR NOT p.enabled THEN RAISE EXCEPTION 'COMPENSATION_POLICY_UNAVAILABLE';END IF;
 SELECT * INTO STRICT d FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 IF(d.currency,d.decimals)IS DISTINCT FROM(p.currency,p.decimals)OR d.driver_minor<0 THEN RAISE EXCEPTION 'COMPENSATION_REVIEW_REQUIRED';END IF;
 amount:=least(p.max_minor,floor(d.driver_minor::numeric*p.returned_rate_bps/10000)::bigint);
 IF amount>0 THEN
  INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals)VALUES('PLATFORM','00000000-0000-4000-8000-000000000001','RECEIVABLE',p.currency,p.decimals),('DRIVER',a.driver_id,'PAYABLE',p.currency,p.decimals)ON CONFLICT DO NOTHING;
  SELECT id INTO STRICT debit FROM ledger_accounts WHERE owner_kind='PLATFORM'AND owner_id='00000000-0000-4000-8000-000000000001'AND purpose='RECEIVABLE'AND currency=p.currency AND decimals=p.decimals;
  SELECT id INTO STRICT credit FROM ledger_accounts WHERE owner_kind='DRIVER'AND owner_id=a.driver_id AND purpose='PAYABLE'AND currency=p.currency AND decimals=p.decimals;
  INSERT INTO ledger_transactions(source_kind,source_id,reason,currency,decimals)VALUES('FOOD_RETURN_COMPENSATION',c.id,payload->>'reason',p.currency,p.decimals)RETURNING id INTO posting;
  INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor)VALUES(posting,1,debit,p.currency,p.decimals,amount,0),(posting,2,credit,p.currency,p.decimals,0,amount);
 END IF;
 result:=jsonb_build_object('caseId',c.id,'policyId',p.id,'amountMinor',amount::text,'currency',p.currency,'decimals',p.decimals,'state','APPROVED','fundsTransferred',false);
 INSERT INTO food_compensation120_decisions(case_id,actor_id,command_id,request_hash,policy_id,driver_id,amount_minor,currency,decimals,posting_id,reason,receipt)VALUES(c.id,actor,key,digest,p.id,a.driver_id,amount,p.currency,p.decimals,posting,payload->>'reason',result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION food_compensation120_approve(uuid,jsonb)FROM PUBLIC,bitpos_app;
CREATE FUNCTION food_compensation120_snapshot(return_case uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;d quote_delivery_snapshots;policies jsonb;decision jsonb;
BEGIN
 PERFORM food_return109_snapshot(return_case);
 SELECT * INTO STRICT c FROM food_return108_cases WHERE id=return_case;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=c.shipment_id;
 SELECT * INTO STRICT d FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('policyId',p.id,'currency',p.currency,'decimals',p.decimals,'returnedRateBps',p.returned_rate_bps,'maxMinor',p.max_minor::text)ORDER BY p.created_at,p.id),'[]'::jsonb)INTO policies FROM food_compensation120_policies p WHERE p.merchant_id=s.merchant_id AND p.enabled AND(p.currency,p.decimals)=(d.currency,d.decimals);
 SELECT receipt INTO decision FROM food_compensation120_decisions WHERE case_id=c.id;
 RETURN jsonb_build_object('caseId',c.id,'shipmentVersion',s.version::text,'currency',d.currency,'decimals',d.decimals,'policies',policies,'decision',decision);
END $$;
REVOKE ALL ON FUNCTION food_compensation120_snapshot(uuid)FROM PUBLIC,bitpos_app;
