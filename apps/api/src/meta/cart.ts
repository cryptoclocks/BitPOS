// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Multi-item orders for meta-pay (table or web) and meta-pos (counter sale as a Stripe QR), migration 313.
// The server prices every line from the live catalog and approved offers when the order is made; the customer only
// chooses product ids and quantities. PAID comes only from a signed Stripe webhook or a server-side Checkout lookup
// that matches amount, currency and order; stock is taken once per line and recorded in meta_stock_movements.
import {createHash,randomBytes} from 'node:crypto';
import type pg from 'pg';
import type {MetaDb} from './identity';
import {listMenu,type AgentDeps,type Currency} from './agent-orders';
import {formatTapAmount} from './staff';
import {STRIPE_MINIMUM,createCheckoutSession,refundPaymentIntent,retrieveCheckoutSession,type PaymentFact} from './stripe';

export type CartChannel='table'|'counter'|'web';
export interface CartLine {productId:string;quantity:number}
export interface CartOrderView {orderId:string;code:string;channel:CartChannel;status:'PENDING'|'PAID'|'CANCELLED'|'EXPIRED';currency:Currency;amountMinor:string;total:string;
 discount:string;checkoutUrl:string|null;paidAt:string|null;handedOverAt:string|null;stockShort:boolean;tableLabel:string|null;
 lines:{name:string;nameEn:string;emoji:string;quantity:number;unit:string;amount:string;offer:boolean}[]}
export class CartError extends Error {constructor(readonly code:'EMPTY'|'INVALID_INPUT'|'NOT_FOUND'|'OUT_OF_STOCK'|'MIXED_CURRENCY'|'BELOW_MINIMUM'|'PAYMENTS_UNAVAILABLE'|'NOT_CANCELLABLE'|'ENDED'){super(code);}}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=(s:string)=>createHash('sha256').update(s).digest();
export const cartCode=(id:string)=>id.replace(/-/g,'').slice(0,4).toUpperCase();
const LIFETIME_MIN=30;

/** Parses "productId:qty,productId:qty" (the signed-out cart a page keeps), merging repeats; at most 20 lines. */
export function parseCart(raw:string|null|undefined):CartLine[]{
 const out=new Map<string,number>();
 for(const part of (raw??'').split(',').slice(0,40)){
  const [id,q]=part.split(':');const n=Number(q);
  if(!id||!UUID.test(id)||!Number.isInteger(n)||n<1)continue;
  out.set(id,Math.min(20,(out.get(id)??0)+n));
 }
 return [...out].slice(0,20).map(([productId,quantity])=>({productId,quantity}));
}
export const formatCart=(lines:CartLine[])=>lines.map(l=>`${l.productId}:${l.quantity}`).join(',');

/** Prices the lines from the live menu inside the shop's transaction. */
async function price(deps:AgentDeps,merchantId:string,lines:CartLine[]){
 if(!lines.length)throw new CartError('EMPTY');
 const menu=new Map((await listMenu(deps,merchantId)).map(m=>[m.productId,m]));
 let currency:Currency|null=null,total=0n,base=0n;
 const priced=lines.map((l,i)=>{
  const m=menu.get(l.productId);if(!m)throw new CartError('NOT_FOUND');
  if(m.available<l.quantity)throw new CartError('OUT_OF_STOCK');
  if(currency&&currency!==m.price.currency)throw new CartError('MIXED_CURRENCY');currency=m.price.currency;
  const unit=BigInt(m.price.amountMinor),b=BigInt(m.basePrice.amountMinor);total+=unit*BigInt(l.quantity);base+=b*BigInt(l.quantity);
  return {line:i+1,m,quantity:l.quantity,unit,base:b};
 });
 if(total<STRIPE_MINIMUM[currency!])throw new CartError('BELOW_MINIMUM');
 return {currency:currency!,total,discount:base-total,priced};
}
export async function quoteCart(deps:AgentDeps,merchantId:string,lines:CartLine[]){
 const p=await price(deps,merchantId,lines);
 return {currency:p.currency,total:formatTapAmount(p.total.toString(),p.currency),discount:formatTapAmount(p.discount.toString(),p.currency),
  lines:p.priced.map(x=>({productId:x.m.productId,name:x.m.name,nameEn:x.m.nameEn,emoji:x.m.emoji,imageUrl:x.m.imageUrl,quantity:x.quantity,
   unit:formatTapAmount(x.unit.toString(),p.currency),amount:formatTapAmount((x.unit*BigInt(x.quantity)).toString(),p.currency),offer:x.m.offer!==null}))};
}

