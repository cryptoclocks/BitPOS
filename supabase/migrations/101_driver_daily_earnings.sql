-- Candidate only: requires explicit local validation/admission. No payment effects.
SET search_path=bitpos,public;
CREATE INDEX driver101_earning_day ON earning_accruals(driver_id,created_at) WHERE food_assignment_id IS NOT NULL;
CREATE FUNCTION driver101_daily_earnings() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;driver uuid;observed timestamptz:=statement_timestamp();day_start timestamptz;day_end timestamptz;totals jsonb;completed bigint;
BEGIN
 PERFORM settlement088_mode();actor:=settlement088_live_actor();
 SELECT id INTO driver FROM driver_profiles WHERE account_id=actor;
 IF driver IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 day_start:=date_trunc('day',observed AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok';
 day_end:=day_start+interval '24 hours';
 -- Created obligations today, grouped by original currency/precision and current state.
 -- Never use a limited earnings page, payout conversion, or quoted assignment fee as a total.
 WITH grouped AS (
  SELECT e.state,f.currency,f.decimals,sum(f.amount_minor)::text amount,count(*) n
  FROM earning_accruals e JOIN earning_accrual_facts f ON f.accrual_id=e.id
  WHERE e.driver_id=driver AND e.food_assignment_id IS NOT NULL
   AND e.created_at>=day_start AND e.created_at<day_end AND e.created_at<=observed
  GROUP BY e.state,f.currency,f.decimals
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('state',state,'count',n::text,
 'money',jsonb_build_object('currency',currency,'decimals',decimals,'amountMinor',amount))
 ORDER BY currency,decimals,state),'[]'::jsonb) INTO totals FROM grouped;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(totals) v WHERE length(v->'money'->>'amountMinor')>19
 OR (v->'money'->>'amountMinor')::numeric>9223372036854775807) THEN RAISE EXCEPTION 'AMOUNT_OVERFLOW';END IF;
 SELECT count(*) INTO completed FROM food_assignments WHERE driver_id=driver AND state='DELIVERED'
 AND closed_at>=day_start AND closed_at<day_end AND closed_at<=observed;
 PERFORM settlement088_live_actor();
 RETURN jsonb_build_object('timeZone','Asia/Bangkok','dayStart',day_start,'dayEnd',day_end,
 'snapshotAt',observed,'completedDeliveries',completed::text,'groups',totals,'isTransferTotal',false);
END $$;
REVOKE ALL ON FUNCTION driver101_daily_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver101_daily_earnings() TO bitpos_app;
