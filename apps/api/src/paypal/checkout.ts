// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Customer PayPal checkout for an existing BitPOS bill (access token): create the PayPal order from the frozen quote,
// capture after the buyer approves, and settle only from PayPal's server-side answer.
// Never holds a database lock across a PayPal call: each step is lock → decide → commit, then HTTP, then lock again.
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {pool,tenant} from '../db';
import {customerOrigin} from '../config';
import {liveOrder} from '../../../../packages/domain/src/index';
import {assertOnlinePaymentAuthorization} from '../online-acceptance-policy';
import type {OrderRow} from '../types';
import {PayPalError,paypalConfig,type PayPalConfig} from './config';
import {paypalClient,invoiceId,type PayPalClient,type PayPalOrder} from './client';
import {toCents,centsToValue} from './money';
import {verifyOrder} from './verify';
import {applyVerdict,type CheckoutRow,type VerifiedVia} from './settle';

export class PayPalRouteError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
const refuse=(status:number,code:string):never=>{throw new PayPalRouteError(status,code);};

export interface PayPalDeps {config:PayPalConfig;client:PayPalClient;now?:()=>number}
let deps:PayPalDeps|null|undefined;
/** Tests inject a stub client; production reads the sandbox config from the environment once. */
export function setPayPalDeps(d:PayPalDeps|null|undefined){deps=d;}
export function paypalDeps():PayPalDeps|null{
 if(deps===undefined){try{const config=paypalConfig();deps={config,client:paypalClient(config)};}catch(e){if(e instanceof PayPalError)deps=null;else throw e;}}
 return deps;
}
const MIN_CAPTURE_MS=60_000,MIN_CREATE_MS=120_000;
const LIVE=['CREATING','CREATED','APPROVED','CAPTURING','PENDING','UNKNOWN'];

export type CheckoutView={status:'none'|'creating'|'awaiting_approval'|'confirming'|'checking'|'paid'|'recovery'|'pending'|'declined'|'expired'|'failed'|'mismatch';
 paypalOrderId:string|null;captureId:string|null;amount:{currency:'USD';value:string}|null;issue:string|null};

