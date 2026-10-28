// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Canonical quotes and agent orders, shared by the BitPOS Muse Connector (MCP) and the Messenger agent.
// The agent never supplies a price: it picks a product id, the server prices it from the live catalog
// (approved offers included) and returns a quote id. Paying a quote takes three phases so the Stripe call
// never runs inside a transaction: reserve one order row → charge the SPT → record the verified outcome.
// CONFIRMED comes only from the PaymentIntent the server created (amount, currency and metadata checked in
// stripe.ts) or a signature-verified webhook; stock is taken once, in that same transaction.
import type pg from 'pg';
import type {MetaDb,OfferDeps} from './identity';
import {approvedOffers} from './offer-select';
import {formatTapAmount} from './staff';
import {STRIPE_MINIMUM,chargeSharedPaymentToken,createCheckoutSession,refundPaymentIntent,retrieveCheckoutSession,toStripeMinor,StripePaymentError,type PaymentFact,type StripeFetch,type StripeSandboxConfig} from './stripe';

export interface AgentDeps {db:MetaDb;offers:OfferDeps;stripe:{config:StripeSandboxConfig;fetch?:StripeFetch}|null}
export type Currency='thb'|'usd';
export interface MenuItem {productId:string;name:string;nameEn:string;emoji:string;category:string|null;available:number;imageUrl:string|null;
 price:{amountMinor:string;currency:Currency;display:string};basePrice:{amountMinor:string;display:string};
 offer:{offerId:string;discountPercent:number;expiresAt:string}|null;payable:boolean}
export interface QuoteView {quoteId:string;productId:string;name:string;nameEn:string;quantity:number;currency:Currency;
 unitAmountMinor:string;amountMinor:string;total:string;offerId:string|null;expiresAt:string;
 terms:string}
export type OrderStatus='PENDING'|'CONFIRMED'|'FAILED'|'REFUNDING'|'CANCELLED';
export interface OrderView {orderId:string;quoteId:string;status:OrderStatus;productId:string;quantity:number;currency:Currency;amountMinor:string;total:string;
 pickupCode:string;paymentIntentId:string|null;declineCode:string|null;confirmedAt:string|null;handedOverAt:string|null;cancelledAt:string|null}
export class AgentOrderError extends Error {constructor(readonly code:'NOT_FOUND'|'OUT_OF_STOCK'|'CURRENCY'|'BELOW_MINIMUM'|'INVALID_INPUT'|'QUOTE_EXPIRED'|'PAYMENTS_UNAVAILABLE'|'NOT_CANCELLABLE'|'PAYMENT_FAILED'|'PROVIDER_OUTCOME_UNKNOWN'){super(code);}}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMS='Pick up at the counter. Cancel with a full refund until staff hand the order over. Stripe sandbox, test mode, no real money.';
const code=(id:string)=>id.replace(/-/g,'').slice(0,4).toUpperCase();
const uuidOrFail=(v:unknown):string=>{if(typeof v!=='string'||!UUID.test(v))throw new AgentOrderError('INVALID_INPUT');return v;};
const isCurrency=(c:string):c is Currency=>c==='thb'||c==='usd';

/** The catalog as an agent may see it: server prices in Stripe units, approved offers only. */
export async function listMenu(deps:AgentDeps,merchantId:string):Promise<MenuItem[]>{
 return deps.db.tenant(merchantId,async db=>{
  const menu=await deps.offers.menu(db,merchantId);
  const offers=new Map(approvedOffers(menu).map(o=>[o.productId,o]));
  const items:MenuItem[]=[];
  for(const p of menu.products){
   if(!p.unitPrice||!p.basePrice)continue;
   const currency=p.unitPrice.currency.toLowerCase();if(!isCurrency(currency))continue;
   const unit=toStripeMinor(p.unitPrice.amountMinor,p.unitPrice.decimals),base=toStripeMinor(p.basePrice.amountMinor,p.basePrice.decimals);
   if(unit===null||base===null)continue;
   const o=offers.get(p.id);
   items.push({productId:p.id,name:p.name,nameEn:p.nameEn,emoji:p.emoji,category:typeof p.category==='string'?p.category:null,available:p.available,imageUrl:typeof p.imageUrl==='string'?p.imageUrl:null,
    price:{amountMinor:unit.toString(),currency,display:formatTapAmount(unit.toString(),currency)},basePrice:{amountMinor:base.toString(),display:formatTapAmount(base.toString(),currency)},
    offer:o?{offerId:o.offerId,discountPercent:o.discountPercent,expiresAt:o.expiresAt}:null,payable:p.available>0&&unit>=STRIPE_MINIMUM[currency]});
  }
  return items;
 });
}

