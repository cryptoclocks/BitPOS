-- Work discovery for the private food-refund lane. Read-only: it lists attempts the restricted refund worker
-- may drive; it never moves state, signs or sends. An attempt is listed only while it holds a fee claim and has
-- neither a terminal receipt nor a quarantined contradiction. Execution itself stays in 110/112/114.
SET search_path=bitpos,public;
CREATE FUNCTION food_refund161_work(max_rows int)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM food_refund110_worker();
 IF max_rows IS NULL OR max_rows<1 OR max_rows>50 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 RETURN coalesce((SELECT jsonb_agg(w.id)FROM(
  SELECT a.id FROM food_refund110_attempts a
  WHERE EXISTS(SELECT 1 FROM food_refund113_claims c WHERE c.attempt_id=a.id)
  AND NOT EXISTS(SELECT 1 FROM food_refund112_receipts r WHERE r.attempt_id=a.id AND r.outcome IN('FINALIZED','FAILED'))
  AND NOT EXISTS(SELECT 1 FROM food_refund112_incidents i WHERE i.attempt_id=a.id)
  ORDER BY a.created_at,a.id LIMIT max_rows)w),'[]'::jsonb);
END$$;
-- Like every other refund function, no ambient grant: the operator grants EXECUTE to the one worker login.
REVOKE ALL ON FUNCTION food_refund161_work(int)FROM PUBLIC,bitpos_app,bitpos_refund_worker;
