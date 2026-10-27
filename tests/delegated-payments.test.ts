import test,{after} from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DELEGATION_PERIOD_SECONDS,validateGrantCaps,grantCapacity} from '../packages/contracts/src/delegated-payments';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import fs from 'node:fs';
import {Keypair,PublicKey,Transaction,TransactionInstruction} from '@solana/web3.js';
import type {VersionedTransactionResponse,SignatureStatus,TransactionError} from '@solana/web3.js';
import {AccountLayout,createRevokeInstruction} from '@solana/spl-token';
import bs58 from 'bs58';
import {z} from 'zod';
import type {GrantPolicy} from '../packages/contracts/src/delegated-payments';
import {DEVNET_GENESIS} from '../packages/domain/src/index';
import {USDC_DEVNET_MINT,SPL_TOKEN_PROGRAM} from '../packages/domain/src/payment-assets';
import {tableFixture} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
test('periods are elapsed windows, including fixed thirty-day month',()=>{assert.deepEqual(DELEGATION_PERIOD_SECONDS,{day:86400,week:604800,month:2592000});});
test('caps reject zero, fractions, overflow, and per-order exceeding total without rounding',()=>{for(const [per,total] of [['0','1'],['1.1','2'],['2','1'],['1','18446744073709551616'],['01','2']])assert.throws(()=>validateGrantCaps(per,total));assert.doesNotThrow(()=>validateGrantCaps('18446744073709551615','18446744073709551615'));});
test('cumulative capacity includes pending holds and accepts exact boundary, not plus one',()=>{assert.equal(grantCapacity('5400000','2700000','0','2700000','2700000'),true);assert.equal(grantCapacity('5400000','0','2700000','2700001','5400000'),false);assert.equal(grantCapacity('5400000','2700000','2700000','1','2700000'),false);assert.equal(grantCapacity('5400000','0','0','2700001','2700000'),false);});
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
async function retireFixtureGrant(f:Awaited<ReturnType<typeof tableFixture>>,grant:string){await f.tenant(f.merchant,async db=>{await db.query("UPDATE delegated_holds SET state='RELEASED' WHERE merchant_id=$1 AND grant_id=$2 AND state='HELD'",[f.merchant,grant]);await db.query("UPDATE delegated_lifecycle SET state='FAILED' WHERE merchant_id=$1 AND grant_id=$2 AND state IN ('PREPARED','SIGNED')",[f.merchant,grant]);await db.query("UPDATE delegated_grants SET reserved=0,status='FAILED' WHERE merchant_id=$1 AND id=$2",[f.merchant,grant]);});}
test('two concurrent finalized callbacks consume one hold exactly once',integration,async(t)=>{
 // Intentional module-loading boundary: skipped integration tests must not load private DB/RPC configuration.
 const {finalizeGrantAttempt}=await import('../apps/api/src/delegated-payments');const f=await tableFixture(),created=await f.create(await f.quote()),grant=randomUUID(),hold=randomUUID(),ownerSession=randomUUID();let attempt:any;
 t.after(()=>retireFixtureGrant(f,grant));
 await f.tenant(f.merchant,async db=>{attempt=(await fixturePaymentAttempt(db,{merchant:f.merchant,order:created.order.id,status:'READY'})).rows[0];const visit=(await db.query('INSERT INTO table_visits(merchant_id,entry_id,request_id) SELECT $1,id,$3 FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1 RETURNING id',[f.merchant,f.b.id,randomUUID()])).rows[0];const quote=(await db.query('SELECT quote_id FROM order_payment_selection WHERE merchant_id=$1 AND order_id=$2',[f.merchant,created.order.id])).rows[0];await db.query("INSERT INTO delegated_owner_sessions(merchant_id,id,owner,domain,token_hash,expires_at) VALUES($1,$2,'owner','https://fixture.invalid',$3,clock_timestamp()+interval '1 hour')",[f.merchant,ownerSession,randomUUID()]);await db.query("INSERT INTO delegated_grants(merchant_id,id,policy,policy_hash,owner,source_ata,delegate,status,reserved) VALUES($1,$2,$3,'digest','owner',$4,$5,'ACTIVE',2700000)",[f.merchant,grant,{totalMinor:'5400000'},randomUUID(),randomUUID()]);await db.query('INSERT INTO delegated_holds(merchant_id,id,grant_id,order_id,visit_id,session_id,quote_id,nonce,request_hash,amount,attempt_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,2700000,$10)',[f.merchant,hold,grant,created.order.id,visit.id,ownerSession,quote.quote_id,randomUUID(),'canonical',attempt.id]);});
 await Promise.all([1,2].map(()=>f.tenant(f.merchant,async db=>{await db.query('SELECT id FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[f.merchant,created.order.id]);await finalizeGrantAttempt(db,attempt,'finalized');})));
 await f.tenant(f.merchant,async db=>{const g=(await db.query('SELECT spent::text,reserved::text FROM delegated_grants WHERE merchant_id=$1 AND id=$2',[f.merchant,grant])).rows[0];assert.deepEqual(g,{spent:'2700000',reserved:'0'});assert.equal((await db.query('SELECT state FROM delegated_holds WHERE merchant_id=$1 AND id=$2',[f.merchant,hold])).rows[0].state,'SPENT');await db.query("UPDATE payment_attempts SET status='EXPIRED',failure_reconciled_at=clock_timestamp() WHERE id=$1",[attempt.id]);});
});
test('committed grant policy and hold nonce cannot be rewritten after authorization',integration,async(t)=>{
 const f=await tableFixture(),created=await f.create(await f.quote()),grant=randomUUID(),hold=randomUUID(),ownerSession=randomUUID();
 t.after(()=>retireFixtureGrant(f,grant));
 await f.tenant(f.merchant,async db=>{
  const visit=(await db.query('INSERT INTO table_visits(merchant_id,entry_id,request_id) SELECT $1,id,$3 FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1 RETURNING id',[f.merchant,f.b.id,randomUUID()])).rows[0];
  const quote=(await db.query('SELECT quote_id FROM order_payment_selection WHERE merchant_id=$1 AND order_id=$2',[f.merchant,created.order.id])).rows[0];
  await db.query("INSERT INTO delegated_owner_sessions(merchant_id,id,owner,domain,token_hash,expires_at) VALUES($1,$2,'owner','https://fixture.invalid',$3,clock_timestamp()+interval '1 hour')",[f.merchant,ownerSession,randomUUID()]);
  await db.query("INSERT INTO delegated_grants(merchant_id,id,policy,policy_hash,owner,source_ata,delegate,status,reserved) VALUES($1,$2,$3,'digest','owner',$4,$5,'ACTIVE',1)",[f.merchant,grant,{totalMinor:'2',generation:grant,recipient:'approved-payee'},randomUUID(),randomUUID()]);
  await db.query('INSERT INTO delegated_holds(merchant_id,id,grant_id,order_id,visit_id,session_id,quote_id,nonce,request_hash,amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)',[f.merchant,hold,grant,created.order.id,visit.id,ownerSession,quote.quote_id,randomUUID(),'canonical']);
 });
 await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE delegated_grants SET policy=jsonb_set(policy,'{recipient}','\"attacker\"') WHERE merchant_id=$1 AND id=$2",[f.merchant,grant])),/immutable delegated policy/);
 await assert.rejects(f.tenant(f.merchant,db=>db.query('UPDATE delegated_holds SET nonce=$3 WHERE merchant_id=$1 AND id=$2',[f.merchant,hold,randomUUID()])),/immutable delegated authorization/);
 await f.tenant(f.merchant,async db=>{assert.equal((await db.query('SELECT policy FROM delegated_grants WHERE merchant_id=$1 AND id=$2',[f.merchant,grant])).rows[0].policy.recipient,'approved-payee');assert.equal((await db.query('SELECT amount::text FROM delegated_holds WHERE merchant_id=$1 AND id=$2',[f.merchant,hold])).rows[0].amount,'1');});
});

// Controlled DB/RPC regression only: ephemeral fixture keys, never real owner or
// sponsor keys, network submission or an AI/provider call. Run on an isolated
// fixture database migrated through 033 with no competing worker.
async function revokeFixture(t:TestContext,initial:'PREPARED'|'SIGNED'){
 // Intentional module-loading boundary: skipped integration tests must not load
 // required private configuration; these modules are loaded before RPC/key mocks.
 const api=await import('../apps/api/src/delegated-payments'),{chain}=await import('../apps/api/src/payments'),{customerOrigin}=await import('../apps/api/src/config');
 const f=await tableFixture(),owner=Keypair.generate(),sponsor=Keypair.generate(),delegate=Keypair.generate().publicKey,source=Keypair.generate().publicKey,grant=randomUUID(),token=randomBytes(32).toString('base64url');
 const policy:GrantPolicy={version:1,grantId:grant,generation:grant,merchantId:f.merchant,domain:customerOrigin,owner:owner.publicKey.toBase58(),sourceAta:source.toBase58(),delegate:delegate.toBase58(),recipient:PublicKey.default.toBase58(),mint:USDC_DEVNET_MINT,tokenProgram:SPL_TOKEN_PROGRAM,genesisHash:DEVNET_GENESIS,decimals:6,period:'day',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),perOrderMinor:'2700000',totalMinor:'5400000'};
 const oldTx=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(createRevokeInstruction(source,owner.publicKey,[],new PublicKey(SPL_TOKEN_PROGRAM)),new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from('fixture:original-revoke')}));
 oldTx.partialSign(sponsor);const unsigned=oldTx.serialize({requireAllSignatures:false}).toString('base64');if(initial==='SIGNED')oldTx.partialSign(owner);
 const signature=bs58.encode(oldTx.signatures[0].signature!),signed=initial==='SIGNED'?oldTx.serialize().toString('base64'):null;
 const visit=await f.tenant(f.merchant,async db=>{
  const entry=(await db.query('SELECT * FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1',[f.merchant,f.b.id])).rows[0];
  const v=(await db.query('INSERT INTO table_visits(merchant_id,entry_id,request_id) VALUES($1,$2,$3) RETURNING access_token',[f.merchant,entry.id,randomUUID()])).rows[0];
  await db.query('INSERT INTO delegated_owner_sessions(merchant_id,owner,domain,token_hash,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval \'1 hour\')',[f.merchant,policy.owner,customerOrigin,createHash('sha256').update(token).digest('hex')]);
  await db.query("INSERT INTO delegated_grants(merchant_id,id,policy,policy_hash,owner,source_ata,delegate,status,approve_signature) VALUES($1,$2,$3,'fixture-policy',$4,$5,$6,'ACTIVE','fixture-finalized-approve')",[f.merchant,grant,policy,policy.owner,policy.sourceAta,policy.delegate]);
  await db.query("INSERT INTO delegated_lifecycle(merchant_id,grant_id,kind,unsigned_base64,blockhash,last_valid_height,signature) VALUES($1,$2,'revoke',$3,$4,100,$5)",[f.merchant,grant,unsigned,oldTx.recentBlockhash,signature]);
  if(signed)await db.query("UPDATE delegated_lifecycle SET signed_base64=$3,state='SIGNED' WHERE merchant_id=$1 AND grant_id=$2",[f.merchant,grant,signed]);
  return {entry:entry.entry_token,token:v.access_token};
 });
 t.after(()=>retireFixtureGrant(f,grant));
 let height=101,chainDelegate:PublicKey|null=delegate,status:SignatureStatus|null=null,submits=0,feeReads=0;
 const proofs=new Map<string,VersionedTransactionResponse>();
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
  const request=JSON.parse(body);assert.equal(request.method,'getGenesisHash','all actual external RPC is forbidden');return Response.json({jsonrpc:'2.0',id:request.id,result:DEVNET_GENESIS});
 });
 // Test seam returns the sole UTF-8 sponsor read; fs overloads include unused binary returns.
 t.mock.method(fs,'readFileSync',((file:unknown)=>{assert.ok(String(file).endsWith('/keys/fee-sponsor.json'),'only the fixture sponsor may be read');return JSON.stringify(Array.from(sponsor.secretKey));}) as unknown as typeof fs.readFileSync);
 t.mock.method(chain,'getTransaction',async(sig:string)=>proofs.get(sig)??null);
 t.mock.method(chain,'getBlockHeight',async()=>height);
 t.mock.method(chain,'getSignatureStatuses',async()=>({context:{slot:123},value:[status]}));
 t.mock.method(chain,'getLatestBlockhash',async()=>({blockhash:oldTx.recentBlockhash!,lastValidBlockHeight:200}));
 t.mock.method(chain,'getFeeForMessage',async()=>{feeReads++;return {context:{slot:123},value:10000};});
 t.mock.method(chain,'getAccountInfo',async(key:PublicKey)=>{
  assert.equal(key.toBase58(),policy.sourceAta);
  const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:new PublicKey(policy.mint),owner:owner.publicKey,amount:5400000n,delegateOption:chainDelegate?1:0,delegate:chainDelegate??PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:chainDelegate?5400000n:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);
  return {data,executable:false,lamports:2039280,owner:new PublicKey(SPL_TOKEN_PROGRAM),rentEpoch:0};
 });
 const journal=()=>f.tenant(f.merchant,async db=>(await db.query("SELECT * FROM delegated_lifecycle WHERE merchant_id=$1 AND grant_id=$2 AND kind='revoke' ORDER BY generation",[f.merchant,grant])).rows);
 t.mock.method(chain,'sendRawTransaction',async(bytes:Uint8Array)=>{
  const rows=await journal(),row=rows.at(-1);assert.equal(row.state,'SIGNED');assert.equal(Buffer.from(bytes).toString('base64'),row.signed_base64,'only committed exact bytes may broadcast');submits++;return row.signature;
 });
 const path=`/api/table/${visit.entry}/visit/${visit.token}/grants/`;
 const request=async(action:string,extra:Record<string,unknown>={})=>z.object({base64:z.string().optional(),signature:z.string().optional()}).passthrough().parse(await api.delegatedPaymentsRequest(path+action,'POST',{sessionToken:token,grantId:grant,...extra}));
 function proof(tx:Transaction,err:TransactionError|null=null):VersionedTransactionResponse{return {slot:123,blockTime:null,version:'legacy',transaction:{message:tx.compileMessage(),signatures:tx.signatures.map(s=>bs58.encode(s.signature!))},meta:{err,fee:10000,preBalances:[],postBalances:[],preTokenBalances:[],postTokenBalances:[],logMessages:[]}};}
 return {f,api,grant,owner,oldTx,unsigned,signed,signature,journal,request,proofs,proof,policy,setHeight:(n:number)=>{height=n;},setStatus:(s:SignatureStatus|null)=>{status=s;},setRevoked:()=>{chainDelegate=null;},submits:()=>submits,feeReads:()=>feeReads};
}
for(const outcome of ['unsigned-expiry','signed-expiry','signed-failure'] as const)test(`revoke ${outcome} admits a fresh owner-signed generation and preserves original journal`,integration,async t=>{
 const f=await revokeFixture(t,outcome==='unsigned-expiry'?'PREPARED':'SIGNED');
 if(outcome==='signed-failure')f.proofs.set(f.signature,f.proof(f.oldTx,{InstructionError:[0,'Custom']}));
 const original=(await f.journal())[0];
 const next=await f.request('revoke');
 const rows=await f.journal(),terminal=outcome==='signed-failure'?'FAILED':'EXPIRED';
 assert.equal(rows.length,2);assert.deepEqual(rows[0],{...original,state:terminal});assert.equal(rows[1].generation,2);assert.equal(rows[1].state,'PREPARED');assert.equal(rows[1].signed_base64,null);assert.notEqual(next.base64,f.unsigned);assert.notEqual(rows[1].signature,f.signature);assert.equal(f.submits(),0);
 const tx=Transaction.from(Buffer.from(z.string().parse(next.base64),'base64'));assert.equal(tx.signatures.find(s=>s.publicKey.equals(f.owner.publicKey))?.signature,null,'recovery has no automatic owner approval');
 await assert.rejects(f.request('authorize',{kind:'revoke',base64:next.base64}),/LIFECYCLE_SIGNATURE_INVALID/);
 if(f.signed)await assert.rejects(f.request('authorize',{kind:'revoke',base64:f.signed}),/LIFECYCLE_SIGNATURE_INVALID/);
 tx.partialSign(f.owner);const newSigned=tx.serialize().toString('base64');
 const authorized=await f.request('authorize',{kind:'revoke',base64:newSigned});assert.equal(authorized.signature,rows[1].signature);assert.equal(f.submits(),1);
 f.setRevoked();f.proofs.set(z.string().parse(authorized.signature),f.proof(tx));
 const view=await f.api.reconcileGrantLifecycle(f.f.merchant,f.grant);assert.equal(view.status,'REVOKED');assert.equal(view.revokeSignature,authorized.signature);assert.equal(view.chainDelegate,null);
 const finished=await f.journal();assert.deepEqual(finished[0],rows[0]);assert.equal(finished[1].state,'FINALIZED');assert.equal(finished[1].signed_base64,newSigned);
 await assert.rejects(f.request('revoke'),/GRANT_ALREADY_REVOKED/);assert.deepEqual(await f.journal(),finished);
 await assert.rejects(f.f.tenant(f.f.merchant,db=>db.query("UPDATE delegated_lifecycle SET unsigned_base64='replacement' WHERE merchant_id=$1 AND grant_id=$2 AND generation=1",[f.f.merchant,f.grant])),/immutable delegated lifecycle/);
 await assert.rejects(f.f.tenant(f.f.merchant,db=>db.query("UPDATE delegated_lifecycle SET state='PREPARED' WHERE merchant_id=$1 AND grant_id=$2 AND generation=1",[f.f.merchant,f.grant])),/immutable delegated lifecycle/);
});
test('unresolved signed revoke cannot admit a replacement before expiry or with observed history after expiry',integration,async t=>{
 const f=await revokeFixture(t,'SIGNED'),original=await f.journal();f.setHeight(100);
 await assert.rejects(f.request('revoke'),/LIFECYCLE_UNRESOLVED/);
 assert.deepEqual(await f.journal(),original);assert.equal(f.feeReads(),0);assert.equal(f.submits(),0);
 f.setHeight(101);f.setStatus({slot:123,confirmations:1,err:null,confirmationStatus:'confirmed'});
 await assert.rejects(f.request('revoke'),/LIFECYCLE_UNRESOLVED/);
 assert.deepEqual(await f.journal(),original);assert.equal(f.feeReads(),0);assert.equal(f.submits(),0);
 await assert.rejects(f.f.tenant(f.f.merchant,db=>db.query("INSERT INTO delegated_lifecycle(merchant_id,grant_id,kind,generation,unsigned_base64,blockhash,last_valid_height,signature) VALUES($1,$2,'revoke',2,$3,$4,200,$5)",[f.f.merchant,f.grant,f.unsigned,f.oldTx.recentBlockhash,f.signature])),/unresolved delegated lifecycle generation/);
 // Existing worker broadcast API still recovers the exact pending signature.
 assert.equal(await f.api.broadcastGrantLifecycle(f.f.merchant,f.grant,'revoke'),f.signature);assert.equal(f.submits(),1);assert.deepEqual(await f.journal(),original);
});
test('unresolved prepared revoke reuses exact bytes, including observed history after its last valid height',integration,async t=>{
 const f=await revokeFixture(t,'PREPARED'),original=await f.journal();f.setHeight(100);
 assert.equal((await f.request('revoke')).base64,f.unsigned);assert.deepEqual(await f.journal(),original);
 f.setHeight(101);f.setStatus({slot:123,confirmations:null,err:null,confirmationStatus:'finalized'});
 assert.equal((await f.request('revoke')).base64,f.unsigned);assert.deepEqual(await f.journal(),original);assert.equal(f.feeReads(),0);assert.equal(f.submits(),0);
});