/** Prices one product from the live catalog and stores a quote that expires in 10 minutes. */
export async function createQuote(deps:AgentDeps,merchantId:string,channel:'mcp'|'messenger',productIdIn:unknown,quantityIn:unknown=1,linkId:string|null=null):Promise<QuoteView>{
 if((channel==='messenger')!==(linkId!==null))throw new AgentOrderError('INVALID_INPUT');
 const productId=uuidOrFail(productIdIn);
 const quantity=Number(quantityIn);if(!Number.isInteger(quantity)||quantity<1||quantity>10)throw new AgentOrderError('INVALID_INPUT');
 return deps.db.tenant(merchantId,async db=>{
  const menu=await deps.offers.menu(db,merchantId);
  const p=menu.products.find(x=>x.id===productId);
  if(!p||!p.unitPrice||!p.basePrice)throw new AgentOrderError('NOT_FOUND');
  const currency=p.unitPrice.currency.toLowerCase();if(!isCurrency(currency))throw new AgentOrderError('CURRENCY');
  const unit=toStripeMinor(p.unitPrice.amountMinor,p.unitPrice.decimals),base=toStripeMinor(p.basePrice.amountMinor,p.basePrice.decimals);
  if(unit===null||base===null||base<unit)throw new AgentOrderError('CURRENCY');
  if(p.available<quantity)throw new AgentOrderError('OUT_OF_STOCK');
  const total=unit*BigInt(quantity);
  if(total<STRIPE_MINIMUM[currency])throw new AgentOrderError('BELOW_MINIMUM');
  const offerId=approvedOffers(menu).find(o=>o.productId===productId)?.offerId??null;
  const q=(await db.query<{id:string;expires_at:Date}>("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_quotes(merchant_id,channel,product_id,offer_id,quantity,currency,unit_amount_minor,base_unit_amount_minor,amount_minor,link_id,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,t,t+interval '10 minutes' FROM n RETURNING id,expires_at",
   [merchantId,channel,productId,offerId,quantity,currency,unit.toString(),base.toString(),total.toString(),linkId])).rows[0];
  return {quoteId:q.id,productId,name:p.name,nameEn:p.nameEn,quantity,currency,unitAmountMinor:unit.toString(),amountMinor:total.toString(),total:formatTapAmount(total.toString(),currency),offerId,expiresAt:q.expires_at.toISOString(),terms:TERMS};
 });
}

type OrderRow={id:string;quote_id:string;status:OrderStatus;product_id:string;quantity:number;currency:Currency;amount_minor:string;stripe_payment_intent_id:string|null;decline_code:string|null;confirmed_at:Date|null;handed_over_at:Date|null;cancelled_at:Date|null;stock_short:boolean};
const ORDER_COLS='id,quote_id,status,product_id,quantity,currency,amount_minor::text,stripe_payment_intent_id,decline_code,confirmed_at,handed_over_at,cancelled_at,stock_short';
const view=(o:OrderRow):OrderView=>({orderId:o.id,quoteId:o.quote_id,status:o.status,productId:o.product_id,quantity:o.quantity,currency:o.currency,amountMinor:o.amount_minor,
 total:formatTapAmount(o.amount_minor,o.currency),pickupCode:code(o.id),paymentIntentId:o.stripe_payment_intent_id,declineCode:o.decline_code,
 confirmedAt:o.confirmed_at?.toISOString()??null,handedOverAt:o.handed_over_at?.toISOString()??null,cancelledAt:o.cancelled_at?.toISOString()??null});

