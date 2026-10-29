-- Private worker recovery view; derives state from durable journals, never memory.
SET search_path=bitpos,public;
CREATE FUNCTION food_compensation132_snapshot(attempt uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE base jsonb;submitted bigint;terminal text;state text;
BEGIN
 base:=food_compensation129_snapshot(attempt);
 SELECT count(*)INTO submitted FROM food_compensation130_submissions WHERE attempt_id=attempt;
 SELECT outcome INTO terminal FROM food_compensation131_receipts WHERE attempt_id=attempt ORDER BY created_at,id LIMIT 1;
 state:=CASE WHEN EXISTS(SELECT 1 FROM food_compensation131_incidents WHERE attempt_id=attempt)THEN 'RECONCILIATION_REQUIRED'
 WHEN terminal IS NOT NULL THEN terminal WHEN submitted>0 THEN 'UNKNOWN'WHEN base->'prepared'<>'null'::jsonb THEN 'PREPARED'ELSE 'ALLOCATED'END;
 RETURN base||jsonb_build_object('submissionSequence',submitted::text,'state',state);
END $$;
REVOKE ALL ON FUNCTION food_compensation132_snapshot(uuid)FROM PUBLIC,bitpos_app,bitpos_compensation_worker;
