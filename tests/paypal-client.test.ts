// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Unit tests (plan/05 U-CFG, U-MNY, U-TOK, U-HTTP, U-REQ, U-VER). No network: PayPal is a scripted fetch stub whose
// response shapes follow the real sandbox capture recorded in paypal-hackathon/evidence/phase0-spike.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {paypalConfig,PayPalError,PAYPAL_SANDBOX_API} from '../apps/api/src/paypal/config';
import {toCents,toPayPalValue,valueToCents,centsToValue} from '../apps/api/src/paypal/money';
import {paypalClient,createOrderBody,parseOrder,customId,invoiceId,type CreateOrderInput,type PayPalFetch} from '../apps/api/src/paypal/client';
import {verifyOrder,type ExpectedPayment} from '../apps/api/src/paypal/verify';

const env={PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_API_BASE_URL:PAYPAL_SANDBOX_API,PAYPAL_CLIENT_ID:'A'.repeat(80),PAYPAL_CLIENT_SECRET:'S'.repeat(80),PAYPAL_MERCHANT_ID:'7W75A4XNV2GZ4'};
const cfg=paypalConfig(env);
const M='33333333-3333-4333-8333-333333333333',O='0b5f6f1e-5c1a-4c39-9d43-1d2f0a7e9c01',C='033b4e71-aad3-47e9-b226-a0b5b2bf9fa8';
const input:CreateOrderInput={merchantId:M,orderId:O,checkoutId:C,requestId:'11111111-2222-4333-8444-555555555555',payeeMerchantId:'7W75A4XNV2GZ4',amountCents:900n,
 items:[{name:'Americano',quantity:1,unitCents:350n},{name:'Matcha',quantity:1,unitCents:550n}],description:'BitPOS PayPal Café · table 2',brandName:'BitPOS PayPal Café',locale:'en-US',
 returnUrl:'https://pay.example/pay/t?paypal=return',cancelUrl:'https://pay.example/pay/t?paypal=cancel'};

