-- Private candidate: immutable policy publication, not payment execution.
SET search_path=bitpos,public;
CREATE TABLE food_compensation121_publications(
 actor_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,
 case_id uuid NOT NULL REFERENCES food_return108_cases,policy_id uuid NOT NULL UNIQUE REFERENCES food_compensation120_policies,
 request_hash text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason))BETWEEN 1 AND 500),
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
ALTER TABLE food_compensation121_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_compensation121_publications FROM PUBLIC,bitpos_app;
CREATE TRIGGER immutable_compensation121_publication BEFORE UPDATE OR DELETE ON food_compensation121_publications FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_compensation121_publish(return_case uuid,payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;key uuid;digest text;c food_return108_cases;s food_shipments;d quote_delivery_snapshots;
 prior food_compensation121_publications;policy uuid;result jsonb;rate int;cap bigint;
BEGIN
 PERFORM food_return109_snapshot(return_case);
 SELECT * INTO STRICT c FROM food_return108_cases WHERE id=return_case;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=c.shipment_id;
 actor:=dispatch_live_actor();
 key:=food_incident_payload_key(payload,ARRAY['idempotencyKey','expectedVersion','enabled','returnedRateBps','maxMinor','reason'],ARRAY['expectedVersion']);
 IF jsonb_typeof(payload->'enabled')IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(payload->'returnedRateBps')IS DISTINCT FROM 'number'OR(payload->>'returnedRateBps')!~'^(0|[1-9][0-9]{0,4})$'
 OR jsonb_typeof(payload->'maxMinor')IS DISTINCT FROM 'string'OR(payload->>'maxMinor')!~'^(0|[1-9][0-9]{0,18})$'
 OR jsonb_typeof(payload->'reason')IS DISTINCT FROM 'string'OR length(btrim(payload->>'reason'))NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF(payload->>'returnedRateBps')::numeric>10000 OR(payload->>'maxMinor')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 rate:=(payload->>'returnedRateBps')::int;cap:=(payload->>'maxMinor')::bigint;
 digest:=encode(sha256(convert_to(jsonb_build_array(return_case,payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('compensation121:'||actor::text||key::text,0));
 SELECT * INTO prior FROM food_compensation121_publications WHERE actor_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF s.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 SELECT * INTO STRICT d FROM quote_delivery_snapshots WHERE merchant_id=s.merchant_id AND quote_id=s.quote_id;
 INSERT INTO food_compensation120_policies(merchant_id,enabled,currency,decimals,returned_rate_bps,max_minor)VALUES(s.merchant_id,(payload->>'enabled')::boolean,d.currency,d.decimals,rate,cap)RETURNING id INTO policy;
 result:=jsonb_build_object('caseId',c.id,'policyId',policy,'enabled',(payload->>'enabled')::boolean,'currency',d.currency,'decimals',d.decimals,'returnedRateBps',rate,'maxMinor',cap::text,'fundsTransferred',false);
 INSERT INTO food_compensation121_publications(actor_id,command_id,case_id,policy_id,request_hash,reason,receipt)VALUES(actor,key,c.id,policy,digest,payload->>'reason',result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION food_compensation121_publish(uuid,jsonb)FROM PUBLIC,bitpos_app;
