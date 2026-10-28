// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {chargeSharedPaymentToken,paymentFactFromEvent,stripeSandboxFromEnv,verifyStripeWebhook,StripePaymentError,type AgentCharge} from '../apps/api/src/meta/stripe';

const config={secretKey:'sk_test_abc123',webhookSecret:'whsec_test123'};
const charge:AgentCharge={checkoutId:'chk_1',merchantId:'m1',orderId:'o1',quoteId:'q1',amountMinor:450n,currency:'usd',sharedPaymentToken:'spt_123'};
const pi=(over:Record<string,unknown>={})=>({object:'payment_intent',id:'pi_1',livemode:false,amount:450,currency:'usd',status:'succeeded',metadata:{bitpos_checkout:'chk_1'},...over});
const reply=(status:number,body:unknown)=>async()=>new Response(JSON.stringify(body),{status});
const code=(c:string)=>(e:unknown)=>e instanceof StripePaymentError&&e.code===c;
const sign=(raw:string,t:number,secret='whsec_test123')=>`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')}`;

test('configuration refuses live keys and missing webhook secrets',()=>{
 assert.throws(()=>stripeSandboxFromEnv({STRIPE_TEST_SECRET_KEY:'sk_live_abc',STRIPE_TEST_WEBHOOK_SECRET:'whsec_x'}),code('LIVE_MODE_REFUSED'));
 assert.throws(()=>stripeSandboxFromEnv({STRIPE_TEST_SECRET_KEY:'sk_test_abc'}),code('CONFIGURATION_REQUIRED'));
 assert.deepEqual(stripeSandboxFromEnv({STRIPE_TEST_SECRET_KEY:'rk_test_abc',STRIPE_TEST_WEBHOOK_SECRET:'whsec_x'}),{secretKey:'rk_test_abc',webhookSecret:'whsec_x'});
});

test('SPT charge sends the canonical quote amount with a stable idempotency key',async()=>{
 let seen:{url:string;init:RequestInit}|undefined;
 const r=await chargeSharedPaymentToken(config,charge,async(url,init)=>{seen={url,init};return new Response(JSON.stringify(pi()),{status:200});});
 assert.deepEqual(r,{outcome:'SUCCEEDED',paymentIntentId:'pi_1',declineCode:null});
 const form=new URLSearchParams(String(seen!.init.body));
 assert.equal(seen!.url,'https://api.stripe.com/v1/payment_intents');
 assert.equal(form.get('amount'),'450');assert.equal(form.get('currency'),'usd');assert.equal(form.get('confirm'),'true');
 assert.equal(form.get('payment_method_data[shared_payment_granted_token]'),'spt_123');
 assert.equal(form.get('metadata[bitpos_quote]'),'q1');
 assert.equal((seen!.init.headers as Record<string,string>)['Idempotency-Key'],'bitpos-meta-spt-chk_1');
});

test('SPT charge rejects responses that do not match the request or are live',async()=>{
 await assert.rejects(chargeSharedPaymentToken(config,charge,reply(200,pi({amount:449}))),code('RESPONSE_MISMATCH'));
 await assert.rejects(chargeSharedPaymentToken(config,charge,reply(200,pi({currency:'eur'}))),code('RESPONSE_MISMATCH'));
 await assert.rejects(chargeSharedPaymentToken(config,charge,reply(200,pi({livemode:true}))),code('LIVE_MODE_REFUSED'));
 await assert.rejects(chargeSharedPaymentToken(config,charge,reply(503,{})),code('PROVIDER_OUTCOME_UNKNOWN'));
 await assert.rejects(chargeSharedPaymentToken(config,charge,async()=>{throw new TypeError('reset');}),code('PROVIDER_OUTCOME_UNKNOWN'));
});

test('declines and invalid input never report success',async()=>{
 const declined=await chargeSharedPaymentToken(config,charge,reply(402,{error:{type:'card_error',decline_code:'insufficient_funds',payment_intent:{id:'pi_2'}}}));
 assert.deepEqual(declined,{outcome:'FAILED',paymentIntentId:'pi_2',declineCode:'insufficient_funds'});
 const action=await chargeSharedPaymentToken(config,charge,reply(200,pi({status:'requires_action'})));
 assert.equal(action.outcome,'FAILED');
 await assert.rejects(chargeSharedPaymentToken(config,{...charge,amountMinor:0n},reply(200,pi())),code('INVALID_AMOUNT'));
 await assert.rejects(chargeSharedPaymentToken(config,{...charge,currency:'USD'},reply(200,pi())),code('INVALID_AMOUNT'));
 await assert.rejects(chargeSharedPaymentToken(config,{...charge,sharedPaymentToken:'pm_card_visa'},reply(200,pi())),code('PAYMENT_FAILED'));
});

