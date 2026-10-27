-- Private candidate: irreversible policy retirement, historical decisions retained.
SET search_path=bitpos,public;
CREATE TABLE food_compensation122_retirements(
 policy_id uuid PRIMARY KEY REFERENCES food_compensation120_policies,actor_id uuid NOT NULL REFERENCES mobile_accounts,
 command_id uuid NOT NULL,case_id uuid NOT NULL REFERENCES food_return108_cases,request_hash text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500),receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(actor_id,command_id)
);
ALTER TABLE food_compensation122_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation122_retirements FROM PUBLIC,bitpos_app;
CREATE TRIGGER immutable_compensation122_retirement BEFORE UPDATE OR DELETE ON food_compensation122_retirements FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation122_retire(return_case uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;p food_compensation120_policies;actor uuid;key uuid;digest text;prior food_compensation122_retirements;result jsonb;
BEGIN
 PERFORM food_return109_snapshot(return_case);
 SELECT * INTO STRICT c FROM food_return108_cases WHERE id=return_case;SELECT * INTO STRICT s FROM food_shipments WHERE id=c.shipment_id;
 actor:=dispatch_live_actor();key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','policyId','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'policyId')IS DISTINCT FROM 'string'OR jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(return_case,payload)::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('compensation122:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_compensation122_retirements WHERE actor_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 SELECT * INTO p FROM food_compensation120_policies WHERE id=(payload->>'policyId')::uuid AND merchant_id=s.merchant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMPENSATION_POLICY_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM food_compensation122_retirements WHERE policy_id=p.id)THEN RAISE EXCEPTION 'COMPENSATION_POLICY_RETIRED';END IF;
 result:=jsonb_build_object('caseId',c.id,'policyId',p.id,'state','RETIRED','fundsTransferred',false);
 INSERT INTO food_compensation122_retirements(policy_id,actor_id,command_id,case_id,request_hash,reason,receipt)VALUES(p.id,actor,key,c.id,digest,payload->>'reason',result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION food_compensation122_retire(uuid,jsonb)FROM PUBLIC,bitpos_app;
CREATE FUNCTION food_compensation122_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM 1 FROM food_compensation120_policies WHERE id=NEW.policy_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM food_compensation122_retirements WHERE policy_id=NEW.policy_id)THEN RAISE EXCEPTION 'COMPENSATION_POLICY_RETIRED';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION food_compensation122_guard()FROM PUBLIC,bitpos_app;
CREATE TRIGGER active_compensation122_policy BEFORE INSERT ON food_compensation120_decisions FOR EACH ROW EXECUTE FUNCTION food_compensation122_guard();
CREATE OR REPLACE FUNCTION food_compensation120_snapshot(return_case uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c food_return108_cases;s food_shipments;d quote_delivery_snapshots;policies jsonb;decision jsonb;
BEGIN
 PERFORM food_return109_snapshot(return_case);
 SELECT * INTO STRICT c FROM food_return108_cases WHERE id=return_case;SELECT * INTO STRICT s FROM food_shipments WHERE id=c.shipment_id;
 SELECT * INTO STRICT d FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('policyId',p.id,'currency',p.currency,'decimals',p.decimals,'returnedRateBps',p.returned_rate_bps,'maxMinor',p.max_minor::text)ORDER BY p.created_at,p.id),'[]'::jsonb)INTO policies FROM food_compensation120_policies p WHERE p.merchant_id=s.merchant_id AND p.enabled AND(p.currency,p.decimals)=(d.currency,d.decimals)AND NOT EXISTS(SELECT 1 FROM food_compensation122_retirements r WHERE r.policy_id=p.id);
 SELECT receipt INTO decision FROM food_compensation120_decisions WHERE case_id=c.id;
 RETURN jsonb_build_object('caseId',c.id,'shipmentVersion',s.version::text,'currency',d.currency,'decimals',d.decimals,'policies',policies,'decision',decision);
END $$;
