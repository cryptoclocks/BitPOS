// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Stripe sandbox payments for BitPOS × Muse: charge an agent Shared Payment Token (SPT) for a canonical
// server quote, and verify Stripe webhooks. Test mode only. A client redirect or an agent's claim is never
// proof of payment: only a signature-verified webhook whose amount, currency and metadata match the quote is.
import {createHmac,timingSafeEqual} from 'node:crypto';

export interface StripeSandboxConfig {secretKey:string;webhookSecret:string;apiBase?:string;timeoutMs?:number}
export type StripeFetch=(input:string,init:RequestInit)=>Promise<Response>;
export class StripePaymentError extends Error {constructor(readonly code:'CONFIGURATION_REQUIRED'|'LIVE_MODE_REFUSED'|'INVALID_AMOUNT'|'PROVIDER_OUTCOME_UNKNOWN'|'PAYMENT_FAILED'|'RESPONSE_MISMATCH'|'WEBHOOK_INVALID',readonly detail?:string){super(code);}}

const MAX_MINOR=99999999n;
// Stripe amounts for THB and USD are in hundredths; menus may keep more decimals (e.g. USD with 4).
// meta_tap_orders / meta_agent_orders amounts are stored in these Stripe units so webhook and lookup facts compare exactly.
const STRIPE_DECIMALS=2;
// Stripe's minimum charge per currency, in Stripe units (USD $0.50, THB ฿10).
export const STRIPE_MINIMUM:Record<'thb'|'usd',bigint>={usd:50n,thb:1000n};

/** Menu minor units → Stripe minor units, or null when the price cannot be expressed exactly. */
export function toStripeMinor(amountMinor:string|bigint,decimals:number):bigint|null{
 if(!Number.isInteger(decimals)||decimals<0||decimals>18)return null;
 const v=BigInt(amountMinor);
 if(decimals<=STRIPE_DECIMALS)return v*10n**BigInt(STRIPE_DECIMALS-decimals);
 const f=10n**BigInt(decimals-STRIPE_DECIMALS);
 return v%f===0n?v/f:null;
}
const CURRENCY=/^[a-z]{3}$/;

export function stripeSandboxFromEnv(env:Record<string,string|undefined>):StripeSandboxConfig {
 const secretKey=env.STRIPE_TEST_SECRET_KEY,webhookSecret=env.STRIPE_TEST_WEBHOOK_SECRET;
 if(!secretKey||!webhookSecret)throw new StripePaymentError('CONFIGURATION_REQUIRED');
 if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey))throw new StripePaymentError('LIVE_MODE_REFUSED');
 if(!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret))throw new StripePaymentError('CONFIGURATION_REQUIRED');
 return {secretKey,webhookSecret};
}

export interface AgentCharge {
 /** Stable per checkout attempt; reused on retry so Stripe never charges twice. */
 checkoutId:string;merchantId:string;orderId:string;quoteId:string;
 /** Canonical quote total in the currency's minor unit, never a value supplied by the agent. */
 amountMinor:bigint;currency:string;sharedPaymentToken:string;
}
export interface AgentChargeResult {outcome:'SUCCEEDED'|'PROCESSING'|'FAILED';paymentIntentId:string|null;declineCode:string|null}

export async function chargeSharedPaymentToken(config:StripeSandboxConfig,charge:AgentCharge,fetchImpl:StripeFetch=fetch):Promise<AgentChargeResult>{
 if(charge.amountMinor<=0n||charge.amountMinor>MAX_MINOR||!CURRENCY.test(charge.currency))throw new StripePaymentError('INVALID_AMOUNT');
 if(!/^spt_[A-Za-z0-9_]+$/.test(charge.sharedPaymentToken))throw new StripePaymentError('PAYMENT_FAILED','invalid_token');
 const form=new URLSearchParams({amount:charge.amountMinor.toString(),currency:charge.currency,confirm:'true',
  'payment_method_data[shared_payment_granted_token]':charge.sharedPaymentToken,
  'metadata[bitpos_merchant]':charge.merchantId,'metadata[bitpos_order]':charge.orderId,'metadata[bitpos_quote]':charge.quoteId,'metadata[bitpos_checkout]':charge.checkoutId});
 return confirmIntent(config,form,`bitpos-meta-spt-${charge.checkoutId}`,charge,fetchImpl);
}

