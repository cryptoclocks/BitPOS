import type pg from 'pg';
import {salesBreakdown} from './report-breakdown';
import {defaultTimeZone} from './opening-hours';

// M11: the ONLY questions the owner assistant can answer. Each one is a fixed, read-only server query over a shop-time-zone window; a language model may
// choose which one (and which period) fits a question, but it never writes SQL, never supplies a date or a number, and cannot reach anything outside
// this list. The numbers in an answer are the rows computed here.
export const metrics=['sales_total','sales_by_channel','sales_by_method','sales_by_category','top_products','not_revenue'] as const;
export const periods=['today','yesterday','last_7_days','last_30_days','this_month','last_month'] as const;
export type Metric=typeof metrics[number];
export type Period=typeof periods[number];
export interface MetricRow{key:string;label:string;currency:string;decimals:number;count:number;totalMinor:string;/** same row in the previous window; null when it had none */previous:{count:number;totalMinor:string}|null;/** totalMinor − previous total (previous counted as 0) */deltaMinor:string|null}
export interface MetricAnswer{metric:Metric;period:Period;from:string;to:string;timeZone:string;compare:{from:string;to:string}|null;/** what `count` means for this metric */countKind:'bills'|'units';note:string|null;rows:MetricRow[]}

const iso=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const ms=(d:string)=>Date.parse(d+'T00:00:00Z');
/** Pure: the inclusive date window for a period, given today's date in the shop's time zone. */
export function resolveWindow(period:Period,today:string):{from:string;to:string}{
 const day=86400000,t=ms(today);
 switch(period){
  case 'today':return {from:today,to:today};
  case 'yesterday':return {from:iso(t-day),to:iso(t-day)};
  case 'last_7_days':return {from:iso(t-6*day),to:today};
  case 'last_30_days':return {from:iso(t-29*day),to:today};
  case 'this_month':return {from:today.slice(0,8)+'01',to:today};
  case 'last_month':{const first=today.slice(0,8)+'01';return {from:iso(Date.UTC(Number(first.slice(0,4)),Number(first.slice(5,7))-2,1)),to:iso(ms(first)-day)};}
 }
}
/** Pure: the window of the same length that ends the day before `from`. */
export function previousWindow(w:{from:string;to:string}):{from:string;to:string}{
 const day=86400000,len=(ms(w.to)-ms(w.from))/day+1;return {from:iso(ms(w.from)-len*day),to:iso(ms(w.from)-day)};
}
interface Raw{key:string;label:string;currency:string;decimals:number;count:number;totalMinor:string}
const rk=(r:{key:string;currency:string;decimals:number})=>r.key+'\u0000'+r.currency+'\u0000'+r.decimals;

