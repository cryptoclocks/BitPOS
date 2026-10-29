// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Owner's assistant on meta-pos: the owner or a manager asks in plain words ("did we sell more than yesterday?",
// "which item should get an offer?") and Muse Wonder answers by calling read-only tools that run fixed, tenant-bound
// queries (no free SQL, no writes). The page shows each tool's result next to the answer, so every number can be
// checked against the shop's own data. Falls back to the default Muse Spark model when Wonder is unavailable.
import {z} from 'zod';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import type {MetaTool} from '../../../../packages/meta-ai/src/types';
import type {MetaDb} from './identity';

const TZ='Asia/Bangkok';
export interface AssistantAnswer {text:string;model:string;data:{tool:string;args:unknown;result:unknown}[]}
const days=z.number().int().min(1).max(31);
const money=(minor:string|number|null)=>Number(minor??0)/100;

export function ownerTools(db:MetaDb,merchantId:string,log:{tool:string;args:unknown;result:unknown}[]):MetaTool[]{
 const q=async<T>(sql:string,params:unknown[]=[])=>(await db.tenant(merchantId,c=>c.query<T&Record<string,unknown>>(sql,params))).rows;
 const rec=<A>(tool:string,run:(a:A)=>Promise<unknown>)=>async(a:A)=>{const result=await run(a);log.push({tool,args:a,result});return result;};
 const since=(d:number)=>`date_trunc('day',clock_timestamp() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}' - interval '${d-1} days'`;
 return [
  {name:'sales_by_day',description:'Paid sales of Meta channels per day (shop time) for the last N days: day, orders, total in USD, and refunds.',
   parameters:{type:'object',required:['days'],properties:{days:{type:'integer',minimum:1,maximum:31}},additionalProperties:false},args:z.object({days}),
   run:rec('sales_by_day',async({days:d}:{days:number})=>(await q<{day:string;orders:string;total:string|null;refunds:string}>(`SELECT to_char(coalesce(paid_at,created_at) AT TIME ZONE '${TZ}','YYYY-MM-DD Dy') AS day,
     count(*) FILTER (WHERE status IN ('PAID','CONFIRMED'))::text AS orders,sum(amount_minor) FILTER (WHERE status IN ('PAID','CONFIRMED'))::text AS total,count(*) FILTER (WHERE status='CANCELLED')::text AS refunds
     FROM bitpos.meta_order_feed(${since(d)}) WHERE platform='meta' GROUP BY 1 ORDER BY 1`)).map(r=>({day:r.day,orders:Number(r.orders),totalUsd:money(r.total),refunds:Number(r.refunds)})))},
  {name:'sales_by_channel',description:'Paid orders and USD totals per channel (tap, chat, mcp, table, counter, web) for the last N days.',
   parameters:{type:'object',required:['days'],properties:{days:{type:'integer',minimum:1,maximum:31}},additionalProperties:false},args:z.object({days}),
   run:rec('sales_by_channel',async({days:d}:{days:number})=>(await q<{channel:string;orders:string;total:string|null}>(`SELECT channel,count(*)::text AS orders,sum(amount_minor)::text AS total FROM bitpos.meta_order_feed(${since(d)})
     WHERE platform='meta' AND status IN ('PAID','CONFIRMED') GROUP BY 1 ORDER BY 2 DESC`)).map(r=>({channel:r.channel,orders:Number(r.orders),totalUsd:money(r.total)})))},
  {name:'top_items',description:'Items sold (paid, all Meta channels) in the last N days, most first, with quantities.',
   parameters:{type:'object',required:['days'],properties:{days:{type:'integer',minimum:1,maximum:31}},additionalProperties:false},args:z.object({days}),
   run:rec('top_items',async({days:d}:{days:number})=>(await q<{item:string;qty:string}>(`SELECT p.name_en AS item,sum(x.q)::text AS qty FROM (
     SELECT i.product_id,i.quantity AS q FROM meta_cart_items i JOIN meta_cart_orders o ON o.merchant_id=i.merchant_id AND o.id=i.order_id WHERE o.status='PAID' AND o.paid_at>=${since(d)}
     UNION ALL SELECT product_id,quantity FROM meta_agent_orders WHERE status='CONFIRMED' AND confirmed_at>=${since(d)}
     UNION ALL SELECT product_id,quantity FROM meta_tap_orders WHERE status='PAID' AND paid_at>=${since(d)}) x JOIN products p ON p.merchant_id=current_setting('bitpos.merchant')::uuid AND p.id=x.product_id GROUP BY 1 ORDER BY sum(x.q) DESC LIMIT 15`)).map(r=>({item:r.item,quantity:Number(r.qty)})))},
  {name:'orders_by_hour',description:'Paid orders per hour of the day (shop time) over the last N days, to see busy hours.',
   parameters:{type:'object',required:['days'],properties:{days:{type:'integer',minimum:1,maximum:31}},additionalProperties:false},args:z.object({days}),
   run:rec('orders_by_hour',async({days:d}:{days:number})=>(await q<{hour:number;orders:string}>(`SELECT extract(hour FROM coalesce(paid_at,created_at) AT TIME ZONE '${TZ}')::int AS hour,count(*)::text AS orders
     FROM bitpos.meta_order_feed(${since(d)}) WHERE platform='meta' AND status IN ('PAID','CONFIRMED') GROUP BY 1 ORDER BY 1`)).map(r=>({hour:r.hour,orders:Number(r.orders)})))},
  {name:'stock_levels',description:'Every item with its current stock, price in USD and whether it has an active offer; low stock first.',
   parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),
   run:rec('stock_levels',async()=>(await q<{item:string;stock:number;reserved:number;price:string}>(`SELECT name_en AS item,stock,reserved,price_minor::text AS price FROM products WHERE merchant_id=current_setting('bitpos.merchant')::uuid ORDER BY stock-reserved,name_en LIMIT 40`)).map(r=>({item:r.item,available:r.stock-r.reserved,listPriceMinor:Number(r.price)})))},
  {name:'offers_and_bookings',description:'Muse Spark offers in the last 7 days (state, discount) and table bookings for today and tomorrow.',
   parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),
   run:rec('offers_and_bookings',async()=>({offers:(await q<{item:string;state:string;discount_percent:number;offer_expires_at:Date|null}>(`SELECT p.name_en AS item,d.state,d.discount_percent,d.offer_expires_at FROM meta_offer_drafts d JOIN products p ON p.merchant_id=d.merchant_id AND p.id=d.product_id
     WHERE d.created_at>clock_timestamp()-interval '7 days' ORDER BY d.created_at DESC LIMIT 10`)).map(r=>({item:r.item,state:r.state,discountPercent:r.discount_percent,live:!!r.offer_expires_at&&r.offer_expires_at.getTime()>Date.now()})),
    bookings:(await q<{day:string;status:string;n:string}>(`SELECT to_char(starts_at AT TIME ZONE '${TZ}','YYYY-MM-DD') AS day,status,count(*)::text AS n FROM meta_table_reservations WHERE starts_at>=${since(1)} AND starts_at<${since(1)}+interval '2 days' GROUP BY 1,2 ORDER BY 1`)).map(r=>({day:r.day,status:r.status,count:Number(r.n)}))}))},
 ];
}