export interface SavedCardCharge {checkoutId:string;merchantId:string;orderId:string;quoteId:string;grantId:string;amountMinor:bigint;currency:string;customerId:string;paymentMethodId:string}
/** Auto-pay: charges the customer's saved card off-session for a server total, inside an allowance the server already checked.
 * A bank that asks for authentication answers FAILED (authentication_required); the caller then offers the normal Pay button. */
export async function chargeSavedCard(config:StripeSandboxConfig,charge:SavedCardCharge,fetchImpl:StripeFetch=fetch):Promise<AgentChargeResult>{
 if(charge.amountMinor<=0n||charge.amountMinor>MAX_MINOR||!CURRENCY.test(charge.currency))throw new StripePaymentError('INVALID_AMOUNT');
 if(!/^cus_[A-Za-z0-9]+$/.test(charge.customerId)||!/^pm_[A-Za-z0-9]+$/.test(charge.paymentMethodId))throw new StripePaymentError('PAYMENT_FAILED','invalid_card');
 const form=new URLSearchParams({amount:charge.amountMinor.toString(),currency:charge.currency,confirm:'true',off_session:'true',customer:charge.customerId,payment_method:charge.paymentMethodId,
  'metadata[bitpos_merchant]':charge.merchantId,'metadata[bitpos_order]':charge.orderId,'metadata[bitpos_quote]':charge.quoteId,'metadata[bitpos_checkout]':charge.checkoutId,'metadata[bitpos_autopay]':charge.grantId});
 return confirmIntent(config,form,`bitpos-meta-autopay-${charge.checkoutId}`,charge,fetchImpl);
}

