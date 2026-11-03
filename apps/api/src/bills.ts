import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';
import {defaultTimeZone} from './opening-hours';
import {voidUnpaidOrder} from './order-closure';
import {orderViews} from './orders';
import type {OrderRow} from './types';

// M05: one searchable history of every bill (counter/table orders and cash sales), a detail view with the evidence and the timeline, and a void
// for UNPAID counter/table orders. A void is not a refund: a paid order is never touched here (paid facts are immutable; money goes back through
// the return/refund workflow). Totals stay in each bill's own currency; nothing is summed across currencies.
const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const listQuery=z.object({
 from:day.optional(),to:day.optional(),
 state:z.enum(['all','paid','open','voided','expired']).default('all'),
 source:z.enum(['all','store','online','cash']).default('all'),
 q:z.string().trim().max(32).optional(),
 cursor:z.string().max(200).optional(),
 limit:z.coerce.number().int().min(1).max(100).default(30),
}).strict();
const uuid=z.string().uuid();
const voidBody=z.object({reason:z.string().trim().min(3).max(120)}).strict();

export type BillState='PAID'|'OPEN'|'VOIDED'|'EXPIRED';
export interface BillRow{kind:'order'|'cash';id:string;ref:string;state:BillState;source:'store'|'online'|'cash';createdAt:string;currency:string;decimals:number;totalMinor:string|null;voidReason:string|null}
const CK="to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
const enc=(t:string,id:string)=>Buffer.from(JSON.stringify([t,id])).toString('base64url');
function dec(cursor:string|undefined):[string,string]|null{
 if(!cursor)return null;
 try{const v=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) as unknown;if(Array.isArray(v)&&typeof v[0]==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v[0])&&uuid.safeParse(v[1]).success)return [v[0],v[1] as string];}catch{/* fall through */}
 return fail('INVALID_REQUEST',422);
}

/** Any signed-in member. Newest first, keyset-paged (stable under inserts); the cursor is opaque. */
export async function listBills(db:pg.PoolClient,merchant:string,url:URL){
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
 const parsed=listQuery.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success)fail('INVALID_REQUEST',422);
 const q=parsed.data,after=dec(q.cursor);
 if(q.from&&q.to&&q.to<q.from)fail('INVALID_REQUEST',422);
 const tz=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const hex=q.q&&/^[0-9a-f-]{3,36}$/i.test(q.q)?q.q.toLowerCase():null;
 // Each statement gets its own parameter list: a bound value that the statement never mentions is an error in Postgres.
 const mk=(alias:string,windowCol='created_at')=>{
  const args:unknown[]=[merchant,tz];const arg=(v:unknown)=>{args.push(v);return '$'+args.length;};
  const created=alias+'created_at',winCol=alias+windowCol,idText=alias+'id::text';
  const win:string[]=[];
  if(q.from)win.push(`${winCol}>=(${arg(q.from)}::date::timestamp AT TIME ZONE $2)`);
  if(q.to)win.push(`${winCol}<((${arg(q.to)}::date+1)::timestamp AT TIME ZONE $2)`);
  if(after)win.push(`(to_char(${created} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),${idText})<(${arg(after[0])},${arg(after[1])})`);
  return {args,arg,win,idText};
 };
 const rows:(BillRow&{ck:string})[]=[];
 if(q.source!=='cash'){
  // A date range on paid bills means "paid in that range" (paid_at), exactly the window the sales report and CSV use, so summary = drill-down.
  const m=mk('o.',q.state==='paid'?'paid_at':'created_at');
  const st={all:'true',paid:"o.status='PAID'",open:"o.status IN('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING','RECOVERY') AND o.closure_reason IS NULL",voided:"o.closure_reason='canceled'",expired:"o.status='EXPIRED' AND coalesce(o.closure_reason,'timeout')='timeout'"}[q.state];
  const where=['$2::text IS NOT NULL',...m.win,st,q.source==='store'?"coalesce(a.source_kind,'')<>'online'":q.source==='online'?"a.source_kind='online'":'true',hex?`${m.idText} LIKE ${m.arg(hex+'%')}`:q.q?'false':'true'];
  const lim=m.arg(q.limit+1);
  const r=(await db.query<{id:string;status:string;closure_reason:string|null;created_at:Date;ck:string;source_kind:string|null;currency:string|null;decimals:number|null;total_minor:string|null;void_reason:string|null}>(
   `SELECT o.id,o.status,o.closure_reason,o.created_at,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ck,a.source_kind,a.catalog_currency AS currency,a.catalog_decimals AS decimals,a.total_minor::text,v.reason AS void_reason
    FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id LEFT JOIN order_voids v ON v.merchant_id=o.merchant_id AND v.order_id=o.id
    WHERE o.merchant_id=$1 AND ${where.join(' AND ')} ORDER BY o.created_at DESC,o.id DESC LIMIT ${lim}`,m.args)).rows;
  for(const o of r)rows.push({kind:'order',id:o.id,ref:o.id.slice(0,8).toUpperCase(),state:o.status==='PAID'?'PAID':o.closure_reason==='canceled'?'VOIDED':o.status==='EXPIRED'?'EXPIRED':'OPEN',source:o.source_kind==='online'?'online':'store',createdAt:o.created_at.toISOString(),currency:o.currency??'',decimals:o.decimals??0,totalMinor:o.total_minor,voidReason:o.void_reason,ck:o.ck});
 }
 if(q.source==='all'||q.source==='cash'){
  const m=mk('');
  const st={all:'true',paid:"status='PAID'",open:'false',voided:"status='VOIDED'",expired:'false'}[q.state];
  const text=q.q?`(receipt_no ILIKE ${m.arg(q.q.replace(/[%_\\]/g,c=>'\\'+c)+'%')}${hex?` OR id::text LIKE ${m.arg(hex+'%')}`:''})`:'true';
  const where=['$2::text IS NOT NULL',...m.win,st,text];
  const lim=m.arg(q.limit+1);
  const r=(await db.query<{id:string;receipt_no:string;status:'PAID'|'VOIDED';created_at:Date;ck:string;currency_code:string;decimals:number;total_minor:string;void_reason:string|null}>(
   `SELECT id,receipt_no,status,created_at,${CK} AS ck,currency_code,decimals,total_minor::text,void_reason FROM cash_sales WHERE merchant_id=$1 AND ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ${lim}`,m.args)).rows;
  for(const c of r)rows.push({kind:'cash',id:c.id,ref:c.receipt_no,state:c.status==='PAID'?'PAID':'VOIDED',source:'cash',createdAt:c.created_at.toISOString(),currency:c.currency_code,decimals:c.decimals,totalMinor:c.total_minor,voidReason:c.void_reason,ck:c.ck});
 }
 const sorted=rows.sort((a,b)=>b.ck.localeCompare(a.ck)||b.id.localeCompare(a.id));
 const page=sorted.slice(0,q.limit),more=sorted.length>q.limit;
 const last=page[page.length-1];
 return {bills:page.map(({ck:_ck,...b})=>b as BillRow),nextCursor:more&&last?enc(last.ck,last.id):null,timeZone:tz};
}

