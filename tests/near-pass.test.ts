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
 const paid=await passes.passPay(b.access_token,ALICE,pass.passId);
 assert.equal(paid.status,'paid');assert.equal(paid.payer,ALICE,'refunds would go to the customer, never to the agent');assert.equal(paid.pass.balance,'14.60');assert.equal(paid.pass.billsPaid,1);
 assert.equal((await state(b.id)).order,'PAID');assert.equal((await state(b.id)).settlements,1);
 assert.deepEqual(await events(b.id),['BILL_OPENED','PAYMENT_RELAYED','SETTLED']);
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
 const held=await passes.passPay(b.access_token,ALICE,pass.passId);
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