async function confirmIntent(config:StripeSandboxConfig,form:URLSearchParams,idempotencyKey:string,charge:{amountMinor:bigint;currency:string;checkoutId:string},fetchImpl:StripeFetch):Promise<AgentChargeResult>{
 let res:Response;
 try{res=await fetchImpl(`${config.apiBase??'https://api.stripe.com'}/v1/payment_intents`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.timeoutMs??20000),
  headers:{Authorization:`Bearer ${config.secretKey}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey},body:form});}
 catch{throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');}
 let body:any;try{body=await res.json();}catch{throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');}
 if(res.status>=500)throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(!res.ok){
  // A card error still creates a failed PaymentIntent; anything else (bad token, limits) is a clean refusal.
  const pi=body?.error?.payment_intent;
  return {outcome:'FAILED',paymentIntentId:typeof pi?.id==='string'?pi.id:null,declineCode:String(body?.error?.decline_code??body?.error?.code??'payment_failed')};
 }
 if(body?.object!=='payment_intent'||typeof body.id!=='string')throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(body.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
 if(String(body.amount)!==charge.amountMinor.toString()||body.currency!==charge.currency||body.metadata?.bitpos_checkout!==charge.checkoutId)throw new StripePaymentError('RESPONSE_MISMATCH');
 if(body.status==='succeeded')return {outcome:'SUCCEEDED',paymentIntentId:body.id,declineCode:null};
 if(body.status==='processing')return {outcome:'PROCESSING',paymentIntentId:body.id,declineCode:null};
 return {outcome:'FAILED',paymentIntentId:body.id,declineCode:String(body.last_payment_error?.code??body.status)};
}

export interface StripeEvent {id:string;type:string;livemode:boolean;created:number;data:{object:any}}

/** Verifies `Stripe-Signature` (scheme v1, HMAC-SHA256 over `${t}.${rawBody}`) against the exact raw body bytes. */
export function verifyStripeWebhook(rawBody:string,signatureHeader:string|null|undefined,webhookSecret:string,nowSeconds:number,toleranceSeconds=300):StripeEvent{
 if(!signatureHeader||signatureHeader.length>2048)throw new StripePaymentError('WEBHOOK_INVALID','missing_signature');
 let timestamp:number|null=null;const signatures:string[]=[];
 for(const part of signatureHeader.split(',')){const i=part.indexOf('=');if(i<0)continue;const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();
  if(k==='t'&&/^\d{1,12}$/.test(v))timestamp=Number(v);else if(k==='v1'&&/^[0-9a-f]{64}$/.test(v))signatures.push(v);}
 if(timestamp===null||signatures.length===0)throw new StripePaymentError('WEBHOOK_INVALID','malformed_signature');
 if(Math.abs(nowSeconds-timestamp)>toleranceSeconds)throw new StripePaymentError('WEBHOOK_INVALID','stale_signature');
 const expected=createHmac('sha256',webhookSecret).update(`${timestamp}.${rawBody}`,'utf8').digest();
 if(!signatures.some(s=>timingSafeEqual(Buffer.from(s,'hex'),expected)))throw new StripePaymentError('WEBHOOK_INVALID','bad_signature');
 let event:any;try{event=JSON.parse(rawBody);}catch{throw new StripePaymentError('WEBHOOK_INVALID','bad_json');}
 if(typeof event?.id!=='string'||typeof event.type!=='string'||typeof event.data?.object!=='object')throw new StripePaymentError('WEBHOOK_INVALID','bad_event');
 if(event.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
 return event as StripeEvent;
}

export interface PaymentFact {eventId:string;paymentIntentId:string;merchantId:string;orderId:string;quoteId:string;checkoutId:string;amountMinor:bigint;currency:string}

/** Extracts a paid fact from `payment_intent.succeeded`; the caller must still match it to the stored quote inside its transaction. */
export function paymentFactFromEvent(event:StripeEvent):PaymentFact|null{
 if(event.type!=='payment_intent.succeeded')return null;
 const pi=event.data.object,m=pi?.metadata??{};
 if(pi?.object!=='payment_intent'||pi.status!=='succeeded'||!Number.isSafeInteger(pi.amount_received)||pi.amount_received<=0||!CURRENCY.test(String(pi.currency)))throw new StripePaymentError('WEBHOOK_INVALID','bad_payment_intent');
 for(const k of ['bitpos_merchant','bitpos_order','bitpos_quote','bitpos_checkout'])if(typeof m[k]!=='string'||!m[k])return null;
 return {eventId:event.id,paymentIntentId:pi.id,merchantId:m.bitpos_merchant,orderId:m.bitpos_order,quoteId:m.bitpos_quote,checkoutId:m.bitpos_checkout,amountMinor:BigInt(pi.amount_received),currency:pi.currency};
}

export interface CheckoutRequest {
 orderId:string;merchantId:string;productName:string;
 /** Quote the order was priced from; defaults to the order id (tap orders). */
 quoteId?:string;
 /** Re-quoted server price in minor units; never a client value. */
 amountMinor:bigint;currency:'thb'|'usd';successUrl:string;cancelUrl:string;expiresAtSeconds:number;
}
export interface CheckoutSession {id:string;url:string|null;paid:boolean;paymentIntentId:string|null;amountMinor:bigint;currency:string;orderId:string|null;merchantId:string|null}

async function stripeCall(config:StripeSandboxConfig,method:'GET'|'POST',path:string,form:URLSearchParams|null,idempotencyKey:string|null,fetchImpl:StripeFetch):Promise<any>{
 let res:Response;
 try{res=await fetchImpl(`${config.apiBase??'https://api.stripe.com'}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(config.timeoutMs??20000),
  headers:{Authorization:`Bearer ${config.secretKey}`,...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:form??undefined});}
 catch{throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');}
 let body:any;try{body=await res.json();}catch{throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');}
 if(res.status>=500)throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(!res.ok)throw new StripePaymentError('PAYMENT_FAILED',String(body?.error?.code??body?.error?.type??res.status));
 return body;
}
function checkoutView(body:any):CheckoutSession{
 if(body?.object!=='checkout.session'||typeof body.id!=='string'||!/^cs_test_[A-Za-z0-9]+$/.test(body.id))throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(body.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
 if(!Number.isSafeInteger(body.amount_total)||typeof body.currency!=='string')throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 const pi=typeof body.payment_intent==='string'?body.payment_intent:typeof body.payment_intent?.id==='string'?body.payment_intent.id:null;
 return {id:body.id,url:typeof body.url==='string'&&body.url.startsWith('https://checkout.stripe.com/')?body.url:null,
  paid:body.status==='complete'&&body.payment_status==='paid'&&pi!==null,paymentIntentId:pi,amountMinor:BigInt(body.amount_total),currency:body.currency,
  orderId:typeof body.metadata?.bitpos_order==='string'?body.metadata.bitpos_order:null,merchantId:typeof body.metadata?.bitpos_merchant==='string'?body.metadata.bitpos_merchant:null};
}

/** Hosted Stripe Checkout for one tap order; the same order id always maps to the same session. */
export async function createCheckoutSession(config:StripeSandboxConfig,req:CheckoutRequest,fetchImpl:StripeFetch=fetch):Promise<CheckoutSession>{
 if(req.amountMinor<=0n||req.amountMinor>MAX_MINOR)throw new StripePaymentError('INVALID_AMOUNT');
 const meta={bitpos_merchant:req.merchantId,bitpos_order:req.orderId,bitpos_quote:req.quoteId??req.orderId,bitpos_checkout:req.orderId};
 const form=new URLSearchParams({mode:'payment',client_reference_id:req.orderId,success_url:req.successUrl,cancel_url:req.cancelUrl,expires_at:String(req.expiresAtSeconds),
  'line_items[0][quantity]':'1','line_items[0][price_data][currency]':req.currency,'line_items[0][price_data][unit_amount]':req.amountMinor.toString(),'line_items[0][price_data][product_data][name]':req.productName.slice(0,250)});
 for(const [k,v] of Object.entries(meta)){form.set(`metadata[${k}]`,v);form.set(`payment_intent_data[metadata][${k}]`,v);}
 const session=checkoutView(await stripeCall(config,'POST','/v1/checkout/sessions',form,`bitpos-meta-checkout-${req.orderId}`,fetchImpl));
 if(!session.url||session.amountMinor!==req.amountMinor||session.currency!==req.currency||session.orderId!==req.orderId)throw new StripePaymentError('RESPONSE_MISMATCH');
 return session;
}

/** Server-side lookup used when the customer returns from Stripe; the redirect itself proves nothing. */
export async function retrieveCheckoutSession(config:StripeSandboxConfig,id:string,fetchImpl:StripeFetch=fetch):Promise<CheckoutSession>{
 if(!/^cs_test_[A-Za-z0-9]+$/.test(id))throw new StripePaymentError('INVALID_AMOUNT');
 return checkoutView(await stripeCall(config,'GET',`/v1/checkout/sessions/${id}`,null,null,fetchImpl));
}

export interface SetupView {id:string;url:string|null;complete:boolean;customerId:string|null;paymentMethodId:string|null;cardLabel:string|null;grantId:string|null;merchantId:string|null}
function setupView(body:any):SetupView{
 if(body?.object!=='checkout.session'||typeof body.id!=='string'||!/^cs_test_[A-Za-z0-9]+$/.test(body.id)||body.mode!=='setup')throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(body.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
 const si=typeof body.setup_intent==='object'&&body.setup_intent?body.setup_intent:null,pm=typeof si?.payment_method==='object'&&si.payment_method?si.payment_method:null;
 const pmId=typeof pm?.id==='string'?pm.id:typeof si?.payment_method==='string'?si.payment_method:null;
 const card=pm?.card?`${String(pm.card.brand??'card').slice(0,12)} ·${String(pm.card.last4??'').slice(0,4)}`:null;
 return {id:body.id,url:typeof body.url==='string'&&body.url.startsWith('https://checkout.stripe.com/')?body.url:null,
  complete:body.status==='complete'&&si?.status==='succeeded'&&pmId!==null,customerId:typeof body.customer==='string'?body.customer:null,paymentMethodId:pmId,cardLabel:card,
  grantId:typeof body.metadata?.bitpos_autopay==='string'?body.metadata.bitpos_autopay:null,merchantId:typeof body.metadata?.bitpos_merchant==='string'?body.metadata.bitpos_merchant:null};
}
/** Auto-pay: a Stripe customer and a hosted Checkout in setup mode that saves one card for off-session use. Same allowance → same session. */
export async function createSetupCheckout(config:StripeSandboxConfig,req:{grantId:string;merchantId:string;currency:string;successUrl:string;cancelUrl:string;description:string},fetchImpl:StripeFetch=fetch):Promise<SetupView&{customerId:string}>{
 const cus=await stripeCall(config,'POST','/v1/customers',new URLSearchParams({description:req.description.slice(0,200),'metadata[bitpos_merchant]':req.merchantId,'metadata[bitpos_autopay]':req.grantId}),`bitpos-meta-autopay-cus-${req.grantId}`,fetchImpl);
 if(cus?.object!=='customer'||typeof cus.id!=='string'||!/^cus_[A-Za-z0-9]+$/.test(cus.id))throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(cus.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
 // Payment methods come from the account's dashboard settings (Stripe no longer takes payment_method_types here); setup mode then needs the currency.
 if(!CURRENCY.test(req.currency))throw new StripePaymentError('INVALID_AMOUNT');
 const form=new URLSearchParams({mode:'setup',customer:cus.id,currency:req.currency,success_url:req.successUrl,cancel_url:req.cancelUrl,client_reference_id:req.grantId,
  'metadata[bitpos_merchant]':req.merchantId,'metadata[bitpos_autopay]':req.grantId,'setup_intent_data[metadata][bitpos_merchant]':req.merchantId,'setup_intent_data[metadata][bitpos_autopay]':req.grantId,
  'custom_text[submit][message]':req.description.slice(0,1000)});
 const v=setupView(await stripeCall(config,'POST','/v1/checkout/sessions',form,`bitpos-meta-autopay-setup-${req.grantId}`,fetchImpl));
 if(!v.url||v.grantId!==req.grantId||v.customerId!==cus.id)throw new StripePaymentError('RESPONSE_MISMATCH');
 return {...v,customerId:cus.id};
}
/** Server-side lookup of a setup session (the return redirect proves nothing): the saved card and its label. */
export async function retrieveSetupCheckout(config:StripeSandboxConfig,id:string,fetchImpl:StripeFetch=fetch):Promise<SetupView>{
 if(!/^cs_test_[A-Za-z0-9]+$/.test(id))throw new StripePaymentError('INVALID_AMOUNT');
 return setupView(await stripeCall(config,'GET',`/v1/checkout/sessions/${id}?expand[]=setup_intent.payment_method`,null,null,fetchImpl));
}

export interface Refund {id:string;status:string}
/** Full refund of a succeeded test PaymentIntent; the same order id always maps to the same refund. */
export async function refundPaymentIntent(config:StripeSandboxConfig,req:{paymentIntentId:string;amountMinor:bigint;orderId:string},fetchImpl:StripeFetch=fetch):Promise<Refund>{
 if(!/^pi_[A-Za-z0-9]+$/.test(req.paymentIntentId)||req.amountMinor<=0n||req.amountMinor>MAX_MINOR)throw new StripePaymentError('INVALID_AMOUNT');
 const form=new URLSearchParams({payment_intent:req.paymentIntentId,amount:req.amountMinor.toString(),'metadata[bitpos_order]':req.orderId});
 const body=await stripeCall(config,'POST','/v1/refunds',form,`bitpos-meta-refund-${req.orderId}`,fetchImpl);
 if(body?.object!=='refund'||typeof body.id!=='string'||!/^re_[A-Za-z0-9]+$/.test(body.id))throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(body.livemode===true)throw new StripePaymentError('LIVE_MODE_REFUSED');
 if(String(body.amount)!==req.amountMinor.toString()||body.payment_intent!==req.paymentIntentId)throw new StripePaymentError('RESPONSE_MISMATCH');
 if(!['succeeded','pending'].includes(body.status))throw new StripePaymentError('PAYMENT_FAILED',String(body.status));
 return {id:body.id,status:body.status};
}

export interface Payout {id:string;amountMinor:bigint;currency:string;status:string;arrivalDate:number;automatic:boolean}
export interface PayoutSummary {available:{amountMinor:bigint;currency:string}[];pending:{amountMinor:bigint;currency:string}[];payouts:Payout[]}
/** Balance and the last payouts of the test account (read only). Live-mode answers are refused. */
export async function listPayouts(config:StripeSandboxConfig,fetchImpl:StripeFetch=fetch):Promise<PayoutSummary>{
 const bal=await stripeCall(config,'GET','/v1/balance',null,null,fetchImpl);
 if(bal?.object!=='balance')throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 if(bal.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
 const list=await stripeCall(config,'GET','/v1/payouts?limit=10',null,null,fetchImpl);
 if(list?.object!=='list'||!Array.isArray(list.data))throw new StripePaymentError('PROVIDER_OUTCOME_UNKNOWN');
 const money=(x:any)=>({amountMinor:BigInt(Number.isSafeInteger(x?.amount)?x.amount:0),currency:String(x?.currency??'')});
 const payouts=list.data.map((p:any)=>{if(p?.livemode!==false)throw new StripePaymentError('LIVE_MODE_REFUSED');
  return {id:String(p.id),...money(p),status:String(p.status),arrivalDate:Number(p.arrival_date)||0,automatic:p.automatic===true};});
 return {available:(bal.available??[]).map(money),pending:(bal.pending??[]).map(money),payouts};
}