async function rawRows(db:pg.PoolClient,merchant:string,metric:Metric,w:{from:string;to:string},timeZone:string):Promise<{rows:Raw[];note:string|null;countKind:'bills'|'units'}>{
 if(metric==='top_products'){
  const paid=`o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=($2::date::timestamp AT TIME ZONE $4) AND o.paid_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
  const cash=`s.merchant_id=$1 AND s.status='PAID' AND s.created_at>=($2::date::timestamp AT TIME ZONE $4) AND s.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
  const r=(await db.query<{pid:string;name:string;name_en:string;currency:string;decimals:number;units:number;total:string}>(
   `SELECT x.pid,coalesce(p.name,'') AS name,coalesce(p.name_en,'') AS name_en,x.currency,x.decimals,x.units,x.total FROM (
     SELECT l."productId"::text AS pid,a.catalog_currency AS currency,a.catalog_decimals AS decimals,sum(l.qty)::int AS units,sum(l.qty::bigint*(l."unitPrice"->>'amountMinor')::bigint)::text AS total
      FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id JOIN order_quotes oq ON oq.merchant_id=a.merchant_id AND oq.id=a.quote_id
      CROSS JOIN LATERAL jsonb_to_recordset(oq.lines) AS l(qty int,"productId" uuid,"unitPrice" jsonb) WHERE ${paid} GROUP BY 1,2,3
     UNION ALL
     SELECT l.product_id::text,s.currency_code,s.decimals,sum(l.qty)::int,sum(l.line_total_minor)::text
      FROM cash_sales s JOIN cash_sale_lines l ON l.merchant_id=s.merchant_id AND l.sale_id=s.id WHERE ${cash} GROUP BY 1,2,3) x
    LEFT JOIN products p ON p.merchant_id=$1 AND p.id::text=x.pid`,[merchant,w.from,w.to,timeZone])).rows;
  // an order line and a cash line of the same product in the same currency are one product
  const m=new Map<string,Raw>();
  for(const x of r){const k=x.pid+'\u0000'+x.currency+'\u0000'+x.decimals;const e=m.get(k);if(e){e.count+=x.units;e.totalMinor=(BigInt(e.totalMinor)+BigInt(x.total)).toString();}else m.set(k,{key:x.pid,label:x.name_en&&x.name_en!==x.name?`${x.name} / ${x.name_en}`:x.name||x.pid.slice(0,8),currency:x.currency,decimals:x.decimals,count:x.units,totalMinor:x.total});}
  return {rows:[...m.values()],note:'line_revenue_before_discounts',countKind:'units'};
 }
 const b=await salesBreakdown(db,merchant,'owner',new URL(`http://local/?from=${w.from}&to=${w.to}`));
 switch(metric){
  case 'sales_total':return {rows:b.totals.map(t=>({key:'total',label:'total',currency:t.currency,decimals:t.decimals,count:t.orders,totalMinor:t.totalMinor})),note:null,countKind:'bills'};
  case 'sales_by_channel':return {rows:b.channels.map(t=>({key:t.channel,label:t.channel,currency:t.currency,decimals:t.decimals,count:t.orders,totalMinor:t.totalMinor})),note:null,countKind:'bills'};
  case 'sales_by_method':return {rows:b.methods.map(t=>({key:t.method,label:t.method,currency:t.currency,decimals:t.decimals,count:t.orders,totalMinor:t.totalMinor})),note:null,countKind:'bills'};
  case 'sales_by_category':return {rows:[...b.categories.map(t=>({key:t.category,label:t.category,currency:t.currency,decimals:t.decimals,count:t.units,totalMinor:t.totalMinor})),...b.unallocated.map(t=>({key:'__unallocated',label:'__unallocated',currency:t.currency,decimals:t.decimals,count:0,totalMinor:t.totalMinor}))],note:'unallocated_row_is_discounts_tax_rounding',countKind:'units'};
  case 'not_revenue':return {rows:b.pipeline.map(t=>({key:t.state,label:t.state,currency:t.currency,decimals:t.decimals,count:t.count,totalMinor:t.totalMinor})),note:'not_counted_as_sales',countKind:'bills'};
  default:throw Error('unknown metric');
 }
}
const bigDesc=(a:MetricRow,b:MetricRow)=>{const x=BigInt(b.totalMinor)-BigInt(a.totalMinor);return x>0n?1:x<0n?-1:a.key.localeCompare(b.key);};

/** Runs one whitelisted metric for a period (optionally against the previous window of the same length). Read-only. */
export async function runMetric(db:pg.PoolClient,merchant:string,metric:Metric,period:Period,compare:boolean):Promise<MetricAnswer>{
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const today=(await db.query<{d:string}>("SELECT to_char((clock_timestamp() AT TIME ZONE $1)::date,'YYYY-MM-DD') AS d",[timeZone])).rows[0]!.d;
 const w=resolveWindow(period,today),pw=compare?previousWindow(w):null;
 const cur=await rawRows(db,merchant,metric,w,timeZone),prev=pw?await rawRows(db,merchant,metric,pw,timeZone):null;
 const before=new Map((prev?.rows??[]).map(r=>[rk(r),r]));
 const rows:MetricRow[]=cur.rows.map(r=>{const p=before.get(rk(r));return {...r,previous:prev?(p?{count:p.count,totalMinor:p.totalMinor}:null):null,deltaMinor:prev?(BigInt(r.totalMinor)-BigInt(p?.totalMinor??'0')).toString():null};});
 // rows that existed only in the previous window are shown too, with a zero current figure, so a drop to nothing is visible
 if(prev)for(const p of prev.rows){if(!cur.rows.some(r=>rk(r)===rk(p)))rows.push({...p,count:0,totalMinor:'0',previous:{count:p.count,totalMinor:p.totalMinor},deltaMinor:(-BigInt(p.totalMinor)).toString()});}
 rows.sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals||bigDesc(a,b));
 const limited=metric==='top_products'?rows.filter(r=>rows.filter(o=>o.currency===r.currency&&o.decimals===r.decimals&&bigDesc(o,r)<0).length<10):rows;
 return {metric,period,from:w.from,to:w.to,timeZone,compare:pw,countKind:cur.countKind,note:cur.note,rows:limited};
}