test('webhook signature: valid, tampered, stale, wrong secret and live events',()=>{
 const event={id:'evt_1',type:'payment_intent.succeeded',livemode:false,created:1,data:{object:{object:'payment_intent',id:'pi_1',status:'succeeded',amount_received:450,currency:'usd',metadata:{bitpos_merchant:'m1',bitpos_order:'o1',bitpos_quote:'q1',bitpos_checkout:'chk_1'}}}};
 const raw=JSON.stringify(event),now=1_800_000_000;
 const verified=verifyStripeWebhook(raw,sign(raw,now),config.webhookSecret,now);
 assert.deepEqual(paymentFactFromEvent(verified),{eventId:'evt_1',paymentIntentId:'pi_1',merchantId:'m1',orderId:'o1',quoteId:'q1',checkoutId:'chk_1',amountMinor:450n,currency:'usd'});
 assert.throws(()=>verifyStripeWebhook(raw.replace('450','45000'),sign(raw,now),config.webhookSecret,now),code('WEBHOOK_INVALID'));
 assert.throws(()=>verifyStripeWebhook(raw,sign(raw,now-301),config.webhookSecret,now),code('WEBHOOK_INVALID'));
 assert.throws(()=>verifyStripeWebhook(raw,sign(raw,now,'whsec_other'),config.webhookSecret,now),code('WEBHOOK_INVALID'));
 assert.throws(()=>verifyStripeWebhook(raw,undefined,config.webhookSecret,now),code('WEBHOOK_INVALID'));
 const live=JSON.stringify({...event,livemode:true});
 assert.throws(()=>verifyStripeWebhook(live,sign(live,now),config.webhookSecret,now),code('LIVE_MODE_REFUSED'));
 // Stripe may send several v1 signatures during secret rotation; one valid match is enough.
 assert.equal(verifyStripeWebhook(raw,`${sign(raw,now,'whsec_old')},v1=${sign(raw,now).split('v1=')[1]}`,config.webhookSecret,now).id,'evt_1');
});

test('payment facts ignore foreign events and refuse malformed succeeded intents',()=>{
 const base={id:'evt_2',livemode:false,created:1};
 assert.equal(paymentFactFromEvent({...base,type:'charge.refunded',data:{object:{}}}),null);
 assert.equal(paymentFactFromEvent({...base,type:'payment_intent.succeeded',data:{object:{object:'payment_intent',id:'pi_x',status:'succeeded',amount_received:100,currency:'usd',metadata:{}}}}),null);
 assert.throws(()=>paymentFactFromEvent({...base,type:'payment_intent.succeeded',data:{object:{object:'payment_intent',id:'pi_x',status:'processing',amount_received:100,currency:'usd',metadata:{}}}}),code('WEBHOOK_INVALID'));
});

test('Checkout Session: canonical amount, metadata on session and PaymentIntent, idempotent per order',async()=>{
 const {createCheckoutSession,retrieveCheckoutSession}=await import('../apps/api/src/meta/stripe');
 let seen:{url:string;init:RequestInit}|undefined;
 const session=(over:Record<string,unknown>={})=>({object:'checkout.session',id:'cs_test_a1',livemode:false,url:'https://checkout.stripe.com/c/pay/cs_test_a1',amount_total:5200,currency:'thb',status:'open',payment_status:'unpaid',payment_intent:null,metadata:{bitpos_order:'o-1',bitpos_merchant:'m-1'},...over});
 const req={orderId:'o-1',merchantId:'m-1',productName:'🥐 Croissant',amountMinor:5200n,currency:'thb' as const,successUrl:'https://shop.test/meta/paid?o=o-1',cancelUrl:'https://shop.test/meta/offer-page',expiresAtSeconds:1_800_000_000};
 const s=await createCheckoutSession(config,req,async(url,init)=>{seen={url,init};return new Response(JSON.stringify(session()),{status:200});});
 assert.equal(s.url,'https://checkout.stripe.com/c/pay/cs_test_a1');assert.equal(s.paid,false);
 const form=new URLSearchParams(String(seen!.init.body));
 assert.equal(form.get('line_items[0][price_data][unit_amount]'),'5200');assert.equal(form.get('line_items[0][price_data][currency]'),'thb');
 assert.equal(form.get('payment_intent_data[metadata][bitpos_order]'),'o-1');assert.equal(form.get('metadata[bitpos_checkout]'),'o-1');
 assert.equal((seen!.init.headers as Record<string,string>)['Idempotency-Key'],'bitpos-meta-checkout-o-1');
 await assert.rejects(createCheckoutSession(config,req,reply(200,session({amount_total:100}))),code('RESPONSE_MISMATCH'));
 await assert.rejects(createCheckoutSession(config,req,reply(200,session({livemode:true}))),code('LIVE_MODE_REFUSED'));
 await assert.rejects(createCheckoutSession(config,req,reply(200,session({url:'https://evil.example/pay'}))),code('RESPONSE_MISMATCH'));
 await assert.rejects(createCheckoutSession(config,{...req,amountMinor:0n},reply(200,session())),code('INVALID_AMOUNT'));
 const paid=await retrieveCheckoutSession(config,'cs_test_a1',reply(200,session({status:'complete',payment_status:'paid',payment_intent:{id:'pi_9'}})));
 assert.deepEqual([paid.paid,paid.paymentIntentId,paid.amountMinor],[true,'pi_9',5200n]);
 const unpaid=await retrieveCheckoutSession(config,'cs_test_a1',reply(200,session({status:'complete',payment_status:'unpaid'})));
 assert.equal(unpaid.paid,false);
 await assert.rejects(retrieveCheckoutSession(config,'cs_live_x',reply(200,session())),code('INVALID_AMOUNT'));
});

test('menu minor units convert exactly to Stripe hundredths or are refused',async()=>{
 const {toStripeMinor}=await import('../apps/api/src/meta/tap-checkout');
 assert.equal(toStripeMinor('800',4),8n,'USD 0.0800 is 8 cents, not 800');
 assert.equal(toStripeMinor('5000',4),50n);
 assert.equal(toStripeMinor('5200',2),5200n);
 assert.equal(toStripeMinor('52',0),5200n);
 assert.equal(toStripeMinor('805',4),null,'a fraction of a cent is never rounded');
 assert.equal(toStripeMinor('1',-1),null);
});
