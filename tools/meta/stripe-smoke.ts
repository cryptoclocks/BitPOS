// Meta hackathon work (2026-10-26..11-04).
// Stripe test-mode feasibility probe: account country, a normal card charge, and an agent
// Shared Payment Token (SPT) charge. Refuses anything but a test key; never prints the key.
// Key file (outside the repo): ~/.bitpos-meta/stripe-test.env containing STRIPE_TEST_SECRET_KEY=sk_test_...
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chargeSharedPaymentToken} from '../../apps/api/src/meta/stripe';

const file=process.env.BITPOS_STRIPE_TEST_ENV??join(homedir(),'.bitpos-meta','stripe-test.env');
const key=readFileSync(file,'utf8').match(/^STRIPE_TEST_SECRET_KEY=(\S+)$/m)?.[1];
if(!key||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))throw Error('STRIPE_TEST_SECRET_KEY must be a test-mode key (sk_test_ or rk_test_)');

async function stripe(method:'GET'|'POST',path:string,form:Record<string,string>={}){
 const res=await fetch(`https://api.stripe.com${path}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/x-www-form-urlencoded',...(method==='POST'?{'Idempotency-Key':crypto.randomUUID()}:{})},
  body:method==='POST'?new URLSearchParams(form):undefined});
 const body=await res.json() as any;
 return {status:res.status,body};
}
function show(label:string,r:{status:number;body:any},pick:(b:any)=>unknown){
 console.log(label,r.status,JSON.stringify(r.status<300?pick(r.body):{error:r.body?.error?.code??r.body?.error?.type,message:r.body?.error?.message}));
}

const account=await stripe('GET','/v1/account');
show('account',account,b=>({country:b.country,default_currency:b.default_currency,livemode:false}));
const currency=String(account.body?.default_currency??'thb');
const amount=currency==='thb'?'6500':'500';

const card=await stripe('POST','/v1/payment_intents',{amount,currency,'automatic_payment_methods[enabled]':'true','automatic_payment_methods[allow_redirects]':'never',payment_method:'pm_card_visa',confirm:'true','metadata[probe]':'bitpos-meta-card'});
show('card PaymentIntent',card,b=>({id:b.id,status:b.status,amount:b.amount,currency:b.currency,livemode:b.livemode}));

const spt=await stripe('POST','/v1/test_helpers/shared_payment/granted_tokens',{payment_method:'pm_card_visa','usage_limits[currency]':currency,'usage_limits[max_amount]':amount,'usage_limits[expires_at]':String(Math.floor(Date.now()/1000)+3600)});
show('SPT test helper',spt,b=>({id:b.id,object:b.object}));
if(spt.status<300){
 // Charge through the production module so the real response shape is checked, then retry with the same checkout id.
 const job={checkoutId:randomUUID(),merchantId:'probe-merchant',orderId:'probe-order',quoteId:'probe-quote',amountMinor:BigInt(amount),currency,sharedPaymentToken:spt.body.id};
 const first=await chargeSharedPaymentToken({secretKey:key,webhookSecret:'whsec_unused'},job);
 console.log('SPT via module',JSON.stringify(first));
 const retry=await chargeSharedPaymentToken({secretKey:key,webhookSecret:'whsec_unused'},job);
 console.log('SPT retry same checkout',JSON.stringify(retry),retry.paymentIntentId===first.paymentIntentId?'(same PaymentIntent: no double charge)':'(DIFFERENT PaymentIntent)');
}

// Hosted Checkout through the production module, in THB, as the tap page does.
const {createCheckoutSession,retrieveCheckoutSession}=await import('../../apps/api/src/meta/stripe');
const orderId=randomUUID();
const checkout=await createCheckoutSession({secretKey:key,webhookSecret:'whsec_unused'},{orderId,merchantId:'probe-merchant',productName:'🥐 ครัวซองต์ / Croissant (probe)',amountMinor:5200n,currency:'thb',successUrl:`https://example.test/meta/paid?o=${orderId}`,cancelUrl:'https://example.test/meta/offer-page',expiresAtSeconds:Math.floor(Date.now()/1000)+31*60});
console.log('checkout session',JSON.stringify({id:checkout.id,amount:checkout.amountMinor.toString(),currency:checkout.currency,paid:checkout.paid,url:checkout.url}));
const looked=await retrieveCheckoutSession({secretKey:key,webhookSecret:'whsec_unused'},checkout.id);
console.log('checkout lookup',JSON.stringify({paid:looked.paid,orderId:looked.orderId===orderId}));
