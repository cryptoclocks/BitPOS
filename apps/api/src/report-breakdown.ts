import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {defaultTimeZone} from './opening-hours';
import {maxReportDays} from './reports';

// M07: the same paid window as /api/reports/sales (orders by paid_at, cash by created_at, shop time zone), broken down by channel, payment method
// and category, plus the bills that are NOT revenue (open, late settlement, voided, expired). Every group stays in its own currency and decimals;
// nothing is summed across denominations. Category lines never have to add up to the order total on their own: the difference (discounts, VAT,
// rounding, orders without itemised lines) is returned as an explicit `unallocated` row so channels = methods = categories+unallocated = totals.
const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const query=z.object({from:day,to:day}).strict();
export interface Tally{currency:string;decimals:number;orders:number;totalMinor:string}
export interface ChannelRow extends Tally{channel:string}
export interface MethodRow extends Tally{method:string}
export interface CategoryRow{category:string;currency:string;decimals:number;units:number;totalMinor:string}
export interface UnallocatedRow{currency:string;decimals:number;totalMinor:string}
export interface PipelineRow{state:'open'|'late_settlement'|'voided'|'expired'|'cash_voided';currency:string;decimals:number;count:number;totalMinor:string}
export interface SalesBreakdown{from:string;to:string;timeZone:string;totals:Tally[];channels:ChannelRow[];methods:MethodRow[];categories:CategoryRow[];unallocated:UnallocatedRow[];pipeline:PipelineRow[]}

const key=(c:string,d:number)=>c+'\u0000'+d;
function add(map:Map<string,bigint>,k:string,v:string){map.set(k,(map.get(k)??0n)+BigInt(v));}

