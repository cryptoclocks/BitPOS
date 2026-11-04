import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from '../authority';

// M12: a read-only reconciliation of one delivery channel, and an honest provider-readiness list. Neither changes anything and neither calls a provider:
// the report compares what BitPOS stored (orders, lines, stock effects, sync result) against itself and names what needs a person, so a half-finished
// order, a shelf that went short or a payout that is still unknown cannot sit unnoticed. Fixing is left to the existing screens (item map, command,
// settlement, manual stock RECEIVE) because each of those needs a human fact or a provider answer.
const source=z.enum(['grabfood','lineman']);
const COMMITTED="('accepted','preparing','ready','handed_over','completed')";
const SAMPLE=20,STUCK_MINUTES=10,STALE_MINUTES=30;
export interface IssueSample{id:string;shortNumber:string;externalOrderId:string;detail:string}
export type IssueCode='PENDING_COMMAND'|'UNMAPPED_LINES'|'STOCK_NOT_APPLIED'|'STOCK_SHORT'|'NET_UNKNOWN'|'NEEDS_ATTENTION'|'CANCELLED_STOCK_TAKEN'|'SYNC_FAILED'|'SYNC_STALE';
export interface Issue{code:IssueCode;severity:'attention'|'info';count:number;sample:IssueSample[]}
export interface Reconciliation{source:'grabfood'|'lineman';environment:'sandbox'|'production';linked:boolean;sync:{lastSyncAt:string|null;lastResult:string;ageMinutes:number|null};statusCounts:Record<string,number>;events:{total:number;poll:number;command:number};issues:Issue[];clean:boolean}

