import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import type http from 'node:http';
import {Keypair,PublicKey,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {MintLayout,AccountLayout,TOKEN_PROGRAM_ID,ACCOUNT_SIZE,MINT_SIZE,createTransferCheckedInstruction} from '@solana/spl-token';
const privateDir=await mkdtemp(tmpdir()+'/bitpos-builder-fixture-');await mkdir(privateDir+'/keys',{mode:0o700});
const sponsor=Keypair.generate();await writeFile(privateDir+'/keys/fee-sponsor.json',JSON.stringify([...sponsor.secretKey]),{mode:0o600});
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:privateDir});
// No external RPC is reachable from this process. Only the genesis call is
// emulated through fetch; all other read-only chain methods are explicit fakes.
const realFetch=globalThis.fetch;
globalThis.fetch=(async(input,init)=>{const url=String(input);if(url.startsWith('https://')){const request=JSON.parse(String(init?.body));assert.equal(request.method,'getGenesisHash');return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'}),{headers:{'Content-Type':'application/json'}});}return realFetch(input,init);}) as typeof fetch;
const {default:pg}=await import('pg');const {pool,tenant}=await import('../../apps/api/src/db');
const {handle}=await import('../../apps/api/src/index');const {chain}=await import('../../apps/api/src/payments');
const {selectPaymentAsset}=await import('../../apps/api/src/payment-assets');const {decideOnlineOrder}=await import('../../apps/api/src/mobile-food');const {errorView}=await import('../../apps/api/src/authority');
const {USDC_DEVNET_MINT}=await import('../../packages/domain/src/payment-assets');
const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-http.json','utf8'));assert.equal(fixture.environment,'local_disposable_fixture');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const merchant=fixture.merchantId as string;let assertions=0;const results:unknown[]=[];
const originalRegistry=(await admin.query("SELECT enabled,verified_at FROM bitpos.payment_assets WHERE asset_id='usdc-devnet'")).rows[0];
try{
 await admin.query("UPDATE bitpos.payment_assets SET enabled=true,verified_at=clock_timestamp() WHERE asset_id='usdc-devnet'");
 await tenant(merchant,db=>db.query("INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy) VALUES($1,'usdc-devnet',true,$2) ON CONFLICT(merchant_id,asset_id) DO UPDATE SET enabled=true,policy=excluded.policy",[merchant,{id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'}]));
 const mintData=Buffer.alloc(MINT_SIZE);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData);
 let currentPayer=Keypair.generate().publicKey;let sourceReads=0;
 chain.getAccountInfo=(async(address:PublicKey)=>{if(address.toBase58()===USDC_DEVNET_MINT)return {data:mintData,owner:TOKEN_PROGRAM_ID,lamports:1,executable:false,rentEpoch:0};sourceReads++;if(sourceReads!==1)return null;const data=Buffer.alloc(ACCOUNT_SIZE);AccountLayout.encode({mint:new PublicKey(USDC_DEVNET_MINT),owner:currentPayer,amount:100000000n,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return {data,owner:TOKEN_PROGRAM_ID,lamports:1,executable:false,rentEpoch:0};}) as typeof chain.getAccountInfo;
 chain.getLatestBlockhash=async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1});
 chain.getFeeForMessage=(async()=>({context:{slot:1},value:5000})) as typeof chain.getFeeForMessage;
 chain.getMinimumBalanceForRentExemption=async()=>0;
 let entered:()=>void=()=>{},release:()=>void=()=>{},hold=Promise.resolve();
 chain.simulateTransaction=(async()=>{entered();await hold;return {context:{slot:1},value:{err:null,logs:[]}};}) as typeof chain.simulateTransaction;
 const mobileAccount=(await admin.query("SELECT id FROM bitpos.mobile_accounts WHERE auth_subject='fa000000-0000-4000-8000-000000000001'")).rows[0].id;
 // Use an existing owned native session only inside SQL authority calls? The
 // fixture creates orders by its ordinary account-authenticated HTTP APIs.
 const {createHash,randomBytes}=await import('node:crypto');const bearer=randomBytes(32).toString('base64url');
 await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[mobileAccount,randomUUID(),createHash('sha256').update(bearer).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);
 async function post(path:string,body:unknown){const response=await realFetch('http://127.0.0.1:3001'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bearer},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
 for(const winner of (process.argv.includes('--x402')?[]:['rejection','publication','deadline']) as ('rejection'|'publication'|'deadline')[]){
  const quote=await post('/api/mobile/v1/food/quotes',{branchId:fixture.branchId,serving:'pickup',items:[{lineId:randomUUID(),productId:fixture.productId,qty:1,optionVersion:null,selections:[],allergyNote:null}]});const created=(await post('/api/mobile/v1/food/orders',{branchId:fixture.branchId,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()})).order;
  const selected=await tenant(merchant,async db=>{const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[created.id])).rows[0];return selectPaymentAsset(db,order,{assetId:'usdc-devnet',expectedVersion:order.version,idempotencyKey:randomUUID()});});assert.equal(selected.order.settlement.currency,'USDC');
  const access=(await tenant(merchant,async db=>(await db.query('SELECT access_token FROM orders WHERE id=$1',[created.id])).rows[0])).access_token;
  currentPayer=Keypair.generate().publicKey;sourceReads=0;const inSimulation=new Promise<void>(resolve=>{entered=resolve;});hold=new Promise<void>(resolve=>{release=resolve;});
  const req=Readable.from([Buffer.from(JSON.stringify({address:currentPayer.toBase58()}))]) as http.IncomingMessage;req.url='/api/pay/'+access+'/attempt';req.method='POST';req.headers={};
  const pending=handle(req);void pending.catch(()=>{});await Promise.race([inSimulation,pending.then(()=>{throw Error('Builder did not pause');})]);assertions++;
  const decision=()=>tenant(merchant,db=>decideOnlineOrder(db,merchant,'fa000000-0000-4000-8000-000000000010','owner',created.id,{status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'Real builder pause fixture'}));
  if(winner==='rejection')await decision();
  if(winner==='deadline'){await delay(Math.max(0,Date.parse(created.acceptanceDeadline)-Date.now()+40));assert.ok(Date.now()<Date.parse(selected.order.quoteExpiresAt),'acceptance expires while selected payment quote remains live');assertions++;}
  release();
  let response;try{const built=await pending;assert.equal(typeof built.base64,'string');response={status:200,bytesReturned:true};}catch(error){response={status:errorView(error).status,code:errorView(error).code,bytesReturned:false};}
  if(winner==='publication')await decision();
  if(winner==='deadline'){
   const unissued=await tenant(merchant,async db=>(await db.query('SELECT transaction_base64 IS NULL AS unissued,status FROM payment_attempts WHERE order_id=$1',[created.id])).rows[0]);
   assert.deepEqual(unissued,{unissued:true,status:'BUILDING'});assertions++;
   const {reconcileOnlineAcceptance}=await import('../../apps/api/src/mobile-food');
   await tenant(merchant,db=>reconcileOnlineAcceptance(db,merchant,created.id));
  }
  const state=await tenant(merchant,async db=>({order:(await db.query('SELECT reservation_released FROM orders WHERE id=$1',[created.id])).rows[0],attempt:(await db.query('SELECT status,transaction_base64 IS NOT NULL AS issued,signature IS NOT NULL AS signed FROM payment_attempts WHERE order_id=$1',[created.id])).rows[0]}));
  assert.equal(response.status,winner==='publication'?200:409);assert.equal(response.bytesReturned,winner==='publication');assert.equal(state.attempt.issued,winner==='publication');assert.equal(state.attempt.signed,false);assert.equal(state.order.reservation_released,winner!=='publication');assertions+=5;results.push({orderId:created.id,winner,response,state});
 }
 if(process.argv.includes('--x402')){
  const {prepareX402,acceptX402}=await import('../../apps/api/src/x402');
  const {ata}=await import('../../apps/api/src/payments');
  const {encodePaymentSignatureHeader}=await import('@x402/core/http');
  const {default:bs58}=await import('bs58');
  chain.getMultipleAccountsInfo=async()=>[0,1].map(()=>({data:Buffer.alloc(ACCOUNT_SIZE),owner:TOKEN_PROGRAM_ID,lamports:1,executable:false,rentEpoch:0}));
  chain.getTransaction=async()=>null;
  chain.sendRawTransaction=async bytes=>bs58.encode(VersionedTransaction.deserialize(Uint8Array.from(bytes)).signatures[0]);
  for(const winner of ['rejection','signing'] as const){
   const quote=await post('/api/mobile/v1/food/quotes',{branchId:fixture.branchId,serving:'pickup',items:[{lineId:randomUUID(),productId:fixture.productId,qty:1,optionVersion:null,selections:[],allergyNote:null}]});
   const created=(await post('/api/mobile/v1/food/orders',{branchId:fixture.branchId,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()})).order;
   const access=await tenant(merchant,async db=>{const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[created.id])).rows[0];await selectPaymentAsset(db,order,{assetId:'usdc-devnet',expectedVersion:order.version,idempotencyKey:randomUUID()});return order.access_token;});
   const payer=Keypair.generate(),attempt=await prepareX402(merchant,access,payer.publicKey.toBase58()),binding=attempt.x402;
   const tx=new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(binding.feePayer),recentBlockhash:binding.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:20000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1}),createTransferCheckedInstruction(ata(attempt.payer,attempt.payment.asset),new PublicKey(USDC_DEVNET_MINT),ata(attempt.recipient,attempt.payment.asset),payer.publicKey,BigInt(attempt.amount_minor),6),{programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from(binding.memo)}]}).compileToV0Message());
   tx.sign([payer]);const transaction=Buffer.from(tx.serialize()).toString('base64');
   const header=encodePaymentSignatureHeader({x402Version:2,resource:{url:binding.resource},accepted:binding.requirements,payload:{transaction}});
   const inSimulation=new Promise<void>(resolve=>{entered=resolve;});hold=new Promise<void>(resolve=>{release=resolve;});
   const pending=acceptX402(attempt,header);void pending.catch(()=>{});
   await Promise.race([inSimulation,pending.then(()=>{throw Error('SDK did not simulate');})]);assertions++;
   const reject=()=>tenant(merchant,db=>decideOnlineOrder(db,merchant,'fa000000-0000-4000-8000-000000000010','owner',created.id,{status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'x402 signing race fixture'}));
   if(winner==='rejection')await reject();release();
   let outcome;try{outcome=await pending;}catch(error){outcome={status:'rejected',code:errorView(error).code};}
   if(winner==='signing')await reject();
   const row=await tenant(merchant,async db=>(await db.query('SELECT signature,signed_base64,status FROM payment_attempts WHERE id=$1',[attempt.id])).rows[0]);
   assert.equal(!!row.signature,winner==='signing');assert.equal(!!row.signed_base64,winner==='signing');assert.equal(outcome.status,winner==='signing'?'pending':'rejected');assertions+=3;
   if(winner==='signing'){
    const recovered=await prepareX402(merchant,access,payer.publicKey.toBase58());const replay=await acceptX402(recovered,header);assert.equal(replay.status,'pending');assert.equal('signature' in replay?replay.signature:null,row.signature);assertions+=2;
    const changed=VersionedTransaction.deserialize(Buffer.from(transaction,'base64'));changed.signatures[1][0]^=1;
    await assert.rejects(acceptX402(recovered,encodePaymentSignatureHeader({x402Version:2,resource:{url:binding.resource},accepted:binding.requirements,payload:{transaction:Buffer.from(changed.serialize()).toString('base64')}})));assertions++;
    const retained=await tenant(merchant,async db=>(await db.query('SELECT signature,signed_base64,status FROM payment_attempts WHERE id=$1',[attempt.id])).rows[0]);assert.deepEqual(retained,row);assertions++;
   }
   results.push({orderId:created.id,winner,outcome:outcome.status,signatureCommitted:!!row.signature,originalBytesRetained:!!row.signed_base64,status:row.status});
  }
 }
 const receipt={environment:'local_disposable_fixture',assertions,results,limits:['Real builder or x402 SDK/admission/publication and SQL state; deterministic genesis/mint/token/balance/simulation/send/proof adapters','Legacy deadline case crosses immutable acceptance while selected payment quote remains live with worker stopped, then reconciles','Ephemeral sandbox sponsor deleted at exit; no real RPC/broadcast/provider or transfer'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(process.argv.includes('--x402')?'p1-acceptance-x402-signing.json':'p1-acceptance-builder-deadline.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-'+(process.argv.includes('--x402')?'x402':'builder')+'-failure-'+Date.now()+'.json',JSON.stringify({assertions,results,error:String(error)},null,2)+'\n');throw error;}
finally{globalThis.fetch=realFetch;await admin.query("UPDATE bitpos.payment_assets SET enabled=$1,verified_at=$2 WHERE asset_id='usdc-devnet'",[originalRegistry.enabled,originalRegistry.verified_at]);await admin.end();await pool.end();await rm(privateDir,{recursive:true,force:true});}