async function merchantFor(token:string){
 const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[token])).rows[0]?.merchant as string|undefined;
 if(!merchant)refuse(404,'RESOURCE_NOT_FOUND');return merchant!;
}
async function lockOrder(db:pg.PoolClient,token:string){
 const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1 FOR UPDATE',[token])).rows[0];
 if(!o)refuse(404,'RESOURCE_NOT_FOUND');return o!;
}
async function settings(db:pg.PoolClient,merchant:string,d:PayPalDeps){
 const s=(await db.query<{enabled:boolean;payee_merchant_id:string;max_order_cents:string}>('SELECT enabled,payee_merchant_id,max_order_cents FROM paypal_merchant_settings WHERE merchant_id=$1',[merchant])).rows[0];
 if(!s?.enabled)refuse(409,'PAYPAL_NOT_ENABLED');
 // Two independent facts must agree: the shop's configured payee and the server's sandbox app merchant.
 if(s!.payee_merchant_id!==d.config.merchantId)refuse(409,'PAYPAL_PAYEE_MISMATCH');
 return s!;
}
const lockCheckout=(db:pg.PoolClient,merchant:string,id:string)=>db.query<CheckoutRow>('SELECT * FROM paypal_checkouts WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id]).then(r=>r.rows[0]);

function view(k:CheckoutRow|undefined,order:OrderRow,captureId:string|null=null):CheckoutView{
 if(!k)return {status:'none',paypalOrderId:null,captureId:null,amount:null,issue:null};
 const map:Record<string,CheckoutView['status']>={CREATING:'creating',CREATED:'awaiting_approval',APPROVED:'awaiting_approval',CAPTURING:'confirming',UNKNOWN:'checking',PENDING:'pending',
  CAPTURED:order.status==='PAID'?'paid':'recovery',DECLINED:'declined',EXPIRED:'expired',FAILED_CREATE:'failed',MISMATCH:'mismatch'};
 return {status:map[k.status]??'checking',paypalOrderId:k.paypal_order_id,captureId,amount:{currency:'USD',value:centsToValue(BigInt(k.amount_cents))},issue:k.status==='DECLINED'||k.status==='FAILED_CREATE'||k.status==='MISMATCH'?k.last_issue:null};
}
async function latest(db:pg.PoolClient,merchant:string,orderId:string){
 const k=(await db.query<CheckoutRow>('SELECT * FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 ORDER BY (status=ANY($3)) DESC,(status=\'CAPTURED\') DESC,created_at DESC LIMIT 1',[merchant,orderId,LIVE])).rows[0];
 const cap=k?(await db.query<{capture_id:string}>('SELECT capture_id FROM paypal_captures WHERE merchant_id=$1 AND checkout_id=$2',[merchant,k.id])).rows[0]?.capture_id??null:null;
 return {k,cap};
}

/** GET: what the pay page needs to show PayPal for this bill. No PayPal call. */
export async function paypalStatus(token:string){
 const d=paypalDeps();const merchant=await merchantFor(token);
 return tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1',[token])).rows[0];if(!o)refuse(404,'RESOURCE_NOT_FOUND');
  const s=(await db.query<{enabled:boolean;payee_merchant_id:string}>('SELECT enabled,payee_merchant_id FROM paypal_merchant_settings WHERE merchant_id=$1',[merchant])).rows[0];
  const enabled=!!(d&&s?.enabled&&s.payee_merchant_id===d.config.merchantId);
  const a=(await db.query<{total_minor:string;catalog_currency:string;catalog_decimals:number}>('SELECT total_minor::text,catalog_currency,catalog_decimals FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,o!.id])).rows[0];
  const cents=a&&a.catalog_currency==='USD'?toCents(a.total_minor,a.catalog_decimals):null;
  const {k,cap}=await latest(db,merchant,o!.id);
  // paypalShop: the shop takes PayPal only, even when PayPal cannot take this bill right now (the page must not offer
  // another payment method); enabled: PayPal is configured and this bill's total is exact in cents.
  return {paypalShop:!!s?.enabled,enabled:enabled&&cents!==null,environment:'sandbox' as const,clientId:enabled?d!.config.clientId:null,amount:cents===null?null:{currency:'USD' as const,value:centsToValue(cents)},checkout:view(k,o!,cap)};
 });
}

/** POST orders: one live checkout per bill; replays return it. The browser never sends an amount. */
export async function createPayPalOrder(token:string):Promise<CheckoutView>{
 const d=paypalDeps()??refuse(503,'PAYPAL_UNAVAILABLE');const now=d.now??Date.now;const merchant=await merchantFor(token);
 const prepared=await tenant(merchant,async db=>{
  const o=await lockOrder(db,token);const s=await settings(db,merchant,d);
  const existing=(await db.query<CheckoutRow>('SELECT * FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 AND status=ANY($3) FOR UPDATE',[merchant,o.id,LIVE])).rows[0];
  if(existing&&existing.status!=='CREATING')return {done:view(existing,o)};
  if(existing)return {k:existing,o,items:await items(db,merchant,o.id)};
  if((await db.query("SELECT 1 FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 AND status='CAPTURED'",[merchant,o.id])).rowCount)return {done:view((await latest(db,merchant,o.id)).k,o)};
  try{liveOrder(o,now());}catch{refuse(409,'ORDER_NOT_PAYABLE');}
  await assertOnlinePaymentAuthorization(db,o);
  if(new Date(o.quote_expires_at).getTime()-now()<MIN_CREATE_MS)refuse(409,'QUOTE_EXPIRING');
  if((await db.query("SELECT 1 FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 AND status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')",[merchant,o.id])).rowCount)refuse(409,'PAYMENT_PENDING');
  const a=(await db.query<{quote_id:string;total_minor:string;catalog_currency:string;catalog_decimals:number;serving_label_snapshot:string}>('SELECT quote_id,total_minor::text,catalog_currency,catalog_decimals,serving_label_snapshot FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,o.id])).rows[0];
  if(!a||a.catalog_currency!=='USD')refuse(409,'PAYPAL_CURRENCY_UNSUPPORTED');
  const cents=toCents(a!.total_minor,a!.catalog_decimals)??refuse(409,'PAYPAL_AMOUNT_NOT_EXACT');
  if(cents>BigInt(s.max_order_cents))refuse(409,'PAYPAL_AMOUNT_TOO_LARGE');
  const id=randomUUID();
  const k=(await db.query<CheckoutRow>(`INSERT INTO paypal_checkouts(merchant_id,id,order_id,quote_id,order_version,amount_cents,payee_merchant_id,invoice_id,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[merchant,id,o.id,a!.quote_id,o.version,cents.toString(),d.config.merchantId,invoiceId(id),o.quote_expires_at])).rows[0];
  return {k,o,items:await items(db,merchant,o.id),label:a!.serving_label_snapshot};
 });
 if('done' in prepared)return prepared.done!;
 const {k,o}=prepared;
 let result:PayPalOrder|null=null,issue:string|null=null,debugId:string|null=null,unknown=false;
 try{
  result=await d.client.createOrder({merchantId:merchant,orderId:o.id,checkoutId:k.id,requestId:k.create_request_id,payeeMerchantId:k.payee_merchant_id,amountCents:BigInt(k.amount_cents),
   items:prepared.items,description:('BitPOS PayPal Café · '+(('label' in prepared&&prepared.label)||'order')).slice(0,127),brandName:'BitPOS PayPal Café',locale:'en-US',
   returnUrl:`${customerOrigin}/pay/${encodeURIComponent(token)}?paypal=return`,cancelUrl:`${customerOrigin}/pay/${encodeURIComponent(token)}?paypal=cancel`});
 }catch(e){if(!(e instanceof PayPalError))throw e;debugId=e.debugId??null;if(e.code==='OUTCOME_UNKNOWN')unknown=true;else issue=e.issue??e.code;}
 return tenant(merchant,async db=>{
  const o2=await lockOrder(db,token);const cur=await lockCheckout(db,merchant,k.id);
  if(cur.status!=='CREATING')return view(cur,o2);
  if(result&&['CREATED','PAYER_ACTION_REQUIRED','APPROVED'].includes(result.status)){
   const next=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET paypal_order_id=$3,status=$4,last_debug_id=$5,attempts=attempts+1 WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id,result.id,result.status==='APPROVED'?'APPROVED':'CREATED',result.debugId])).rows[0];
   return view(next,o2);
  }
  // Outcome unknown keeps CREATING: the reconcile worker resends with the same PayPal-Request-Id, never a new order.
  if(unknown||result){
   const next=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET attempts=attempts+1,next_check_at=clock_timestamp()+interval '15 seconds',last_debug_id=$3,last_issue=$4 WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id,debugId,result?'UNEXPECTED_STATUS_'+result.status:'OUTCOME_UNKNOWN'])).rows[0];
   return view(next,o2);
  }
  const next=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET status='FAILED_CREATE',last_issue=$3,last_debug_id=$4 WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id,(issue??'REJECTED').slice(0,120),debugId])).rows[0];
  return view(next,o2);
 });
}

async function items(db:pg.PoolClient,merchant:string,orderId:string){
 const q=(await db.query<{lines:{nameEn:string;qty:number;unitPrice:{currency:string;decimals:number;amountMinor:string}}[]|null}>('SELECT q.lines FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id WHERE a.merchant_id=$1 AND a.order_id=$2',[merchant,orderId])).rows[0];
 if(!q?.lines)return undefined;
 const out:{name:string;quantity:number;unitCents:bigint}[]=[];
 for(const l of q.lines){const c=l.unitPrice.currency==='USD'?toCents(l.unitPrice.amountMinor,l.unitPrice.decimals):null;if(c===null)return undefined;out.push({name:l.nameEn,quantity:l.qty,unitCents:c});}
 return out;
}

/**
 * Asks PayPal for the truth about one checkout and applies it. Shared by the capture route (after approval),
 * the webhook processor and the reconcile worker. `capture` true sends the capture (same request id on every retry).
 */
export async function advanceCheckout(merchant:string,checkoutId:string,mode:'capture'|'lookup',d:PayPalDeps,via:VerifiedVia='order_lookup'):Promise<{k:CheckoutRow;order:OrderRow;captureId:string|null}>{
 const now=d.now??Date.now;
 const start=await tenant(merchant,async db=>{
  const k0=(await db.query<CheckoutRow>('SELECT * FROM paypal_checkouts WHERE merchant_id=$1 AND id=$2',[merchant,checkoutId])).rows[0];if(!k0)refuse(404,'RESOURCE_NOT_FOUND');
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,k0!.order_id])).rows[0];
  const k=await lockCheckout(db,merchant,checkoutId);
  if(!LIVE.includes(k.status)||!k.paypal_order_id)return {k,o,act:'none' as const};
  if(mode==='capture'&&k.status!=='CAPTURING'&&k.status!=='UNKNOWN'&&k.status!=='PENDING'){
   // Capture moves money: only while the bill can still be paid and the reservation is held.
   const payable=['AWAITING_WALLET','AWAITING_PAYMENT'].includes(o.status)&&!o.reservation_released&&new Date(k.expires_at).getTime()-now()>=MIN_CAPTURE_MS;
   if(!payable){const e=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET status='EXPIRED',last_issue='NOT_PAYABLE_AT_CAPTURE' WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id])).rows[0];return {k:e,o,act:'none' as const};}
   // next_check_at keeps the reconcile worker from sending a second, overlapping capture while this one is in flight.
   const c=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET status='CAPTURING',capture_started_at=coalesce(capture_started_at,clock_timestamp()),attempts=attempts+1,next_check_at=clock_timestamp()+interval '30 seconds' WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id])).rows[0];
   return {k:c,o,act:'capture' as const};
  }
  return {k,o,act:k.status==='CAPTURING'||k.status==='UNKNOWN'?'capture' as const:'lookup' as const};
 });
 if(start.act==='none')return {k:start.k,order:start.o,captureId:null};
 const expected={paypalOrderId:start.k.paypal_order_id!,merchantId:merchant,orderId:start.k.order_id,checkoutId:start.k.id,amountCents:BigInt(start.k.amount_cents),payeeMerchantId:d.config.merchantId};
 let order:PayPalOrder|null=null,issue:string|null=null,debugId:string|null=null,unknown=false,source:VerifiedVia=via;
 try{
  if(start.act==='capture'){order=await d.client.captureOrder(start.k.paypal_order_id!,start.k.capture_request_id);source='capture_response';}
  else order=await d.client.getOrder(start.k.paypal_order_id!);
 }catch(e){
  if(!(e instanceof PayPalError))throw e;debugId=e.debugId??null;
  if(e.code==='OUTCOME_UNKNOWN')unknown=true;
  else{
   issue=e.issue??e.code;
   // A refused capture is not "unpaid": ask PayPal what the order really is (already captured, duplicate invoice, …).
   if(start.act==='capture'&&issue!=='ORDER_NOT_APPROVED'&&issue!=='INSTRUMENT_DECLINED'&&issue!=='PAYER_ACTION_REQUIRED'){
    try{order=await d.client.getOrder(start.k.paypal_order_id!);source='order_lookup';}catch(x){if(x instanceof PayPalError&&x.code==='OUTCOME_UNKNOWN')unknown=true;else if(!(x instanceof PayPalError))throw x;}
   }
  }
 }
 return tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,start.k.order_id])).rows[0];
  let k=await lockCheckout(db,merchant,checkoutId);
  if(order){
   const verdict=verifyOrder(expected,order);
   if(verdict.state==='NONE'){
    // PayPal has no capture: approval may be pending, or the buyer must approve again (declined instrument).
    // An approved order whose capture was refused for another reason (e.g. a capture already in progress) may still
    // be captured: keep it UNKNOWN, which blocks closing the bill, and look again shortly.
    const next=order.status==='APPROVED'?(issue?'UNKNOWN':'APPROVED'):'CREATED';
    if(LIVE.includes(k.status))k=(await db.query<CheckoutRow>(`UPDATE paypal_checkouts SET status=$3,last_issue=$4,last_debug_id=$5,next_check_at=CASE WHEN $3='UNKNOWN' THEN clock_timestamp()+interval '15 seconds' END WHERE merchant_id=$1 AND id=$2 RETURNING *`,[merchant,k.id,next,issue,order.debugId??debugId])).rows[0];
    return {k,order:o,captureId:null};
   }
   const r=await applyVerdict(db,k,verdict,source,order.debugId);
   k=await lockCheckout(db,merchant,checkoutId);
   const fresh=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,k.order_id])).rows[0];
   return {k,order:fresh,captureId:r.captureId};
  }
  if(unknown){
   if(LIVE.includes(k.status))k=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET status=CASE WHEN status='CAPTURING' THEN 'UNKNOWN' ELSE status END,next_check_at=clock_timestamp()+interval '15 seconds',last_debug_id=$3 WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id,debugId])).rows[0];
   return {k,order:o,captureId:null};
  }
  // Definitive refusal before any money moved (not approved / instrument declined): the buyer can approve again.
  if(LIVE.includes(k.status))k=(await db.query<CheckoutRow>("UPDATE paypal_checkouts SET status='CREATED',last_issue=$3,last_debug_id=$4 WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id,issue,debugId])).rows[0];
  return {k,order:o,captureId:null};
 });
}

/** POST capture: the SDK's onApprove is only a trigger; the answer comes from PayPal via the server. */
export async function capturePayPalOrder(token:string,paypalOrderId:string):Promise<CheckoutView>{
 const d=paypalDeps()??refuse(503,'PAYPAL_UNAVAILABLE');const merchant=await merchantFor(token);
 const k=await tenant(merchant,async db=>{
  const o=await lockOrder(db,token);
  const row=(await db.query<CheckoutRow>('SELECT * FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 AND paypal_order_id=$3',[merchant,o.id,paypalOrderId])).rows[0];
  if(!row)refuse(404,'RESOURCE_NOT_FOUND');return row!;
 });
 const r=await advanceCheckout(merchant,k.id,'capture',d);
 const v=view(r.k,r.order,r.captureId);
 if(r.k.last_issue==='INSTRUMENT_DECLINED'&&r.k.status==='CREATED')return {...v,status:'declined',issue:'INSTRUMENT_DECLINED'};
 return v;
}

/** POST cancel: the buyer closed PayPal. Nothing moved; the same PayPal order can be approved again later. */
export async function cancelPayPalOrder(token:string,paypalOrderId:string):Promise<CheckoutView>{
 const merchant=await merchantFor(token);
 return tenant(merchant,async db=>{
  const o=await lockOrder(db,token);
  const k=(await db.query<CheckoutRow>('UPDATE paypal_checkouts SET cancelled_at=clock_timestamp() WHERE merchant_id=$1 AND order_id=$2 AND paypal_order_id=$3 RETURNING *',[merchant,o.id,paypalOrderId])).rows[0];
  if(!k)refuse(404,'RESOURCE_NOT_FOUND');return view(k,o);
 });
}
