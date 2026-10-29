-- Owner decision 2026-10-27: demo default ride fare is a flat 50.00 THB (about 1.5 USDC at the demo rate;
-- ride payment itself stays closed, so the USDC figure is informational only). Seeded only when no fare is
-- active, so a rate an administrator already published is never replaced. An administrator can still
-- publish a different rate through the fare publication function; this row is then retired as usual.
SET LOCAL search_path=bitpos,public;
INSERT INTO ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,active,published_by)
SELECT 'THB',2,5000,0,0,5000,2500,true,NULL
WHERE NOT EXISTS (SELECT 1 FROM ride_fare_rates WHERE active);
