import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {defaultTimeZone} from './opening-hours';

const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const query=z.object({from:day,to:day}).strict();
export const maxReportDays=366;
export interface SalesGroup{currency:string;decimals:number;sourceKind:string;orders:number;totalMinor:string}
export interface HourGroup{hour:number;currency:string;decimals:number;orders:number;totalMinor:string}
/** Return cases whose every refund transfer is finalized on chain, valued in the order's catalog currency. */
export interface RefundGroup{currency:string;decimals:number;cases:number;refundedMinor:string}
export interface SalesReport{from:string;to:string;timeZone:string;days:{day:string;groups:SalesGroup[]}[];hours:HourGroup[];refunds:RefundGroup[];excludedOrders:number;basis:'gross_paid_before_refunds_and_fees';netBasis:'gross_paid_minus_finalized_refunds_before_fees'}
/** Owner/manager only. Totals are grouped by currency and decimals and never summed across denominations. */
export async function salesReport(db:pg.PoolClient,merchant:string,role:string,url:URL):Promise<SalesReport>{
 requireRole(role);
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
 const q=query.safeParse(Object.fromEntries(url.searchParams));if(!q.success)fail('INVALID_REQUEST',422);
 const {from,to}=q.data;
 const span=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(span<0||span+1>maxReportDays)fail('INVALID_REQUEST',422);
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const window=`o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=($2::date::timestamp AT TIME ZONE $4) AND o.paid_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
 const rows=(await db.query<{day:string;currency:string;decimals:number;source_kind:string;orders:number;total_minor:string}>(
  `SELECT to_char((o.paid_at AT TIME ZONE $4)::date,'YYYY-MM-DD') AS day,a.catalog_currency AS currency,a.catalog_decimals AS decimals,a.source_kind,count(*)::int AS orders,sum(a.total_minor)::text AS total_minor
   FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${window}
   GROUP BY 1,2,3,4 ORDER BY 1 DESC,2,3,4`,[merchant,from,to,timeZone])).rows;
 const hours=(await db.query<{hour:number;currency:string;decimals:number;orders:number;total_minor:string}>(
  `SELECT extract(hour FROM (o.paid_at AT TIME ZONE $4))::int AS hour,a.catalog_currency AS currency,a.catalog_decimals AS decimals,count(*)::int AS orders,sum(a.total_minor)::text AS total_minor
   FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${window}
   GROUP BY 1,2,3 ORDER BY 1,2,3`,[merchant,from,to,timeZone])).rows.map(r=>({hour:r.hour,currency:r.currency,decimals:r.decimals,orders:r.orders,totalMinor:r.total_minor}));
 // Refund tables are closed to the application role; this read-only definer function returns the finalized totals.
 const refunds=((await db.query<{value:RefundGroup[]}>('SELECT bitpos.sales_report162_refunds($1,$2::date,$3::date,$4) value',[merchant,from,to,timeZone])).rows[0]?.value??[]);
 const excluded=(await db.query<{n:number}>(`SELECT count(*)::int AS n FROM orders o WHERE ${window} AND NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=o.merchant_id AND a.order_id=o.id)`,[merchant,from,to,timeZone])).rows[0].n;
 // Cash taken at the register joins the same report as its own source (never merged with on-chain totals); voided sales are left out.
 const cashWindow=`merchant_id=$1 AND status='PAID' AND created_at>=($2::date::timestamp AT TIME ZONE $4) AND created_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
 const cashDays=(await db.query<{day:string;currency:string;decimals:number;orders:number;total_minor:string}>(
  `SELECT to_char((created_at AT TIME ZONE $4)::date,'YYYY-MM-DD') AS day,currency_code AS currency,decimals,count(*)::int AS orders,sum(total_minor)::text AS total_minor FROM cash_sales WHERE ${cashWindow} GROUP BY 1,2,3`,[merchant,from,to,timeZone])).rows;
 const cashHours=(await db.query<{hour:number;currency:string;decimals:number;orders:number;total_minor:string}>(
  `SELECT extract(hour FROM (created_at AT TIME ZONE $4))::int AS hour,currency_code AS currency,decimals,count(*)::int AS orders,sum(total_minor)::text AS total_minor FROM cash_sales WHERE ${cashWindow} GROUP BY 1,2,3`,[merchant,from,to,timeZone])).rows;
 for(const c of cashHours){const h=hours.find(x=>x.hour===c.hour&&x.currency===c.currency&&x.decimals===c.decimals);if(h){h.orders+=c.orders;h.totalMinor=(BigInt(h.totalMinor)+BigInt(c.total_minor)).toString();}else hours.push({hour:c.hour,currency:c.currency,decimals:c.decimals,orders:c.orders,totalMinor:c.total_minor});}
 hours.sort((a,b)=>a.hour-b.hour||a.currency.localeCompare(b.currency)||a.decimals-b.decimals);
 const byDay=new Map<string,SalesGroup[]>();
 for(const r of rows)byDay.set(r.day,[...(byDay.get(r.day)??[]),{currency:r.currency,decimals:r.decimals,sourceKind:r.source_kind,orders:r.orders,totalMinor:r.total_minor}]);
 for(const c of cashDays)byDay.set(c.day,[...(byDay.get(c.day)??[]),{currency:c.currency,decimals:c.decimals,sourceKind:'cash_counter',orders:c.orders,totalMinor:c.total_minor}]);
 const days:SalesReport['days']=[...byDay.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([day,groups])=>({day,groups:groups.sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals||a.sourceKind.localeCompare(b.sourceKind))}));
 return {from,to,timeZone,days,hours,refunds,excludedOrders:excluded,basis:'gross_paid_before_refunds_and_fees',netBasis:'gross_paid_minus_finalized_refunds_before_fees'};
}
