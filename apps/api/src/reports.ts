import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {defaultTimeZone} from './opening-hours';

const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const query=z.object({from:day,to:day}).strict();
export const maxReportDays=366;
export interface SalesGroup{currency:string;decimals:number;sourceKind:string;orders:number;totalMinor:string}
export interface SalesReport{from:string;to:string;timeZone:string;days:{day:string;groups:SalesGroup[]}[];excludedOrders:number;basis:'gross_paid_before_refunds_and_fees'}
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
 const excluded=(await db.query<{n:number}>(`SELECT count(*)::int AS n FROM orders o WHERE ${window} AND NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=o.merchant_id AND a.order_id=o.id)`,[merchant,from,to,timeZone])).rows[0].n;
 const days:SalesReport['days']=[];
 for(const r of rows){let entry=days[days.length-1];if(!entry||entry.day!==r.day){entry={day:r.day,groups:[]};days.push(entry);}entry.groups.push({currency:r.currency,decimals:r.decimals,sourceKind:r.source_kind,orders:r.orders,totalMinor:r.total_minor});}
 return {from,to,timeZone,days,excludedOrders:excluded,basis:'gross_paid_before_refunds_and_fees'};
}
