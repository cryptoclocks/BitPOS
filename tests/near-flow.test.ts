// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Integration tests for the NEAR Living Bill on real bills in the disposable PostgreSQL (through the tenant path,
// as role bitpos_app). The chain is an in-memory stand-in that follows the contract's rules; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ed25519} from '@noble/curves/ed25519';
import {setupNearShop as setup,ALICE,CONTRACT,SHOP_ACCOUNT,TOKEN} from './near-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const code=(c:string,status?:number)=>(e:Error&{status?:number;code?:string})=>(e.code===c||e.message===c)&&(status===undefined||e.status===status);

test('N-01: status → open bill (replays return the same one) → gasless pay → PAID once, stock consumed, everyone paid',integration,async()=>{
 const {near,bills,bill,state,events}=await setup();const b=await bill(2);
 const st=await bills.nearStatus(b.access_token);
 assert.equal(st.enabled,true);assert.equal(st.network,'testnet');assert.deepEqual(st.amount,{units:'5400000',display:'5.40'});assert.equal(st.bill.status,'none');assert.deepEqual(st.demoWallets,[ALICE]);
 const o1=await bills.createNearBill(b.access_token),o2=await bills.createNearBill(b.access_token);
 assert.equal(o1.status,'awaiting_payment');assert.equal(o2.billId,o1.billId);assert.equal(near.calls.filter(c=>c==='open').length,1,'the second call returns the live bill without touching the chain');
 assert.equal(o1.witness,false);assert.equal(o1.contract,CONTRACT);assert.equal(o1.token,TOKEN);assert.equal(o1.payMessage,JSON.stringify({m:SHOP_ACCOUNT,b:o1.billId}));
 assert.deepEqual(o1.payouts.map(p=>[p.role,p.amount,p.paid]),[['owner','5.40',false]],'no tax account and nobody on shift: the owner gets it all');
 const paid=await bills.demoPay(b.access_token,ALICE);
 assert.equal(paid.status,'paid');assert.equal(paid.payer,ALICE);assert.ok(paid.tx.pay);assert.ok(paid.payouts.every(p=>p.paid));
 assert.deepEqual(await state(b.id),{order:'PAID',stock:{stock:8,reserved:0},bills:['SETTLED'],settlements:1,safe:false});
 assert.equal((await bills.demoPay(b.access_token,ALICE)).status,'paid','paying again changes nothing');
 assert.equal((await bills.createNearBill(b.access_token)).status,'paid','a paid order never gets a second bill');
 assert.equal((await state(b.id)).settlements,1);assert.equal(near.calls.filter(c=>c==='relay').length,1);
 assert.deepEqual(await events(b.id),['BILL_OPENED','PAYMENT_RELAYED','SETTLED']);
});

test('N-02: a payment that is not exactly this bill is refused before any gas is spent; a bounced one changes nothing',integration,async()=>{
 const {near,bills,bill,state,events}=await setup();const b=await bill(1);const o=await bills.createNearBill(b.access_token);
 const mine={token:TOKEN,amount:o.amount!.units,msg:o.payMessage!};
 for(const over of [{amount:'2699999'},{receiver:'thief.fake.testnet'},{token:'evil.fake.testnet'},{msg:JSON.stringify({m:SHOP_ACCOUNT,b:'b'+'0'.repeat(32)})},{method:'ft_transfer'},{other:1},{deposit:'0'},{gas:'1'}])
  await assert.rejects(bills.relayPayment(b.access_token,near.delegate(mine,over)),code('NEAR_PAYMENT_NOT_FOR_THIS_BILL',422),JSON.stringify(over));
 await assert.rejects(bills.relayPayment(b.access_token,'not-a-delegate'),code('NEAR_PAYMENT_NOT_FOR_THIS_BILL',422));
 assert.equal(near.calls.filter(c=>c==='relay').length,0);
 // The contract bounces what it does not recognise: here the on-chain bill was voided behind the server's back.
 near.tamper(SHOP_ACCOUNT,o.billId!,x=>{x.state='Void';});
 const bounced=await bills.relayPayment(b.access_token,near.delegate(mine));
 assert.equal(bounced.status,'void');
 assert.deepEqual(await state(b.id),{order:'AWAITING_WALLET',stock:{stock:10,reserved:1},bills:['VOID'],settlements:0,safe:true});
 assert.ok((await events(b.id)).includes('PAYMENT_BOUNCED'));
 await assert.rejects(bills.demoPay(b.access_token,'mallory.fake.testnet'),code('RESOURCE_NOT_FOUND',404));
});