/** Any signed-in member. The order as the server prices it, the payment evidence, the void record and the audit timeline. */
export async function billDetail(db:pg.PoolClient,merchant:string,role:string,orderId:unknown){
 const id=uuid.safeParse(orderId);if(!id.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,id.data])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);
 const order=(await orderViews(db,[row]))[0]!;
 const voided=(await db.query<{reason:string;voided_by:string;voided_at:Date}>('SELECT reason,voided_by,voided_at FROM order_voids WHERE merchant_id=$1 AND order_id=$2',[merchant,id.data])).rows[0];
 const attempts=(await db.query<{status:string;signature:string|null;created_at:Date}>('SELECT status,signature,created_at FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 ORDER BY created_at',[merchant,id.data])).rows;
 const timeline=(await db.query<{action:string;actor:string;created_at:Date}>('SELECT action,actor,created_at FROM audit_logs WHERE merchant_id=$1 AND subject=$2 ORDER BY created_at,id',[merchant,id.data])).rows;
 const online=(await db.query<{k:string|null}>('SELECT source_kind AS k FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,id.data])).rows[0]?.k==='online';
 const unpaid=['AWAITING_WALLET','AWAITING_PAYMENT'].includes(row.status)&&!row.closure_reason;
 return {order,void:voided?{reason:voided.reason,by:voided.voided_by,at:voided.voided_at.toISOString()}:null,
  attempts:attempts.map(a=>({status:a.status,signature:a.signature,at:a.created_at.toISOString()})),
  timeline:timeline.map(t=>({action:t.action,actor:t.actor,at:t.created_at.toISOString()})),
  canVoid:unpaid&&!online&&['owner','manager'].includes(role),
  voidBlocked:row.status==='PAID'?'PAID':online?'ONLINE':!unpaid?'NOT_OPEN':!['owner','manager'].includes(role)?'ROLE':null};
}

/** Owner/manager, with a reason (3–120 characters). Only an unpaid counter/table order; a paid one answers ORDER_PAID_CANNOT_VOID and is never touched.
 * Idempotent: a second call returns the stored record and releases nothing again. A payment that may still be in flight refuses (PAYMENT_PENDING). */
export async function voidBill(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown,input:unknown){
 requireRole(role);
 const id=uuid.safeParse(orderId),data=voidBody.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{status:string;closure_reason:string|null}>('SELECT status,closure_reason FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);
 const existing=(await db.query<{reason:string;voided_by:string;voided_at:Date}>('SELECT reason,voided_by,voided_at FROM order_voids WHERE merchant_id=$1 AND order_id=$2',[merchant,id.data])).rows[0];
 if(existing)return {orderId:id.data,status:'VOIDED' as const,reason:existing.reason,by:existing.voided_by,at:existing.voided_at.toISOString(),replayed:true};
 if(row.status==='PAID')fail('ORDER_PAID_CANNOT_VOID',409);
 if(['CONFIRMING','RECOVERY'].includes(row.status))fail('PAYMENT_PENDING',409);
 if(row.closure_reason)fail('ORDER_NOT_PAYABLE',409); // already closed by timeout/cancel: nothing to void
 const closed=await voidUnpaidOrder(db,merchant,id.data,actor);
 if(!('closed' in closed)||!closed.closed)fail('ORDER_NOT_PAYABLE',409);
 const at=(await db.query<{at:Date}>('INSERT INTO order_voids(merchant_id,order_id,reason,voided_by) VALUES($1,$2,$3,$4) RETURNING voided_at AS at',[merchant,id.data,data.data.reason,actor])).rows[0]!.at;
 await audit(db,merchant,actor,'bill.void',id.data);
 return {orderId:id.data,status:'VOIDED' as const,reason:data.data.reason,by:actor,at:at.toISOString(),replayed:false};
}
