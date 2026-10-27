#!/usr/bin/env -S pnpm exec tsx
// Coordinator-only real-devnet lever. Never run as a child, and never fund/create ATAs.
// Usage: pnpm exec tsx tools/runtime/coffee-x402-http-smoke.ts --execute --transfer --run-id <stable-id>
// Reuse the same run ID after interruption; its private journal is the sole retry authority.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import type {PaymentPayload,PaymentRequired} from '@x402/core/types';
import type {KeyPairSigner,TransactionPartialSigner} from '@solana/kit';
import type {TransactionMessage as MutableTransactionMessage} from '@solana/web3.js';

type Counts={payments:number;paidOutbox:number;attempts:number;stock:number;reserved:number;orderBudget:string;dayBudget:string};
type Journal={
 schemaVersion:1;runId:string;merchant:string;product:string;register:string;actor:string;device:string;table:string;
 createKey:string;selectKey:string;selectVersion?:number;quote?:{id:string;priceVersion:string};orderId?:string;access?:string;
 initialStock:number;pricing?:unknown;before?:Counts;sourceBefore?:string;recipientBefore?:string;
 required?:PaymentRequired;requiredHeader?:string;header?:string;signatureCalls:number;
 guards?:{name:string;status:number;error:string}[];guardRuns?:Record<string,number>;legacyRequestStarted?:boolean;legacy?:{status:number;error:string};
 submitRequests:number;replayRequests:number;replayVerified?:boolean;broadcasts:number;signature?:string;receiptHeader?:string;workerCalls?:number;
};
const GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NETWORK='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const USDC='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AMOUNT='2700000';
const orderSchema=z.object({id:z.string().uuid(),version:z.number().int(),status:z.string(),pricing:z.object({total:z.object({currency:z.string(),amountMinor:z.string()})}).passthrough(),settlement:z.object({assetId:z.string(),mint:z.string(),tokenProgram:z.string(),decimals:z.number(),amountMinor:z.string(),recipient:z.string()}).passthrough(),paymentUrl:z.string().url()}).passthrough();
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
function packageVersion(require:NodeRequire,name:string){
 let dir=path.dirname(require.resolve(name));
 for(;;){const p=path.join(dir,'package.json');if(fs.existsSync(p)){const v=JSON.parse(fs.readFileSync(p,'utf8'));if(v.name===name)return z.string().parse(v.version);}const parent=path.dirname(dir);assert.notEqual(parent,dir,'SDK package metadata unavailable');dir=parent;}
}
async function main(){
 const args=process.argv.slice(2),known:Record<string,true>={'--execute':true,'--transfer':true,'--run-id':true};
 let runId:string|undefined;
 for(let i=0;i<args.length;i++){assert.ok(Object.hasOwn(known,args[i]),'Unsupported flag');if(args[i]==='--run-id'){runId=args[++i];assert.ok(runId&&/^[a-zA-Z0-9_-]{1,64}$/.test(runId),'Use a stable nonsecret run ID');}}
 if(!args.includes('--execute')||!args.includes('--transfer')){
  console.log(JSON.stringify({executed:false,proof:false,command:'pnpm exec tsx tools/runtime/coffee-x402-http-smoke.ts --execute --transfer --run-id <stable-id>',prerequisites:['Coordinator explicitly authorizes one 2.700000 devnet USDC transfer','Current integrated API/worker modules and migrations 029–032 on existing dedicated DB','Existing private config loaded via DOTENV_CONFIG_PATH; no secrets on CLI','Public role manifest and existing customer-no-sol / fee-sponsor keys outside repository','Canonical USDC registry verified/enabled; both customer and treasury ATAs precreated','Customer has zero SOL and at least 2700000 USDC atomic units; existing sponsor budget available','No concurrent use of these test wallets; reuse run ID on retry'],limits:['Fixture merchant/device/table; no Phantom, real browser wallet or physical display claim','No funding, faucet, account creation, migrations, budget changes, provider calls or deployment','runWorker restart and repeat-source-cap proofs are separate parent-controlled scenarios']}));return;
 }
 assert.ok(runId,'--run-id is required for retry safety');
 // Intentional opt-in module-loading boundary: static runtime imports validate private
 // config before flags, violating the required safe prerequisites-only invocation.
 await import('dotenv/config');
 const [{config},{pool,tenant},{server},{tableFixture,staffToken},{merchantPaymentAssets,frozenAttempt},{chain,loadSponsor,assertCluster,ata},{verifyX402Transfer,x402Memo},{reconcileMerchant},{PublicKey,VersionedTransaction,TransactionMessage},spl,kit,{x402Client,x402HTTPClient},{ExactSvmScheme},{decodePaymentSignatureHeader,encodePaymentSignatureHeader},bs58Module]=await Promise.all([
  import('../../apps/api/src/config'),import('../../apps/api/src/db'),import('../../apps/api/src/index'),import('../../tests/backend-table-fixture'),import('../../apps/api/src/payment-assets'),import('../../apps/api/src/payments'),import('../../apps/api/src/x402-payment'),import('../../apps/worker/src/index'),import('@solana/web3.js'),import('@solana/spl-token'),import('@solana/kit'),import('@x402/core/client'),import('@x402/svm/exact/client'),import('@x402/core/http'),import('bs58')
 ]);
 const bs58=bs58Module.default,root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url))),privateRoot=fs.realpathSync(config.DEVNET_PRIVATE_DIR);
 assert.ok(privateRoot!==root&&!privateRoot.startsWith(root+path.sep),'Private journal and keys must remain outside repository');
 const journalDir=path.join(privateRoot,'coffee-x402-http');fs.mkdirSync(journalDir,{recursive:true,mode:0o700});assert.ok(!fs.lstatSync(journalDir).isSymbolicLink());fs.chmodSync(journalDir,0o700);
 const journalPath=path.join(journalDir,runId+'.json'),lockPath=path.join(journalDir,runId+'.lock');
 // Do not automatically clear crash locks. Parent must reconcile journal/chain first.
 const lock=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,runId})+'\n');
 let j:Journal|undefined,started=false;
 const originalSend=chain.sendRawTransaction.bind(chain);
 function save(){assert.ok(j);const temp=journalPath+'.next',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(j)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,journalPath);fs.chmodSync(journalPath,0o600);}
 try{
  const require=createRequire(import.meta.url),versions={core:packageVersion(require,'@x402/core'),svm:packageVersion(require,'@x402/svm'),kit:packageVersion(require,'@solana/kit')};assert.equal(versions.core,'2.28.0');assert.equal(versions.svm,'2.28.0');
  await assertCluster();assert.equal(await chain.getGenesisHash(),GENESIS);
  const manifest=z.object({wallets:z.array(z.object({id:z.string(),address:z.string()}))}).parse(JSON.parse(fs.readFileSync(path.join(privateRoot,'wallets.public.json'),'utf8')));
  function role(id:string){const r=manifest.wallets.find(w=>w.id===id);assert.ok(r,'Required public devnet role missing');return r.address;}
  const treasury=role('merchant-a-treasury'),customer=role('customer-no-sol'),sponsor=role('fee-sponsor');
  assert.notEqual(treasury,'11111111111111111111111111111111');assert.equal(loadSponsor().publicKey.toBase58(),sponsor);assert.equal(new Set([treasury,customer,sponsor]).size,3);
  assert.equal(await chain.getBalance(new PublicKey(customer),'finalized'),0,'Customer must have actual zero SOL');
  const source=spl.getAssociatedTokenAddressSync(new PublicKey(USDC),new PublicKey(customer),false,spl.TOKEN_PROGRAM_ID),destination=spl.getAssociatedTokenAddressSync(new PublicKey(USDC),new PublicKey(treasury),false,spl.TOKEN_PROGRAM_ID);
  const accounts=await Promise.all([spl.getAccount(chain,source,'finalized',spl.TOKEN_PROGRAM_ID),spl.getAccount(chain,destination,'finalized',spl.TOKEN_PROGRAM_ID)]);
  assert.equal(accounts[0].owner.toBase58(),customer);assert.equal(accounts[1].owner.toBase58(),treasury);for(const a of accounts){assert.equal(a.mint.toBase58(),USDC);assert.equal(a.isFrozen,false);}assert.equal(accounts[0].delegate,null,'Do not overlap a delegation proof');
  server.listen(0,'127.0.0.1');await once(server,'listening');started=true;const listen=server.address();assert.ok(listen&&typeof listen!=='string');const origin='http://127.0.0.1:'+listen.port;
  async function request(route:string,body?:unknown,token?:string,headers:Record<string,string>={}){
   const res=await fetch(origin+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
   const data:unknown=await res.json();return {res,data};
  }
  async function ok(route:string,body?:unknown,token?:string){const r=await request(route,body,token);assert.ok(r.res.ok,'HTTP operation rejected ('+r.res.status+'); inspect private journal, never blindly repeat');return r.data;}
  if(fs.existsSync(journalPath)){
   assert.ok(!fs.lstatSync(journalPath).isSymbolicLink());assert.equal(fs.statSync(journalPath).mode&0o077,0);j=JSON.parse(fs.readFileSync(journalPath,'utf8')) as Journal;assert.equal(j.schemaVersion,1);assert.equal(j.runId,runId);
  }else{
   assert.ok(accounts[0].amount>=BigInt(AMOUNT),'Existing USDC balance insufficient; no funding is authorized');
   const f=await tableFixture(3);
   j={schemaVersion:1,runId,merchant:f.merchant,product:f.product,register:f.register.id,actor:f.actor,device:f.a.id,table:f.table.id,createKey:randomUUID(),selectKey:randomUUID(),initialStock:3,signatureCalls:0,submitRequests:0,replayRequests:0,broadcasts:0};save();
   // The existing fixture starts all-ones. Replace it before any quote or order.
   await tenant(j.merchant,db=>db.query('UPDATE merchants SET treasury=$2 WHERE id=$1',[j!.merchant,treasury]));
  }
  const state=j;
  if(!state.quote)await tenant(state.merchant,db=>db.query('UPDATE merchants SET treasury=$2 WHERE id=$1 AND treasury=$3',[state.merchant,treasury,'11111111111111111111111111111111']));
  assert.equal((await tenant(state.merchant,async db=>(await db.query('SELECT treasury FROM merchants WHERE id=$1',[state.merchant])).rows[0])).treasury,treasury,'Fixture treasury must be the owned public role before quotes');
  const token=await staffToken(pool,state.merchant,state.actor);
  const supported=await request('/api/x402/supported');assert.equal(supported.res.status,200);
  const capabilities=z.object({kinds:z.array(z.object({x402Version:z.number(),scheme:z.string(),network:z.string(),extra:z.object({feePayer:z.string()})}))}).parse(supported.data);assert.ok(capabilities.kinds.some(k=>k.x402Version===2&&k.scheme==='exact'&&k.network===NETWORK&&k.extra.feePayer===sponsor));
  await tenant(state.merchant,async db=>{
   const row=(await db.query('SELECT enabled,version,policy FROM merchant_payment_assets WHERE merchant_id=$1 AND asset_id=$2',[state.merchant,'usdc-devnet'])).rows[0];
   if(!row?.enabled)await merchantPaymentAssets(db,state.merchant,state.actor,'owner','PUT',{assetId:'usdc-devnet',enabled:true,expectedVersion:row?.version??0,denominationPolicy:{id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'}});
   else assert.deepEqual(row.policy,{id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'});
  });
  if(!state.quote){state.quote=z.object({id:z.string().uuid(),priceVersion:z.string().uuid()}).parse(await ok('/api/registers/'+state.register+'/quotes',{items:[{productId:state.product,qty:1}],serving:{kind:'counter'}},token));save();}
  if(!state.orderId){const order=orderSchema.parse(await ok('/api/registers/'+state.register+'/orders',{items:[{productId:state.product,qty:1}],serving:{kind:'counter'},quoteId:state.quote.id,priceVersion:state.quote.priceVersion,idempotencyKey:state.createKey},token));state.orderId=order.id;state.access=new URL(order.paymentUrl).pathname.split('/').pop()!;state.pricing=order.pricing;save();}
  assert.ok(state.access&&state.orderId);const pay='/api/pay/'+state.access,x402=pay+'/x402';
  let order=orderSchema.parse(await ok(pay));assert.equal(order.id,state.orderId);assert.deepEqual(order.pricing,state.pricing);assert.deepEqual(order.pricing.total,{currency:'USD',amountMinor:'270'});
  if(!state.required){
   if(state.selectVersion===undefined){state.selectVersion=order.version;save();}
   const selected=z.object({order:orderSchema}).parse(await ok(pay+'/asset',{assetId:'usdc-devnet',expectedVersion:state.selectVersion,idempotencyKey:state.selectKey}));order=selected.order;
   const saved=await tenant(state.merchant,async db=>(await db.query('SELECT result FROM payment_asset_requests WHERE merchant_id=$1 AND order_id=$2 AND idempotency_key=$3',[state.merchant,state.orderId,state.selectKey])).rows[0]);assert.ok(saved,'Canonical asset idempotency must be saved before issuance');
  }
  assert.equal(order.settlement.assetId,'usdc-devnet');assert.equal(order.settlement.mint,USDC);assert.equal(order.settlement.tokenProgram,spl.TOKEN_PROGRAM_ID.toBase58());assert.equal(order.settlement.decimals,6);assert.equal(order.settlement.amountMinor,AMOUNT);assert.equal(order.settlement.recipient,treasury);
  async function snapshot():Promise<Counts>{return tenant(state.merchant,async db=>(await db.query(`SELECT
   (SELECT count(*)::int FROM payments WHERE merchant_id=$1 AND order_id=$2 AND state='SETTLED') AS payments,
   (SELECT count(*)::int FROM outbox_events WHERE merchant_id=$1 AND order_id=$2 AND payload->'payload'->>'status'='PAID') AS "paidOutbox",
   (SELECT count(*)::int FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2) AS attempts,
   p.stock,p.reserved,
   coalesce((SELECT reserved_lamports::text FROM sponsor_orders WHERE merchant_id=$1 AND order_id=$2),'0') AS "orderBudget",
   coalesce((SELECT reserved_lamports::text FROM sponsor_days WHERE day=current_date),'0') AS "dayBudget"
   FROM products p WHERE p.merchant_id=$1 AND p.id=$3`,[state.merchant,state.orderId,state.product])).rows[0]);}
  if(!state.before){state.before=await snapshot();assert.equal(state.before.payments,0);assert.equal(state.before.paidOutbox,0);assert.equal(state.before.attempts,0);assert.equal(state.before.stock,state.initialStock);assert.equal(state.before.reserved,1);state.sourceBefore=accounts[0].amount.toString();state.recipientBefore=accounts[1].amount.toString();save();}
  const core=new x402Client().setSpendControls({maxAmountPerPayment:'$2.70',allowedAssets:[{network:NETWORK,asset:USDC,maxAmountPerPayment:AMOUNT}]}),http=new x402HTTPClient(core);
  if(!state.required){const issued=await request(x402,{address:customer});assert.equal(issued.res.status,402);assert.equal(issued.res.headers.get('cache-control'),'no-store');state.requiredHeader=issued.res.headers.get('payment-required')!;assert.ok(state.requiredHeader);state.required=http.getPaymentRequiredResponse(n=>issued.res.headers.get(n),issued.data);assert.deepEqual(state.required,issued.data);save();}
  const required=state.required;assert.equal(required.x402Version,2);assert.equal(required.accepts.length,1);const requirement=required.accepts[0];assert.equal(requirement.scheme,'exact');assert.equal(requirement.network,NETWORK);assert.equal(requirement.asset,USDC);assert.equal(requirement.amount,AMOUNT);assert.equal(requirement.payTo,treasury);assert.equal(requirement.extra?.feePayer,sponsor);assert.ok(required.resource?.url.endsWith(x402));
  async function attempt(){return tenant(state.merchant,async db=>{const rows=(await db.query('SELECT * FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2',[state.merchant,state.orderId])).rows;assert.equal(rows.length,1);const a=await frozenAttempt(db,rows[0]);assert.ok(a.x402);return a as typeof a&{x402:NonNullable<typeof a.x402>};});}
  let a=await attempt();assert.equal(a.x402.owner,customer);assert.equal(a.x402.transferAuthority,customer);assert.equal(a.x402.resource,required.resource?.url);assert.deepEqual(a.x402.requirements,requirement);assert.equal(requirement.extra?.recentBlockhash,a.blockhash);assert.equal(requirement.extra?.memo,a.x402.memo);assert.equal(a.payment.asset.mint,USDC);assert.equal(ata(treasury,a.payment.asset).toBase58(),destination.toBase58());
  if(!state.header){
   assert.equal(state.signatureCalls,0,'Interrupted host signing: do not sign again; parent must inspect private journal');assert.equal(a.signature,null);assert.equal(a.signed_base64,null);
   const bytes=Uint8Array.from(z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(fs.readFileSync(path.join(privateRoot,'keys/customer-no-sol.json'),'utf8'))));
   let native:KeyPairSigner;
   try{native=await kit.createKeyPairSignerFromBytes(bytes,false);}finally{bytes.fill(0);}
   assert.equal(native.address,customer);assert.equal(native.keyPair.privateKey.extractable,false);
   const signer:TransactionPartialSigner={address:native.address,signTransactions:async(txs,options)=>{assert.equal(txs.length,1);assert.equal(state.signatureCalls,0);assert.equal(await chain.getGenesisHash(),GENESIS);assert.equal(await chain.getBalance(new PublicKey(customer),'finalized'),0);state.signatureCalls++;save();return native.signTransactions(txs,options);}};
   core.register(NETWORK,new ExactSvmScheme(signer,{rpcUrl:config.SOLANA_RPC}));
   const payload=await http.createPaymentPayload(required);assert.equal(payload.resource?.url,required.resource?.url);assert.deepEqual(payload.accepted,requirement);
   const headers=http.encodePaymentSignatureHeader(payload);state.header=headers['PAYMENT-SIGNATURE'];assert.ok(state.header);save();
  }
  assert.equal(state.signatureCalls,1);const payload=decodePaymentSignatureHeader(state.header),partial=VersionedTransaction.deserialize(Buffer.from(z.string().parse(payload.payload.transaction),'base64'));
  assert.equal(partial.version,0);assert.equal(partial.message.recentBlockhash,a.x402.blockhash);assert.equal(partial.signatures.length,2);assert.ok(partial.signatures[0].every(v=>v===0));assert.ok(partial.signatures[1].some(v=>v!==0));
  chain.sendRawTransaction=async(raw,options)=>{
   assert.equal(await chain.getGenesisHash(),GENESIS);const current=await attempt();assert.ok(current.signature&&current.signed_base64,'Broadcast requires durable fully signed journal');assert.equal(Buffer.from(raw).toString('base64'),current.signed_base64);assert.equal(bs58.encode(VersionedTransaction.deserialize(Buffer.from(raw)).signatures[0]),current.signature);assert.ok(!state.signature||state.signature===current.signature,'At most one financial signature');state.signature=current.signature;state.broadcasts++;save();return originalSend(raw,options);
  };
  if(!state.guards){
   assert.equal(state.submitRequests,0);assert.equal(a.signature,null);const baseline=await snapshot();assert.equal(baseline.attempts,1);assert.equal(baseline.orderBudget,'1000000');assert.equal(BigInt(baseline.dayBudget)-BigInt(state.before.dayBudget),1000000n);
   const variants:{name:string;payload:PaymentPayload}[]=[];
   function variant(name:string,edit:(p:PaymentPayload)=>void){const p=structuredClone(payload);edit(p);variants.push({name,payload:p});}
   variant('wrong-resource',p=>{p.resource={...p.resource!,url:'https://fixture.invalid/not-this-order'};});
   variant('wrong-accepted-mint',p=>{p.accepted.asset=customer;});
   variant('wrong-accepted-amount',p=>{p.accepted.amount='2700001';});
   variant('wrong-accepted-recipient',p=>{p.accepted.payTo=customer;});
   function changedMessage(name:string,change:(m:MutableTransactionMessage)=>void){variant(name,p=>{const tx=VersionedTransaction.deserialize(Buffer.from(z.string().parse(p.payload.transaction),'base64')),m=TransactionMessage.decompile(tx.message);change(m);const bad=new VersionedTransaction(m.compileToV0Message());bad.signatures[1]=tx.signatures[1];p.payload.transaction=Buffer.from(bad.serialize()).toString('base64');});}
   // Intentionally partial/stale signatures, never fresh malicious owner signatures.
   changedMessage('wrong-mint',m=>{m.instructions[2].keys[1].pubkey=new PublicKey(customer);});
   changedMessage('wrong-program',m=>{m.instructions[2].programId=spl.TOKEN_2022_PROGRAM_ID;});
   changedMessage('wrong-amount',m=>{const data=Buffer.from(m.instructions[2].data);data.writeBigUInt64LE(2700001n,1);m.instructions[2].data=data;});
   changedMessage('wrong-reference',m=>{m.instructions[3].data=Buffer.from(x402Memo(a.merchant_id,a.order_id,a.id,customer));});
   changedMessage('wrong-recipient',m=>{m.instructions[2].keys[2].pubkey=source;});
   changedMessage('wrong-blockhash',m=>{m.recentBlockhash=customer;});
   variant('wrong-owner-signature',p=>{const tx=VersionedTransaction.deserialize(Buffer.from(z.string().parse(p.payload.transaction),'base64'));tx.signatures[1][0]^=1;p.payload.transaction=Buffer.from(tx.serialize()).toString('base64');});
   const guards:NonNullable<Journal['guards']>=[];
   state.guardRuns??={};
   for(const v of variants){
    const runs:number=state.guardRuns[v.name]??0;assert.ok(runs<3,'Bounded guard limit reached');state.guardRuns[v.name]=runs+1;save();
    const broadcasts=state.broadcasts,r=await request(x402,{address:customer},undefined,{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(v.payload)});assert.ok([422,503].includes(r.res.status),'Malformed partial payload must be refused');const error=z.object({error:z.enum(['INVALID_TRANSACTION','PAYMENT_UNAVAILABLE'])}).parse(r.data).error;assert.equal(state.broadcasts,broadcasts,'Guard must reject before broadcast');assert.deepEqual(await snapshot(),baseline,'Guard changed attempts/budget/stock/payment/outbox');const current=await attempt();assert.equal(current.signature,null);assert.equal(current.signed_base64,null);guards.push({name:v.name,status:r.res.status,error});
   }
   state.guards=guards;save();
  }
  a=await attempt();
  if(!a.signature){
   assert.ok(state.submitRequests<3,'Bounded submit limit reached; parent must reconcile');assert.equal(await chain.getGenesisHash(),GENESIS);assert.equal(await chain.getBalance(new PublicKey(customer),'finalized'),0);
   state.submitRequests++;const doLegacy=!state.legacyRequestStarted;state.legacyRequestStarted=true;save();
   // One legacy request races the SDK submit against this SAME already-issued live attempt.
   const [submitted,legacy]=await Promise.all([request(x402,{address:customer},undefined,{'PAYMENT-SIGNATURE':state.header}),doLegacy?request(pay+'/attempt',{address:customer}):Promise.resolve(null)]);
   if(legacy){assert.equal(legacy.res.status,409,'Legacy channel must observe pending fence');const error=z.object({error:z.union([z.string(),z.object({code:z.string()}).passthrough()])}).parse(legacy.data).error;const code=typeof error==='string'?error:error.code;assert.equal(code,'PAYMENT_PENDING');state.legacy={status:legacy.res.status,error:code};save();}
   assert.ok([200,202].includes(submitted.res.status),'SDK settlement rejected; preserve journal, no replacement transfer');
   if(submitted.res.status===200){state.receiptHeader=submitted.res.headers.get('payment-response')??undefined;save();}
   a=await attempt();assert.ok(a.signature&&a.signed_base64,'SDK must persist actual signature before dispatch');state.signature=a.signature;save();
  }else{assert.ok(!state.signature||state.signature===a.signature);state.signature=a.signature;save();}
  assert.ok(state.legacy,'Interrupted race has no observed legacy result; parent must inspect, do not repeat race');
  const deadline=Date.now()+90_000;let status;
  do{status=(await chain.getSignatureStatuses([state.signature!],{searchTransactionHistory:true})).value[0];if(status?.confirmationStatus==='finalized')break;await delay(1500);}while(Date.now()<deadline);
  assert.equal(status?.confirmationStatus,'finalized','Actual finality pending: preserve journal and rerun same ID');assert.equal(status.err,null,'Finalized transaction failed; no replacement payment is authorized');
  // Real worker reconciliation reads the same journal; no fabricated records/flags.
  if((state.workerCalls??0)<1){state.workerCalls=1;save();await reconcileMerchant(state.merchant);}
  a=await attempt();assert.equal(a.status,'FINALIZED');const chainProof=await verifyX402Transfer(state.signature!,a,'finalized');assert.ok(chainProof);const settledBytes=a.signed_base64;
  order=orderSchema.parse(await ok(pay));assert.equal(order.status,'PAID');assert.deepEqual(order.pricing,state.pricing);assert.equal(order.settlement.amountMinor,AMOUNT);
  const after=await snapshot();assert.equal(after.payments-state.before.payments,1);assert.equal(after.paidOutbox-state.before.paidOutbox,1);assert.equal(state.before.stock-after.stock,1);assert.equal(state.before.reserved-after.reserved,1);assert.equal(after.attempts-state.before.attempts,1);
  const settled=await tenant(state.merchant,async db=>(await db.query("SELECT signature,amount_minor::text FROM payments WHERE merchant_id=$1 AND order_id=$2 AND state='SETTLED'",[state.merchant,state.orderId])).rows);assert.deepEqual(settled,[{signature:state.signature,amount_minor:AMOUNT}]);
  const sourceAfter=(await spl.getAccount(chain,source,'finalized',spl.TOKEN_PROGRAM_ID)).amount.toString(),recipientAfter=(await spl.getAccount(chain,destination,'finalized',spl.TOKEN_PROGRAM_ID)).amount.toString();assert.equal(BigInt(state.sourceBefore!)-BigInt(sourceAfter),BigInt(AMOUNT));assert.equal(BigInt(recipientAfter)-BigInt(state.recipientBefore!),BigInt(AMOUNT));assert.equal(await chain.getBalance(new PublicKey(customer),'finalized'),0);
  // Exactly one replay request. Persist before egress; never invent a replay after a crash.
  if(!state.replayVerified){
   assert.equal(state.replayRequests,0,'Replay response lost: parent must inspect private journal');const broadcastBefore=state.broadcasts;state.replayRequests++;save();
   const replay=await request(x402,{address:customer},undefined,{'PAYMENT-SIGNATURE':state.header});assert.equal(replay.res.status,200);state.receiptHeader=replay.res.headers.get('payment-response')??undefined;assert.ok(state.receiptHeader);const receipt=http.getPaymentSettleResponse(n=>replay.res.headers.get(n));assert.equal(receipt.success,true);assert.equal(receipt.transaction,state.signature);assert.equal(receipt.network,NETWORK);assert.equal(receipt.payer,customer);assert.equal(state.broadcasts,broadcastBefore);assert.equal(state.signatureCalls,1);assert.deepEqual(await snapshot(),after);assert.equal((await spl.getAccount(chain,source,'finalized',spl.TOKEN_PROGRAM_ID)).amount.toString(),sourceAfter);
   state.replayVerified=true;save();
  }
  assert.equal(state.replayRequests,1);assert.ok(state.receiptHeader);
  while((state.workerCalls??0)<3){state.workerCalls=(state.workerCalls??0)+1;save();await reconcileMerchant(state.merchant);}
  assert.deepEqual(await snapshot(),after);const recovered=await attempt();assert.equal(recovered.signed_base64,settledBytes);assert.equal(recovered.signature,state.signature);assert.equal(recovered.x402.quoteId,a.x402.quoteId);
  const receipt=http.getPaymentSettleResponse(n=>n.toLowerCase()==='payment-response'?state.receiptHeader:null);assert.equal(receipt.success,true);assert.equal(receipt.transaction,state.signature);assert.equal(receipt.network,NETWORK);assert.equal(receipt.payer,customer);
  const evidence={schemaVersion:1,scope:'coffee-copilot-x402-v2-20261012',observedAt:new Date().toISOString(),runId,origin:'actual_exported_API_ephemeral_localhost_genuine_SDK_owner_host_signonly_devnet_finalized',sdk:versions,network:NETWORK,genesis:GENESIS,roles:{customer:{role:'customer-no-sol',address:customer,fixtureHostSigner:true},treasury:{role:'merchant-a-treasury',address:treasury},feeSponsor:{role:'fee-sponsor',address:sponsor}},fixture:{merchantId:state.merchant,productId:state.product,registerId:state.register,tableId:state.table,deviceId:state.device,display:'simulated fixture routing; no physical display'},orderId:state.orderId,originalQuoteId:state.quote.id,paymentQuoteId:a.payment.quoteId,attemptId:a.id,reference:a.reference,signature:state.signature,chainProof,finalized:true,paid:true,headers:{paymentRequired:{name:'PAYMENT-REQUIRED',sha256:digest(state.requiredHeader!),decoded:{...required,resource:{description:required.resource?.description,mimeType:required.resource?.mimeType,url:'[MASKED capability resource]',urlSha256:digest(required.resource!.url)}}},paymentSignature:{name:'PAYMENT-SIGNATURE',sha256:digest(state.header),ownerSignatureCount:state.signatureCalls},paymentResponse:{name:'PAYMENT-RESPONSE',raw:state.receiptHeader,decoded:receipt}},quote:{currency:'USD',priceMinor:'270',assetId:'usdc-devnet',mint:USDC,program:spl.TOKEN_PROGRAM_ID.toBase58(),decimals:6,amountMinor:AMOUNT,recipient:treasury},effects:{baseline:state.before,after,deltas:{settledPayments:1,paidOutbox:1,stock:-1,reserved:-1,attempts:1}},balances:{sourceBefore:state.sourceBefore,sourceAfter,recipientBefore:state.recipientBefore,recipientAfter,customerSOL:0},guards:state.guards,legacyRace:{...state.legacy,liveAttemptId:a.id,additionalLegacyRequests:1,kind:'legacy issuance versus SDK submission of an already-issued x402 attempt'},replay:{requests:1,unchangedSource:true,unchangedDB:true,noNewOwnerSignature:true,noBroadcast:true},worker:{reconciliationCalls:3,restartObserved:false,journalUnchanged:true},limits:{browserPhantom:false,physicalDisplay:false,workerProcessRestart:false,repeatSourceCap:'separate parent scenario',maliciousPayloads:'partial/stale signature mutations only; no malicious fresh signatures',aiProviderProof:false}};
  const evidenceDir=path.join(root,'.omp/work/coffee-copilot-x402-v2-20261012/evidence');fs.mkdirSync(evidenceDir,{recursive:true});const evidencePath=path.join(evidenceDir,'x402-http-'+runId+'.json');fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({executed:true,finalized:true,evidencePath:path.relative(root,evidencePath),orderId:state.orderId,attemptId:a.id,signature:state.signature,customerSOL:0,transferAtomic:AMOUNT,sdk:versions}));
 }finally{
  chain.sendRawTransaction=originalSend;
  if(started){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
  await pool.end();fs.closeSync(lock);fs.unlinkSync(lockPath);
 }
}
// Never dump errors containing live URLs, capabilities, private configuration or RPC payloads.
main().catch(()=>{console.error('x402 HTTP scenario unsuccessful; no success evidence written. Coordinator: inspect the private run journal and reconcile the existing attempt; never change run ID to retry a payment.');process.exitCode=1;});