/** Makes the order and its hosted Stripe Checkout. Returns the order and a one-time access token for its receipt page. */
export async function startCart(deps:AgentDeps,merchantId:string,lines:CartLine[],opts:{channel:CartChannel;tableId?:string|null;linkId?:string|null;staffUserId?:string|null;publicOrigin:string}):Promise<{orderId:string;access:string;checkoutUrl:string}>{
 if(!deps.stripe)throw new CartError('PAYMENTS_UNAVAILABLE');
 if((opts.channel==='counter')!==Boolean(opts.staffUserId))throw new CartError('INVALID_INPUT');
 const p=await price(deps,merchantId,lines);
 const access=randomBytes(24).toString('base64url');
 const orderId=await deps.db.tenant(merchantId,async c=>{
  const id=(await c.query<{id:string}>(`INSERT INTO meta_cart_orders(merchant_id,channel,table_id,link_id,access_sha256,currency,amount_minor,discount_minor,created_by,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '${LIFETIME_MIN} minutes') RETURNING id`,
   [merchantId,opts.channel,opts.tableId??null,opts.linkId??null,sha(access),p.currency,p.total.toString(),p.discount.toString(),opts.staffUserId??null])).rows[0].id;
  for(const x of p.priced)await c.query('INSERT INTO meta_cart_items(merchant_id,order_id,line,product_id,name,name_en,emoji,quantity,unit_minor,base_minor,offer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
   [merchantId,id,x.line,x.m.productId,x.m.name,x.m.nameEn,x.m.emoji,x.quantity,x.unit.toString(),x.base.toString(),x.m.offer?.offerId??null]);
  return id;
 });
 const items=p.priced.reduce((n,x)=>n+x.quantity,0);
 const back=`${opts.publicOrigin}/receipt/${orderId}?a=${access}`;
 const session=await createCheckoutSession(deps.stripe.config,{merchantId,orderId,quoteId:orderId,amountMinor:p.total,currency:p.currency,
  productName:`Muse order #${cartCode(orderId)} · ${items} item${items>1?'s':''}`,successUrl:`${back}&s={CHECKOUT_SESSION_ID}`,cancelUrl:`${opts.publicOrigin}/cart`,
  expiresAtSeconds:Math.floor(Date.now()/1000)+LIFETIME_MIN*60},deps.stripe.fetch);
 await deps.db.tenant(merchantId,c=>c.query('UPDATE meta_cart_orders SET stripe_checkout_id=$2,checkout_url=$3 WHERE id=$1',[orderId,session.id,session.url]));
 return {orderId,access,checkoutUrl:session.url!};
}

