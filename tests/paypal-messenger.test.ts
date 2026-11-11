// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Messenger ordering (apps/api/src/paypal/messenger.ts): signed webhook → scripted AI cart → priced table bill →
// "Pay with PayPal" card → PayPal capture verified (in-memory Sandbox fake) → one "paid" reply. No AI or Meta call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {validSignature,messengerConfig} from '../apps/api/src/paypal/messenger';
import {setupPayPalShop} from './paypal-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));

test('U-MSG: signature check and configuration',()=>{
 const raw=Buffer.from('{"object":"page"}');const sig='sha256='+createHmac('sha256','s3cret').update(raw).digest('hex');
 assert.equal(validSignature('s3cret',raw,sig),true);
 assert.equal(validSignature('other',raw,sig),false);
 assert.equal(validSignature('s3cret',Buffer.from('{"object":"page" }'),sig),false,'any changed byte fails');
 assert.equal(validSignature('s3cret',raw,undefined),false);
 assert.equal(messengerConfig({}),null,'unconfigured: route answers 503, nothing runs');
 assert.equal(messengerConfig({BITPOS_PAYPAL_MESSENGER_PAGE_TOKEN:'p',BITPOS_PAYPAL_MESSENGER_APP_SECRET:'s',BITPOS_PAYPAL_MESSENGER_VERIFY_TOKEN:'v',BITPOS_PAYPAL_MESSENGER_TABLE_ENTRY:'short'}),null);
});

test('I-MSG: a Messenger message becomes a PayPal-payable table bill; paid reply only after verified capture; duplicates and forgeries do nothing',integration,async()=>{
 const s=await setupPayPalShop();const f=s.f;
 assert.equal((await f.command(f.b.id,{type:'CAPABILITIES',capabilities:['promotion_playlist_v1']})).result.ok,true);
 const entry=(await f.tenant(f.merchant,db=>db.query('SELECT e.entry_token FROM table_entries e JOIN devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id AND d.table_id=e.table_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation WHERE e.merchant_id=$1 AND e.device_id=$2',[f.merchant,f.b.id]))).rows[0].entry_token as string;
 Object.assign(process.env,{BITPOS_PAYPAL_MESSENGER_PAGE_TOKEN:'page-token-test',BITPOS_PAYPAL_MESSENGER_APP_SECRET:'app-secret-test',BITPOS_PAYPAL_MESSENGER_VERIFY_TOKEN:'verify-test',BITPOS_PAYPAL_MESSENGER_TABLE_ENTRY:entry});
 const m=await import('../apps/api/src/paypal/messenger');
 const sent:{to:string;message:any}[]=[];m.setMessengerSender(async(to,message)=>{sent.push({to,message});});
 const asked:string[]=[];
 m.setMessengerInterpreter(async(text,products)=>{asked.push(text);if(/sugar/.test(text))return {kind:'clarification',message:'Sugar options are not available. Order without sugar?'} as any;return {kind:'proposal',items:[{productId:products.find(p=>p.id===f.product)!.id,qty:2}],collection:'table'} as any;});
 const {server}=await import('../apps/api/src/index');if(!server.listening){server.listen(0,'127.0.0.1');await once(server,'listening');}
 const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 const post=(body:unknown,secret='app-secret-test')=>{const raw=JSON.stringify(body);return fetch(origin+'/paypal/messenger/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')},body:raw});};
 const msg=(mid:string,text:string,sender='1234567890')=>({object:'page',entry:[{messaging:[{sender:{id:sender},message:{mid,text}}]}]});
 const run=randomUUID().slice(0,8);const id=(k:string)=>`m.${run}.${k}`;
 const until=async(n:number)=>{for(let i=0;i<100&&sent.length<n;i++)await delay(20);assert.equal(sent.length,n,JSON.stringify(sent));};
 try{
  const hs=await fetch(origin+'/paypal/messenger/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=abc123');assert.equal(await hs.text(),'abc123');
  assert.equal((await fetch(origin+'/paypal/messenger/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123')).status,403);
  assert.equal((await post(msg(id('forged'),'two coffees'),'wrong-secret')).status,401,'unsigned/forged events are refused');
  assert.equal(asked.length,0);
  assert.equal((await post(msg(id('1'),'two coffees please'))).status,200);await until(1);
  const card=sent[0].message.attachment.payload.elements[0];
  assert.equal(sent[0].to,'1234567890');assert.match(card.title,/^Cart · 2 items · USD /);
  assert.equal(card.buttons[0].title,'Pay with PayPal');assert.match(card.subtitle,/pay within \d+ min$/,'the payment window is shown');const token=card.buttons[0].url.split('/pay/')[1];
  const bill=(await f.tenant(f.merchant,db=>db.query('SELECT id,status FROM orders WHERE merchant_id=$1 AND access_token=$2',[f.merchant,token]))).rows[0];
  assert.equal(bill.status,'AWAITING_WALLET','a priced, unpaid bill routed like any table order');
  assert.equal((await post(msg(id('1'),'two coffees please'))).status,200);await delay(200);
  assert.equal(sent.length,1,'a redelivered message (same id) places no second order');
  assert.equal(Number((await f.tenant(f.merchant,db=>db.query("SELECT count(*) FROM orders WHERE merchant_id=$1 AND created_at>now()-interval '1 minute'",[f.merchant]))).rows[0].count),1);
  assert.equal(await m.notifyPaidMessenger(),0,'no paid reply before PayPal capture');
  await post(msg(id('2'),'latte with sugar','222333444'));await until(2);
  assert.match(sent[1].message.text,/Sugar options/,'clarifications are relayed, no bill');
  // Pay through the normal verified PayPal flow.
  const c=await s.checkout.createPayPalOrder(token);s.pp.approve(c.paypalOrderId!);
  assert.equal((await s.checkout.capturePayPalOrder(token,c.paypalOrderId!)).status,'paid');
  assert.equal(await m.notifyPaidMessenger(),1);assert.equal(sent.length,3);
  assert.match(sent[2].message.text,/^Paid with PayPal ✓ Your order is sent to the kitchen for /);assert.equal(sent[2].to,'1234567890');
  assert.equal(await m.notifyPaidMessenger(),0,'exactly one paid reply');
 }finally{m.setMessengerSender(null);m.setMessengerInterpreter(null);await new Promise(r=>server.close(r));}
});