const json=(status:number,body:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','paypal-debug-id':'dbg123',...headers}});
const token=(expires=32400)=>json(200,{access_token:'tok-'+Math.random(),expires_in:expires,app_id:'APP-TEST'});
function order(over:{status?:string;capture?:Record<string,unknown>|null;unit?:Record<string,unknown>;id?:string}={}){
 const cap=over.capture===null?undefined:{id:'3NJ75207B63619939',status:'COMPLETED',amount:{currency_code:'USD',value:'9.00'},final_capture:true,custom_id:customId(M,O,C),invoice_id:invoiceId(C),
  seller_receivable_breakdown:{gross_amount:{currency_code:'USD',value:'9.00'},paypal_fee:{currency_code:'USD',value:'0.79'},net_amount:{currency_code:'USD',value:'8.21'}},...over.capture};
 return {id:over.id??'9GA10264K77259045',status:over.status??'COMPLETED',purchase_units:[{reference_id:O,custom_id:customId(M,O,C),invoice_id:invoiceId(C),amount:{currency_code:'USD',value:'9.00'},
  payee:{merchant_id:'7W75A4XNV2GZ4'},...(cap?{payments:{captures:[cap]}}:{}),...over.unit}],links:[{href:'https://www.sandbox.paypal.com/checkoutnow?token=9GA10264K77259045',rel:'payer-action'}]};
}
/** Scripted PayPal: each call takes the next response (or throws); records what was sent. */
function stub(...responses:(Response|Error|(()=>Response))[]){
 const calls:{url:string;init:RequestInit}[]=[];
 const f:PayPalFetch=async(url,init)=>{calls.push({url,init});const next=responses.shift();if(!next)throw new Error('unexpected call '+url);if(next instanceof Error)throw next;return typeof next==='function'?next():next;};
 return {f,calls};
}
const header=(init:RequestInit,name:string)=>(init.headers as Record<string,string>)[name];
const parse=(o:object)=>parseOrder(o,'dbg');
const expected:ExpectedPayment={paypalOrderId:'9GA10264K77259045',merchantId:M,orderId:O,checkoutId:C,amountCents:900n,payeeMerchantId:'7W75A4XNV2GZ4'};

test('U-CFG: sandbox only, every credential required, live refused before parsing',()=>{
 assert.equal(cfg.apiBase,PAYPAL_SANDBOX_API);assert.equal(cfg.webhookId,null);assert.equal(cfg.timeoutMs,15000);
 const code=(e:NodeJS.ProcessEnv)=>{try{paypalConfig(e);return 'OK';}catch(x){return (x as PayPalError).code;}};
 assert.equal(code({...env,PAYPAL_API_BASE_URL:'https://api-m.paypal.com'}),'LIVE_MODE_REFUSED');
 assert.equal(code({...env,PAYPAL_ENVIRONMENT:'live'}),'LIVE_MODE_REFUSED');
 for(const k of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_MERCHANT_ID','PAYPAL_ENVIRONMENT'])assert.equal(code({...env,[k]:''}),'CONFIGURATION_REQUIRED',k);
 assert.equal(code({...env,PAYPAL_MERCHANT_ID:'not-an-id'}),'CONFIGURATION_REQUIRED');
 assert.equal(paypalConfig({...env,PAYPAL_WEBHOOK_ID:'8PT597110X687430LKGECATA'}).webhookId,'8PT597110X687430LKGECATA');
});

test('U-MNY: exact cents only, two-decimal strings both ways',()=>{
 assert.equal(toPayPalValue(450n,2),'4.50');assert.equal(toPayPalValue(45000n,4),'4.50');assert.equal(toPayPalValue('5',0),'5.00');
 assert.equal(toPayPalValue(45001n,4),null,'sub-cent price cannot be charged exactly');
 assert.equal(toCents(0n,2),null);assert.equal(toCents(-1n,2),null);assert.equal(toCents(1_000_001n,2),null);assert.equal(toCents('x',2),null);assert.equal(toCents(1n,19),null);
 assert.equal(centsToValue(1n),'0.01');assert.equal(centsToValue(1_000_000n),'10000.00');assert.throws(()=>centsToValue(0n));
 assert.equal(valueToCents('4.50'),450n);assert.equal(valueToCents('0.65'),65n);
 for(const bad of ['4.5','4.500','04.50','-4.50','4,50',' 4.50','1e2',4.5,null])assert.equal(valueToCents(bad),null,String(bad));
});

test('U-REQ: create body carries canonical amount, attribution, payee and no shipping; items only when they add up',()=>{
 const b=createOrderBody(input) as any;const pu=b.purchase_units[0];
 assert.equal(b.intent,'CAPTURE');assert.equal(pu.amount.value,'9.00');assert.equal(pu.amount.breakdown.item_total.value,'9.00');assert.equal(pu.items.length,2);
 assert.equal(pu.reference_id,O);assert.equal(pu.custom_id,`bitpos:v1:${M}:${O}:${C}`);assert.equal(pu.invoice_id,'BP033b4e71aad347e9b226a0b5b2bf9fa8');assert.ok(pu.custom_id.length<=255&&pu.invoice_id.length<=127);
 assert.deepEqual(pu.payee,{merchant_id:'7W75A4XNV2GZ4'});assert.equal(b.payment_source.paypal.experience_context.shipping_preference,'NO_SHIPPING');assert.equal(b.payment_source.paypal.experience_context.user_action,'PAY_NOW');
 const loose=createOrderBody({...input,items:[{name:'Americano',quantity:1,unitCents:350n}]}) as any;
 assert.equal(loose.purchase_units[0].items,undefined);assert.equal(loose.purchase_units[0].amount.breakdown,undefined);assert.equal(loose.purchase_units[0].amount.value,'9.00');
});

test('U-TOK + U-REQ: token cached until expiry−60s, request ids per operation, Prefer representation',async()=>{
 let t=0;const {f,calls}=stub(token(120),json(200,order({status:'PAYER_ACTION_REQUIRED',capture:null})),json(201,order()),token(120),json(200,order()));
 const c=paypalClient(cfg,f,()=>t);
 const created=await c.createOrder(input);assert.equal(created.status,'PAYER_ACTION_REQUIRED');assert.equal(created.payerActionUrl,'https://www.sandbox.paypal.com/checkoutnow?token=9GA10264K77259045');assert.equal(created.debugId,'dbg123');
 t=59_000;await c.captureOrder('9GA10264K77259045','cap-req-1');
 t=60_001;await c.getOrder('9GA10264K77259045');
 assert.equal(calls.filter(x=>x.url.endsWith('/v1/oauth2/token')).length,2,'refreshed only after expiry−60s');
 const create=calls[1],capture=calls[2];
 assert.equal(header(create.init,'PayPal-Request-Id'),input.requestId);assert.equal(header(capture.init,'PayPal-Request-Id'),'cap-req-1');assert.notEqual(input.requestId,'cap-req-1');
 assert.equal(header(create.init,'Prefer'),'return=representation');assert.equal(create.init.redirect,'error');assert.ok(create.init.signal);
 assert.match(String(header(calls[0].init,'Authorization')),/^Basic /);assert.equal(header(calls[4].init,'PayPal-Request-Id'),undefined,'GET has no request id');
});

test('U-TOK: a 401 on an API call refreshes the token once, keeping the same request id',async()=>{
 const {f,calls}=stub(token(),json(401,{name:'AUTHENTICATION_FAILURE'}),token(),json(201,order()));
 const o=await paypalClient(cfg,f).captureOrder('9GA10264K77259045','cap-req-1');assert.equal(o.status,'COMPLETED');
 assert.deepEqual(calls.filter(x=>x.url.includes('/capture')).map(x=>header(x.init,'PayPal-Request-Id')),['cap-req-1','cap-req-1']);
 const twice=stub(token(),json(401,{}),token(),json(401,{}));
 await assert.rejects(paypalClient(cfg,twice.f).getOrder('9GA10264K77259045'),(e:PayPalError)=>e.code==='AUTH_FAILED');
 await assert.rejects(paypalClient(cfg,stub(json(401,{error:'invalid_client'})).f).getOrder('9GA10264K77259045'),(e:PayPalError)=>e.code==='AUTH_FAILED');
});

test('U-HTTP: network failure, timeout, 429 and 5xx are OUTCOME_UNKNOWN; 4xx is REJECTED with the PayPal issue',async()=>{
 const outcome=async(r:Response|Error)=>{try{await paypalClient(cfg,stub(token(),r).f).captureOrder('9GA10264K77259045','r');return 'OK';}catch(e){return (e as PayPalError).code+':'+((e as PayPalError).issue??'');}};
 assert.equal(await outcome(new TypeError('fetch failed')),'OUTCOME_UNKNOWN:');
 assert.equal(await outcome(new DOMException('timeout','TimeoutError')),'OUTCOME_UNKNOWN:');
 assert.equal(await outcome(json(429,{})),'OUTCOME_UNKNOWN:');assert.equal(await outcome(json(503,{})),'OUTCOME_UNKNOWN:');
 assert.equal(await outcome(json(422,{name:'UNPROCESSABLE_ENTITY',details:[{issue:'DUPLICATE_INVOICE_ID'}]})),'REJECTED:DUPLICATE_INVOICE_ID');
 assert.equal(await outcome(json(422,{name:'UNPROCESSABLE_ENTITY',details:[{issue:'ORDER_ALREADY_CAPTURED'}]})),'REJECTED:ORDER_ALREADY_CAPTURED');
 assert.equal(await outcome(json(404,{name:'RESOURCE_NOT_FOUND'})),'REJECTED:RESOURCE_NOT_FOUND');
 assert.equal(await outcome(new Response('not json',{status:200})),'RESPONSE_INVALID:');
 assert.equal(await outcome(json(201,{id:'bad id!',status:'COMPLETED'})),'RESPONSE_INVALID:');
 assert.equal(await outcome(new Response('x'.repeat(300*1024),{status:200})),'RESPONSE_TOO_LARGE:');
 const e=await paypalClient(cfg,stub(token(),json(422,{details:[{issue:'INSTRUMENT_DECLINED'}]})).f).captureOrder('9GA10264K77259045','r').then(()=>assert.fail('expected rejection'),x=>x as PayPalError);
 assert.equal(e.debugId,'dbg123');assert.equal(e.httpStatus,422);
 await assert.rejects(paypalClient(cfg,stub().f).getOrder('../../v1/oauth2/token'),(x:PayPalError)=>x.code==='RESPONSE_INVALID','ids are validated before building a URL');
});

test('U-VER: the recorded sandbox capture verifies; capture replays (201 with the same capture) verify the same',()=>{
 const v=verifyOrder(expected,parse(order()));assert.equal(v.state,'COMPLETED');
 if(v.state==='COMPLETED'){assert.equal(v.capture.id,'3NJ75207B63619939');assert.equal(v.capture.grossCents,900n);assert.equal(v.capture.feeCents,79n);assert.equal(v.capture.netCents,821n);}
 assert.equal(verifyOrder(expected,parse(order({status:'APPROVED',capture:null}))).state,'NONE');
 assert.equal(verifyOrder(expected,parse(order({capture:{status:'PENDING',final_capture:false,status_details:{reason:'PENDING_REVIEW'}}}))).state,'PENDING');
 assert.equal(verifyOrder(expected,parse(order({capture:{status:'DECLINED'}}))).state,'DECLINED');
 assert.equal(verifyOrder(expected,parse(order({capture:{status:'REFUNDED'}}))).state,'REFUNDED');
});

test('U-VER: every attribution fact is enforced, gross not net',()=>{
 const reasons=(o:object,e:ExpectedPayment=expected)=>{const v=verifyOrder(e,parse(o));return v.state==='MISMATCH'?v.reasons:[];};
 assert.deepEqual(reasons(order({id:'8KM46435KC381573L'})),['ORDER_ID']);
 assert.deepEqual(reasons(order({unit:{reference_id:'other'}})),['REFERENCE_ID']);
 assert.deepEqual(reasons(order({unit:{custom_id:customId(M,O,'other')}})),['CUSTOM_ID']);
 assert.deepEqual(reasons(order({unit:{invoice_id:'BPother'}})),['INVOICE_ID']);
 assert.deepEqual(reasons(order({unit:{payee:{merchant_id:'YL65Q7MRPFC34'}}})),['PAYEE']);
 assert.deepEqual(reasons(order({unit:{amount:{currency_code:'USD',value:'8.99'}}})),['ORDER_AMOUNT']);
 assert.deepEqual(reasons(order({capture:{amount:{currency_code:'USD',value:'0.90'}}})),['CAPTURE_AMOUNT']);
 assert.deepEqual(reasons(order({capture:{amount:{currency_code:'THB',value:'9.00'}}})),['CAPTURE_AMOUNT']);
 assert.deepEqual(reasons(order({capture:{seller_receivable_breakdown:{gross_amount:{currency_code:'USD',value:'9.01'}}}})),['GROSS_AMOUNT']);
 assert.deepEqual(reasons(order({capture:{custom_id:'bitpos:v1:x'}})),['CAPTURE_CUSTOM_ID']);
 assert.deepEqual(reasons(order({capture:{final_capture:false}})),['NOT_FINAL']);
 assert.deepEqual(reasons(order(),{...expected,amountCents:901n}),['ORDER_AMOUNT','CAPTURE_AMOUNT','GROSS_AMOUNT']);
 assert.deepEqual(reasons(order({capture:{seller_receivable_breakdown:{gross_amount:{currency_code:'USD',value:'9.00'},net_amount:{currency_code:'USD',value:'1.00'}}}})),[],'net after fees is irrelevant');
 const two=order();(two.purchase_units[0] as any).payments.captures.push({...(two.purchase_units[0] as any).payments.captures[0],id:'60868501X2803334W'});
 assert.deepEqual(reasons(two),['MULTIPLE_CAPTURES']);
 const units=order();units.purchase_units.push(units.purchase_units[0]);assert.ok(reasons(units).includes('PURCHASE_UNITS'));
});