/** Owner/manager. One query per issue kind, each scoped by merchant and source, each returning the total and up to 20 example orders. */
export async function channelReconciliation(db:pg.PoolClient,merchant:string,role:string,sourceInput:unknown):Promise<Reconciliation>{
 requireRole(role);
 const s=source.safeParse(sourceInput);if(!s.success)fail('INVALID_REQUEST',422);
 const src=s.data;
 const set=(await db.query<{active_environment:'sandbox'|'production';last_sync_at:Date|null;last_sync_result:string;age:string|null}>(
  "SELECT active_environment,last_sync_at,last_sync_result,extract(epoch FROM clock_timestamp()-last_sync_at)/60 AS age FROM channel_settings WHERE merchant_id=$1 AND source=$2",[merchant,src])).rows[0];
 const environment=set?.active_environment??'sandbox';
 const linked=(await db.query("SELECT 1 FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=$3 AND state='linked'",[merchant,src,environment])).rowCount===1;
 const statusCounts:Record<string,number>={};
 for(const r of (await db.query<{status:string;n:number}>('SELECT status,count(*)::int n FROM channel_orders WHERE merchant_id=$1 AND source=$2 GROUP BY 1 ORDER BY 1',[merchant,src])).rows)statusCounts[r.status]=r.n;
 const ev=(await db.query<{kind:string;n:number}>('SELECT e.kind,count(*)::int n FROM channel_events e JOIN channel_orders o ON o.merchant_id=e.merchant_id AND o.id=e.order_id WHERE e.merchant_id=$1 AND o.source=$2 GROUP BY 1',[merchant,src])).rows;
 const events={total:ev.reduce((n,r)=>n+r.n,0),poll:ev.find(r=>r.kind==='poll')?.n??0,command:ev.find(r=>r.kind==='command')?.n??0};

 type Row={id:string;short_number:string;external_order_id:string;detail:string;total:number};
 const issue=async(code:IssueCode,severity:'attention'|'info',where:string,detail:string,extra:unknown[]=[]):Promise<Issue|null>=>{
  const rows=(await db.query<Row>(
   `SELECT o.id,o.short_number,o.external_order_id,(${detail})::text AS detail,count(*) OVER()::int AS total FROM channel_orders o
    WHERE o.merchant_id=$1 AND o.source=$2 AND (${where}) ORDER BY o.updated_at DESC,o.id LIMIT ${SAMPLE}`,[merchant,src,...extra])).rows;
  return rows.length?{code,severity,count:rows[0]!.total,sample:rows.map(r=>({id:r.id,shortNumber:r.short_number,externalOrderId:r.external_order_id,detail:r.detail}))}:null;
 };
 const found=[
  // a command whose outcome was never confirmed: nothing may be re-sent until a sync shows what the provider did
  await issue('PENDING_COMMAND','attention',`o.pending_command IS NOT NULL AND o.updated_at<clock_timestamp()-make_interval(mins=>${STUCK_MINUTES})`,"o.pending_command||':'||o.last_command_error"),
  await issue('NEEDS_ATTENTION','attention',"o.status='needs_attention'","o.raw_status"),
  // an accepted order with an item the shop never mapped: its stock was not taken
  await issue('UNMAPPED_LINES','attention',`o.status IN ${COMMITTED} AND EXISTS(SELECT 1 FROM channel_order_lines l WHERE l.merchant_id=o.merchant_id AND l.order_id=o.id AND l.mapped_product_id IS NULL)`,"(SELECT string_agg(l.external_item_id,',' ORDER BY l.line_no) FROM channel_order_lines l WHERE l.merchant_id=o.merchant_id AND l.order_id=o.id AND l.mapped_product_id IS NULL)"),
  // mapped and committed but no stock effect yet: the next sync takes it; shown so a stalled sync is visible
  await issue('STOCK_NOT_APPLIED','attention',`o.status IN ${COMMITTED} AND EXISTS(SELECT 1 FROM channel_order_lines l WHERE l.merchant_id=o.merchant_id AND l.order_id=o.id AND l.mapped_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM channel_stock_effects e WHERE e.merchant_id=l.merchant_id AND e.order_id=l.order_id AND e.line_no=l.line_no))`,"o.status"),
  await issue('STOCK_SHORT','attention',"EXISTS(SELECT 1 FROM channel_stock_effects e WHERE e.merchant_id=o.merchant_id AND e.order_id=o.id AND e.qty_applied<e.qty_requested)","(SELECT sum(e.qty_requested-e.qty_applied) FROM channel_stock_effects e WHERE e.merchant_id=o.merchant_id AND e.order_id=o.id)"),
  // finished platform-collected order with no payout figure: the amount to expect is unknown
  await issue('NET_UNKNOWN','attention',"o.status='completed' AND o.payment_collector='platform' AND o.settlement_state='receivable' AND o.net_earning_minor IS NULL","o.currency_code"),
  // stock is never returned automatically; whether the food can go back on the shelf is the shop's call
  await issue('CANCELLED_STOCK_TAKEN','info',"o.status IN ('cancelled','rejected','expired') AND EXISTS(SELECT 1 FROM channel_stock_effects e WHERE e.merchant_id=o.merchant_id AND e.order_id=o.id AND e.qty_applied>0)","(SELECT sum(e.qty_applied) FROM channel_stock_effects e WHERE e.merchant_id=o.merchant_id AND e.order_id=o.id)"),
 ].filter((x):x is Issue=>x!==null);
 const age=set?.age==null?null:Math.round(Number(set.age));
 const lastResult=set?.last_sync_result??'';
 if(lastResult&&!['ok','recent'].includes(lastResult))found.push({code:'SYNC_FAILED',severity:'attention',count:1,sample:[{id:'',shortNumber:'',externalOrderId:'',detail:lastResult}]});
 else if(linked&&age!==null&&age>STALE_MINUTES)found.push({code:'SYNC_STALE',severity:'info',count:1,sample:[{id:'',shortNumber:'',externalOrderId:'',detail:String(age)}]});
 return {source:src,environment,linked,sync:{lastSyncAt:set?.last_sync_at?.toISOString()??null,lastResult,ageMinutes:age},statusCounts,events,issues:found,clean:found.every(i=>i.severity==='info')};
}

export type ProviderState='adapter_unverified'|'credentials_only'|'blocked_external';
export interface ProviderInfo{id:string;kind:'delivery'|'payment';state:ProviderState;/** why it is in that state, as a stable code the screen translates */needs:'live_sandbox_check'|'official_api_access'|'bank_or_psp_account'|'provider_account'|'not_planned'}
/** What BitPOS can honestly say about each outside channel today. Static on purpose: a provider only moves up this list with evidence (docs, credentials,
 * a passing provider test), never by a setting. Mocks and fake HTTP exist only inside tests; no mock provider is ever offered to a shop. */
export const providers:ProviderInfo[]=[
 {id:'grabfood',kind:'delivery',state:'adapter_unverified',needs:'live_sandbox_check'},
 {id:'lineman',kind:'delivery',state:'credentials_only',needs:'official_api_access'},
 {id:'wongnai',kind:'delivery',state:'blocked_external',needs:'official_api_access'},
 {id:'pos_pay',kind:'payment',state:'blocked_external',needs:'official_api_access'},
 {id:'promptpay',kind:'payment',state:'blocked_external',needs:'bank_or_psp_account'},
 {id:'stripe',kind:'payment',state:'blocked_external',needs:'provider_account'},
];
export function channelProviders(role:string){requireRole(role);return {providers};}
