import 'dotenv/config';
import assert from 'node:assert/strict';import fs from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';import {Transaction,Keypair} from '@solana/web3.js';import {z} from 'zod';
import {server} from '../../apps/api/src/index';import {pool,tenant} from '../../apps/api/src/db';import {config} from '../../apps/api/src/config';import {staffToken,tableFixture} from '../../tests/backend-table-fixture';import {reconcileMerchant} from '../../apps/worker/src/index';import {chain,assertCluster,verifyTransfer} from '../../apps/api/src/payments';import {frozenAttempt} from '../../apps/api/src/payment-assets';import {WebSocket} from 'ws';import {once} from 'node:events';
const assetId=process.argv[2];assert.ok(['usdg-devnet','usdc-devnet','usdt-test-devnet'].includes(assetId));await assertCluster();
const orderSchema=z.object({id:z.string().uuid(),version:z.number().int(),status:z.string(),pricing:z.object({total:z.object({currency:z.string(),amountMinor:z.string()}).passthrough()}).passthrough(),settlement:z.object({assetId:z.string(),amountMinor:z.string(),currency:z.string()}).passthrough(),paymentUrl:z.string().url()}).passthrough();
const payer=Keypair.fromSecretKey(Uint8Array.from(z.array(z.number().int().min(0).max(255)).parse(JSON.parse(fs.readFileSync(config.DEVNET_PRIVATE_DIR+'/keys/customer-no-sol.json','utf8')))));assert.equal(await chain.getBalance(payer.publicKey),0);
server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
const f=await tableFixture(3),merchant=f.merchant;
const publicWallets=z.object({wallets:z.array(z.object({id:z.string(),address:z.string()}))}).parse(JSON.parse(fs.readFileSync(config.DEVNET_PRIVATE_DIR+'/wallets.public.json','utf8')));
const treasury=publicWallets.wallets.find(w=>w.id==='merchant-a-treasury');assert.ok(treasury);
await f.tenant(merchant,db=>db.query('UPDATE merchants SET treasury=$2 WHERE id=$1',[merchant,treasury.address]));
const socket=new WebSocket(origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(f.a.id)}});
await once(socket,'open');await delay(250);
async function req(path:string,body?:unknown,token?:string,method=body?'POST':'GET'):Promise<unknown>{const response=await fetch(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result:unknown=await response.json();if(!response.ok)throw Error(JSON.stringify({status:response.status,result}));return result;}
try{const token=await staffToken(pool,merchant,f.actor);const settings=z.object({assets:z.array(z.object({asset:z.object({assetId:z.string()}),enabled:z.boolean().nullable(),version:z.number().nullable()}))}).parse(await req('/api/settings/payment-assets',undefined,token));const chosen=settings.assets.find(row=>row.asset.assetId===assetId);assert.ok(chosen);
if(!chosen.enabled)await req('/api/settings/payment-assets',{assetId,enabled:true,expectedVersion:chosen.version??0,denominationPolicy:{id:assetId==='usdg-devnet'?'USD_CENTS_TO_USDG_1_TO_1':assetId==='usdc-devnet'?'USD_CENTS_TO_USDC_1_TO_1':'USD_CENTS_TO_USDT_TEST_1_TO_1',numerator:'10000',denominator:'1'}},token,'PUT');
const register=f.register,product={id:f.product};
const quote=z.object({id:z.string().uuid(),priceVersion:z.string().uuid()}).parse(await req('/api/registers/'+register.id+'/quotes',{items:[{productId:product.id,qty:1}],serving:{kind:'counter'}},token));let order=orderSchema.parse(await req('/api/registers/'+register.id+'/orders',{items:[{productId:product.id,qty:1}],serving:{kind:'counter'},quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:crypto.randomUUID()},token));const access=new URL(order.paymentUrl).pathname.split('/').pop()!;const evidenceBefore=JSON.stringify(order.pricing);
const recovery=process.argv[3]==='--recover-unfunded';
if(recovery){
 await req('/api/settings/payment-assets',{assetId:'usdc-devnet',enabled:true,expectedVersion:0,denominationPolicy:{id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'}},token,'PUT');
 order=z.object({order:orderSchema}).parse(await req('/api/pay/'+access+'/asset',{assetId:'usdc-devnet',expectedVersion:order.version,idempotencyKey:crypto.randomUUID()})).order;
 await assert.rejects(req('/api/pay/'+access+'/attempt',{address:payer.publicKey.toBase58()}),/INSUFFICIENT_BALANCE/);
 await tenant(merchant,async db=>{
  const failed=(await db.query("SELECT status,transaction_base64,signature,failure_reconciled_at FROM payment_attempts WHERE order_id=$1",[order.id])).rows[0];
  assert.equal(failed.status,'FAILED');assert.equal(failed.transaction_base64,null);assert.equal(failed.signature,null);assert.ok(failed.failure_reconciled_at);
  assert.equal((await db.query('SELECT reserved_lamports::text AS reserved FROM sponsor_orders WHERE order_id=$1',[order.id])).rows[0].reserved,'0');
 });
}
if(order.settlement.assetId!==assetId)order=z.object({order:orderSchema}).parse(await req('/api/pay/'+access+'/asset',{assetId,expectedVersion:order.version,idempotencyKey:crypto.randomUUID()})).order;assert.equal(JSON.stringify(order.pricing),evidenceBefore);
if(process.argv[4]==='--recovery-only'){
 assert.equal(recovery,true);const receipt={origin:'actual_current_API_devnet_readonly_balance_failure_then_alternate_selection',orderId:order.id,unissuedFailureResolved:true,sponsorOrderReservationReleased:true,frozenBillUnchanged:true,selectedAssetId:order.settlement.assetId,transactionsSubmitted:0};
 fs.writeFileSync('.omp/work/post-submit-20261012/evidence/assets-unissued-recovery-current.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}else{
const attempt=z.object({id:z.string().uuid(),base64:z.string()}).parse(await req('/api/pay/'+access+'/attempt',{address:payer.publicKey.toBase58()}));const tx=Transaction.from(Buffer.from(attempt.base64,'base64'));tx.partialSign(payer);const submitted=z.object({signature:z.string()}).parse(await req('/api/pay/'+access+'/submit',{attemptId:attempt.id,base64:tx.serialize().toString('base64')}));
let paid=order;for(let n=0;n<30;n++){await reconcileMerchant(merchant);paid=orderSchema.parse(await req('/api/pay/'+access));if(paid.status==='PAID')break;await delay(1500);}assert.equal(paid.status,'PAID');assert.equal(paid.settlement.assetId,assetId);assert.equal(JSON.stringify(paid.pricing),evidenceBefore);await reconcileMerchant(merchant);await reconcileMerchant(merchant);
const proof=await tenant(merchant,async db=>{const a=(await db.query('SELECT * FROM payment_attempts WHERE id=$1',[attempt.id])).rows[0];assert.equal(a.status,'FINALIZED');assert.ok(await verifyTransfer(submitted.signature,await frozenAttempt(db,a),'finalized'));const counts=(await db.query("SELECT (SELECT count(*)::int FROM payments WHERE order_id=$1 AND state='SETTLED') AS payments,(SELECT count(*)::int FROM outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='PAID') AS events",[paid.id])).rows[0];assert.deepEqual(counts,{payments:1,events:1});return counts;});assert.equal(await chain.getBalance(payer.publicKey),0);
const receipt={origin:'actual_current_API_signed_devnet_frozen_verifier_worker_reconciliation',assetId,orderId:paid.id,attemptId:attempt.id,signature:submitted.signature,settlement:paid.settlement,finalized:true,zeroSOLCustomer:true,frozenBillUnchanged:true,unfundedAssetRecovery:recovery,...proof,physical:false,Android:false};fs.writeFileSync('.omp/work/post-submit-20261012/evidence/assets-live-'+assetId+(recovery?'-recovery':'')+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}
}finally{socket.terminate();server.close();await once(server,'close');await pool.end();}
