/** Explicit own-stack, rollback-only check. Never submits a transaction or device event. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import {config} from '../../apps/api/src/config';
import {pool} from '../../apps/api/src/db';
import {registry} from '../../apps/api/src/registry';
import {publishPrices} from '../../apps/api/src/catalog';
import {productOffer} from '../../apps/api/src/offers';
import {counterQuote,createRoutedOrder,orderView} from '../../apps/api/src/orders';
import {catalogPage} from '../../apps/api/src/device-commands';
import {paymentAssets,selectedQuote,selectPaymentAsset,frozenAttempt} from '../../apps/api/src/payment-assets';
import {paymentInstructions,assertPaymentMessage} from '../../apps/api/src/payments';
import {MINT,TOKEN_PROGRAM,hash} from '../../packages/domain/src/index';
import {formatMoney} from '../../apps/web/src/lib/money';
import type {AttemptRow} from '../../apps/api/src/types';

if(process.env.BITPOS_PRECISION_ROLLBACK_CHECK!=='1')throw Error('Explicit rollback-only check required');
const schemaDryRun=process.env.BITPOS_PRECISION_SCHEMA_DRY_RUN==='1';
const db=new pg.Client({connectionString:schemaDryRun?config.ADMIN_DATABASE_URL:config.DATABASE_URL,options:'-c search_path=bitpos,public'});
await db.connect();const proofs:Record<string,unknown>[]=[];
try{
 await db.query('BEGIN');
 await db.query("SELECT pg_advisory_xact_lock(hashtext('bitpos-table-migration'))");
 if(schemaDryRun)await db.query(fs.readFileSync('/app/tools/runtime/043_usd_fixed_precision.sql','utf8'));
 const role=(await db.query('SELECT current_user AS role')).rows[0].role;
 assert.equal(role,schemaDryRun?'postgres':'bitpos_app');
 const assets=(await db.query("SELECT * FROM payment_assets WHERE enabled AND verified_at IS NOT NULL ORDER BY asset_id")).rows;
 assert.deepEqual(assets.map(r=>r.asset_id).sort(),['usdc-devnet','usdg-devnet','usdt-test-devnet']);
 for(const decimals of [2,4] as const){
  await db.query('SET CONSTRAINTS ALL DEFERRED');
  const merchant=randomUUID(),actor=randomUUID(),product=randomUUID(),treasury=Keypair.generate().publicKey.toBase58();
  await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
  await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Precision rollback fixture',$2)",[merchant,treasury]);
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟ','Coffee','',10,10)",[product,merchant]);
  for(const asset of assets)await db.query("INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy) VALUES($1,$2,true,$3) ON CONFLICT(merchant_id,asset_id) DO UPDATE SET enabled=true,policy=excluded.policy",[merchant,asset.asset_id,{id:`USD_CENTS_TO_${asset.descriptor.symbol}_1_TO_1`,numerator:'10000',denominator:'1'}]);
  const reg=(path:string,method:string,input:unknown)=>registry(db as unknown as pg.PoolClient,merchant,actor,'owner',path,method,input);
  const device=await reg('/api/devices','POST',{label:'Rollback device'}),register=await reg('/api/registers','POST',{label:'Rollback register'});
  const credential=await reg(`/api/devices/${device.id}/credential`,'POST',{}),connectionId=randomUUID();
  await db.query("UPDATE device_presence SET connection_generation=1,connection_id=$2,connected_until=clock_timestamp()+interval '1 hour' WHERE device_id=$1",[device.id,connectionId]);
  await reg(`/api/registers/${register.id}/pairing`,'PUT',{deviceId:device.id,expectedPairingGeneration:'1'});
  const base=decimals===4?'1000':'10',final=decimals===4?'850':'9',raw=decimals===4?'85000':'90000';
  const client=db as unknown as pg.PoolClient;
  const pricing=await publishPrices(client,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',catalogDecimals:decimals,provenance:{kind:'demo_configured',label:'ROLLBACK TEST ONLY'},prices:[{productId:product,unitMinor:base}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:decimals===4?'USD_FIXED4_TO_USDG_1_TO_1':'USD_CENTS_TO_USDG_1_TO_1'}});
  await productOffer(client,merchant,actor,'owner',product,'PUT',{priceVersion:pricing.priceVersion,expectedRevision:'0',enabled:true,basePriceMinor:base,currentPriceMinor:final,discount:{kind:'percent',percent:15},expiresAt:new Date(Date.now()+3600000).toISOString()});
  const quote=await counterQuote(client,merchant,register.id,{items:[{productId:product,qty:1}],serving:{kind:'counter'}});
  assert.deepEqual(quote.total,{currency:'USD',decimals,amountMinor:final});assert.equal(quote.settlement.amountMinor,raw);
  assert.equal(formatMoney(quote.total),decimals===4?'USD 0.085':'USD 0.09');
  const catalog=await catalogPage(client,{merchant,device:device.id,tokenHash:hash(credential.deviceToken),authGeneration:credential.authGeneration,connectionGeneration:'1',connectionId},null,0);
  assert.equal(catalog.decimals,decimals);assert.equal(catalog.products[0].unitPrice.decimals,decimals);
  const created=await createRoutedOrder(client,merchant,'register',register.id,{items:[{productId:product,qty:1}],serving:{kind:'counter'},quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()});
  let order=(await db.query('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,created.order.id])).rows[0];
  assert.equal(created.order.pricing.total.amountMinor,final);assert.equal(created.order.pricing.total.decimals,decimals);
  assert.equal((await selectedQuote(client,order)).settlement.amountMinor,raw);
  const alternatives=await paymentAssets(client,order);assert.equal(alternatives.assets.length,3);
  for(const alternative of alternatives.assets){
   assert.equal(alternative.settlement.amountMinor,raw);
   await selectPaymentAsset(client,order,{assetId:alternative.asset.assetId,expectedVersion:order.version,idempotencyKey:randomUUID()});
   order=(await db.query('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,order.id])).rows[0];
   const selected=await selectedQuote(client,order);assert.equal(selected.settlement.amountMinor,raw);
   const payer=Keypair.generate().publicKey.toBase58(),reference=Keypair.generate().publicKey.toBase58();
   const insert=(amount:string)=>db.query<AttemptRow>('INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[merchant,order.id,reference,payer,treasury,amount,alternative.asset.mint,alternative.asset.tokenProgram]);
   await db.query('SAVEPOINT reject_wrong_amount');
   await assert.rejects(insert('8500000'),(error:unknown)=>(error as {code:string}).code==='23514');
   await db.query('ROLLBACK TO SAVEPOINT reject_wrong_amount');await db.query('RELEASE SAVEPOINT reject_wrong_amount');
   await db.query('SAVEPOINT canonical_attempt');
   const attempt=await frozenAttempt(client,(await insert(raw)).rows[0]);assert.equal(attempt.payment.settlement.amountMinor,raw);
   const feePayer=Keypair.generate().publicKey,ix=paymentInstructions(attempt,feePayer,false)[0];
   const decoded=alternative.asset.symbol==='USDG'?spl.decodeTransferCheckedWithFeeInstruction(ix,new PublicKey(alternative.asset.tokenProgram)):spl.decodeTransferCheckedInstruction(ix,new PublicKey(alternative.asset.tokenProgram));
   assert.equal(decoded.data.amount,BigInt(raw));assert.equal(decoded.data.decimals,6);
   const transaction=new Transaction({feePayer,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(ix);assertPaymentMessage(transaction,attempt);
   await db.query('ROLLBACK TO SAVEPOINT canonical_attempt');await db.query('RELEASE SAVEPOINT canonical_attempt');
  }
  const view=await orderView(client,order,true);assert.deepEqual(view.pricing.total,quote.total);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  proofs.push({decimals,display:formatMoney(view.pricing.total),rawAmount:raw,assets:3,wrongAmountRejected:true,transferInstructionVerified:true,catalogFramePrecisionVerified:true,databaseRole:role});
 }
 await db.query('ROLLBACK');
 console.log(JSON.stringify({result:'PASS',scope:schemaDryRun?'schema and production function dry run under migration role':'production functions under actual application role',proofs,transactionsSubmitted:0,deviceFramesCommitted:0,fixtureRowsCommitted:0}));
}catch(error){await db.query('ROLLBACK');const e=error as {code?:string;message?:string};console.error(JSON.stringify({result:'FAIL_ROLLED_BACK',code:e.code,message:e.message}));process.exitCode=1;}
finally{await db.end();await pool.end();}
