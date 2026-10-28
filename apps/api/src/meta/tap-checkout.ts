// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Pay for the offer shown on a tap with Stripe Checkout (test mode). Three phases so the Stripe call never
// runs inside a transaction: re-quote and reserve one order row → create the hosted session → store it.
// PAID comes only from a Stripe-signed webhook or a server-side Stripe lookup that matches the row,
// and the stock decrement happens in that same transaction, once.
import type pg from 'pg';
import {approvedOffers} from './offer-select';
import {STOCK_MOVE,agentOrderMerchant,applyAgentWebhook} from './agent-orders';
import {customerFromSession,type IdentityDeps,type OfferDeps} from './identity';
import {STRIPE_MINIMUM,toStripeMinor,createCheckoutSession,paymentFactFromEvent,retrieveCheckoutSession,verifyStripeWebhook,StripePaymentError,type StripeFetch,type StripeSandboxConfig} from './stripe';

export interface StripeDeps {config:StripeSandboxConfig;fetch?:StripeFetch}
export type CheckoutStart=
 {kind:'redirect';url:string;orderId:string}|{kind:'paid';orderId:string}|
 {kind:'unavailable';reason:'NO_SESSION'|'NO_TAP'|'NO_OFFER'|'OFFER_ENDED'|'CURRENCY'|'OUT_OF_STOCK'|'BELOW_MINIMUM'};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export {toStripeMinor};

export async function startTapCheckout(deps:IdentityDeps,offers:OfferDeps,stripe:StripeDeps,sessionToken:string|null|undefined):Promise<CheckoutStart>{
 const me=await customerFromSession(deps,sessionToken);
 if(!me)return {kind:'unavailable',reason:'NO_SESSION'};
 if(!me.lastTap)return {kind:'unavailable',reason:'NO_TAP'};
 const tapSessionId=me.lastTap.tapSessionId;
 const prep=await deps.db.tenant(me.merchantId,async db=>{
  const existing=(await db.query<{id:string;status:string;checkout_url:string|null;live:boolean}>("SELECT id,status,checkout_url,expires_at>clock_timestamp()+interval '1 minute' AS live FROM meta_tap_orders WHERE tap_session_id=$1 AND status IN ('CREATED','PAID') FOR UPDATE",[tapSessionId])).rows[0];
  if(existing?.status==='PAID')return {kind:'paid',orderId:existing.id} as const;
  if(existing?.checkout_url&&existing.live)return {kind:'redirect',url:existing.checkout_url,orderId:existing.id} as const;
  if(existing)await db.query("UPDATE meta_tap_orders SET status='EXPIRED' WHERE id=$1",[existing.id]);
  const shown=(await db.query<{offer_id:string;product_id:string}>('SELECT offer_id,product_id FROM meta_offer_impressions WHERE tap_session_id=$1 AND link_id=$2',[tapSessionId,me.linkId])).rows[0];
  if(!shown)return {kind:'unavailable',reason:'NO_OFFER'} as const;
  // Re-quote now: the price paid is today's catalog price for the same approved offer, not the impression.
  const offer=approvedOffers(await offers.menu(db,me.merchantId)).find(c=>c.offerId===shown.offer_id);
  if(!offer)return {kind:'unavailable',reason:'OFFER_ENDED'} as const;
  const currency=offer.unitPrice.currency.toLowerCase();
  if(currency!=='thb'&&currency!=='usd')return {kind:'unavailable',reason:'CURRENCY'} as const;
  const amount=toStripeMinor(offer.unitPrice.amountMinor,offer.unitPrice.decimals);
  if(amount===null)return {kind:'unavailable',reason:'CURRENCY'} as const;
  if(amount<STRIPE_MINIMUM[currency])return {kind:'unavailable',reason:'BELOW_MINIMUM'} as const;
  if(offer.available<1)return {kind:'unavailable',reason:'OUT_OF_STOCK'} as const;
  const row=(await db.query<{id:string}>("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_tap_orders(merchant_id,link_id,tap_session_id,offer_id,product_id,currency,amount_minor,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,t,t+interval '40 minutes' FROM n RETURNING id",
   [me.merchantId,me.linkId,tapSessionId,offer.offerId,offer.productId,currency,amount.toString()])).rows[0];
  return {kind:'create',orderId:row.id,amountMinor:amount,currency:currency as 'thb'|'usd',productName:`${offer.emoji} ${offer.name} / ${offer.nameEn}`} as const;
 });
 if(prep.kind!=='create')return prep;
 const session=await createCheckoutSession(stripe.config,{orderId:prep.orderId,merchantId:me.merchantId,productName:prep.productName,amountMinor:prep.amountMinor,currency:prep.currency,
  successUrl:`${deps.publicOrigin}/meta/paid?o=${prep.orderId}`,cancelUrl:`${deps.publicOrigin}/meta/offer-page`,expiresAtSeconds:Math.floor(Date.now()/1000)+31*60},stripe.fetch);
 await deps.db.tenant(me.merchantId,db=>db.query('UPDATE meta_tap_orders SET stripe_checkout_id=$2,checkout_url=$3 WHERE id=$1 AND stripe_checkout_id IS NULL',[prep.orderId,session.id,session.url]));
 return {kind:'redirect',url:session.url!,orderId:prep.orderId};
}

export type PaidOutcome='PAID'|'ALREADY_PAID'|'DUPLICATE_EVENT'|'MISMATCH'|'UNKNOWN_ORDER';