test('N-03: with a witness the money waits in escrow; only the device\'s own signature releases the split',integration,async()=>{
 const {bills,device,bill,state,events,witness}=await setup();const w=await witness();const b=await bill(2);
 const o=await bills.createNearBill(b.access_token);assert.equal(o.witness,true);
 const shown=await device.deviceState(w.id,w.key,'en');assert.equal(shown.screen,'qr');assert.equal(shown.big,'5.40 tUSD');assert.match(shown.qr,/\/pay\//);
 const escrow=await bills.demoPay(b.access_token,ALICE);
 assert.equal(escrow.status,'escrow');assert.ok(escrow.witnessDeadline);
 assert.deepEqual(await state(b.id),{order:'AWAITING_WALLET',stock:{stock:10,reserved:2},bills:['ESCROW'],settlements:0,safe:false});
 const checking=await device.deviceState(w.id,w.key,'th');assert.equal(checking.screen,'checking');assert.deepEqual(checking.bill,{contract:CONTRACT,merchant:SHOP_ACCOUNT,id:o.billId});
 const forged=w.sign(o.billId!,ed25519.utils.randomPrivateKey());
 await assert.rejects(device.deviceAck(w.id,w.key,{bill:o.billId!,sig:forged,pk:w.pk}),code('WITNESS_SIGNATURE_INVALID',422));
 await assert.rejects(device.deviceAck(w.id,'x'.repeat(43),{bill:o.billId!,sig:w.sign(o.billId!),pk:w.pk}),code('DEVICE_AUTH_REQUIRED',401));
 await assert.rejects(device.deviceAck(w.id,w.key,{bill:o.billId!,sig:w.sign(o.billId!),pk:'ab'.repeat(32)}),code('WITNESS_KEY_MISMATCH',409));
 assert.equal((await state(b.id)).order,'AWAITING_WALLET');
 assert.deepEqual(await device.deviceAck(w.id,w.key,{bill:o.billId!,sig:w.sign(o.billId!),pk:w.pk}),{ok:true,state:'SETTLED'});
 assert.deepEqual(await state(b.id),{order:'PAID',stock:{stock:8,reserved:0},bills:['SETTLED'],settlements:1,safe:false});
 assert.deepEqual(await device.deviceAck(w.id,w.key,{bill:o.billId!,sig:w.sign(o.billId!),pk:w.pk}),{ok:true,state:'SETTLED'},'a repeated acknowledgement is answered, not repeated');
 const done=await device.deviceState(w.id,w.key,'en');assert.equal(done.screen,'paid');assert.equal(done.splits.length,1);
 assert.deepEqual(await events(b.id),['BILL_OPENED','PAYMENT_RELAYED','PAID_ESCROW','WITNESS_REFUSED','WITNESS_ACK','SETTLED']);
});

test('N-04: no witness in time → the money goes back to the payer, the order stays unpaid and can be paid again',integration,async()=>{
 const {f,near,clock,bills,reconcile,bill,state,witness}=await setup();await witness();const b=await bill(1);
 const o=await bills.createNearBill(b.access_token);await bills.demoPay(b.access_token,ALICE);
 await assert.rejects(bills.reclaimBill(b.access_token),code('NEAR_WITNESS_WINDOW_OPEN',409));
 clock.now+=121_000;
 const back=await bills.reclaimBill(b.access_token);
 assert.equal(back.status,'refunded');assert.ok(back.tx.refund);
 assert.deepEqual(await state(b.id),{order:'AWAITING_WALLET',stock:{stock:10,reserved:1},bills:['REFUNDED'],settlements:0,safe:true});
 assert.equal(near.bills.get(SHOP_ACCOUNT+':'+o.billId)!.state,'Refunded');
 clock.now-=121_000;
 const again=await bills.createNearBill(b.access_token);assert.equal(again.status,'awaiting_payment');assert.notEqual(again.billId,o.billId);
 // The worker does the same on its own when nobody presses the button.
 await bills.demoPay(b.access_token,ALICE);clock.now+=130_000;
 const second=await f.tenant(f.merchant,async db=>(await db.query('SELECT id FROM near_bills WHERE chain_bill_id=$1',[again.billId])).rows[0].id as string);
 await reconcile.tickNearBill(f.merchant,second,{config:(await import('./near-fixture')).config,chain:near.chain,now:()=>clock.now});
 assert.deepEqual((await state(b.id)).bills,['REFUNDED','REFUNDED']);
});

test('N-05: staff on shift are paid by the cup; a supplier invoice collects itself and stops when funded',integration,async()=>{
 const {f,bills,api,bill,dismiss}=await setup({taxBps:700,tipsBps:1000});
 await f.tenant(f.merchant,db=>db.query("INSERT INTO near_recipients(merchant_id,kind,label,near_account) VALUES($1,'tax','Tax reserve','tax.orbit.fake.testnet')",[f.merchant]));
 const mai=await api('owner','team','POST',{label:'Mai',nearAccount:'mai.orbit.fake.testnet'}) as {id:string};
 const ton=await api('manager','team','POST',{label:'Ton',nearAccount:'ton.orbit.fake.testnet',weight:2}) as {id:string};
 const milk=await api('owner','suppliers','POST',{label:'Milk Farm',nearAccount:'milkfarm.fake.testnet'}) as {id:string};
 await assert.rejects(api('staff','team','POST',{label:'X',nearAccount:'x.fake.testnet'}),code('ROLE_REQUIRED',403));
 await assert.rejects(api('owner','team','POST',{label:'X',nearAccount:'missing.fake.testnet'}),code('NEAR_ACCOUNT_NOT_FOUND',422));
 await assert.rejects(api('owner','team','POST',{label:'X',nearAccount:'someone.near'}),/./,'mainnet accounts are refused');
 await api('staff','team/'+mai.id+'/shift','POST',{on:true});await api('staff','team/'+ton.id+'/shift','POST',{on:true});
 const invoice=await api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-001',total:'1.00',rateBps:1000}) as {id:string};
 await assert.rejects(api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-001',total:'1.00',rateBps:100}),code('NEAR_INVOICE_EXISTS',409));
 await assert.rejects(api('staff','invoices','POST',{recipientId:milk.id,reference:'INV-002',total:'1.00',rateBps:100}),code('ROLE_REQUIRED',403));
 // Bill 1: 5.40 → tax 0.378, tips 0.54 (Mai 0.18, Ton 0.36), supplier 0.54, owner the rest.
 const b1=await bill(2);const o1=await bills.createNearBill(b1.access_token);
 assert.deepEqual(o1.payouts.map(p=>[p.role,p.label,p.amount]),[['owner','Table backend fixture','3.942'],['tax','Tax reserve','0.378'],['tips','Mai','0.18'],['tips','Ton','0.36'],['supplier','Milk Farm · INV-001','0.54']]);
 await bills.demoPay(b1.access_token,ALICE);await dismiss();
 // Bill 2: the invoice needs only 0.46 more, so that is all it collects.
 const b2=await bill(2);const o2=await bills.createNearBill(b2.access_token);
 assert.equal(o2.payouts.find(p=>p.role==='supplier')!.amount,'0.46','only what is left to collect');
 await bills.demoPay(b2.access_token,ALICE);await dismiss();
 const suppliers=await api('staff','suppliers') as {invoices:{id:string;funded:string;status:string}[];items:{earnedTotal:string}[]};
 assert.deepEqual(suppliers.invoices.find(i=>i.id===invoice.id),{...suppliers.invoices[0],funded:'1.00',status:'FUNDED'});assert.equal(suppliers.items[0].earnedTotal,'1.00');
 // Bill 3: the invoice is funded, Mai clocked out → no supplier line, Ton gets all tips.
 await api('staff','team/'+mai.id+'/shift','POST',{on:false});
 const b3=await bill(1);const o3=await bills.createNearBill(b3.access_token);
 assert.deepEqual(o3.payouts.map(p=>[p.role,p.amount]),[['owner','2.241'],['tax','0.189'],['tips','0.27']]);
 await bills.demoPay(b3.access_token,ALICE);
 const team=await api('staff','team') as {items:{label:string;onShift:boolean;earnedTotal:string}[]};
 assert.deepEqual(team.items.map(t=>[t.label,t.onShift,t.earnedTotal]),[['Mai',false,'0.36'],['Ton',true,'0.99']]);
 // Tax + tips + open invoice rates may never exceed 90% of a bill: the owner always keeps a share.
 await api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-A',total:'50',rateBps:3000});await api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-B',total:'50',rateBps:1000});
 await assert.rejects(api('owner','recipe','POST',{taxBps:3000,tipsBps:3000,witnessDeviceId:null,witnessTimeoutS:120}),code('NEAR_RECIPE_INVALID',409));
 await assert.rejects(api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-C',total:'50',rateBps:3001}),/./,'one invoice takes at most 30%');
 await api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-C',total:'50',rateBps:3000});
 await assert.rejects(api('owner','invoices','POST',{recipientId:milk.id,reference:'INV-D',total:'50',rateBps:100}),code('NEAR_TOO_MANY_OPEN_INVOICES',409));
 await assert.rejects(api('staff','recipe','POST',{taxBps:0,tipsBps:0,witnessDeviceId:null,witnessTimeoutS:120}),code('ROLE_REQUIRED',403));
});

test('N-06: what the contract holds must equal what the server froze, or the order is never marked paid',integration,async()=>{
 const {near,bills,bill,state,events}=await setup();const b=await bill(2);const o=await bills.createNearBill(b.access_token);
 near.tamper(SHOP_ACCOUNT,o.billId!,x=>{x.payouts[0].account='thief.fake.testnet';});
 const paid=await bills.demoPay(b.access_token,ALICE);
 assert.equal(paid.status,'mismatch');assert.equal(paid.issue,'PAYOUTS');
 assert.deepEqual(await state(b.id),{order:'AWAITING_WALLET',stock:{stock:10,reserved:2},bills:['MISMATCH'],settlements:0,safe:true});
 assert.ok((await events(b.id)).includes('MISMATCH'));
});

test('N-07: lost answers and failed payouts — the bill is opened once, the split is retried, never paid twice',integration,async()=>{
 const {near,bills,reconcile,clock,api,f,bill,state}=await setup();const b=await bill(1);
 near.fail.open='lost';// the contract opened the bill but the answer never arrived
 const lost=await bills.createNearBill(b.access_token);assert.equal(lost.status,'opening');
 const retried=await bills.createNearBill(b.access_token);assert.equal(retried.status,'awaiting_payment');assert.equal(retried.billId,lost.billId);
 assert.equal(near.bills.size,1,'still one bill on chain');
 near.fail.payout=true;// e.g. a recipient that cannot hold the token
 const failed=await bills.demoPay(b.access_token,ALICE);assert.equal(failed.status,'payout_failed');
 assert.deepEqual(await state(b.id),{order:'AWAITING_WALLET',stock:{stock:10,reserved:1},bills:['PAYOUT_FAILED'],settlements:0,safe:false});
 const id=await f.tenant(f.merchant,async db=>(await db.query('SELECT id FROM near_bills WHERE order_id=$1',[b.id])).rows[0].id as string);
 await assert.rejects(api('staff',`bills/${id}/retry`,'POST',{}),code('ROLE_REQUIRED',403));
 const fixed=await api('owner',`bills/${id}/retry`,'POST',{}) as {status:string};assert.equal(fixed.status,'paid');
 assert.deepEqual(await state(b.id),{order:'PAID',stock:{stock:9,reserved:0},bills:['SETTLED'],settlements:1,safe:false});
 near.fail.getBill=true;await reconcile.tickNearBill(f.merchant,id,{config:(await import('./near-fixture')).config,chain:near.chain,now:()=>clock.now});
 assert.equal((await state(b.id)).settlements,1);
});

test('N-08: one order, one channel — a live NEAR bill blocks a Solana attempt; ledger, CSV and evidence read back',integration,async()=>{
 const {f,bills,api,bill}=await setup();const b=await bill(1);await bills.createNearBill(b.access_token);
 await assert.rejects(f.tenant(f.merchant,db=>db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,last_valid_height,status) VALUES($1,$2,'r','p','t',1,'m','tp',1,'BUILDING')",[f.merchant,b.id])),(e:Error&{code?:string})=>e.code==='55P03'||/PAYMENT_PENDING/.test(e.message));
 await bills.demoPay(b.access_token,ALICE);
 const ledger=await api('staff','ledger') as {bills:{status:string;orderId:string;payouts:unknown[];tx:{pay:string|null}}[]};
 assert.equal(ledger.bills[0].status,'paid');assert.equal(ledger.bills[0].orderId,b.id);
 const csv=await api('staff','ledger/export') as {filename:string;csv:string};
 assert.match(csv.filename,/^bitpos-near-ledger-\d{4}-\d{2}-\d{2}\.csv$/);const lines=csv.csv.trim().split('\n');
 assert.equal(lines[0],'date_utc,bill_id,order_id,serving,status,token,bill_total,role,recipient,recipient_account,amount,paid,payer,payment_tx,witness_tx,refund_tx');
 assert.match(lines[1],/,SETTLED,tUSD,2\.70,owner,Table backend fixture,orbit\.fake\.testnet,2\.70,yes,alice\.fake\.testnet,https:\/\/testnet\.nearblocks\.io\/txns\//);
 const evidence=await api('staff',`orders/${b.id}/evidence`) as {orderStatus:string;bills:{events:{kind:string;url:string|null}[]}[]};
 assert.equal(evidence.orderStatus,'PAID');assert.deepEqual(evidence.bills[0].events.map(e=>e.kind),['BILL_OPENED','PAYMENT_RELAYED','SETTLED']);
 const account=await api('staff','account') as {enabled:boolean;account:string;today:{total:string}};
 assert.equal(account.enabled,true);assert.equal(account.account,SHOP_ACCOUNT);assert.equal(account.today.total,'2.70');
});
