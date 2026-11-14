// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// AI spending pass through the API, against the in-memory contract (same rules as the Rust contract; the real
// testnet run is near-hackathon/evidence/e2e-pass-*.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupNearShop as setup,ALICE,SHOP_ACCOUNT} from './near-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const code=(c:string,status?:number)=>(e:Error&{status?:number;code?:string})=>(e.code===c||e.message===c)&&(status===undefined||e.status===status);

test('P-01: a 1-hour pass lets the AI agent pay an exact bill; the order is PAID once and the customer is the payer',integration,async()=>{
 const {near,bill,state,events,bills,dismiss}=await setup();const passes=await import('../apps/api/src/near/passes');
 const b=await bill(2);await bills.createNearBill(b.access_token);
 const pass=await passes.createPass(b.access_token,{wallet:ALICE,ttl:'1h',cap:'20',maxBill:'10'});
 assert.equal(pass.state,'ACTIVE');assert.equal(pass.balance,'20.00');assert.equal(pass.merchant,SHOP_ACCOUNT);assert.equal(pass.agent,'agent.fake.testnet');
 const paid=await passes.passPay(b.access_token,ALICE,pass.passId) as Awaited<ReturnType<typeof passes.passPay>>&{status:string;payer:string|null};
 assert.equal(paid.agent.decision,'pay');assert.equal(paid.agent.proof.mode,'sample');
 assert.equal(paid.status,'paid');assert.equal(paid.payer,ALICE,'refunds would go to the customer, never to the agent');assert.equal(paid.pass.balance,'14.60');assert.equal(paid.pass.billsPaid,1);
 assert.equal((await state(b.id)).order,'PAID');assert.equal((await state(b.id)).settlements,1);
 assert.deepEqual(await events(b.id),['BILL_OPENED','CHAIN_CHECK','PAYMENT_RELAYED','SETTLED'],'the agent decision is recorded before the payment');
 await assert.rejects(passes.passPay(b.access_token,ALICE,pass.passId),code('NEAR_BILL_NOT_OPEN',409),'a paid bill is never paid twice');
 // per-bill limit: a 4-item bill (10.80) is over the 10.00 limit
 await dismiss();const big=await bill(4);await bills.createNearBill(big.access_token);
 await assert.rejects(passes.passPay(big.access_token,ALICE,pass.passId),code('NEAR_PASS_BILL_LIMIT',409));
 assert.equal(near.calls.filter(c=>c==='passPay').length,1,'refused before any transaction');
});

test('P-02: refund rules — an unserved witness bill pays the customer back; closing returns the rest; then the agent is refused',integration,async()=>{
 const {near,clock,bill,state,bills,witness}=await setup();const passes=await import('../apps/api/src/near/passes');
 await witness();const b=await bill(1);await bills.createNearBill(b.access_token);
 const pass=await passes.createPass(b.access_token,{wallet:ALICE,ttl:'1d',cap:'20',maxBill:'10'});
 const held=await passes.passPay(b.access_token,ALICE,pass.passId) as {status:string};
 assert.equal(held.status,'escrow');assert.equal((await state(b.id)).order,'AWAITING_WALLET');
 clock.now+=121_000;
 const back=await bills.reclaimBill(b.access_token);
 assert.equal(back.status,'refunded');assert.equal(near.bills.get(SHOP_ACCOUNT+':'+back.billId)!.payer,ALICE);
 const closed=await passes.closePass(b.access_token,ALICE,pass.passId);
 assert.equal(closed.state,'CLOSED');assert.equal(closed.balance,'0.00');
 const again=await bills.createNearBill(b.access_token);assert.equal(again.status,'awaiting_payment');
 await assert.rejects(passes.passPay(b.access_token,ALICE,pass.passId),code('NEAR_PASS_CLOSED',409));
});

test('P-03: lengths are only 30m/1h/1d/1w/1mo; an expired pass cannot spend and anyone may close it for the owner',integration,async()=>{
 const {clock,bill,bills}=await setup();const passes=await import('../apps/api/src/near/passes');
 const b=await bill(1);await bills.createNearBill(b.access_token);
 const pass=await passes.createPass(b.access_token,{wallet:ALICE,ttl:'30m',cap:'5',maxBill:'5'});
 assert.equal(pass.expiresAtMs-pass.createdAtMs,1_800_000);
 await assert.rejects(passes.createPass(b.access_token,{wallet:ALICE,ttl:'1h',cap:'60',maxBill:'5'}),code('NEAR_PASS_LIMIT_INVALID',422),'cap above 50 tUSD');
 await assert.rejects(passes.createPass(b.access_token,{wallet:ALICE,ttl:'1h',cap:'5',maxBill:'6'}),code('NEAR_PASS_LIMIT_INVALID',422),'per-bill above cap');
 clock.now+=1_800_001;
 await assert.rejects(passes.passPay(b.access_token,ALICE,pass.passId),code('NEAR_PASS_EXPIRED',409));
 const closed=await passes.closePass(b.access_token,ALICE,pass.passId);
 assert.equal(closed.state,'CLOSED');
});

