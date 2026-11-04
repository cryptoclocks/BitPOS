import type pg from 'pg';
import {fail} from './authority';
import {z} from 'zod';
import {defaultTimeZone} from './opening-hours';
import {salesReport} from './reports';

const dayParam=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
export type OverviewChannel='store'|'delivery'|'pickup';
export interface OverviewSale{currency:string;decimals:number;orders:number;totalMinor:string}
export interface OverviewNet{currency:string;decimals:number;salesMinor:string;refundedMinor:string;netMinor:string}
export interface OverviewRecent{id:string;channel:OverviewChannel;status:string;fulfillmentStatus:string|null;total:{currency:string;decimals:number;amountMinor:string};createdAt:string}
/**
 * One definition, stated once (the same one the server sales report and CSV export use):
 *  - "today" is the shop-local calendar day in the merchant's time zone (default Asia/Bangkok), never the viewer's;
 *  - order count and channel shares count orders by CREATED time, every status including unpaid;
 *  - paid count, sales and hourly buckets count PAID orders by PAID time (paid_at), exactly like /api/reports/sales and /api/reports/export;
 *  - in progress = paid, not yet collected, paid since the start of yesterday (shop zone), so a bill paid just before midnight stays on the board.
 */
export interface OverviewSummary{
 day:string;/** true when `day` is the shop's current day: only then is "in progress" a live figure */isToday:boolean;timeZone:string;generatedAt:string;
 basis:{orders:'created_at';sales:'paid_at';hours:'paid_at';inProgress:'paid_since_yesterday_not_collected'};
 orders:{today:number;paid:number;inProgress:number};
 /** Per currency and decimals, integer minor units, never summed across denominations. null for roles that may not read sales (staff). */
 sales:OverviewSale[]|null;
 /** Paid orders today that have no price record (legacy), so they are in the paid count but not in sales. null when sales is null. */
 excludedOrders:number|null;
 /** Per denomination: gross paid minus FINALIZED refunds (before fees), the same refund source as the sales report. null for roles that may not read sales. */
 net:OverviewNet[]|null;
 channels:Record<OverviewChannel,number>;
 hours:{hour:number;paid:number}[];
 recent:OverviewRecent[];
}
/** Any signed-in role. Operational counts are open to staff (as the order list already is); money totals are owner/manager only like the sales report. */
export async function overviewSummary(db:pg.PoolClient,merchant:string,role:string,url:URL):Promise<OverviewSummary>{
 const keys=[...url.searchParams.keys()];if(keys.some(k=>k!=='day')||keys.length>1)fail('INVALID_REQUEST',422);
 const asked=url.searchParams.get('day');if(asked!==null&&!dayParam.safeParse(asked).success)fail('INVALID_REQUEST',422);
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const today=(await db.query<{day:string}>("SELECT to_char((now() AT TIME ZONE $1)::date,'YYYY-MM-DD') AS day",[timeZone])).rows[0].day;
 if(asked!==null&&asked>today)fail('INVALID_REQUEST',422);
 const day=asked??today;
 const bounds=`(SELECT $2::date::timestamp AT TIME ZONE $3) AS s,(SELECT ($2::date+1)::timestamp AT TIME ZONE $3) AS e,(SELECT ($2::date-1)::timestamp AT TIME ZONE $3) AS y`;
 const channelSql=`CASE a.serving_kind WHEN 'delivery' THEN 'delivery' WHEN 'pickup' THEN 'pickup' WHEN 'takeaway' THEN 'pickup' ELSE 'store' END`;
 const counts=(await db.query<{today:number;paid:number;in_progress:number;store:number;delivery:number;pickup:number}>(
  `WITH b AS(SELECT ${bounds}),
   created AS(SELECT ${channelSql} AS channel FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id,b WHERE o.merchant_id=$1 AND o.created_at>=b.s AND o.created_at<b.e)
   SELECT (SELECT count(*) FROM created)::int AS today,
    (SELECT count(*) FROM orders o,b WHERE o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=b.s AND o.paid_at<b.e)::int AS paid,
    (SELECT count(*) FROM orders o LEFT JOIN order_fulfillment f ON f.merchant_id=o.merchant_id AND f.order_id=o.id,b WHERE o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=b.y AND coalesce(f.status,'RECEIVED')<>'COLLECTED')::int AS in_progress,
    (SELECT count(*) FROM created WHERE channel='store')::int AS store,(SELECT count(*) FROM created WHERE channel='delivery')::int AS delivery,(SELECT count(*) FROM created WHERE channel='pickup')::int AS pickup`,
  [merchant,day,timeZone])).rows[0];
 const hours=(await db.query<{hour:number;paid:number}>(
  `WITH b AS(SELECT ${bounds}) SELECT extract(hour FROM (o.paid_at AT TIME ZONE $3))::int AS hour,count(*)::int AS paid FROM orders o,b
   WHERE o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=b.s AND o.paid_at<b.e GROUP BY 1 ORDER BY 1`,[merchant,day,timeZone])).rows;
 const recent=(await db.query<{id:string;channel:OverviewChannel;status:string;fulfillment_status:string|null;currency:string;decimals:number;amount_minor:string;created_at:Date}>(
  `WITH b AS(SELECT ${bounds})
   SELECT o.id,${channelSql} AS channel,o.status,CASE WHEN o.status='PAID' THEN coalesce(f.status,'RECEIVED') END AS fulfillment_status,
    coalesce(a.catalog_currency,'THB') AS currency,coalesce(a.catalog_decimals,2)::int AS decimals,coalesce(a.total_minor,o.thb_minor)::text AS amount_minor,o.created_at
   FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id LEFT JOIN order_fulfillment f ON f.merchant_id=o.merchant_id AND f.order_id=o.id,b
   WHERE o.merchant_id=$1 AND o.created_at>=b.s AND o.created_at<b.e ORDER BY o.created_at DESC,o.id DESC LIMIT 5`,[merchant,day,timeZone])).rows
  .map(r=>({id:r.id,channel:r.channel,status:r.status,fulfillmentStatus:r.fulfillment_status,total:{currency:r.currency,decimals:r.decimals,amountMinor:r.amount_minor},createdAt:r.created_at.toISOString()}));
 let sales:OverviewSale[]|null=null,excludedOrders:number|null=null,net:OverviewNet[]|null=null;
 if(role==='owner'||role==='manager'){
  // Reuse the sales report itself so the two can never disagree: same window, same joins, same exclusions.
  const report=await salesReport(db,merchant,role,new URL(`http://overview.local/api/reports/sales?from=${day}&to=${day}`));
  const byDenomination=new Map<string,OverviewSale>();
  for(const group of report.days.flatMap(d=>d.groups)){
   const key=group.currency+':'+group.decimals,prior=byDenomination.get(key);
   byDenomination.set(key,{currency:group.currency,decimals:group.decimals,orders:(prior?.orders??0)+group.orders,totalMinor:(BigInt(prior?.totalMinor??0)+BigInt(group.totalMinor)).toString()});
  }
  sales=[...byDenomination.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals);
  excludedOrders=report.excludedOrders;
  const keys2=new Map<string,OverviewNet>();
  for(const sale of sales)keys2.set(sale.currency+':'+sale.decimals,{currency:sale.currency,decimals:sale.decimals,salesMinor:sale.totalMinor,refundedMinor:'0',netMinor:sale.totalMinor});
  for(const r of report.refunds){const k=r.currency+':'+r.decimals,e=keys2.get(k)??{currency:r.currency,decimals:r.decimals,salesMinor:'0',refundedMinor:'0',netMinor:'0'};e.refundedMinor=(BigInt(e.refundedMinor)+BigInt(r.refundedMinor)).toString();e.netMinor=(BigInt(e.salesMinor)-BigInt(e.refundedMinor)).toString();keys2.set(k,e);}
  net=[...keys2.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals);
 }
 return {day,isToday:day===today,timeZone,generatedAt:new Date().toISOString(),basis:{orders:'created_at',sales:'paid_at',hours:'paid_at',inProgress:'paid_since_yesterday_not_collected'},
  orders:{today:counts.today,paid:counts.paid,inProgress:day===today?counts.in_progress:0},sales,excludedOrders,net,channels:{store:counts.store,delivery:counts.delivery,pickup:counts.pickup},hours,recent};
}
