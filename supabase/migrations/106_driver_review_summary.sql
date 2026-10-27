-- Private driver aggregate; no public reviewer identity or client-selected driver.
SET search_path=bitpos,public;
CREATE INDEX driver106_published_reviews ON mobile_food_reviews(driver_id) WHERE state='PUBLISHED' AND driver_stars IS NOT NULL;
CREATE FUNCTION driver106_review_summary() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;counted bigint;total numeric;observed timestamptz:=statement_timestamp();
BEGIN
 PERFORM settlement088_mode();actor:=settlement088_live_actor();
 SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 SELECT count(*),coalesce(sum(driver_stars::numeric),0) INTO counted,total
 FROM mobile_food_reviews WHERE driver_id=driver AND state='PUBLISHED' AND driver_stars IS NOT NULL AND created_at<=observed;
 RETURN jsonb_build_object('driverId',driver,'publishedCount',counted::text,
 'averageTenths',CASE WHEN counted=0 THEN NULL ELSE round(total*10/counted)::integer END,
 'snapshotAt',observed);
END $$;
REVOKE ALL ON FUNCTION driver106_review_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver106_review_summary() TO bitpos_app;