test('P-04: the agent reads the bill and the guest rule first; a decline moves no money, and an unreadable model answer is a decline',integration,async()=>{
 const {near,bill,state,bills}=await setup();const passes=await import('../apps/api/src/near/passes');const agent=await import('../apps/api/src/near/agent');
 const b=await bill(2);await bills.createNearBill(b.access_token);
 const pass=await passes.createPass(b.access_token,{wallet:ALICE,ttl:'1h',cap:'20',maxBill:'10'});
 // deterministic: a stub model that declines
 agent.setAgentModel({name:'stub',async decide(){return {decision:'decline',reason:'The guest asked for drinks only, so the agent will not pay it.',proof:{mode:'near_ai',model:'stub',signature_kind:'gateway',request_sha256:null,response_sha256:null,signer:null,signature_verified:true,signer_in_attestation_report:true,nonce_echoed:true,quote_verified:false,note:'stub'}};}});
 const before=near.calls.filter(c=>c==='passPay').length;
 const r=await passes.passPay(b.access_token,ALICE,pass.passId,'Drinks only') as {declined?:boolean;agent:{decision:string;reason:string}};
 assert.equal(r.declined,true);assert.equal(r.agent.decision,'decline');assert.match(r.agent.reason,/drinks only/);
 assert.equal(near.calls.filter(c=>c==='passPay').length,before,'no transaction after a decline');
 assert.equal((await state(b.id)).order,'AWAITING_WALLET');
 // a real-model adapter whose answer cannot be read must not pay
 const fake=(async(url:string)=>new Response(url.includes('/chat/completions')?JSON.stringify({id:'x1',choices:[{message:{content:'not json'}}]}):'{}',{status:200})) as unknown as typeof fetch;
 const unreadable=await agent.nearAiAgent('k'.repeat(30),'test-model',fake).decide({shop:'Orbit',total:'5.00',symbol:'tUSD',lines:[{name:'Latte',qty:1}]},{balance:'20.00',maxBill:'10.00',minutesLeft:50,billsPaid:0},'');
 assert.equal(unreadable.decision,'decline');assert.equal(unreadable.proof.signature_verified,false);
 // a model that says "pay" but lists an item breaking the rule is treated as a decline
 const contradict=(async(url:string)=>new Response(url.includes('/chat/completions')?JSON.stringify({id:'x2',choices:[{message:{content:JSON.stringify({items_breaking_rule:['Croissant'],option:'pay',reason:'The croissant is excluded by the rule.'})}}]}):'{}',{status:200})) as unknown as typeof fetch;
 const guarded=await agent.nearAiAgent('k'.repeat(30),'test-model',contradict).decide({shop:'Orbit',total:'9.50',symbol:'tUSD',lines:[{name:'Latte',qty:1},{name:'Croissant',qty:1}]},{balance:'20.00',maxBill:'10.00',minutesLeft:50,billsPaid:0},'Coffee only');
 assert.equal(guarded.decision,'decline');
 // the sample rule (no key): "no croissant" blocks a croissant line
 const sample=await agent.sampleAgent.decide({shop:'Orbit',total:'4.50',symbol:'tUSD',lines:[{name:'Croissant',qty:1}]},{balance:'20.00',maxBill:'10.00',minutesLeft:50,billsPaid:0},'Coffee is fine, no croissants');
 assert.equal(sample.decision,'decline');assert.equal(sample.proof.mode,'sample');
 assert.equal(agent.cleanAgentReason('Pay 5 dollars now','pay'),'This bill fits the pass rule and its limits, so the agent pays it.','numbers never reach the guest');
 agent.setAgentModel(undefined);
});

test('P-05: the witness screen shows a waiting order as a QR before the bill is on chain, then follows the bill',integration,async()=>{
 const {bill,bills,device,witness,dismiss}=await setup();
 const w=await witness();await dismiss();const b=await bill(1);
 const before=await device.deviceState(w.id,w.key,'en') as {screen:string;qr:string};
 assert.equal(before.screen,'qr');assert.ok(before.qr.endsWith('/pay/'+b.access_token),'the QR opens this order\'s pay page');
 await bills.createNearBill(b.access_token);
 const after=await device.deviceState(w.id,w.key,'en') as {screen:string;qr:string;bill:unknown};
 assert.equal(after.screen,'qr');assert.ok(after.qr.endsWith('/pay/'+b.access_token));
});

test('P-06: with nothing to pay, the witness screen shows a scan-to-order QR for the table menu',integration,async()=>{
 const {device,witness}=await setup();
 const w=await witness();
 const idle=await device.deviceState(w.id,w.key,'en') as {screen:string;qr:string;title:string;anim:string};
 assert.equal(idle.screen,'idle');
 assert.match(idle.qr,/\/table\/[A-Za-z0-9_-]+$/,'the QR opens the table menu');
 assert.equal(idle.anim,'','no live offer in the fixture, so no offer animation');
});
