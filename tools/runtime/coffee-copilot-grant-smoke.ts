#!/usr/bin/env -S pnpm exec tsx
/**
 * Coordinator-only SOURCE lever. Children must not execute this file.
 * Default invocation prints prerequisites WITHOUT loading config, DB or RPC modules.
 * Authorized envelope: ONE owner purpose-message signature, ONE 24h ApproveChecked
 * (per order 2.7 USDC / total 5.4), TWO 2.7 USDC transfers, ONE owner Revoke.
 * No funding, ATA creation, new approvals, budget increases, provider or deployment calls.
 *
 * Exact coordinator orchestration (normal private environment supplied out of band):
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <stable-id> --phase approved
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <same-id> --phase signed-1
 *   # Process has CLOSED its exported API server and DB pool. Restart is real, not a mocked callback.
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <same-id> --phase submitted-1
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <same-id> --phase paid-1
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <same-id> --phase signed-2
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <same-id> --phase submitted-2
 *   pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <same-id> --phase complete
 * Omitting --phase runs to complete but MUST NOT be described as a process-restart proof.
 * A signed-N checkpoint deliberately blocks network send AFTER the product's durable
 * signature/authorization commit. The next process invokes the real exported worker.
 * Keep all other wallet users and financial workers quiescent throughout this scenario.
 * Crash lock: inspect the private journal, PID and actual chain/DB before removing ONLY
 * the stale lock. Never remove the journal or active-run authority; never use a new ID.
 * A lost session/prepare HTTP response is retained as unknown and stops this lever;
 * these APIs currently have no client idempotency key. No fabricated recovery token.
 * Emergency bounded teardown after an approved grant: same flags/ID, --phase revoke-only.
 * It never starts another order/payment/approval; pauses, reconciles known truth, revokes
 * once and retains unresolved signatures/holds. Teardown is NOT two-payment success.
 * Evidence is an allowlist written only after ALL final observed assertions and revoke.
 * DB table/device presence is a fixture, NOT physical hardware, Phantom, mic or browser.
 * SPL on-chain policy is cumulative allowance/owner revoke ONLY. Trusted BitPOS enforces
 * time, merchant/payee, explicit ORDER and per-order cap. A compromised delegate can
 * transfer/burn remaining allowance until on-chain owner revoke, even after service expiry.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {WebSocket} from 'ws';
import type {PaymentPayload} from '@x402/core/types';

const GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NETWORK='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const USDC='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AMOUNT='2700000',TOTAL='5400000';
const PHASES=['approved','signed-1','submitted-1','paid-1','signed-2','submitted-2','paid-2','revoked','revoke-only','complete'] as const;
type Phase=typeof PHASES[number];
type Round=z.infer<typeof roundSchema>;
type Journal=z.infer<typeof journalSchema>;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=z.string().uuid(),cap=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const settlementSchema=z.object({assetId:z.literal('usdc-devnet'),mint:z.literal(USDC),genesisHash:z.literal(GENESIS),tokenProgram:z.string(),decimals:z.literal(6),amountMinor:z.literal(AMOUNT),recipient:z.string()}).passthrough();
const orderSchema=z.object({id:uuid,status:z.enum(['AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING','PAID','EXPIRED','RECOVERY']),paymentQuoteId:uuid,pricing:z.object({total:z.object({currency:z.literal('USD'),amountMinor:z.literal('270')}).passthrough()}).passthrough(),settlement:settlementSchema}).passthrough();
const policySchema=z.object({version:z.literal(1),grantId:uuid,generation:uuid,merchantId:uuid,domain:z.string(),owner:z.string(),sourceAta:z.string(),delegate:z.string(),recipient:z.string(),mint:z.literal(USDC),tokenProgram:z.string(),genesisHash:z.literal(GENESIS),decimals:z.literal(6),period:z.enum(['day','week','month']),startsAt:z.string(),expiresAt:z.string(),perOrderMinor:z.string(),totalMinor:z.string()});
const replySchema=z.object({visitToken:cap.optional(),challengeId:uuid.optional(),message:z.string().optional(),sessionToken:cap.optional(),owner:z.string().optional(),expiresAt:z.string().optional(),grantId:uuid.optional(),policy:policySchema.optional(),base64:z.string().optional(),quote:z.object({id:uuid,priceVersion:uuid,settlement:settlementSchema,total:z.object({currency:z.string(),decimals:z.number(),amountMinor:z.string()}),delegationGrantId:uuid}).passthrough().optional(),order:orderSchema.optional(),status:z.string().optional(),signature:z.string().optional(),responseHeader:z.string().optional(),dismissed:z.boolean().optional(),error:z.unknown().optional()}).passthrough();
const grantViewSchema=z.object({policy:policySchema,status:z.enum(['PREPARED','ACTIVE','PAUSED','REVOKING','REVOKED','EXPIRED','FAILED']),spentMinor:z.string(),reservedMinor:z.string(),remainingMinor:z.string(),balanceMinor:z.string(),allowanceMinor:z.string(),chainDelegate:z.string().nullable(),approveSignature:z.string().nullable(),revokeSignature:z.string().nullable(),history:z.array(z.object({attemptId:z.string().nullable(),orderId:uuid,amountMinor:z.string(),state:z.string(),signature:z.string().nullable()}))});
const roundSchema=z.object({visitRequest:uuid,visitToken:cap.optional(),createKey:uuid,nonce:uuid,repeatExpiresAt:z.string().datetime().optional(),quote:z.object({id:uuid,priceVersion:uuid,settlement:z.unknown()}).optional(),orderId:uuid.optional(),paymentQuoteId:uuid.optional(),pricing:z.unknown().optional(),checkoutBody:z.record(z.string(),z.unknown()).optional(),attemptId:uuid.optional(),signature:z.string().optional(),signedBase64:z.string().optional(),partialBase64:z.string().optional(),signedHeader:z.string().optional(),requests:z.number().int().min(0).max(3),replays:z.number().int().min(0).max(3),replayObserved:z.boolean().optional(),paid:z.boolean().optional(),dismissed:z.boolean().optional(),stagedPid:z.number().optional(),recoveredPid:z.number().optional(),submittedPid:z.number().optional(),submitRecoveredPid:z.number().optional(),workerCalls:z.number().int().min(0).max(3)});
const journalSchema=z.object({schemaVersion:z.literal(1),runId:z.string(),merchant:uuid,other:uuid,product:uuid,actor:uuid,table:uuid,device:uuid,entry:cap,deviceToken:cap,foreignEntry:cap.optional(),initialStock:z.literal(4),sourceBefore:z.string().regex(/^[0-9]+$/),destinationBefore:z.string().regex(/^[0-9]+$/),challenge:z.object({challengeId:uuid,message:z.string()}).optional(),messageSignature:z.string().optional(),sessionToken:cap.optional(),prepare:z.object({grantId:uuid,policy:policySchema,base64:z.string()}).optional(),approvalBase64:z.string().optional(),approvalSignature:z.string().optional(),revokeUnsigned:z.string().optional(),revokeBase64:z.string().optional(),revokeSignature:z.string().optional(),ownerMessageSignatures:z.number().int().min(0).max(1),ownerApproveSignatures:z.number().int().min(0).max(1),ownerRevokeSignatures:z.number().int().min(0).max(1),ownerPerOrderSignatures:z.literal(0),operations:z.record(z.string(),z.object({bodyHash:z.string(),requests:z.number().int().min(0).max(3),observed:z.boolean().optional(),response:z.unknown().optional()})),guards:z.record(z.string(),z.object({observed:z.boolean(),repetitions:z.number().int().min(0).max(3),boundary:z.string()})),rounds:z.tuple([roundSchema,roundSchema]),broadcasts:z.record(z.string(),z.object({kind:z.enum(['approve','payment','revoke']),calls:z.number().int().min(0).max(3),returned:z.number().int().min(0).max(3)})),paused:z.boolean().optional(),completed:z.boolean().optional(),invocations:z.array(z.object({pid:z.number(),phase:z.enum(PHASES),at:z.string()})),authenticationRecovery:z.object({retiredJournalSha256:z.string().regex(/^[0-9a-f]{64}$/),reason:z.literal('ZEROED_PROOF_KEY_BEFORE_USE'),invalidNonOwnerSigningAttempts:z.literal(1),confirmedNoFinancialAuthority:z.literal(true),publicEvidencePath:z.string()}).optional()});
function version(require:NodeRequire,name:string){let dir=path.dirname(require.resolve(name));for(;;){const file=path.join(dir,'package.json');if(fs.existsSync(file)){const pkg=JSON.parse(fs.readFileSync(file,'utf8'));if(pkg.name===name)return z.string().parse(pkg.version);}const parent=path.dirname(dir);assert.notEqual(parent,dir);dir=parent;}}
function durable(file:string,value:unknown){const tmp=file+'.next',fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);fs.chmodSync(file,0o600);const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
function privateFile(file:string){assert.ok(!fs.lstatSync(file).isSymbolicLink());assert.equal(fs.statSync(file).mode&0o077,0);}

async function main(){
 const args=process.argv.slice(2);let runId:string|undefined,phase:Phase='complete';const seen=new Set<string>();
 for(let i=0;i<args.length;i++){const flag=args[i];assert.ok(['--execute','--transfer','--run-id','--phase'].includes(flag)&&!seen.has(flag),'Unsupported or duplicate flag');seen.add(flag);if(flag==='--run-id'){runId=args[++i];assert.ok(runId&&/^[A-Za-z0-9_-]{1,64}$/.test(runId),'Stable nonsecret run ID required');}if(flag==='--phase')phase=z.enum(PHASES).parse(args[++i]);}
 if(!seen.has('--execute')||!seen.has('--transfer')){
  console.log(JSON.stringify({executed:false,proof:false,command:'pnpm exec tsx tools/runtime/coffee-copilot-grant-smoke.ts --execute --transfer --run-id <stable-id> --phase complete',prerequisites:['Coordinator authorization: one initial 24h approval, two 2700000 atomic devnet USDC payments, one owner revoke only','Integrated exported API server, private grants checkout status paid/pending/rejected + actual order, exported reconcileMerchant; migrations 029–032 on existing dedicated OCI DB','Normal private environment via DOTENV_CONFIG_PATH, installed SDK core/svm 2.28.0; existing DEVNET_PRIVATE_DIR outside repository','Existing customer-no-sol / fee-sponsor key files and public manifest; source and canonical treasury USDC ATAs already exist','Customer zero SOL, source USDC >=5400000; no preexisting delegate or unresolved journal; existing sponsor budgets only','Quiesce other wallet users and worker processes; repeat identical run ID and phase after interruption','Read source header for exact staged process restart commands'],limits:['No execution or acceptance evidence exists merely because this source lever exists','Host-wallet sandbox and DB device fixture only; no Phantom, physical mic/display or browser UI claim','Week=7d/month=fixed30d are source contract assertions, not additional on-chain approvals','Lost owner-session/prepare response remains unknown; no blind replacement or silent renewal','Unknown signed transfers remain journaled; failures never discard financial history','No mainnet, funding, ATA creation, extra approvals, budget increase, provider calls, deploy or migrations']}));return;
 }
 assert.ok(runId,'--run-id is required');
 // Intentional opt-in module-loading boundary: static product imports initialize
 // private config/DB before the prerequisites-only CLI can return safely.
 await import('dotenv/config');
 const [{config,customerOrigin},{pool,tenant},{server},{tableFixture},{merchantPaymentAssets,frozenAttempt},{chain,loadSponsor,assertCluster},{reconcileMerchant},{assertGrantAttempt},{DELEGATION_PERIOD_SECONDS,validateGrantCaps,grantCapacity},{PublicKey,Keypair,Transaction,VersionedTransaction,TransactionMessage},spl,{encodePaymentSignatureHeader,decodePaymentSignatureHeader,decodePaymentResponseHeader},bs58Module,naclModule]=await Promise.all([
  import('../../apps/api/src/config'),import('../../apps/api/src/db'),import('../../apps/api/src/index'),import('../../tests/backend-table-fixture'),import('../../apps/api/src/payment-assets'),import('../../apps/api/src/payments'),import('../../apps/worker/src/index'),import('../../apps/api/src/delegated-payments'),import('../../packages/contracts/src/delegated-payments'),import('@solana/web3.js'),import('@solana/spl-token'),import('@x402/core/http'),import('bs58'),import('tweetnacl')
 ]);
 const {verifyX402Transfer,assertX402Message}=await import('../../apps/api/src/x402-payment');
 const bs58=bs58Module.default,nacl=naclModule.default,root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url))),privateRoot=fs.realpathSync(config.DEVNET_PRIVATE_DIR);
 assert.ok(privateRoot!==root&&!privateRoot.startsWith(root+path.sep),'Private material must remain outside repository');
 const dir=path.join(privateRoot,'coffee-copilot-grant-http');fs.mkdirSync(dir,{recursive:true,mode:0o700});assert.ok(!fs.lstatSync(dir).isSymbolicLink());assert.equal(fs.realpathSync(dir),dir);fs.chmodSync(dir,0o700);
 const journalPath=path.join(dir,runId+'.json'),lockPath=path.join(dir,'owner.lock'),authorityPath=path.join(dir,'active-run.json');
 const lock=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,runId})+'\n');fs.fsyncSync(lock);
 let j:Journal|undefined,started=false,blockedCheckpoint=false;
 let deviceSocket:WebSocket|undefined,heartbeat:NodeJS.Timeout|undefined;
 const originalSend=chain.sendRawTransaction.bind(chain);
 const save=()=>{assert.ok(j);durable(journalPath,j);};
 try{
  const require=createRequire(import.meta.url),sdk={core:version(require,'@x402/core'),svm:version(require,'@x402/svm')};assert.deepEqual(sdk,{core:'2.28.0',svm:'2.28.0'});
  if(fs.existsSync(authorityPath)){privateFile(authorityPath);assert.equal(JSON.parse(fs.readFileSync(authorityPath,'utf8')).runId,runId,'A different run owns this wallet; reconcile it, never silently replace');}else durable(authorityPath,{runId});
  await assertCluster();assert.equal(await chain.getGenesisHash(),GENESIS);
  const manifest=z.object({wallets:z.array(z.object({id:z.string(),address:z.string()}))}).parse(JSON.parse(fs.readFileSync(path.join(privateRoot,'wallets.public.json'),'utf8')));
  const role=(id:string)=>{const item=manifest.wallets.find(w=>w.id===id);assert.ok(item,'Missing public wallet role');return item.address;};
  const customer=role('customer-no-sol'),treasury=role('merchant-a-treasury'),sponsor=role('fee-sponsor');
  assert.equal(customer,'GQT3Je4HGa5JpN2tWvDjRFJV9mv29kwaWTmZgdTmJjLE');assert.equal(treasury,'4Vm9jmb7JNd7SRJiD6PWxhkxjFck1xDGzxGchTd7BAdh');assert.equal(sponsor,'8u6kFDrJa2fhtDawyiZRrroTTTPzEqhtdThBqboERLXv');assert.equal(loadSponsor().publicKey.toBase58(),sponsor);
  assert.equal(await chain.getBalance(new PublicKey(customer),'finalized'),0);
  const source=spl.getAssociatedTokenAddressSync(new PublicKey(USDC),new PublicKey(customer)),destination=spl.getAssociatedTokenAddressSync(new PublicKey(USDC),new PublicKey(treasury));
  const readAccounts=()=>Promise.all([spl.getAccount(chain,source,'finalized'),spl.getAccount(chain,destination,'finalized')]);
  const accounts=await readAccounts();assert.equal(accounts[0].owner.toBase58(),customer);assert.equal(accounts[1].owner.toBase58(),treasury);for(const a of accounts){assert.equal(a.mint.toBase58(),USDC);assert.equal(a.isFrozen,false);}
  if(fs.existsSync(journalPath)){privateFile(journalPath);j=journalSchema.parse(JSON.parse(fs.readFileSync(journalPath,'utf8')));assert.equal(j.runId,runId);}
  else{
   assert.equal(accounts[0].delegate,null,'Existing delegate must be independently resolved');assert.ok(accounts[0].amount>=BigInt(TOTAL),'No funding is authorized');
   assert.notEqual(phase,'revoke-only','Teardown requires the existing run journal and approved grant');
   const f=await tableFixture(4);const entry=(await tenant(f.merchant,async db=>(await db.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 AND auth_generation=$3',[f.merchant,f.b.id,f.devices.get(f.b.id)!.authGeneration])).rows[0])).entry_token;
   const rounds:[Round,Round]=[0,1].map(()=>({visitRequest:randomUUID(),createKey:randomUUID(),nonce:randomUUID(),requests:0,replays:0,workerCalls:0})) as [Round,Round];
   j={schemaVersion:1,runId,merchant:f.merchant,other:f.other,product:f.product,actor:f.actor,table:f.table.id,device:f.b.id,entry,deviceToken:cap.parse(f.credentials.get(f.b.id)),initialStock:4,sourceBefore:accounts[0].amount.toString(),destinationBefore:accounts[1].amount.toString(),ownerMessageSignatures:0,ownerApproveSignatures:0,ownerRevokeSignatures:0,ownerPerOrderSignatures:0,operations:{},guards:{},rounds,broadcasts:{},invocations:[]};save();
  }
  const state=j;state.invocations.push({pid:process.pid,phase,at:new Date().toISOString()});save();
  assert.ok(state);
  if(phase==='revoke-only')assert.ok(state.sessionToken&&state.prepare&&state.approvalBase64&&state.approvalSignature,'Teardown requires an ALREADY owner-signed grant, never an initial approval');
  if(!state.foreignEntry){
   // Honest second-tenant DB routing fixture; no physical device or transaction.
   const {registry}=await import('../../apps/api/src/registry');
   state.foreignEntry=await tenant(state.other,async db=>{
    const table=await registry(db,state.other,state.actor,'owner','/api/tables','POST',{label:'Grant proof foreign fixture'});
    assert.ok(table&&'id' in table);
    const device=await registry(db,state.other,state.actor,'owner','/api/devices','POST',{label:'Foreign fixture',tableId:table.id});
    assert.ok(device&&'id' in device);
    await registry(db,state.other,state.actor,'owner','/api/devices/'+device.id+'/credential','POST',{});
    return cap.parse((await db.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1',[state.other,device.id])).rows[0].entry_token);
   });save();
  }
  // ONLY fresh fixture configuration; never reset stock/order/screen/payment truth.
  if(!state.prepare)await tenant(state.merchant,async db=>{
   await db.query('UPDATE merchants SET treasury=$2 WHERE id=$1 AND treasury IN ($2,$3)',[state.merchant,treasury,'11111111111111111111111111111111']);
   assert.equal((await db.query('SELECT treasury FROM merchants WHERE id=$1',[state.merchant])).rows[0].treasury,treasury);
   const row=(await db.query("SELECT enabled,version,policy FROM merchant_payment_assets WHERE merchant_id=$1 AND asset_id='usdc-devnet'",[state.merchant])).rows[0];
   const denominationPolicy={id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'};
   if(!row?.enabled)await merchantPaymentAssets(db,state.merchant,state.actor,'owner','PUT',{assetId:'usdc-devnet',enabled:true,expectedVersion:row?.version??0,denominationPolicy});else assert.deepEqual(row.policy,denominationPolicy);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');started=true;const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port,entryBase='/api/table/'+state.entry;
  // Authenticated VIRTUAL fixture receiver. Receiving bytes/ACKing them is not
  // physical rendering evidence. It exists solely to use the real bill-dismiss
  // guard rather than resetting rendered/screen/financial state in SQL.
  const frames:Record<string,unknown>[]=[];
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+state.deviceToken}});deviceSocket=socket;
  socket.on('message',raw=>{try{frames.push(z.record(z.string(),z.unknown()).parse(JSON.parse(raw.toString())));if(frames.length>64)frames.shift();}catch{socket.terminate();}});
  socket.on('error',()=>{ /* No raw URL, token, payload or error details in logs. */ });
  await once(socket,'open');
  async function waitFrame(predicate:(v:Record<string,unknown>)=>boolean){const deadline=Date.now()+10000;do{const index=frames.findIndex(predicate);if(index>=0)return frames.splice(index,1)[0];assert.equal(socket.readyState,WebSocket.OPEN,'Fixture connection unavailable');await delay(50);}while(Date.now()<deadline);throw Error('Fixture frame pending; retain private run');}
  const connectionGeneration=z.string().parse((await waitFrame(v=>v.type==='CONFIG')).connectionGeneration);
  heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({schemaVersion:2,type:'HEARTBEAT',requestId:randomUUID(),connectionGeneration,sessionId:null}));},20000);
  async function http(route:string,body?:unknown){const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(90_000),headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.headers.get('cache-control'),'no-store');return {response,value:replySchema.parse(await response.json())};}
  // A durable operation records its exact body before HTTP egress. Only documented
  // idempotent operations may be retried (at most three). Unknown non-idempotent
  // session/prepare/challenge responses deliberately stop without fresh signing.
  async function operation(name:string,route:string,body:unknown,retry:boolean){const bodyHash=sha(JSON.stringify(body));let op=state.operations[name];if(op){assert.equal(op.bodyHash,bodyHash);if(op.observed)return replySchema.parse(op.response);assert.ok(retry,'Unknown non-idempotent HTTP result: coordinator must reconcile privately');}else{op={bodyHash,requests:0};state.operations[name]=op;}assert.ok(op.requests<3,'Bounded HTTP repetition reached');op.requests++;save();const result=await http(route,body);assert.ok(result.response.ok,'HTTP rejected; retain exact private journal');op.observed=true;op.response=result.value;save();return result.value;}
  const base=(r:Round)=>{assert.ok(r.visitToken);return entryBase+'/visit/'+r.visitToken;};
  async function visit(r:Round,n:number){if(!r.visitToken){const v=await operation('visit-'+n,entryBase+'/visit',{requestId:r.visitRequest},true);r.visitToken=cap.parse(v.visitToken);save();}}
  await visit(state.rounds[0],1);const grantBase=base(state.rounds[0])+'/grants';
  const snapshot=()=>tenant(state.merchant,async db=>({
   orders:(await db.query('SELECT id,status,version,request_hash,usdg_minor,treasury FROM orders WHERE merchant_id=$1 ORDER BY id',[state.merchant])).rows,
   payments:(await db.query('SELECT order_id,signature,state,amount_minor::text FROM payments WHERE merchant_id=$1 ORDER BY order_id,signature',[state.merchant])).rows,
   attempts:(await db.query('SELECT id,order_id,status,signature,signed_base64 FROM payment_attempts WHERE merchant_id=$1 ORDER BY id',[state.merchant])).rows,
   authorizations:(await db.query('SELECT attempt_id,unsigned_base64,partial_base64 FROM delegated_authorizations WHERE merchant_id=$1 ORDER BY attempt_id',[state.merchant])).rows,
   lifecycle:(await db.query('SELECT grant_id,kind,state,signature,signed_base64 FROM delegated_lifecycle WHERE merchant_id=$1 ORDER BY grant_id,kind',[state.merchant])).rows,
   stock:(await db.query('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2',[state.merchant,state.product])).rows,
   holds:(await db.query('SELECT id,grant_id,order_id,quote_id,nonce,amount::text,state,attempt_id FROM delegated_holds WHERE merchant_id=$1 ORDER BY id',[state.merchant])).rows,
   grants:(await db.query('SELECT id,status,spent::text,reserved::text,policy FROM delegated_grants WHERE merchant_id=$1 ORDER BY id',[state.merchant])).rows,
   paidOutbox:(await db.query("SELECT order_id,count(*)::int AS n FROM outbox_events WHERE merchant_id=$1 AND payload->'payload'->>'status'='PAID' GROUP BY order_id ORDER BY order_id",[state.merchant])).rows
  }));
  async function denied(name:string,route:string,body:unknown){const old=state.guards[name];if(old?.observed)return;const before=await snapshot(),broadcasts=JSON.stringify(state.broadcasts);state.guards[name]={observed:false,repetitions:(old?.repetitions??0)+1,boundary:'actual_HTTP_before_authorization_egress'};assert.ok(state.guards[name].repetitions<=3);save();const result=await http(route,body);assert.ok([403,404,409,422].includes(result.response.status)||result.response.ok&&result.value.status==='rejected','Guard must explicitly refuse, not an infrastructure failure');assert.ok(result.response.status!==404||!route.endsWith('/checkout')||name.startsWith('wrong-tenant')||name.startsWith('wrong-order'),'Missing checkout API is not a successful guard');assert.deepEqual(await snapshot(),before);assert.equal(JSON.stringify(state.broadcasts),broadcasts);state.guards[name].observed=true;save();}
  function withOwnerKey<T>(sign:(key:InstanceType<typeof Keypair>,secret:Uint8Array)=>T){const keyPath=path.join(privateRoot,'keys/customer-no-sol.json');privateFile(keyPath);const bytes=Uint8Array.from(z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(fs.readFileSync(keyPath,'utf8'))));try{const key=Keypair.fromSecretKey(bytes);assert.equal(key.publicKey.toBase58(),customer);return sign(key,bytes);}finally{bytes.fill(0);}}
  // Monitor the genuine network send seam, not fake RPC outcomes. Both the product
  // journal and this private fsynced journal MUST precede any authorized broadcast.
  chain.sendRawTransaction=async(raw,options)=>{
   assert.equal(await chain.getGenesisHash(),GENESIS);const bytes=Buffer.from(raw);let signature:string,kind:'approve'|'payment'|'revoke';
   const decoded=VersionedTransaction.deserialize(bytes);
   if(decoded.version===0){
    signature=bs58.encode(decoded.signatures[0]);kind='payment';
    const a=await tenant(state.merchant,async db=>{const row=(await db.query('SELECT * FROM payment_attempts WHERE merchant_id=$1 AND signature=$2',[state.merchant,signature])).rows[0];assert.ok(row);return frozenAttempt(db,row);});
    assert.ok(a.x402&&a.signature&&a.signed_base64);assert.equal(a.signed_base64,bytes.toString('base64'));assert.equal(a.x402.owner,customer);assert.equal(a.x402.transferAuthority,state.prepare!.policy.delegate);assert.equal(a.x402.feePayer,sponsor);assert.equal(a.x402.grantId,state.prepare!.grantId);assert.equal(a.amount_minor,AMOUNT);
    assertX402Message(a.signed_base64,{...a,x402:a.x402},true);
    const r=state.rounds.find(v=>v.orderId===a.order_id);assert.ok(r,'No third payment authorized');assert.ok(!state.paused,'Pause forbids new network egress');
    const auth=await tenant(state.merchant,async db=>(await db.query('SELECT unsigned_base64,partial_base64 FROM delegated_authorizations WHERE merchant_id=$1 AND attempt_id=$2',[state.merchant,a.id])).rows[0]);assert.ok(auth?.partial_base64);
    const payload:PaymentPayload={x402Version:2,resource:{url:a.x402.resource},accepted:a.x402.requirements,payload:{transaction:auth.partial_base64}};
    const header=encodePaymentSignatureHeader(payload);if(r.signedHeader)assert.equal(r.signedHeader,header);if(r.signature)assert.equal(r.signature,a.signature);if(r.signedBase64)assert.equal(r.signedBase64,a.signed_base64);
    Object.assign(r,{attemptId:a.id,signature:a.signature,signedBase64:a.signed_base64,partialBase64:auth.partial_base64,signedHeader:header});save();
    const requestedStage=phase==='signed-'+(state.rounds.indexOf(r)+1);
    if(requestedStage||r===state.rounds[0]&&!state.guards['rollback-sign-boundaries']?.observed){if(requestedStage)r.stagedPid=process.pid;blockedCheckpoint=true;save();throw new Error('Deliberate signed-before-send checkpoint');}
   }else{
    assert.equal(decoded.version,'legacy');
    const tx=Transaction.from(bytes);signature=bs58.encode(tx.signatures[0].signature!);
    const lifecycle=await tenant(state.merchant,async db=>(await db.query('SELECT kind,signed_base64,signature FROM delegated_lifecycle WHERE merchant_id=$1 AND grant_id=$2 AND signature=$3',[state.merchant,state.prepare?.grantId,signature])).rows[0]);assert.ok(lifecycle?.signed_base64);assert.equal(lifecycle.signed_base64,bytes.toString('base64'));kind=z.enum(['approve','revoke']).parse(lifecycle.kind);assert.equal(signature,kind==='approve'?state.approvalSignature:state.revokeSignature);
   }
   const previous=state.broadcasts[signature!];if(previous)assert.equal(previous.kind,kind!);else state.broadcasts[signature!]={kind:kind!,calls:0,returned:0};
   const sent=state.broadcasts[signature!];assert.ok(sent.calls<3,'At most three exact-byte sends per signature');sent.calls++;save();
   const result=await originalSend(raw,options);assert.equal(result,signature!);sent.returned++;save();return result;
  };
  if(!state.challenge){const v=await operation('challenge',grantBase+'/challenge',{owner:customer},false);state.challenge=z.object({challengeId:uuid,message:z.string()}).parse(v);save();}
  const challenge=state.challenge;assert.ok(challenge.message.includes('Domain: '+customerOrigin)&&challenge.message.includes('Merchant: '+state.merchant)&&challenge.message.includes('Owner: '+customer)&&challenge.message.includes('Purpose: authenticate owner for explicit reviewed orders; not token approval'));
  if(!state.messageSignature){assert.equal(state.ownerMessageSignatures,0,'Unknown owner signing must not be repeated');state.ownerMessageSignatures++;save();state.messageSignature=withOwnerKey((key,secret)=>{const message=Buffer.from(challenge.message),signature=nacl.sign.detached(message,secret);assert.ok(nacl.sign.detached.verify(message,signature,key.publicKey.toBytes()),'Owner proof must verify before egress');return bs58.encode(signature);});save();}
  if(!state.sessionToken){const bad=bs58.decode(state.messageSignature);bad[0]^=1;await denied('wrong-owner-purpose-proof',grantBase+'/session',{challengeId:challenge.challengeId,signature:bs58.encode(bad)});const v=await operation('session',grantBase+'/session',{challengeId:challenge.challengeId,signature:state.messageSignature},false);state.sessionToken=cap.parse(v.sessionToken);assert.equal(v.owner,customer);save();}
  const sessionToken=state.sessionToken;
  await denied('owner-challenge-nonce-replay',grantBase+'/session',{challengeId:challenge.challengeId,signature:state.messageSignature});
  if(!state.prepare){const p=await operation('prepare',grantBase+'/prepare',{sessionToken,period:'day',perOrderMinor:AMOUNT,totalMinor:TOTAL},false);state.prepare={grantId:uuid.parse(p.grantId),policy:policySchema.parse(p.policy),base64:z.string().parse(p.base64)};save();}
  const prepared=state.prepare,policy=prepared.policy;
  assert.equal(policy.grantId,prepared.grantId);assert.equal(policy.generation,prepared.grantId);assert.equal(policy.period,'day');assert.equal(policy.owner,customer);assert.equal(policy.merchantId,state.merchant);assert.equal(policy.domain,customerOrigin);assert.equal(policy.sourceAta,source.toBase58());assert.equal(policy.recipient,treasury);assert.equal(policy.mint,USDC);assert.equal(policy.tokenProgram,spl.TOKEN_PROGRAM_ID.toBase58());assert.equal(policy.genesisHash,GENESIS);assert.equal(policy.decimals,6);assert.equal(policy.perOrderMinor,AMOUNT);assert.equal(policy.totalMinor,TOTAL);assert.equal(Date.parse(policy.expiresAt)-Date.parse(policy.startsAt),86400000);assert.notEqual(policy.delegate,customer);assert.notEqual(policy.delegate,sponsor);
  // Day/week/month are real source contract checks, expressly NOT extra approvals.
  assert.deepEqual(DELEGATION_PERIOD_SECONDS,{day:86400,week:604800,month:2592000});validateGrantCaps(AMOUNT,TOTAL);assert.throws(()=>validateGrantCaps('2700001','2700000'));assert.equal(grantCapacity(TOTAL,'0',AMOUNT,AMOUNT,AMOUNT),true);assert.equal(grantCapacity(TOTAL,'0',AMOUNT,'2700001',AMOUNT),false);assert.equal(grantCapacity(TOTAL,AMOUNT,AMOUNT,'1',AMOUNT),false);
  state.guards['periods-and-cap-boundary']={observed:true,repetitions:1,boundary:'source_contract_day24h_week7d_month_fixed30d_and_integer_capacity_not_chain_expiry'};save();
  async function lifecycleSign(kind:'approve'|'revoke',unsigned:string){const tx=Transaction.from(Buffer.from(unsigned,'base64'));assert.equal(tx.feePayer?.toBase58(),sponsor);assert.equal(tx.instructions.length,2);const expected=kind==='approve'?spl.createApproveCheckedInstruction(source,new PublicKey(USDC),new PublicKey(policy.delegate),new PublicKey(customer),BigInt(TOTAL),6):spl.createRevokeInstruction(source,new PublicKey(customer));const actual=tx.instructions[0];assert.equal(actual.programId.toBase58(),expected.programId.toBase58());assert.deepEqual(actual.data,expected.data);assert.deepEqual(actual.keys,expected.keys);assert.equal(tx.instructions[1].programId.toBase58(),'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');assert.equal(tx.instructions[1].keys.length,0);assert.equal(tx.instructions[1].data.toString(),`bitpos:delegation:${kind}:${prepared.grantId}:${sha(JSON.stringify(policy))}:1`);
   const field=kind==='approve'?'ownerApproveSignatures':'ownerRevokeSignatures';assert.equal(state[field],0,'Unknown lifecycle signing must not be repeated');state[field]++;save();withOwnerKey(key=>tx.partialSign(key));assert.ok(tx.verifySignatures());return {base64:tx.serialize().toString('base64'),signature:bs58.encode(tx.signatures[0].signature!)};}
  async function finality(signature:string){const deadline=Date.now()+90_000;let status;do{status=(await chain.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];if(status?.confirmationStatus==='finalized')break;await delay(1500);}while(Date.now()<deadline);assert.equal(status?.confirmationStatus,'finalized','Unknown/pending preserved; rerun same ID, never sign replacement');assert.equal(status.err,null,'Finalized failure retained; no replacement authorized');}
  async function readGrant(){const body={sessionToken,grantId:prepared.grantId},name='reconcile-'+state.invocations.length+'-'+Object.keys(state.operations).length;return grantViewSchema.parse(await operation(name,grantBase+'/reconcile',body,true));}
  async function revokeObserved(){
   if(!state.revokeUnsigned){const v=await operation('revoke-prepare',grantBase+'/revoke',{sessionToken,grantId:prepared.grantId},true);state.revokeUnsigned=z.string().parse(v.base64);save();}
   if(!state.revokeBase64){const signed=await lifecycleSign('revoke',state.revokeUnsigned);state.revokeBase64=signed.base64;state.revokeSignature=signed.signature;save();}
   await operation('revoke-authorize',grantBase+'/authorize',{sessionToken,grantId:prepared.grantId,kind:'revoke',base64:state.revokeBase64},true);
   await finality(state.revokeSignature!);const view=await readGrant();assert.equal(view.status,'REVOKED');assert.equal(view.revokeSignature,state.revokeSignature);const sourceNow=(await readAccounts())[0];assert.equal(sourceNow.delegate,null);assert.equal(sourceNow.delegatedAmount,0n);return view;
  }
  if(!state.approvalBase64){const signed=await lifecycleSign('approve',prepared.base64);state.approvalBase64=signed.base64;state.approvalSignature=signed.signature;save();}
  await operation('approve-authorize',grantBase+'/authorize',{sessionToken,grantId:prepared.grantId,kind:'approve',base64:state.approvalBase64},true);
  await finality(state.approvalSignature!);let grant=await readGrant();assert.equal(grant.approveSignature,state.approvalSignature);
  if(phase!=='revoke-only'&&!state.rounds[0].signature&&!state.rounds[0].paid){assert.equal(grant.status,'ACTIVE');assert.equal(grant.chainDelegate,policy.delegate);assert.equal(grant.allowanceMinor,TOTAL);assert.equal(grant.spentMinor,'0');assert.equal(grant.reservedMinor,'0');}
  if(phase==='revoke-only'){
   assert.ok(state.approvalBase64&&state.approvalSignature,'Teardown cannot create an initial approval');
   if(!state.paused){await operation('pause-known-signature',grantBase+'/pause',{sessionToken,grantId:prepared.grantId},true);state.paused=true;save();}
   await reconcileMerchant(state.merchant);
   const view=await revokeObserved();await reconcileMerchant(state.merchant);
   const unresolved=(await snapshot()).holds.filter(h=>h.state==='HELD').length;
   console.log(JSON.stringify({executed:true,proof:false,finalizedRevoke:true,sourceDelegate:null,spentAtomic:view.spentMinor,unresolvedHolds:unresolved,unknownJournalRetained:true,runId}));return;
  }
  const checkpoint=(p:Phase)=>{if(phase===p){console.log(JSON.stringify({executed:true,proof:false,checkpoint:p,runId,privateJournal:'DEVNET_PRIVATE_DIR/coffee-copilot-grant-http/'+runId+'.json',next:'Restart process using SAME run ID and the next phase; no acceptance claim'}));return true;}return false;};
  if(checkpoint('approved'))return;
  async function attempt(r:Round){assert.ok(r.orderId);return tenant(state.merchant,async db=>{const rows=(await db.query('SELECT * FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2',[state.merchant,r.orderId])).rows;assert.equal(rows.length,1);const a=await frozenAttempt(db,rows[0]);assert.ok(a.x402);assert.equal(a.x402.grantId,prepared.grantId);assert.equal(a.x402.owner,customer);assert.equal(a.x402.transferAuthority,policy.delegate);assert.equal(a.payment.quoteId,r.paymentQuoteId);return {...a,x402:a.x402};});}
  async function recordAttempt(r:Round){const a=await attempt(r);assert.ok(a.signature&&a.signed_base64);const auth=await tenant(state.merchant,async db=>(await db.query('SELECT partial_base64 FROM delegated_authorizations WHERE merchant_id=$1 AND attempt_id=$2',[state.merchant,a.id])).rows[0]);assert.ok(auth?.partial_base64);const header=encodePaymentSignatureHeader({x402Version:2,resource:{url:a.x402.resource},accepted:a.x402.requirements,payload:{transaction:auth.partial_base64}});if(r.signature)assert.equal(r.signature,a.signature);if(r.signedBase64)assert.equal(r.signedBase64,a.signed_base64);if(r.signedHeader)assert.equal(r.signedHeader,header);Object.assign(r,{attemptId:a.id,signature:a.signature,signedBase64:a.signed_base64,partialBase64:auth.partial_base64,signedHeader:header});save();return a;}
  async function rollbackGuards(r:Round){if(state.guards['rollback-sign-boundaries']?.observed)return;const before=await snapshot(),broadcasts=JSON.stringify(state.broadcasts);const db=await pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[state.merchant]);await db.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='5000ms'");await db.query('SELECT id FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[state.merchant,r.orderId]);await assertGrantAttempt(db,r.attemptId!,'sign');
   const a=await attempt(r),partial=VersionedTransaction.deserialize(Buffer.from(r.partialBase64!,'base64'));
   const messageCases:{name:string;mutate:(m:InstanceType<typeof TransactionMessage>)=>void}[]=[
    {name:'wrong-source',mutate:m=>{m.instructions[2].keys[0].pubkey=destination;}},
    {name:'wrong-mint',mutate:m=>{m.instructions[2].keys[1].pubkey=new PublicKey(customer);}},
    {name:'wrong-payee',mutate:m=>{m.instructions[2].keys[2].pubkey=source;}},
    {name:'wrong-authority-owner',mutate:m=>{m.instructions[2].keys[3].pubkey=new PublicKey(customer);}},
    {name:'wrong-program',mutate:m=>{m.instructions[2].programId=spl.TOKEN_2022_PROGRAM_ID;}},
    {name:'wrong-amount',mutate:m=>{m.instructions[2].data.writeBigUInt64LE(2700001n,1);}},
    {name:'wrong-reference',mutate:m=>{m.instructions[3].data=Buffer.from('not-this-order');}}
   ];
   assert.equal(partial.message.staticAccountKeys[0].toBase58(),sponsor);assert.equal(partial.message.staticAccountKeys[1].toBase58(),policy.delegate);assert.ok(!partial.message.staticAccountKeys.slice(0,2).some(k=>k.toBase58()===customer),'Owner is NOT a per-order transaction signer');
   for(const c of messageCases){const m=TransactionMessage.decompile(partial.message);c.mutate(m);const bad=new VersionedTransaction(m.compileToV0Message());bad.signatures[1]=partial.signatures[1];assert.throws(()=>assertX402Message(Buffer.from(bad.serialize()).toString('base64'),a));state.guards[c.name]={observed:true,repetitions:1,boundary:'actual_strict_message_verifier_preserved_stale_signature_no_sign_or_egress'};}
    const cases:[string,string,unknown[]][]=[
     ['paused',"UPDATE delegated_grants SET status='PAUSED' WHERE merchant_id=$1 AND id=$2",[state.merchant,prepared.grantId]],
     ['session-expired',"UPDATE delegated_owner_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND token_hash=$2",[state.merchant,sha(sessionToken)]],
     ['wrong-session-owner','UPDATE delegated_owner_sessions SET owner=$3 WHERE merchant_id=$1 AND token_hash=$2',[state.merchant,sha(sessionToken),treasury]],
     ['auth-generation','UPDATE devices SET auth_generation=auth_generation+1 WHERE merchant_id=$1 AND id=$2',[state.merchant,state.device]],
     ['assignment-generation','UPDATE devices SET assignment_generation=assignment_generation+1 WHERE merchant_id=$1 AND id=$2',[state.merchant,state.device]]
    ];
    for(const [name,sql,params] of cases){await db.query('SAVEPOINT guard_case');try{await db.query(sql,params);const {RequestError}=await import('../../apps/api/src/authority');await assert.rejects(()=>assertGrantAttempt(db,r.attemptId!,'sign'),e=>e instanceof RequestError&&e.status===409&&e.code==='PAYMENT_UNAVAILABLE'&&e.details?.delegationCode===(name==='auth-generation'||name==='assignment-generation'?'GRANT_ATTEMPT_MISMATCH':'GRANT_PAUSED_OR_EXPIRED'));}finally{await db.query('ROLLBACK TO SAVEPOINT guard_case');await db.query('RELEASE SAVEPOINT guard_case');}state.guards[name]={observed:true,repetitions:1,boundary:'actual_exported_sign_guard_rollback_only_no_key_or_egress'};}
    // Real grant lock exclusion, not a Promise.all success-count fantasy. Competitor
    // NOWAIT must fail while this transaction owns the production grant lock.
    const other=await pool.connect();try{await other.query('BEGIN');await other.query("SELECT set_config('bitpos.merchant',$1,true)",[state.merchant]);await assert.rejects(()=>other.query('SELECT id FROM delegated_grants WHERE merchant_id=$1 AND id=$2 FOR UPDATE NOWAIT',[state.merchant,prepared.grantId]),e=>!!e&&typeof e==='object'&&'code' in e&&e.code==='55P03');}finally{await other.query('ROLLBACK');other.release();}
    const g=(await db.query('SELECT spent::text,reserved::text FROM delegated_grants WHERE merchant_id=$1 AND id=$2',[state.merchant,prepared.grantId])).rows[0];assert.equal(grantCapacity(TOTAL,g.spent,g.reserved,AMOUNT,AMOUNT),true);assert.equal(grantCapacity(TOTAL,g.spent,g.reserved,'2700001',AMOUNT),false);
   }finally{try{await db.query('ROLLBACK');}finally{db.release();}}
   assert.deepEqual(await snapshot(),before);assert.equal(JSON.stringify(state.broadcasts),broadcasts);state.guards['rollback-sign-boundaries']={observed:true,repetitions:1,boundary:'actual_sign_guard_and_concurrent_grant_lock_rolled_back'};save();
  }
  for(let index=0;index<2;index++){
   const r=state.rounds[index],n=index+1;if(index===1){assert.ok(state.rounds[0].paid&&state.rounds[0].dismissed,'First finalized bill must be legitimately dismissed before second visit');}
   await visit(r,n);
   const review={items:[{productId:state.product,qty:1}],collection:'table',delegation:{sessionToken,grantId:prepared.grantId}};
   if(!r.quote){await denied('wrong-review-session-'+n,base(r)+'/quotes',{...review,delegation:{sessionToken:randomBytes(32).toString('base64url'),grantId:prepared.grantId}});await denied('per-order-cap-review-'+n,base(r)+'/quotes',{...review,items:[{productId:state.product,qty:2}]});let q;if(n===2){r.repeatExpiresAt??=new Date(Date.now()+300000).toISOString();save();const repeat={sourceVisitToken:state.rounds[0].visitToken,requestId:r.visitRequest,assetId:'usdc-devnet',maxAtomic:AMOUNT,expiresAt:r.repeatExpiresAt,delegation:review.delegation};await denied('repeat-cap-below-paid-amount',base(r)+'/repeat-quotes',{...repeat,maxAtomic:'2699999'});await denied('repeat-expired-cap',base(r)+'/repeat-quotes',{...repeat,expiresAt:new Date(Date.now()-1000).toISOString()});await denied('repeat-wrong-private-source',base(r)+'/repeat-quotes',{...repeat,sourceVisitToken:randomBytes(32).toString('base64url')});q=(await operation('quote-'+n,base(r)+'/repeat-quotes',repeat,false)).quote;assert.ok(q);const capView=z.object({asset:z.object({assetId:z.literal('usdc-devnet'),mint:z.literal(USDC),tokenProgram:z.string(),decimals:z.literal(6)}),maxAtomic:z.literal(AMOUNT),expiresAt:z.string()}).parse(q.repeatCap);assert.equal(capView.expiresAt,r.repeatExpiresAt);state.guards['real-paid-source-repeat']={observed:true,repetitions:1,boundary:'first_actual_finalized_PAID_SETTLED_private_visit_fresh_USDC_quote_exact_cap_before_second_explicit_ORDER'};save();}else q=(await operation('quote-'+n,base(r)+'/quotes',review,false)).quote;assert.ok(q);assert.equal(q.delegationGrantId,prepared.grantId);const settlement=settlementSchema.parse(q.settlement);assert.equal(settlement.recipient,treasury);assert.equal(settlement.tokenProgram,spl.TOKEN_PROGRAM_ID.toBase58());assert.deepEqual(q.total,{currency:'USD',decimals:2,amountMinor:'270'});r.quote={id:q.id,priceVersion:q.priceVersion,settlement:q.settlement};save();}
   if(!r.orderId){const {currentScreen}=await import('../../apps/api/src/device-commands');const screen=await tenant(state.merchant,db=>currentScreen(db,state.merchant,state.device));assert.ok(screen.kind==='cart'&&screen.review);assert.equal(screen.review.quoteId,r.quote.id);assert.deepEqual(screen.review.settlement,r.quote.settlement);state.guards['canonical-device-review-'+n]={observed:true,repetitions:1,boundary:'actual_currentScreen_DB_function_review_before_explicit_ORDER_not_physical_render'};save();}
   if(!r.orderId){const result=await operation('explicit-ORDER-'+n,base(r)+'/orders',{quoteId:r.quote.id,priceVersion:r.quote.priceVersion,idempotencyKey:r.createKey},true);const order=orderSchema.parse(result.order);assert.equal(order.settlement.recipient,treasury);assert.deepEqual(order.settlement,r.quote.settlement);r.orderId=order.id;r.paymentQuoteId=order.paymentQuoteId;r.pricing=order.pricing;assert.notEqual(r.paymentQuoteId,r.quote.id,'Checkout uses canonical selected payment quote, NOT review order_quote');r.checkoutBody={sessionToken,grantId:prepared.grantId,orderConfirmation:true,orderId:r.orderId,quoteId:r.paymentQuoteId,nonce:r.nonce};save();}
   const checkout=base(r)+'/grants/checkout';assert.ok(r.checkoutBody);
   if(!r.signature){
    await denied('wrong-checkout-session-'+n,checkout,{...r.checkoutBody,sessionToken:randomBytes(32).toString('base64url')});
    await denied('wrong-order-'+n,checkout,{...r.checkoutBody,orderId:randomUUID()});
    await denied('wrong-paymentquote-'+n,checkout,{...r.checkoutBody,quoteId:r.quote.id});
    await denied('missing-ORDER-confirmation-'+n,checkout,{...r.checkoutBody,orderConfirmation:false});
    await denied('wrong-tenant-visit-'+n,'/api/table/'+state.foreignEntry+'/visit/'+r.visitToken+'/grants/checkout',r.checkoutBody);
    if(n===2)await denied('cross-order-nonce-replay',checkout,{...r.checkoutBody,nonce:state.rounds[0].nonce});
    assert.ok(r.requests<3);r.requests++;save();const result=await http(checkout,r.checkoutBody);assert.ok(result.response.ok);z.enum(['paid','pending']).parse(result.value.status);assert.equal(orderSchema.parse(result.value.order).id,r.orderId);if(result.value.signature)r.signature=result.value.signature;save();await recordAttempt(r);
   }else await recordAttempt(r);
   if(n===1&&!r.paid)await rollbackGuards(r);
   // Existing authorization can be retried ONLY with its original nonce/quote/body.
   if(!r.paid)await denied('changed-nonce-'+n,checkout,{...r.checkoutBody,nonce:randomUUID()});
   if(phase==='signed-'+n){assert.ok(blockedCheckpoint||r.stagedPid,'Checkpoint has no observed durable signed-before-send stage');assert.ok(!state.broadcasts[r.signature!],'Signed checkpoint must have ZERO actual sends');if(checkpoint(('signed-'+n) as Phase))return;}
   if(!r.paid){
    if(r.stagedPid&&r.stagedPid!==process.pid){r.recoveredPid=process.pid;save();}
    const status=(await chain.getSignatureStatuses([r.signature!],{searchTransactionHistory:true})).value[0];
    if(!status){assert.ok(r.workerCalls<3);r.workerCalls++;save();await reconcileMerchant(state.merchant);}
    if(n===2&&!state.paused){assert.ok(state.broadcasts[r.signature!]?.returned,'Pause scenario requires observed submit, never strand an unsent payment');await operation('pause-known-signature',grantBase+'/pause',{sessionToken,grantId:prepared.grantId},true);state.paused=true;save();}
    if(phase==='submitted-'+n){assert.ok(state.broadcasts[r.signature!]?.calls,'No actual submission egress observed');r.submittedPid=process.pid;save();if(checkpoint(('submitted-'+n) as Phase))return;}
    if(r.submittedPid&&r.submittedPid!==process.pid){r.submitRecoveredPid=process.pid;save();}
    await finality(r.signature!);assert.ok(r.workerCalls<3);r.workerCalls++;save();await reconcileMerchant(state.merchant);
    const a=await recordAttempt(r);assert.equal(a.status,'FINALIZED');assert.ok(await verifyX402Transfer(r.signature!,a,'finalized'));const order=orderSchema.parse((await http(base(r))).value.order);assert.equal(order.status,'PAID');assert.equal(order.paymentQuoteId,r.paymentQuoteId);assert.deepEqual(order.pricing,r.pricing);
    const effects=await snapshot();assert.equal(effects.payments.filter(v=>v.order_id===r.orderId&&v.state==='SETTLED').length,1);assert.deepEqual(effects.payments.find(v=>v.order_id===r.orderId),{order_id:r.orderId,signature:r.signature,state:'SETTLED',amount_minor:AMOUNT});assert.equal(effects.paidOutbox.find(v=>v.order_id===r.orderId)?.n,1);assert.equal(effects.stock[0].stock,state.initialStock-n);assert.equal(effects.stock[0].reserved,0);
    const live=await readAccounts();assert.equal(BigInt(state.sourceBefore)-live[0].amount,BigInt(AMOUNT)*BigInt(n));assert.equal(live[1].amount-BigInt(state.destinationBefore),BigInt(AMOUNT)*BigInt(n));grant=await readGrant();assert.equal(grant.spentMinor,(BigInt(AMOUNT)*BigInt(n)).toString());assert.equal(grant.reservedMinor,'0');r.paid=true;save();
   }
   if(!r.replayObserved){const before=await snapshot(),broadcasts=JSON.stringify(state.broadcasts);assert.ok(r.replays<3);r.replays++;save();const result=await http(checkout,r.checkoutBody);assert.ok(result.response.ok);assert.equal(result.value.status,'paid');assert.equal(result.value.signature,r.signature);assert.equal(orderSchema.parse(result.value.order).id,r.orderId);const header=result.response.headers.get('payment-response')??result.value.responseHeader;if(header){const receipt=decodePaymentResponseHeader(header);assert.equal(receipt.success,true);assert.equal(receipt.transaction,r.signature);assert.equal(receipt.network,NETWORK);assert.equal(receipt.payer,policy.delegate);}assert.deepEqual(await snapshot(),before);assert.equal(JSON.stringify(state.broadcasts),broadcasts);assert.equal(state.ownerPerOrderSignatures,0);assert.equal(decodePaymentSignatureHeader(r.signedHeader!).payload.transaction,r.partialBase64);r.replayObserved=true;save();}
   if(!r.dismissed){
    const {currentScreen}=await import('../../apps/api/src/device-commands');let screen=await tenant(state.merchant,db=>currentScreen(db,state.merchant,state.device));assert.ok(screen.kind==='order'&&screen.order.id===r.orderId&&screen.order.status==='PAID');
    const label='virtual-fixture-paid-ack-'+n,previous=state.guards[label];
    if(!screen.canDismiss){
     const paid=z.object({id:z.literal(r.orderId!),status:z.literal('PAID'),version:z.literal(screen.order.version)}).passthrough();
     const frame=await waitFrame(v=>{if(v.connectionGeneration!==connectionGeneration)return false;if(v.type==='ORDER')return paid.safeParse(v.payload).success;if(v.type==='SNAPSHOT'){const value=z.object({screen:z.object({kind:z.literal('order'),order:paid}).passthrough()}).safeParse(v.payload);return value.success;}return false;});
     const envelope=z.object({eventId:uuid,deviceSeq:z.string(),screenGeneration:z.string()}).passthrough().parse(frame);
     const command={schemaVersion:2,type:'ACK',requestId:randomUUID(),connectionGeneration,eventId:envelope.eventId,deviceSeq:envelope.deviceSeq,orderId:r.orderId,orderVersion:screen.order.version,screenGeneration:envelope.screenGeneration,rendered:true};
     state.guards[label]={observed:false,repetitions:(previous?.repetitions??0)+1,boundary:'actual_authenticated_WebSocket_simulated_receiver_ACK_NOT_physical_render'};assert.ok(state.guards[label].repetitions<=3);
     state.operations['fixture-ACK-'+command.requestId]={bodyHash:sha(JSON.stringify(command)),requests:1};save();socket.send(JSON.stringify(command));
     const receipt=await waitFrame(v=>v.type==='COMMAND_RESULT'&&v.requestId===command.requestId);
     z.object({result:z.object({ok:z.literal(true),value:z.object({acknowledged:z.literal(true)})})}).parse(receipt);
     state.operations['fixture-ACK-'+command.requestId].observed=true;state.guards[label].observed=true;save();
     screen=await tenant(state.merchant,db=>currentScreen(db,state.merchant,state.device));assert.ok(screen.kind==='order'&&screen.canDismiss);
    }else if(!previous?.observed){state.guards[label]={observed:true,repetitions:previous?.repetitions??0,boundary:'actual_currentScreen_retained_render_truth_from_virtual_fixture_NOT_physical_render'};save();}
   }
   if(!r.dismissed){const before=await snapshot();const result=await operation('dismiss-paid-bill-'+n,base(r)+'/dismiss',{},true);assert.equal(result.dismissed,true);const screen=await tenant(state.merchant,async db=>(await db.query('SELECT kind,order_id FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2',[state.merchant,state.device])).rows[0]);assert.equal(screen.kind,'idle');assert.equal(screen.order_id,null);assert.deepEqual(await snapshot(),before);r.dismissed=true;save();}
   if(checkpoint(('paid-'+n) as Phase))return;
  }
  assert.ok(state.paused);grant=await readGrant();assert.equal(grant.spentMinor,TOTAL);assert.equal(grant.reservedMinor,'0');assert.equal(grant.remainingMinor,'0');
  // Exhaustion/pause and regrant denial cause no third order, new key or allowance.
  await denied('no-silent-regrant',grantBase+'/prepare',{sessionToken,period:'week',perOrderMinor:AMOUNT,totalMinor:TOTAL});
  const extra:Round={visitRequest:randomUUID(),createKey:randomUUID(),nonce:randomUUID(),requests:0,replays:0,workerCalls:0};
  const exhaustedRequest=state.operations['exhausted-visit'];let extraToken:string;
  if(exhaustedRequest?.observed)extraToken=cap.parse(replySchema.parse(exhaustedRequest.response).visitToken);else{assert.ok(!exhaustedRequest,'Unknown exhaustion-visit response retained; inspect private journal');extraToken=cap.parse((await operation('exhausted-visit',entryBase+'/visit',{requestId:extra.visitRequest},false)).visitToken);}
  await denied('cap-spent-or-pause-review',entryBase+'/visit/'+extraToken+'/quotes',{items:[{productId:state.product,qty:1}],collection:'table',delegation:{sessionToken,grantId:prepared.grantId}});
  const afterPaid=await snapshot(),beforeBroadcasts=JSON.stringify(state.broadcasts);await reconcileMerchant(state.merchant);assert.deepEqual(await snapshot(),afterPaid);assert.equal(JSON.stringify(state.broadcasts),beforeBroadcasts,'Paused worker may reconcile truth but must not send new bytes');
  grant=await revokeObserved();assert.equal(grant.spentMinor,TOTAL);assert.equal(grant.reservedMinor,'0');
  const end=await readAccounts();assert.equal(end[0].delegate,null);assert.equal(end[0].delegatedAmount,0n);assert.equal(await chain.getBalance(new PublicKey(customer),'finalized'),0);assert.equal(BigInt(state.sourceBefore)-end[0].amount,BigInt(TOTAL));assert.equal(end[1].amount-BigInt(state.destinationBefore),BigInt(TOTAL));assert.equal(state.ownerMessageSignatures,1);assert.equal(state.ownerApproveSignatures,1);assert.equal(state.ownerRevokeSignatures,1);assert.equal(state.ownerPerOrderSignatures,0);
  const paymentSignatures=new Set(state.rounds.map(r=>r.signature));assert.equal(paymentSignatures.size,2);assert.ok(!paymentSignatures.has(undefined));const effects=await snapshot();assert.equal(effects.orders.length,2);assert.equal(effects.attempts.length,2);assert.equal(effects.payments.length,2);assert.equal(effects.stock[0].stock,2);assert.equal(effects.stock[0].reserved,0);assert.equal(effects.holds.length,2);assert.ok(effects.holds.every(h=>h.state==='SPENT'&&h.amount===AMOUNT));assert.ok(Object.values(state.guards).every(g=>g.observed&&g.repetitions<=3));
  for(const r of state.rounds){const a=await recordAttempt(r);assert.equal(a.status,'FINALIZED');assert.equal(effects.paidOutbox.find(v=>v.order_id===r.orderId)?.n,1);assert.deepEqual(orderSchema.parse((await http(base(r))).value.order).pricing,r.pricing);}
  assert.equal(await tenant(state.merchant,async db=>(await db.query('SELECT count(*)::int AS n FROM x402_pending_settlements WHERE merchant_id=$1',[state.merchant])).rows[0].n),0,'Finalized restart recovery must retire pending SDK sidecars without erasing signed attempts');
  state.completed=true;save();if(checkpoint('revoked'))return;
  const evidence={
   schemaVersion:1,scope:'coffee-copilot-x402-v2-20261012',runId,observedAt:new Date().toISOString(),
   origin:'actual_exported_API_private_visit_checkout_and_worker_host_wallet_devnet_finalized',sdk,genesis:GENESIS,network:NETWORK,asset:USDC,
   fixture:{merchantId:state.merchant,tableId:state.table,deviceId:state.device,productId:state.product,devicePresence:'DB fixture only; no physical display'},
   policy:{period:'day',durationSeconds:86400,perOrderAtomic:AMOUNT,totalAtomic:TOTAL,spentAtomic:grant.spentMinor,reservedAtomic:grant.reservedMinor,remainingAtomic:grant.remainingMinor,expiryEnforcement:'trusted service, not SPL on-chain expiry',compromiseDisclosure:'Grant key compromise can transfer/burn remaining allowance until owner on-chain revoke'},
   ownerSignatures:{purposeMessage:state.ownerMessageSignatures,initialApproveChecked:state.ownerApproveSignatures,perOrderTransaction:state.ownerPerOrderSignatures,revoke:state.ownerRevokeSignatures},
   approveSignature:state.approvalSignature,revokeSignature:state.revokeSignature,sourceDelegateAfterFinalizedRevoke:null,
   rounds:state.rounds.map(r=>({
    orderId:r.orderId,paymentQuoteId:r.paymentQuoteId,attemptId:r.attemptId,signature:r.signature,amountAtomic:AMOUNT,
    orderStatus:'PAID',paymentState:'SETTLED',stockDecrement:1,paidOutbox:1,exactReplayObserved:r.replayObserved,
    signedBeforeSendCheckpointPid:r.stagedPid??null,recoveryPid:r.recoveredPid??null,
    processRestartBeforeSendObserved:!!r.stagedPid&&!!r.recoveredPid&&r.stagedPid!==r.recoveredPid,
    submittedCheckpointPid:r.submittedPid??null,submitRecoveryPid:r.submitRecoveredPid??null,
    processRestartAfterSendObserved:!!r.submittedPid&&!!r.submitRecoveredPid&&r.submittedPid!==r.submitRecoveredPid
   })),
   sourceDeltaAtomic:TOTAL,destinationDeltaAtomic:TOTAL,stockBefore:state.initialStock,stockAfter:effects.stock[0].stock,stockReserved:effects.stock[0].reserved,
   guards:state.guards,pause:{observed:true,knownSignaturesReconciled:true,newBroadcastsAfterPause:0},
   claims:{finalAcceptance:false,sourceFingerprint:false,phantom:false,physicalPhone:false,physicalMicrophone:false,physicalDisplay:false,voice:false,additionalWeekMonthApprovals:false},
   limits:['Only different checkpoint/recovery PIDs prove process restart','Week/month duration and expiry guard are source/rollback observations, not elapsed real-chain periods','No claim of on-chain payee/per-order/time enforcement or compromise-resistant delegate','No new funds/accounts/budget or provider calls; unknown journal entries never erased']
  };
  const evidenceDir=path.join(root,'.omp/work/coffee-copilot-x402-v2-20261012/evidence');fs.mkdirSync(evidenceDir,{recursive:true});const evidencePath=path.join(evidenceDir,'grant-http-'+runId+'.json');durable(evidencePath,evidence);console.log(JSON.stringify({executed:true,finalized:true,ownerPerOrderTransactionSignatures:0,payments:2,totalAtomic:TOTAL,sourceDelegate:null,evidencePath:path.relative(root,evidencePath)}));
 }finally{chain.sendRawTransaction=originalSend;clearInterval(heartbeat);if(deviceSocket&&deviceSocket.readyState!==WebSocket.CLOSED){const closed=once(deviceSocket,'close');deviceSocket.terminate();await closed;}if(started){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}await pool.end();fs.closeSync(lock);fs.unlinkSync(lockPath);}
}
// Do not print Error.message/stack: assertions and RPC errors can contain capabilities,
// signed headers, private environment, raw journals or key-derived material.
main().catch(()=>{console.error('Delegated proof stopped; no success evidence written. Coordinator: privately inspect retained run journal/chain/DB, then resume SAME run ID. Never fund, replace, reapprove or discard unknown transactions.');process.exitCode=1;});