/** Inside the shop's transaction: match Stripe's facts to the row, confirm and take stock once. */
async function confirm(db:pg.PoolClient,orderId:string,f:{paymentIntentId:string;amountMinor:bigint;currency:string;source:'charge'|'webhook'|'lookup'}):Promise<'CONFIRMED'|'ALREADY'|'MISMATCH'|'NOT_FOUND'>{
 const o=(await db.query<{status:OrderStatus;amount_minor:string;currency:string;product_id:string;quantity:number;stripe_payment_intent_id:string|null}>('SELECT status,amount_minor::text,currency,product_id,quantity,stripe_payment_intent_id FROM meta_agent_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
 if(!o)return 'NOT_FOUND';
 if(o.status!=='PENDING'&&o.status!=='FAILED')return 'ALREADY';
 if(BigInt(o.amount_minor)!==f.amountMinor||o.currency!==f.currency||(o.stripe_payment_intent_id&&o.stripe_payment_intent_id!==f.paymentIntentId))return 'MISMATCH';
 const stock=(await db.query('UPDATE products SET stock=stock-$2 WHERE id=$1 AND stock-reserved>=$2',[o.product_id,o.quantity])).rowCount===1;
 await db.query("UPDATE meta_agent_orders SET status='CONFIRMED',stripe_payment_intent_id=$2,decline_code=NULL,confirmed_at=clock_timestamp(),confirmed_source=$3,stock_short=$4 WHERE id=$1",[orderId,f.paymentIntentId,f.source,!stock]);
 return 'CONFIRMED';
}

/**
 * Pay a quote with an agent's Shared Payment Token. One order per quote: a retry with the same quote
 * returns the same order and, while it is still pending, repeats the same idempotent Stripe request.
 */
export async function completeCheckout(deps:AgentDeps,merchantId:string,quoteIdIn:unknown,sptIn:unknown):Promise<OrderView>{
 const quoteId=uuidOrFail(quoteIdIn);
 if(typeof sptIn!=='string'||!/^spt_[A-Za-z0-9_]{1,200}$/.test(sptIn))throw new AgentOrderError('INVALID_INPUT');
 if(!deps.stripe)throw new AgentOrderError('PAYMENTS_UNAVAILABLE');
 const stripe=deps.stripe;
 const prep=await deps.db.tenant(merchantId,async db=>{
  const existing=(await db.query<OrderRow>(`SELECT ${ORDER_COLS} FROM meta_agent_orders WHERE quote_id=$1 FOR UPDATE`,[quoteId])).rows[0];
  if(existing&&existing.status!=='PENDING')return {kind:'done' as const,order:existing};
  // SPT checkout is for connector (MCP) quotes; a chat quote is paid only through its own Stripe Checkout.
  const q=(await db.query<{product_id:string;quantity:number;currency:Currency;amount_minor:string;live:boolean}>("SELECT product_id,quantity,currency,amount_minor::text,expires_at>clock_timestamp() AS live FROM meta_quotes WHERE id=$1 AND channel='mcp'",[quoteId])).rows[0];
  if(!q)throw new AgentOrderError('NOT_FOUND');
  if(existing)return {kind:'charge' as const,order:existing};
  if(!q.live)throw new AgentOrderError('QUOTE_EXPIRED');
  const order=(await db.query<OrderRow>(`INSERT INTO meta_agent_orders(merchant_id,quote_id,product_id,quantity,currency,amount_minor) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${ORDER_COLS}`,
   [merchantId,quoteId,q.product_id,q.quantity,q.currency,q.amount_minor])).rows[0];
  return {kind:'charge' as const,order};
 });
 if(prep.kind==='done')return view(prep.order);
 const o=prep.order;
 let r;
 try{r=await chargeSharedPaymentToken(stripe.config,{checkoutId:o.id,merchantId,orderId:o.id,quoteId,amountMinor:BigInt(o.amount_minor),currency:o.currency,sharedPaymentToken:sptIn},stripe.fetch);}
 catch(e){
  // Unknown outcome: the row stays PENDING; a retry repeats the same idempotent request, and the webhook can still confirm it.
  if(e instanceof StripePaymentError&&e.code==='PAYMENT_FAILED')r={outcome:'FAILED' as const,paymentIntentId:null,declineCode:e.detail??'payment_failed'};
  else throw new AgentOrderError('PROVIDER_OUTCOME_UNKNOWN');
 }
 const res=r;
 return deps.db.tenant(merchantId,async db=>{
  if(res.outcome==='SUCCEEDED')await confirm(db,o.id,{paymentIntentId:res.paymentIntentId!,amountMinor:BigInt(o.amount_minor),currency:o.currency,source:'charge'});
  else if(res.outcome==='FAILED')await db.query("UPDATE meta_agent_orders SET status='FAILED',decline_code=$2,stripe_payment_intent_id=coalesce(stripe_payment_intent_id,$3) WHERE id=$1 AND status='PENDING'",[o.id,res.declineCode?.slice(0,80)??'payment_failed',res.paymentIntentId]);
  else await db.query("UPDATE meta_agent_orders SET stripe_payment_intent_id=coalesce(stripe_payment_intent_id,$2) WHERE id=$1 AND status='PENDING'",[o.id,res.paymentIntentId]);
  return view((await db.query<OrderRow>(`SELECT ${ORDER_COLS} FROM meta_agent_orders WHERE id=$1`,[o.id])).rows[0]);
 });
}

export async function orderStatus(deps:AgentDeps,merchantId:string,orderIdIn:unknown):Promise<OrderView>{
 const orderId=uuidOrFail(orderIdIn);
 const o=await deps.db.tenant(merchantId,async db=>(await db.query<OrderRow>(`SELECT ${ORDER_COLS} FROM meta_agent_orders WHERE id=$1`,[orderId])).rows[0]);
 if(!o)throw new AgentOrderError('NOT_FOUND');
 return view(o);
}

/** Cancel before hand-over: full Stripe refund, then stock back (only what was actually taken). */
export async function cancelOrder(deps:AgentDeps,merchantId:string,orderIdIn:unknown):Promise<OrderView>{
 const orderId=uuidOrFail(orderIdIn);
 if(!deps.stripe)throw new AgentOrderError('PAYMENTS_UNAVAILABLE');
 const stripe=deps.stripe;
 const prep=await deps.db.tenant(merchantId,async db=>{
  const o=(await db.query<OrderRow>(`SELECT ${ORDER_COLS} FROM meta_agent_orders WHERE id=$1 FOR UPDATE`,[orderId])).rows[0];
  if(!o)throw new AgentOrderError('NOT_FOUND');
  if(o.status==='CANCELLED')return {kind:'done' as const,order:o};
  if(o.status==='CONFIRMED'&&!o.handed_over_at){await db.query("UPDATE meta_agent_orders SET status='REFUNDING' WHERE id=$1",[orderId]);return {kind:'refund' as const,order:o};}
  if(o.status==='REFUNDING')return {kind:'refund' as const,order:o};
  throw new AgentOrderError('NOT_CANCELLABLE');
 });
 if(prep.kind==='done')return view(prep.order);
 const o=prep.order;
 let refund;
 try{refund=await refundPaymentIntent(stripe.config,{paymentIntentId:o.stripe_payment_intent_id!,amountMinor:BigInt(o.amount_minor),orderId},stripe.fetch);}
 catch(e){
  if(e instanceof StripePaymentError&&e.code==='PAYMENT_FAILED'){
   // Stripe refused the refund outright: the order is still paid and can be handed over or retried.
   await deps.db.tenant(merchantId,db=>db.query("UPDATE meta_agent_orders SET status='CONFIRMED' WHERE id=$1 AND status='REFUNDING'",[orderId]));
   throw new AgentOrderError('PAYMENT_FAILED');
  }
  throw new AgentOrderError('PROVIDER_OUTCOME_UNKNOWN');
 }
 return deps.db.tenant(merchantId,async db=>{
  const cur=(await db.query<{status:OrderStatus;stock_short:boolean;product_id:string;quantity:number}>('SELECT status,stock_short,product_id,quantity FROM meta_agent_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(cur.status==='REFUNDING'){
   if(!cur.stock_short)await db.query('UPDATE products SET stock=stock+$2 WHERE id=$1',[cur.product_id,cur.quantity]);
   await db.query("UPDATE meta_agent_orders SET status='CANCELLED',stripe_refund_id=$2,cancelled_at=clock_timestamp() WHERE id=$1",[orderId,refund.id]);
  }
  return view((await db.query<OrderRow>(`SELECT ${ORDER_COLS} FROM meta_agent_orders WHERE id=$1`,[orderId])).rows[0]);
 });
}

export async function agentOrderMerchant(db:MetaDb,orderId:string):Promise<string|null>{
 if(!UUID.test(orderId))return null;
 return (await db.query<{m:string|null}>('SELECT bitpos.meta_agent_order_merchant($1) AS m',[orderId])).rows[0]?.m??null;
}

/** Signed `payment_intent.succeeded` for an agent order: dedupe the event, then confirm if it matches. */
export async function applyAgentWebhook(db:MetaDb,merchantId:string,fact:PaymentFact):Promise<'CONFIRMED'|'ALREADY'|'MISMATCH'|'NOT_FOUND'|'DUPLICATE_EVENT'>{
 return db.tenant(merchantId,async c=>{
  const q=(await c.query<{quote_id:string}>('SELECT quote_id FROM meta_agent_orders WHERE id=$1',[fact.orderId])).rows[0];
  if(!q)return 'NOT_FOUND';
  if(q.quote_id!==fact.quoteId)return 'MISMATCH';
  if(!(await c.query('INSERT INTO meta_agent_stripe_events(merchant_id,event_id,order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[merchantId,fact.eventId,fact.orderId])).rowCount)return 'DUPLICATE_EVENT';
  return confirm(c,fact.orderId,{paymentIntentId:fact.paymentIntentId,amountMinor:fact.amountMinor,currency:fact.currency,source:'webhook'});
 });
}

export type AgentCheckoutStart={kind:'redirect';url:string;orderId:string;total:string}|{kind:'paid';orderId:string;pickupCode:string}|{kind:'ended'};

/** Chat orders: one hosted Stripe Checkout per quote, for the customer the quote was made for. */
export async function startAgentCheckout(deps:AgentDeps,merchantId:string,linkId:string,quoteIdIn:unknown,publicOrigin:string):Promise<AgentCheckoutStart>{
 const quoteId=uuidOrFail(quoteIdIn);
 if(!deps.stripe)throw new AgentOrderError('PAYMENTS_UNAVAILABLE');
 const stripe=deps.stripe;
 const prep=await deps.db.tenant(merchantId,async db=>{
  const q=(await db.query<{product_id:string;quantity:number;currency:Currency;amount_minor:string;live:boolean;name:string;name_en:string;emoji:string}>(
   `SELECT q.product_id,q.quantity,q.currency,q.amount_minor::text,q.expires_at>clock_timestamp() AS live,coalesce(p.name,'') AS name,coalesce(p.name_en,'') AS name_en,coalesce(p.emoji,'') AS emoji
    FROM meta_quotes q LEFT JOIN products p ON p.merchant_id=q.merchant_id AND p.id=q.product_id WHERE q.id=$1 AND q.channel='messenger' AND q.link_id=$2`,[quoteId,linkId])).rows[0];
  if(!q)throw new AgentOrderError('NOT_FOUND');
  const o=(await db.query<OrderRow&{checkout_url:string|null}>(`SELECT ${ORDER_COLS},checkout_url FROM meta_agent_orders WHERE quote_id=$1 FOR UPDATE`,[quoteId])).rows[0];
  if(o?.status==='CONFIRMED')return {kind:'paid' as const,orderId:o.id};
  if(o&&o.status!=='PENDING')return {kind:'ended' as const};
  if(o?.checkout_url)return {kind:'redirect' as const,url:o.checkout_url,orderId:o.id,amount:q.amount_minor,currency:q.currency};
  if(!o&&!q.live)throw new AgentOrderError('QUOTE_EXPIRED');
  const orderId=o?.id??(await db.query<{id:string}>('INSERT INTO meta_agent_orders(merchant_id,quote_id,product_id,quantity,currency,amount_minor,link_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
   [merchantId,quoteId,q.product_id,q.quantity,q.currency,q.amount_minor,linkId])).rows[0].id;
  return {kind:'create' as const,orderId,amount:q.amount_minor,currency:q.currency,productName:`${q.emoji} ${q.name} / ${q.name_en} ×${q.quantity}`};
 });
 if(prep.kind==='paid')return {kind:'paid',orderId:prep.orderId,pickupCode:code(prep.orderId)};
 if(prep.kind==='ended')return prep;
 if(prep.kind==='redirect')return {kind:'redirect',url:prep.url,orderId:prep.orderId,total:formatTapAmount(prep.amount,prep.currency)};
 let session;
 try{session=await createCheckoutSession(stripe.config,{orderId:prep.orderId,quoteId,merchantId,productName:prep.productName,amountMinor:BigInt(prep.amount),currency:prep.currency,
  successUrl:`${publicOrigin}/meta/agent/paid?o=${prep.orderId}`,cancelUrl:`${publicOrigin}/meta/agent/paid?o=${prep.orderId}`,expiresAtSeconds:Math.floor(Date.now()/1000)+31*60},stripe.fetch);}
 catch{throw new AgentOrderError('PROVIDER_OUTCOME_UNKNOWN');}
 await deps.db.tenant(merchantId,db=>db.query('UPDATE meta_agent_orders SET stripe_checkout_id=$2,checkout_url=$3 WHERE id=$1 AND stripe_checkout_id IS NULL',[prep.orderId,session.id,session.url]));
 return {kind:'redirect',url:session.url!,orderId:prep.orderId,total:formatTapAmount(prep.amount,prep.currency)};
}

/** Return page after Stripe: ask Stripe server to server before believing the order is paid. */
export async function reconcileAgentCheckout(deps:AgentDeps,orderIdIn:unknown):Promise<(OrderView&{merchantId:string;confirmedNow:boolean})|null>{
 if(typeof orderIdIn!=='string'||!UUID.test(orderIdIn))return null;
 const orderId=orderIdIn,merchantId=await agentOrderMerchant(deps.db,orderId);
 if(!merchantId)return null;
 const read=(db:pg.PoolClient)=>db.query<OrderRow&{stripe_checkout_id:string|null}>(`SELECT ${ORDER_COLS},stripe_checkout_id FROM meta_agent_orders WHERE id=$1`,[orderId]).then(r=>r.rows[0]);
 const before=await deps.db.tenant(merchantId,read);
 const unchanged={...view(before),merchantId,confirmedNow:false};
 if(before.status!=='PENDING'||!before.stripe_checkout_id||!deps.stripe)return unchanged;
 const s=await retrieveCheckoutSession(deps.stripe.config,before.stripe_checkout_id,deps.stripe.fetch);
 if(!s.paid||s.orderId!==orderId||s.merchantId!==merchantId||!s.paymentIntentId)return unchanged;
 return deps.db.tenant(merchantId,async db=>{
  const r=await confirm(db,orderId,{paymentIntentId:s.paymentIntentId!,amountMinor:s.amountMinor,currency:s.currency,source:'lookup'});
  return {...view((await read(db))!),merchantId,confirmedNow:r==='CONFIRMED'};
 });
}

/** Who to tell when a chat order is paid (consented Messenger customers only), as a Messenger receipt. */
export async function agentReceipt(db:MetaDb,merchantId:string,orderId:string,publicOrigin?:string):Promise<{psid:string;text:string;receipt:import('./messenger').Receipt}|null>{
 return db.tenant(merchantId,async c=>{
  const r=(await c.query<{psid:string;status:string;amount_minor:string;currency:string;quantity:number;name:string;name_en:string;emoji:string;image_url:string|null;confirmed_at:Date|null}>(
   `SELECT l.psid,o.status,o.amount_minor::text,o.currency,o.quantity,coalesce(p.name,'') AS name,coalesce(p.name_en,'') AS name_en,coalesce(p.emoji,'') AS emoji,p.image_url,o.confirmed_at FROM meta_agent_orders o
    JOIN meta_customer_links l ON l.merchant_id=o.merchant_id AND l.id=o.link_id AND l.revoked_at IS NULL
    LEFT JOIN products p ON p.merchant_id=o.merchant_id AND p.id=o.product_id WHERE o.id=$1`,[orderId])).rows[0];
  if(!r||r.status!=='CONFIRMED')return null;
  const total=Number(BigInt(r.amount_minor))/100,unit=total/r.quantity;
  const image=r.image_url?.startsWith('/images/')&&publicOrigin?publicOrigin+'/meta'+r.image_url:r.image_url?.startsWith('https://')?r.image_url:undefined;
  const text=`จ่ายแล้ว ✓ ${r.emoji} ${r.name} ×${r.quantity} · ${formatTapAmount(r.amount_minor,r.currency)}\nรหัสรับสินค้า #${code(orderId)} รับที่เคาน์เตอร์ได้เลยค่ะ\nPaid — pickup code #${code(orderId)}. Stripe sandbox, test mode.`;
  return {psid:r.psid,text,receipt:{recipientName:`รหัสรับ #${code(orderId)} / Pickup #${code(orderId)}`,orderNumber:code(orderId),currency:r.currency.toUpperCase(),paymentMethod:'Stripe sandbox (test mode)',
   timestamp:Math.floor((r.confirmed_at??new Date()).getTime()/1000),elements:[{title:`${r.emoji} ${r.name} / ${r.name_en}`,subtitle:'รับที่เคาน์เตอร์ / Pick up at the counter',quantity:r.quantity,price:Math.round(unit*100)/100,currency:r.currency.toUpperCase(),imageUrl:image}],total}};
 });
}

/** A customer's own recent chat orders (pickup code, item, total, status) for "My orders". */
export async function listCustomerOrders(deps:AgentDeps,merchantId:string,linkId:string):Promise<{code:string;line:string;status:OrderStatus;handedOver:boolean}[]>{
 return deps.db.tenant(merchantId,async db=>(await db.query<{id:string;status:OrderStatus;amount_minor:string;currency:Currency;quantity:number;handed_over_at:Date|null;name:string;emoji:string}>(
  `SELECT o.id,o.status,o.amount_minor::text,o.currency,o.quantity,o.handed_over_at,coalesce(p.name,'') AS name,coalesce(p.emoji,'') AS emoji FROM meta_agent_orders o
   LEFT JOIN products p ON p.merchant_id=o.merchant_id AND p.id=o.product_id WHERE o.link_id=$1 AND o.created_at>clock_timestamp()-interval '7 days' ORDER BY o.created_at DESC LIMIT 5`,[linkId])).rows
  .map(r=>({code:code(r.id),status:r.status,handedOver:r.handed_over_at!==null,line:`${r.emoji} ${r.name} ×${r.quantity} · ${formatTapAmount(r.amount_minor,r.currency)}`})));
}
