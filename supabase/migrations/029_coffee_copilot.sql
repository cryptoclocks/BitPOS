-- Apply before enabling Copilot or Gemini promotion generation. Requires parent 032
-- before serving Copilot; retain records on rollback and disable route admission.
SET search_path TO bitpos,extensions,public;
CREATE TABLE ai_free_requests(merchant_id uuid NOT NULL REFERENCES merchants,request_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose IN ('copilot','transcribe','promotion')),visit_id uuid, input_hash text NOT NULL,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,request_id,purpose));
CREATE INDEX ai_free_day ON ai_free_requests(started_at);
-- Preserve every observed actual prior Gemini start (including the three approved
-- prior jobs), not a synthetic reset. Fail deployment if expected history is absent.
INSERT INTO ai_free_requests(merchant_id,request_id,purpose,input_hash,started_at)
 SELECT merchant_id,id,'promotion',md5(id::text),created_at FROM ai_generation_jobs WHERE attempts>0 AND provider_origin='https://generativelanguage.googleapis.com';
DO $$ BEGIN IF (SELECT count(*) FROM ai_free_requests WHERE purpose='promotion')<3 THEN RAISE EXCEPTION 'Expected at least three historical Gemini starts; reconcile history before rollout'; END IF; END $$;
CREATE TABLE coffee_operations(merchant_id uuid NOT NULL REFERENCES merchants,visit_id uuid NOT NULL,request_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose IN ('copilot','transcribe')),input_hash text NOT NULL,draft_revision text NOT NULL,snapshot_hash text NOT NULL,result jsonb,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,visit_id,request_id),FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id));
ALTER TABLE coffee_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY coffee_tenant ON coffee_operations USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON coffee_operations TO bitpos_app;
REVOKE ALL ON ai_free_requests FROM PUBLIC,bitpos_app;
CREATE FUNCTION reserve_ai_free(p_merchant uuid,p_request uuid,p_purpose text,p_visit uuid,p_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE moment timestamptz:=clock_timestamp();day_start timestamptz:=date_trunc('day',moment AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 IF p_merchant::text IS DISTINCT FROM current_setting('bitpos.merchant',true) OR p_purpose NOT IN ('copilot','transcribe','promotion') THEN RAISE EXCEPTION 'invalid free admission'; END IF;
 PERFORM pg_advisory_xact_lock(730029);
 IF EXISTS(SELECT 1 FROM ai_free_requests WHERE merchant_id=p_merchant AND request_id=p_request AND purpose=p_purpose) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM ai_free_requests WHERE started_at>=day_start)>=20 THEN RETURN false; END IF;
 IF p_visit IS NOT NULL AND ((SELECT count(*) FROM ai_free_requests WHERE merchant_id=p_merchant AND visit_id=p_visit AND started_at>=day_start)>=5 OR (SELECT count(*) FROM ai_free_requests WHERE merchant_id=p_merchant AND visit_id=p_visit AND started_at>moment-interval '1 minute')>=3) THEN RETURN false; END IF;
 INSERT INTO ai_free_requests VALUES(p_merchant,p_request,p_purpose,p_visit,p_hash,moment);RETURN true;
END $$;
REVOKE ALL ON FUNCTION reserve_ai_free(uuid,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_ai_free(uuid,uuid,text,uuid,text) TO bitpos_app;
