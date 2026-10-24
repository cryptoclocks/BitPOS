import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Keypair,Transaction,TransactionInstruction,PublicKey} from '@solana/web3.js';
import type {VersionedTransactionResponse} from '@solana/web3.js';
import bs58 from 'bs58';
import {TOKEN_PROGRAM_ID,ExtensionType,decodeTransferCheckedInstruction,decodeTransferCheckedWithFeeInstruction} from '@solana/spl-token';
import {denomination,assetSettlement,USDG_ASSET,USDC_DEVNET_MINT,SPL_TOKEN_PROGRAM,assertAssetDescriptor} from '../packages/domain/src/payment-assets';
import type {PaymentAsset} from '../packages/contracts/src/index';
import type {AttemptRow,OrderRow} from '../apps/api/src/types';
import type {FrozenPayment} from '../apps/api/src/payment-assets';
import {tableFixture} from './backend-table-fixture';
const policy={id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'};
const usdc:PaymentAsset={...USDG_ASSET,assetId:'usdc-devnet',symbol:'USDC',displayLabel:'USDC devnet (Circle)',mint:USDC_DEVNET_MINT,tokenProgram:SPL_TOKEN_PROGRAM,instructionPolicy:'spl_checked'};
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('denomination is exact integer math, bounded and never market FX',()=>{
 assert.equal(denomination('270',policy),'2700000');
 assert.equal(denomination('9007199254740993',{id:'unsafe-number',numerator:'3',denominator:'1'}),'27021597764222979');
 assert.equal(denomination('270',{id:'ratio',numerator:'10000',denominator:'3'}),'900000');
 assert.throws(()=>denomination('271',{id:'ratio',numerator:'10000',denominator:'3'}),/Nondivisible/);
 for(const [total,n,d] of [['0','1','1'],['1','0','1'],['1','1','0'],['1','18446744073709551616','1'],['999999999999999999','2','1']])assert.throws(()=>denomination(total,{id:'invalid',numerator:n,denominator:d}));
 assert.equal(assetSettlement(usdc,'270',policy,'recipient').currency,'USDC');
 for(const mutated of [{...usdc,mint:USDG_ASSET.mint},{...usdc,tokenProgram:USDG_ASSET.tokenProgram},{...usdc,genesisHash:'mainnet'},{...usdc,assetId:'unknown'}])assert.throws(()=>assertAssetDescriptor(mutated));
 const testAsset:PaymentAsset={...usdc,assetId:'usdt-test-devnet',symbol:'USDT',mint:Keypair.generate().publicKey.toBase58(),displayLabel:'USDT test (BitPOS-issued)',issuerTestAsset:false};
 assert.doesNotThrow(()=>assertAssetDescriptor(testAsset));assert.throws(()=>assertAssetDescriptor({...testAsset,issuerTestAsset:true}));assert.throws(()=>assertAssetDescriptor({...testAsset,displayLabel:'Tether USDT'}));
});

test('selection preserves bill evidence, serializes attempts, replays exact result and fences tenant/role',integration,async()=>{
 const f=await tableFixture(3),created=await f.create(await f.quote(2));
 // Intentional module-loading boundary: skipped tests cannot load required private runtime configuration.
 const {config}=await import('../apps/api/src/config');const {paymentAssets,selectPaymentAsset,merchantPaymentAssets}=await import('../apps/api/src/payment-assets');
 const {orderView,settleAttempt}=await import('../apps/api/src/orders');
 const registryAdmin=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await registryAdmin.connect();
 const original=(await registryAdmin.query("SELECT enabled,verified_at FROM bitpos.payment_assets WHERE asset_id='usdc-devnet'")).rows[0];
 await registryAdmin.query("UPDATE bitpos.payment_assets SET enabled=true,verified_at=clock_timestamp() WHERE asset_id='usdc-devnet'");
 const admin=await f.pool.connect();
 try{await admin.query('BEGIN');await admin.query('SET LOCAL search_path=bitpos,public');
  await admin.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);
  await admin.query("INSERT INTO bitpos.merchant_payment_assets(merchant_id,asset_id,enabled,policy) VALUES($1,'usdc-devnet',true,$2)",[f.merchant,policy]);
  const db=admin;
  const locked=async()=>(await admin.query<OrderRow>('SELECT * FROM bitpos.orders WHERE id=$1 FOR UPDATE',[created.order.id])).rows[0];
  const evidence=async()=>({authority:(await admin.query('SELECT * FROM bitpos.order_authority WHERE order_id=$1',[created.order.id])).rows,quote:(await admin.query('SELECT q.* FROM bitpos.order_quotes q JOIN bitpos.order_authority a ON a.quote_id=q.id WHERE a.order_id=$1',[created.order.id])).rows,items:(await admin.query('SELECT * FROM bitpos.order_items WHERE order_id=$1',[created.order.id])).rows});
  const before=await evidence(),o=await locked();
  const available=await paymentAssets(db,o);assert.equal(available.selectedAssetId,'usdg-devnet');assert.equal(available.canChange,true);assert.equal(available.assets.find(a=>a.asset.assetId==='usdc-devnet')?.settlement.amountMinor,'5400000');
  const key=randomUUID(),request={assetId:'usdc-devnet',expectedVersion:o.version,idempotencyKey:key};
  const selected=await selectPaymentAsset(db,o,request);assert.equal(selected.order.version,o.version+1);assert.equal(selected.order.settlement.currency,'USDC');assert.deepEqual(selected.order.pricing,created.order.pricing);assert.deepEqual(await evidence(),before);
  const replay=await selectPaymentAsset(db,await locked(),request);assert.equal(replay.replayed,true);assert.deepEqual(replay.order,selected.order);
  await assert.rejects(selectPaymentAsset(db,await locked(),{...request,assetId:'usdg-devnet'}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(selectPaymentAsset(db,await locked(),{...request,idempotencyKey:randomUUID()}),/PAYMENT_ASSET_VERSION_CONFLICT/);
  await assert.rejects(merchantPaymentAssets(db,f.merchant,f.actor,'staff','PUT',{}),/ROLE_REQUIRED/);
  await assert.rejects(merchantPaymentAssets(db,f.merchant,f.actor,'manager','PUT',{assetId:'usdc-devnet',mint:USDG_ASSET.mint,enabled:true,expectedVersion:1,denominationPolicy:policy}));
  const a=(await admin.query<AttemptRow>(`INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature,signed_base64,transaction_base64)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,'READY',$9,'SQL-only fixture proof','SQL-only fixture message') RETURNING *`,[f.merchant,o.id,Keypair.generate().publicKey.toBase58(),Keypair.generate().publicKey.toBase58(),selected.order.settlement.recipient,'5400000',usdc.mint,usdc.tokenProgram,randomUUID()])).rows[0];
  for(const state of ['READY','SUBMITTING','SUBMITTED','CONFIRMED','EXPIRED','FAILED','REJECTED']){
   await admin.query('UPDATE bitpos.payment_attempts SET status=$2 WHERE id=$1',[a.id,state]);
   assert.equal((await paymentAssets(db,await locked())).canChange,false,state);
   await assert.rejects(selectPaymentAsset(db,await locked(),{assetId:'usdg-devnet',expectedVersion:selected.order.version,idempotencyKey:randomUUID()}),/PAYMENT_PENDING/);
  }
  await admin.query('SAVEPOINT reconciled_expiry');
  await admin.query("UPDATE bitpos.payment_attempts SET status='EXPIRED',failure_reconciled_at=clock_timestamp() WHERE id=$1",[a.id]);
  assert.equal((await paymentAssets(db,await locked())).canChange,true);
  const switched=await selectPaymentAsset(db,await locked(),{assetId:'usdg-devnet',expectedVersion:selected.order.version,idempotencyKey:randomUUID()});
  assert.equal(switched.order.settlement.currency,'USDG');assert.deepEqual(await evidence(),before);
  await admin.query('ROLLBACK TO SAVEPOINT reconciled_expiry');
  const configured=await merchantPaymentAssets(db,f.merchant,f.actor,'manager','PUT',{assetId:'usdg-devnet',enabled:false,expectedVersion:1,denominationPolicy:{id:'USD_CENTS_TO_USDG_1_TO_1',numerator:'10000',denominator:'1'}});
  assert.equal(configured.enabled,false);assert.equal(configured.version,2);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM bitpos.audit_logs WHERE merchant_id=$1 AND action='payment_asset.configure'",[f.merchant])).rows[0].n,1);
  // Direct SQL fixtures stand in for verifier-approved facts; no chain payment is claimed.
  await admin.query("UPDATE bitpos.payment_attempts SET status='SUBMITTED' WHERE id=$1",[a.id]);
  await settleAttempt(db,a,true);await settleAttempt(db,a,true);
  const paid=await orderView(db,await locked(),true);assert.equal(paid.status,'PAID');assert.equal(paid.settlement.currency,'USDC');assert.deepEqual(paid.pricing,created.order.pricing);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM bitpos.payments WHERE order_id=$1',[o.id])).rows[0].n,1);
  assert.deepEqual((await admin.query('SELECT stock,reserved FROM bitpos.products WHERE id=$1',[f.product])).rows[0],{stock:1,reserved:0});
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM bitpos.outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='PAID'",[o.id])).rows[0].n,1);
  await admin.query("SELECT set_config('bitpos.merchant',$1,true)",[f.other]);
  assert.equal((await admin.query('SELECT * FROM bitpos.payment_quotes WHERE order_id=$1',[o.id])).rowCount,0);
  assert.equal((await admin.query('SELECT * FROM bitpos.payment_attempt_assets WHERE attempt_id=$1',[a.id])).rowCount,0);
 }finally{await admin.query('ROLLBACK');admin.release();await registryAdmin.query("UPDATE bitpos.payment_assets SET enabled=$1,verified_at=$2 WHERE asset_id='usdc-devnet'",[original.enabled,original.verified_at]);await registryAdmin.end();}
});

test('both explicit instruction policies verify exact signed messages and recipient deltas; extra instructions fail',integration,async()=>{
 // Intentional module-loading boundary: skipped tests cannot load required private runtime configuration.
 const p=await import('../apps/api/src/payments');const original=p.chain.getTransaction;
 try{for(const asset of [USDG_ASSET,usdc]){
  const sponsor=Keypair.generate(),payer=Keypair.generate(),recipient=Keypair.generate();
  const reference=Keypair.generate().publicKey.toBase58(),settlement=assetSettlement(asset,'270',policy,recipient.publicKey.toBase58());
  const attempt:AttemptRow&{payment:FrozenPayment}={id:randomUUID(),order_id:randomUUID(),merchant_id:randomUUID(),reference,payer:payer.publicKey.toBase58(),recipient:recipient.publicKey.toBase58(),amount_minor:'2700000',mint:asset.mint,token_program:asset.tokenProgram,signature:null,signed_base64:null,transaction_base64:null,blockhash:null,last_valid_height:'1',status:'SUBMITTED',payment:{quoteId:randomUUID(),asset,settlement,payer:payer.publicKey.toBase58(),recipient:recipient.publicKey.toBase58(),reference,expiresAt:new Date(Date.now()+60000).toISOString()}};
  await assert.rejects(p.build({...attempt,payment:{...attempt.payment,expiresAt:'2020-01-01T00:00:00.000Z'}}),/QUOTE_EXPIRED/);
  const tx=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(...p.paymentInstructions(attempt,sponsor.publicKey,false));tx.partialSign(sponsor);
  attempt.transaction_base64=tx.serialize({requireAllSignatures:false}).toString('base64');tx.partialSign(payer);attempt.signed_base64=tx.serialize().toString('base64');attempt.signature=p.validateSigned(attempt.signed_base64,attempt.transaction_base64,attempt.payer).signature;
  const message=tx.compileMessage(),destination=p.ata(attempt.recipient,asset),index=message.accountKeys.findIndex(k=>k.equals(destination));
  const balances={accountIndex:index,mint:asset.mint,owner:attempt.recipient,programId:asset.tokenProgram,uiTokenAmount:{amount:'2700000',decimals:6,uiAmount:2.7,uiAmountString:'2.7'}};
  let record={slot:123,blockTime:null,version:'legacy',transaction:{message,signatures:tx.signatures.map(s=>s.signature?bs58.encode(s.signature):'')},meta:{err:null,fee:10000,preTokenBalances:[],postTokenBalances:[balances]}};
  p.chain.getTransaction=(async()=>record as unknown as VersionedTransactionResponse) as typeof original;
  assert.deepEqual(await p.verifyTransfer(attempt.signature,attempt,'finalized'),{fee:10000,slot:123});
  for(const mutation of [{mint:USDG_ASSET.mint===asset.mint?usdc.mint:USDG_ASSET.mint},{programId:asset.tokenProgram===SPL_TOKEN_PROGRAM?USDG_ASSET.tokenProgram:SPL_TOKEN_PROGRAM},{owner:payer.publicKey.toBase58()},{uiTokenAmount:{...balances.uiTokenAmount,amount:'2700001'}}]){
   record={...record,meta:{...record.meta,postTokenBalances:[{...balances,...mutation}]}};
   await assert.rejects(p.verifyTransfer(attempt.signature,attempt,'finalized'),p.PaymentProofError);
  }
  for(const key of ['mint','token_program','amount_minor','reference','recipient'] as const){const mutated={...attempt,[key]:key==='amount_minor'?'2700001':Keypair.generate().publicKey.toBase58()};assert.throws(()=>p.assertPaymentMessage(tx,mutated),key);}
  const extra=Transaction.from(Buffer.from(attempt.signed_base64,'base64'));extra.add(new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from('unauthorized')}));assert.throws(()=>p.assertPaymentMessage(extra,attempt));
  assert.equal(asset.instructionPolicy==='spl_checked',tx.instructions[0].programId.equals(TOKEN_PROGRAM_ID));
  const decoded=asset.instructionPolicy==='spl_checked'?decodeTransferCheckedInstruction(tx.instructions[0],TOKEN_PROGRAM_ID):decodeTransferCheckedWithFeeInstruction(tx.instructions[0],new PublicKey(asset.tokenProgram));
  assert.equal(decoded.keys.mint.pubkey.toBase58(),asset.mint);assert.equal(decoded.data.amount,2700000n);assert.equal(decoded.data.decimals,6);
  if('fee' in decoded.data)assert.equal(decoded.data.fee,0n);
 }}finally{p.chain.getTransaction=original;}
});

