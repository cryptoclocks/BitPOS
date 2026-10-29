-- Platform administrators publish the single active passenger fare rate. Publication is
-- optimistic (caller names the rate it is replacing), audited by the row itself, and limited to
-- currencies/decimals the mobile money schema can express. Old rates stay for past trips.
SET search_path TO bitpos,extensions,public;
CREATE FUNCTION ride_publish_fare(expected_rate uuid,cur text,places int,base bigint,per_km bigint,per_min bigint,minimum bigint,shared_bps int) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;active_id uuid;new_id uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM platform_staff_role_grants WHERE account_id=actor AND role='administrator' AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ROLE_REQUIRED'; END IF;
 IF cur NOT IN('THB','USD','USDG','USDC','USDT') OR places NOT IN(2,4,6) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF minimum<1 OR base<0 OR per_km<0 OR per_min<0 OR shared_bps NOT BETWEEN 0 AND 9000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ride-fare-publish',0));
 SELECT id INTO active_id FROM ride_fare_rates WHERE active;
 IF active_id IS DISTINCT FROM expected_rate THEN RAISE EXCEPTION 'FARE_CHANGED'; END IF;
 UPDATE ride_fare_rates SET active=false WHERE active;
 INSERT INTO ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,active,published_by) VALUES(cur,places,base,per_km,per_min,minimum,shared_bps,true,actor) RETURNING id INTO new_id;
 RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION ride_publish_fare(uuid,text,int,bigint,bigint,bigint,bigint,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_publish_fare(uuid,text,int,bigint,bigint,bigint,bigint,int) TO bitpos_app;
CREATE FUNCTION ride_fare_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM platform_staff_role_grants WHERE account_id::text=current_setting('bitpos.mobile_account',true) AND role='administrator' AND revoked_at IS NULL AND expires_at>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION ride_fare_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_fare_admin() TO bitpos_app;