/** Inside the shop's transaction: verify the Stripe facts against the row, mark PAID and take stock once. */
async function markPaid(db:pg.PoolClient,f:{orderId:string;paymentIntentId:string;amountMinor:bigint;currency:string;source:'webhook'|'lookup';eventId?:string}):Promise<PaidOutcome>{
 if(f.eventId&&!(await db.query('INSERT INTO meta_stripe_events(merchant_id,event_id,order_id) SELECT merchant_id,$2,id FROM meta_tap_orders WHERE id=$1 ON CONFLICT DO NOTHING',[f.orderId,f.eventId])).rowCount)return 'DUPLICATE_EVENT';
 const o=(await db.query<{status:string;amount_minor:string;currency:string;product_id:string;stripe_payment_intent_id:string|null}>('SELECT status,amount_minor::text,currency,product_id,stripe_payment_intent_id FROM meta_tap_orders WHERE id=$1 FOR UPDATE',[f.orderId])).rows[0];
 if(!o)return 'UNKNOWN_ORDER';
 if(o.status==='PAID')return 'ALREADY_PAID';
 if(BigInt(o.amount_minor)!==f.amountMinor||o.currency!==f.currency)return 'MISMATCH';
 const stock=(await db.query('UPDATE products SET stock=stock-1 WHERE id=$1 AND stock-reserved>=1',[o.product_id])).rowCount===1;
 if(stock)await db.query(STOCK_MOVE,[o.product_id,-1,'tap_paid','tap',f.orderId]);
 await db.query("UPDATE meta_tap_orders SET status='PAID',paid_at=clock_timestamp(),paid_source=$2,stripe_payment_intent_id=$3,stock_short=$4 WHERE id=$1",[f.orderId,f.source,f.paymentIntentId,!stock]);
 return 'PAID';
}

async function orderMerchant(deps:IdentityDeps,orderId:string):Promise<string|null>{
 if(!UUID.test(orderId))return null;
 return (await deps.db.query<{m:string|null}>('SELECT bitpos.meta_tap_order_merchant($1) AS m',[orderId])).rows[0]?.m??null;
}

/** Stripe webhook: signature over the raw body, then `payment_intent.succeeded` facts matched to our row. */
export async function applyStripeWebhook(deps:IdentityDeps,stripe:StripeDeps,rawBody:string,signature:string|undefined,nowSeconds=Math.floor(Date.now()/1000),onAgentConfirmed?:(merchantId:string,orderId:string)=>Promise<void>):Promise<PaidOutcome|'IGNORED'>{
 const event=verifyStripeWebhook(rawBody,signature,stripe.config.webhookSecret,nowSeconds);
 const fact=paymentFactFromEvent(event);
 if(!fact||fact.orderId!==fact.checkoutId)return 'IGNORED';
 const merchant=await orderMerchant(deps,fact.orderId);
 if(!merchant){
  // Not a tap order: an agent (MCP / Messenger) order paid with a Shared Payment Token.
  const agentMerchant=await agentOrderMerchant(deps.db,fact.orderId);
  if(!agentMerchant||agentMerchant!==fact.merchantId)return 'UNKNOWN_ORDER';
  const r=await applyAgentWebhook(deps.db,agentMerchant,fact);
  // Runs after the confirming transaction committed (e.g. the Messenger receipt).
  if(r==='CONFIRMED'&&onAgentConfirmed)await onAgentConfirmed(agentMerchant,fact.orderId).catch(()=>{});
  return r==='CONFIRMED'?'PAID':r==='ALREADY'?'ALREADY_PAID':r==='NOT_FOUND'?'UNKNOWN_ORDER':r;
 }
 if(merchant!==fact.merchantId)return 'UNKNOWN_ORDER';
 return deps.db.tenant(merchant,db=>markPaid(db,{orderId:fact.orderId,paymentIntentId:fact.paymentIntentId,amountMinor:fact.amountMinor,currency:fact.currency,source:'webhook',eventId:fact.eventId}));
}

export interface TapOrderView {status:string;amountMinor:string;currency:string;paidAt:string|null;stockShort:boolean}

/** Return page: asks Stripe directly (server to server) before believing the customer has paid. */
export async function reconcileTapOrder(deps:IdentityDeps,stripe:StripeDeps,sessionToken:string|null|undefined,orderId:string):Promise<TapOrderView|null>{
 const me=await customerFromSession(deps,sessionToken);
 if(!me||!UUID.test(orderId))return null;
 const read=(db:pg.PoolClient)=>db.query<{status:string;amount_minor:string;currency:string;paid_at:Date|null;stock_short:boolean;stripe_checkout_id:string|null}>('SELECT status,amount_minor::text,currency,paid_at,stock_short,stripe_checkout_id FROM meta_tap_orders WHERE id=$1 AND link_id=$2',[orderId,me.linkId]).then(r=>r.rows[0]);
 const view=(o:NonNullable<Awaited<ReturnType<typeof read>>>):TapOrderView=>({status:o.status,amountMinor:o.amount_minor,currency:o.currency,paidAt:o.paid_at?.toISOString()??null,stockShort:o.stock_short});
 const before=await deps.db.tenant(me.merchantId,read);
 if(!before)return null;
 if(before.status==='PAID'||!before.stripe_checkout_id)return view(before);
 const s=await retrieveCheckoutSession(stripe.config,before.stripe_checkout_id,stripe.fetch);
 if(!s.paid||s.orderId!==orderId||s.merchantId!==me.merchantId||!s.paymentIntentId)return view(before);
 return deps.db.tenant(me.merchantId,async db=>{
  await markPaid(db,{orderId,paymentIntentId:s.paymentIntentId!,amountMinor:s.amountMinor,currency:s.currency,source:'lookup'});
  return view((await read(db))!);
 });
}

export {StripePaymentError};