test('mint policy rejects changed decimals, future fee schedule and unsupported extensions',integration,async()=>{
 // Intentional module-loading boundary: skipped tests cannot load private RPC configuration.
 const {assertMintPolicy,USDG_MINT_EXTENSION_TYPES,USDG_ISSUER_AUTHORITY}=await import('../apps/api/src/payments');
 const base={address:new PublicKey(usdc.mint),mintAuthority:null,supply:100000000n,decimals:6,isInitialized:true,freezeAuthority:null,tlvData:Buffer.alloc(0)};
 assert.doesNotThrow(()=>assertMintPolicy(usdc,base));
 assert.throws(()=>assertMintPolicy(usdc,{...base,decimals:9}));
 assert.throws(()=>assertMintPolicy(usdc,{...base,isInitialized:false}));
 const issuer=new PublicKey(USDG_ISSUER_AUTHORITY).toBuffer(),mint=new PublicKey(USDG_ASSET.mint).toBuffer();
 const fee=Buffer.alloc(112);fee.writeUInt16LE(ExtensionType.TransferFeeConfig,0);fee.writeUInt16LE(108,2);issuer.copy(fee,4);issuer.copy(fee,36);
 const tlv=(type:number,data:Buffer)=>{const header=Buffer.alloc(4);header.writeUInt16LE(type,0);header.writeUInt16LE(data.length,2);return Buffer.concat([header,data]);};
 const hook=Buffer.alloc(64);issuer.copy(hook,0);
 const metadata=Buffer.concat([issuer,mint]);
 // Include observed wire ID16 even though this SDK has no enum name for it.
 const parts=[fee,tlv(3,Buffer.alloc(0)),tlv(12,issuer),tlv(4,Buffer.alloc(0)),tlv(16,Buffer.alloc(0)),tlv(14,hook),tlv(18,metadata),tlv(19,Buffer.alloc(0))];
 const canonical=Buffer.concat(parts);
 assert.equal(USDG_MINT_EXTENSION_TYPES.length,8);
 assert.doesNotThrow(()=>assertMintPolicy(USDG_ASSET,{...base,address:new PublicKey(USDG_ASSET.mint),tlvData:canonical}));
 assert.throws(()=>assertMintPolicy(usdc,{...base,tlvData:canonical}));
 const nonzero=Buffer.from(canonical);nonzero.writeUInt16LE(1,110);
 assert.throws(()=>assertMintPolicy(USDG_ASSET,{...base,tlvData:nonzero}));
 const activeHook=Buffer.from(parts[5]);Keypair.generate().publicKey.toBuffer().copy(activeHook,36); // TLV header4 + authority32.
 assert.throws(()=>assertMintPolicy(USDG_ASSET,{...base,tlvData:Buffer.concat([...parts.slice(0,5),activeHook,...parts.slice(6)])}));
 assert.throws(()=>assertMintPolicy(USDG_ASSET,{...base,tlvData:Buffer.concat([canonical,tlv(ExtensionType.DefaultAccountState,Buffer.from([1]))])}));
});

test('actual SDK mint unpacking rejects an account owned by the wrong token program',integration,async()=>{
 // Intentional module-loading boundary: skipped tests cannot load private RPC configuration.
 const p=await import('../apps/api/src/payments'),original=p.chain.getAccountInfo;
 // Read-only account fixture, not a real devnet inspection or a transferred token.
 p.chain.getAccountInfo=(async()=>({owner:new PublicKey(USDG_ASSET.tokenProgram),data:Buffer.alloc(82),lamports:1,executable:false,rentEpoch:0})) as typeof original;
 try{await assert.rejects(p.mintPolicy(usdc),error=>error instanceof Error&&'code' in error&&error.code==='PAYMENT_UNAVAILABLE');}
 finally{p.chain.getAccountInfo=original;}
});
