import type pg from 'pg';
import {z} from 'zod';
import type {DailyPromotionContext,PromotionSalesBucket} from '../../../packages/contracts/src/promotion-context';
import {fail} from './authority';
const timezone=z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}catch{return false;}});
export const dailyContextSchema=z.object({timezone:timezone.default('Asia/Bangkok'),lookbackWeeks:z.number().int().min(4).max(8).default(6)}).strict();
/** Finalized successful payment, not callback/cart/fixture; no identity leaves this boundary. */
export async function dailyPromotionContext(db:pg.PoolClient,merchant:string,productIds:string[],options:unknown,now=new Date()):Promise<DailyPromotionContext>{
 const input=dailyContextSchema.parse(options),until=now.toISOString(),from=new Date(now.getTime()-input.lookbackWeeks*7*86400000).toISOString();
 const query=`WITH paid AS (
 SELECT o.id,o.paid_at FROM orders o WHERE o.merchant_id=$1 AND o.status='PAID' AND o.paid_at>=$2::timestamptz AND o.paid_at<$3::timestamptz
 AND EXISTS(SELECT 1 FROM payments p JOIN payment_attempts a ON a.merchant_id=p.merchant_id AND a.id=p.attempt_id AND a.order_id=p.order_id
  WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id AND p.state='SETTLED' AND a.status='FINALIZED')
 AND EXISTS(SELECT 1 FROM catalog_price_versions v JOIN order_authority oa ON oa.merchant_id=v.merchant_id AND oa.price_version_id=v.id
  WHERE oa.merchant_id=o.merchant_id AND oa.order_id=o.id AND v.provenance='owner_configured')
 ), buckets AS (
 SELECT i.product_id,extract(dow FROM p.paid_at AT TIME ZONE $4)::int AS weekday,
 CASE WHEN extract(hour FROM p.paid_at AT TIME ZONE $4)>=6 AND extract(hour FROM p.paid_at AT TIME ZONE $4)<12 THEN 'morning'
 WHEN extract(hour FROM p.paid_at AT TIME ZONE $4)>=12 AND extract(hour FROM p.paid_at AT TIME ZONE $4)<17 THEN 'afternoon'
 WHEN extract(hour FROM p.paid_at AT TIME ZONE $4)>=17 AND extract(hour FROM p.paid_at AT TIME ZONE $4)<22 THEN 'evening' ELSE 'night' END AS time_window,
 count(DISTINCT p.id)::int AS order_count,sum(i.qty)::int AS quantity
 FROM paid p JOIN order_items i ON i.order_id=p.id AND i.merchant_id=$1 WHERE i.product_id=ANY($5::uuid[])
 GROUP BY i.product_id,weekday,time_window
 ) SELECT (SELECT count(*)::int FROM paid) AS paid_count,
 coalesce((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'weekday',weekday,'window',time_window,'orderCount',order_count,'quantity',quantity) ORDER BY weekday,time_window,product_id) FROM buckets),'[]'::jsonb) AS buckets`;
 const row=(await db.query<{paid_count:number;buckets:PromotionSalesBucket[]}>(query,[merchant,from,until,input.timezone,productIds])).rows[0];if(!row)fail('PROMOTION_REVIEW_REQUIRED');
 const localWeekday=new Intl.DateTimeFormat('en-US',{timeZone:input.timezone,weekday:'short'}).format(now),weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(localWeekday);
 const sparseHistory=row.paid_count<20;
 return {kind:'daily',timezone:input.timezone,lookbackWeeks:input.lookbackWeeks,from,until,weekday,verifiedPaidOrderCount:row.paid_count,sparseHistory,basis:sparseHistory?'stock_first_sparse_history':'verified_paid_sales_and_stock',buckets:row.buckets};
}