const SYSTEM=`You are the business assistant of a small cafe (Muse Café), answering the owner or manager in the language they use (Thai or English).
Use the tools to get the shop's real numbers before answering; call several at once when useful. Base every number you mention on a tool result and say which period it covers.
Be short and practical: 2–5 sentences or a few bullets, then one concrete suggestion if it helps (for example an item that could use an offer, or a busy hour that needs staff).
If the data is too thin to say, say so plainly. Never invent numbers, customers or events. Amounts are in US dollars (Stripe sandbox, not real money).`;

export async function askOwnerAssistant(db:MetaDb,router:MetaRouter,merchantId:string,question:string):Promise<AssistantAnswer>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,dateStyle:'full'}).format(new Date());
 const run=async(model?:string)=>{const data:AssistantAnswer['data']=[];
  const r=await router.invokeTools({task:'owner_insights',merchantId,model,tools:ownerTools(db,merchantId,data),maxRounds:4,maxOutputTokens:2500,reasoningEffort:'medium',deadlineMs:60000,
   messages:[{role:'system',content:`${SYSTEM}\nToday is ${today} (${TZ}).`},{role:'user',content:question.slice(0,500)}]});
  return {text:r.text.trim(),model:r.model,data};};
 try{return await run('muse-wonder-1.0');}catch{return await run();}
}