/** Inside the shop's transaction: PAID once, stock once per line, recorded. */
async function markCartPaid(c:pg.PoolClient,orderId:string,f:{paymentIntentId:string;amountMinor:bigint;currency:string;source:'webhook'|'lookup'}):Promise<'PAID'|'ALREADY_PAID'|'MISMATCH'|'UNKNOWN_ORDER'>{
 const o=(await c.query<{status:string;amount_minor:string;currency:string}>('SELECT status,amount_minor::text,currency FROM meta_cart_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
 if(!o)return 'UNKNOWN_ORDER';
 if(o.status==='PAID'||o.status==='CANCELLED')return 'ALREADY_PAID';
 if(BigInt(o.amount_minor)!==f.amountMinor||o.currency!==f.currency)return 'MISMATCH';
 let short=false;
 for(const l of (await c.query<{line:number;product_id:string;quantity:number}>('SELECT line,product_id,quantity FROM meta_cart_items WHERE order_id=$1 ORDER BY line',[orderId])).rows){
  const took=(await c.query('UPDATE products SET stock=stock-$2 WHERE id=$1 AND stock-reserved>=$2',[l.product_id,l.quantity])).rowCount===1;
  if(took)await c.query("INSERT INTO meta_stock_movements(merchant_id,product_id,delta,reason,order_kind,order_id,line) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,'cart_paid','cart',$3,$4)",[l.product_id,-l.quantity,orderId,l.line]);
  else short=true;
 }
 await c.query("UPDATE meta_cart_orders SET status='PAID',paid_at=clock_timestamp(),paid_source=$2,stripe_payment_intent_id=$3,stock_short=$4 WHERE id=$1",[orderId,f.source,f.paymentIntentId,short]);
 return 'PAID';
}
export async function cartOrderMerchant(db:MetaDb,orderId:string):Promise<string|null>{
 if(!UUID.test(orderId))return null;
 return (await db.query<{m:string|null}>('SELECT bitpos.meta_cart_order_merchant($1) AS m',[orderId])).rows[0]?.m??null;
}
/** Signed payment_intent.succeeded for a cart order: dedupe the event, then mark paid if it matches. */
export async function applyCartWebhook(db:MetaDb,merchantId:string,fact:PaymentFact){
 return db.tenant(merchantId,async c=>{
  if(!(await c.query('SELECT 1 FROM meta_cart_orders WHERE id=$1',[fact.orderId])).rowCount)return 'UNKNOWN_ORDER' as const;
  if(!(await c.query('INSERT INTO meta_cart_stripe_events(merchant_id,event_id,order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[merchantId,fact.eventId,fact.orderId])).rowCount)return 'DUPLICATE_EVENT' as const;
  return markCartPaid(c,fact.orderId,{paymentIntentId:fact.paymentIntentId,amountMinor:fact.amountMinor,currency:fact.currency,source:'webhook'});
 });
}

async function viewOf(c:pg.PoolClient,orderId:string):Promise<CartOrderView|null>{
 const o=(await c.query<{id:string;channel:CartChannel;status:CartOrderView['status'];expired:boolean;currency:Currency;amount_minor:string;discount_minor:string;checkout_url:string|null;paid_at:Date|null;handed_over_at:Date|null;stock_short:boolean;label:string|null}>(
  `SELECT o.id,o.channel,o.status,(o.status='PENDING' AND o.expires_at<clock_timestamp()) AS expired,o.currency,o.amount_minor::text,o.discount_minor::text,o.checkout_url,o.paid_at,o.handed_over_at,o.stock_short,t.label
   FROM meta_cart_orders o LEFT JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id WHERE o.id=$1`,[orderId])).rows[0];
 if(!o)return null;
 const lines=(await c.query<{name:string;name_en:string;emoji:string;quantity:number;unit_minor:string;base_minor:string}>('SELECT name,name_en,emoji,quantity,unit_minor::text,base_minor::text FROM meta_cart_items WHERE order_id=$1 ORDER BY line',[orderId])).rows;
 const f=(m:string|bigint)=>formatTapAmount(m.toString(),o.currency);
 return {orderId:o.id,code:cartCode(o.id),channel:o.channel,status:o.expired?'EXPIRED':o.status,currency:o.currency,amountMinor:o.amount_minor,total:f(o.amount_minor),discount:f(o.discount_minor),
  checkoutUrl:o.status==='PENDING'&&!o.expired?o.checkout_url:null,paidAt:o.paid_at?.toISOString()??null,handedOverAt:o.handed_over_at?.toISOString()??null,stockShort:o.stock_short,tableLabel:o.label,
  lines:lines.map(l=>({name:l.name,nameEn:l.name_en,emoji:l.emoji,quantity:l.quantity,unit:f(l.unit_minor),amount:f(BigInt(l.unit_minor)*BigInt(l.quantity)),offer:BigInt(l.base_minor)>BigInt(l.unit_minor)}))};
}
/** The customer's receipt page: needs the access token from the return link; asks Stripe once if still pending. */
export async function cartReceipt(deps:AgentDeps,orderId:string,access:string|null,checkoutId:string|null):Promise<CartOrderView|null>{
 if(!UUID.test(orderId)||!access||!/^[A-Za-z0-9_-]{32}$/.test(access))return null;
 const merchantId=await cartOrderMerchant(deps.db,orderId);if(!merchantId)return null;
 const first=await deps.db.tenant(merchantId,async c=>{
  const ok=(await c.query<{checkout:string|null}>('SELECT stripe_checkout_id AS checkout FROM meta_cart_orders WHERE id=$1 AND access_sha256=$2',[orderId,sha(access)])).rows[0];
  return ok?{view:await viewOf(c,orderId),checkout:ok.checkout}:null;
 });
 if(!first?.view)return null;
 if(first.view.status!=='PENDING'||!deps.stripe||!first.checkout||(checkoutId&&checkoutId!==first.checkout))return first.view;
 // Server-to-server lookup; the redirect itself proves nothing.
 const s=await retrieveCheckoutSession(deps.stripe.config,first.checkout,deps.stripe.fetch).catch(()=>null);
 if(!s?.paid||!s.paymentIntentId||s.orderId!==orderId||s.merchantId!==merchantId)return first.view;
 return deps.db.tenant(merchantId,async c=>{await markCartPaid(c,orderId,{paymentIntentId:s.paymentIntentId!,amountMinor:s.amountMinor,currency:s.currency,source:'lookup'});return viewOf(c,orderId);});
}
export async function cartForStaff(db:MetaDb,merchantId:string,orderId:string):Promise<CartOrderView|null>{
 if(!UUID.test(orderId))return null;
 return db.tenant(merchantId,c=>viewOf(c,orderId));
}
export async function handOverCart(db:MetaDb,merchantId:string,staffUserId:string,orderId:string):Promise<'HANDED_OVER'|'ALREADY'|'NOT_PAID'|'NOT_FOUND'>{
 if(!UUID.test(orderId))return 'NOT_FOUND';
 return db.tenant(merchantId,async c=>{
  const o=(await c.query<{status:string;handed:boolean}>('SELECT status,handed_over_at IS NOT NULL AS handed FROM meta_cart_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o)return 'NOT_FOUND';if(o.status!=='PAID')return 'NOT_PAID';if(o.handed)return 'ALREADY';
  await c.query('UPDATE meta_cart_orders SET handed_over_at=clock_timestamp(),handed_over_by=$2 WHERE id=$1',[orderId,staffUserId]);return 'HANDED_OVER';
 });
}
/** Staff refund before hand-over: full amount, idempotent at Stripe, stock returned once per line. */
export async function refundCart(deps:AgentDeps,merchantId:string,orderId:string):Promise<CartOrderView>{
 if(!deps.stripe)throw new CartError('PAYMENTS_UNAVAILABLE');
 const o=await deps.db.tenant(merchantId,async c=>(await c.query<{status:string;handed:boolean;pi:string|null;amount:string}>('SELECT status,handed_over_at IS NOT NULL AS handed,stripe_payment_intent_id AS pi,amount_minor::text AS amount FROM meta_cart_orders WHERE id=$1',[orderId])).rows[0]);
 if(!o)throw new CartError('NOT_FOUND');
 if(o.status==='CANCELLED')return (await cartForStaff(deps.db,merchantId,orderId))!;
 if(o.status!=='PAID'||o.handed||!o.pi)throw new CartError('NOT_CANCELLABLE');
 const refund=await refundPaymentIntent(deps.stripe.config,{paymentIntentId:o.pi,amountMinor:BigInt(o.amount),orderId},deps.stripe.fetch);
 return deps.db.tenant(merchantId,async c=>{
  const cur=(await c.query<{status:string;stock_short:boolean}>('SELECT status,stock_short FROM meta_cart_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(cur.status==='PAID'){
   for(const m of (await c.query<{line:number;product_id:string;delta:number}>("SELECT line,product_id,delta FROM meta_stock_movements WHERE order_kind='cart' AND order_id=$1 AND reason='cart_paid'",[orderId])).rows){
    await c.query('UPDATE products SET stock=stock+$2 WHERE id=$1',[m.product_id,-m.delta]);
    await c.query("INSERT INTO meta_stock_movements(merchant_id,product_id,delta,reason,order_kind,order_id,line) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,'cart_refunded','cart',$3,$4)",[m.product_id,-m.delta,orderId,m.line]);
   }
   await c.query("UPDATE meta_cart_orders SET status='CANCELLED',stripe_refund_id=$2,cancelled_at=clock_timestamp() WHERE id=$1",[orderId,refund.id]);
  }
  return (await viewOf(c,orderId))!;
 });
}
export {formatTapAmount};