/** Owner/manager only. */
export async function salesBreakdown(db:pg.PoolClient,merchant:string,role:string,url:URL):Promise<SalesBreakdown>{
 requireRole(role);
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
 const q=query.safeParse(Object.fromEntries(url.searchParams));if(!q.success)fail('INVALID_REQUEST',422);
 const {from,to}=q.data;
 const span=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(span<0||span+1>maxReportDays)fail('INVALID_REQUEST',422);
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const args=[merchant,from,to,timeZone];
 const paid=`o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=($2::date::timestamp AT TIME ZONE $4) AND o.paid_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
 const created=(a:string)=>`${a}created_at>=($2::date::timestamp AT TIME ZONE $4) AND ${a}created_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
 const cash=`s.merchant_id=$1 AND s.status='PAID' AND ${created('s.')}`;

 const channelRows=(await db.query<{channel:string;currency:string;decimals:number;orders:number;total:string}>(
  `SELECT a.source_kind AS channel,a.catalog_currency AS currency,a.catalog_decimals AS decimals,count(*)::int AS orders,sum(a.total_minor)::text AS total
   FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${paid} GROUP BY 1,2,3
   UNION ALL SELECT 'cash_counter',s.currency_code,s.decimals,count(*)::int,sum(s.total_minor)::text FROM cash_sales s WHERE ${cash} GROUP BY 2,3 ORDER BY 1,2,3`,args)).rows;
 const channels:ChannelRow[]=channelRows.map(r=>({channel:r.channel,currency:r.currency,decimals:r.decimals,orders:r.orders,totalMinor:r.total}));

 const methodRows=(await db.query<{method:string;currency:string;decimals:number;orders:number;total:string}>(
  `SELECT coalesce(nullif(a.settlement->>'currency',''),'UNSPECIFIED') AS method,a.catalog_currency AS currency,a.catalog_decimals AS decimals,count(*)::int AS orders,sum(a.total_minor)::text AS total
   FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${paid} GROUP BY 1,2,3
   UNION ALL SELECT 'CASH',s.currency_code,s.decimals,count(*)::int,sum(s.total_minor)::text FROM cash_sales s WHERE ${cash} GROUP BY 2,3 ORDER BY 1,2,3`,args)).rows;
 const methods:MethodRow[]=methodRows.map(r=>({method:r.method,currency:r.currency,decimals:r.decimals,orders:r.orders,totalMinor:r.total}));

 // Itemised lines. Online/store orders: the server quote (qty × effective unit price). Cash: the sale's own frozen lines.
 const lineRows=(await db.query<{category:string;currency:string;decimals:number;units:number;total:string}>(
  `SELECT coalesce(p.category,'') AS category,a.catalog_currency AS currency,a.catalog_decimals AS decimals,sum(l.qty)::int AS units,sum(l.qty::bigint*(l."unitPrice"->>'amountMinor')::bigint)::text AS total
   FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
   JOIN order_quotes oq ON oq.merchant_id=a.merchant_id AND oq.id=a.quote_id
   CROSS JOIN LATERAL jsonb_to_recordset(oq.lines) AS l(qty int,"productId" uuid,"unitPrice" jsonb)
   LEFT JOIN products p ON p.merchant_id=o.merchant_id AND p.id=l."productId" WHERE ${paid} GROUP BY 1,2,3
   UNION ALL SELECT coalesce(p.category,''),s.currency_code,s.decimals,sum(l.qty)::int,sum(l.line_total_minor)::text
   FROM cash_sales s JOIN cash_sale_lines l ON l.merchant_id=s.merchant_id AND l.sale_id=s.id
   LEFT JOIN products p ON p.merchant_id=l.merchant_id AND p.id=l.product_id WHERE ${cash} GROUP BY 1,2,3`,args)).rows;
 const catMap=new Map<string,CategoryRow>(),lineSum=new Map<string,bigint>();
 for(const r of lineRows){
  const k=r.category+'\u0001'+key(r.currency,r.decimals),cur=catMap.get(k);
  if(cur){cur.units+=r.units;cur.totalMinor=(BigInt(cur.totalMinor)+BigInt(r.total)).toString();}
  else catMap.set(k,{category:r.category,currency:r.currency,decimals:r.decimals,units:r.units,totalMinor:r.total});
  add(lineSum,key(r.currency,r.decimals),r.total);
 }
 const categories=[...catMap.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals||(BigInt(b.totalMinor)>BigInt(a.totalMinor)?1:BigInt(b.totalMinor)<BigInt(a.totalMinor)?-1:0)||a.category.localeCompare(b.category));

 const totalMap=new Map<string,Tally>();
 for(const c of channels){const k=key(c.currency,c.decimals),cur=totalMap.get(k);if(cur){cur.orders+=c.orders;cur.totalMinor=(BigInt(cur.totalMinor)+BigInt(c.totalMinor)).toString();}else totalMap.set(k,{currency:c.currency,decimals:c.decimals,orders:c.orders,totalMinor:c.totalMinor});}
 const totals=[...totalMap.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals);
 const unallocated:UnallocatedRow[]=totals.map(t=>({currency:t.currency,decimals:t.decimals,totalMinor:(BigInt(t.totalMinor)-(lineSum.get(key(t.currency,t.decimals))??0n)).toString()})).filter(u=>u.totalMinor!=='0');

 // Not revenue: windowed by creation time because they never reached a paid_at. Late settlement (RECOVERY) is money seen after the order lapsed.
 const pipe=(await db.query<{state:PipelineRow['state'];currency:string|null;decimals:number|null;count:number;total:string|null}>(
  `SELECT CASE WHEN o.status='RECOVERY' THEN 'late_settlement' WHEN o.closure_reason='canceled' THEN 'voided' WHEN o.status='EXPIRED' THEN 'expired' ELSE 'open' END AS state,
    a.catalog_currency AS currency,a.catalog_decimals AS decimals,count(*)::int AS count,sum(a.total_minor)::text AS total
   FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
   WHERE o.merchant_id=$1 AND o.status<>'PAID' AND ${created('o.')} GROUP BY 1,2,3
   UNION ALL SELECT 'cash_voided',s.currency_code,s.decimals,count(*)::int,sum(s.total_minor)::text FROM cash_sales s WHERE s.merchant_id=$1 AND s.status='VOIDED' AND ${created('s.')} GROUP BY 2,3
   ORDER BY 1,2,3`,args)).rows;
 const pipeline:PipelineRow[]=pipe.map(r=>({state:r.state,currency:r.currency??'',decimals:r.decimals??0,count:r.count,totalMinor:r.total??'0'}));
 return {from,to,timeZone,totals,channels,methods,categories,unallocated,pipeline};
}
