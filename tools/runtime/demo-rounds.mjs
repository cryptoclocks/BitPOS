import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Connection,Keypair,Transaction,PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
const api=process.env.BITPOS_API_URL||'http://127.0.0.1:3001/api';
const vault=process.env.DEVNET_PRIVATE_DIR;
const customerRole=process.env.BITPOS_DEMO_CUSTOMER_ROLE||'customer-no-sol';
assert.ok(['customer-no-sol','customer-bob'].includes(customerRole),'Only dedicated authorized demo wallets');
const customer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(vault+'/keys/'+customerRole+'.json','utf8'))));
const chain=new Connection('https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(12000)})});
assert.equal(await chain.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const manifest=JSON.parse(fs.readFileSync(vault+'/wallets.public.json','utf8'));
const initialSol=await chain.getBalance(customer.publicKey);
if(customerRole==='customer-no-sol')assert.equal(initialSol,0,'test customer must remain zero SOL');
const credentials=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8'))[0];
async function request(path,body,token){const response=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw new Error('API '+path.split('/')[1]+' HTTP '+response.status+': '+String(value.error?.code??'UNAVAILABLE'));return value;}
const session=await request('/session',{email:credentials.email,password:credentials.password});
const menu=await request('/menu',undefined,session.token);
const product=menu.products.filter(p=>p.unitPrice&&p.available>0).reduce((lowest,p)=>BigInt(p.unitPrice.amountMinor)<BigInt(lowest.unitPrice.amountMinor)?p:lowest);
assert.equal(product.unitPrice.currency,'USD');assert.equal(product.unitPrice.decimals,2);
const routing=JSON.parse(fs.readFileSync('.omp/work/evidence/table-demo-configuration.json','utf8'));
assert.equal(session.merchantId,routing.merchantId);
const registerId=routing.ids.register,deviceId=routing.ids.device;
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const statePath=process.env.BITPOS_DEMO_STATE||'local/private/demo-rounds.json';
assert.match(statePath,/^local\/private\/demo-rounds(?:-[a-z0-9-]+)?\.json$/);
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{protocolVersion:2,runId:crypto.randomUUID(),registerId,deviceId,rounds:[]};
assert.equal(state.protocolVersion,2,'Historical single-terminal journals are never reused as v2 proof');
assert.equal(state.registerId,registerId);assert.equal(state.deviceId,deviceId);
assert.ok(!state.payer||state.payer===customer.publicKey.toBase58(),'Never resume a journal using a different payer');
state.payer=customer.publicKey.toBase58();state.initialSol??=initialSol;
function save(){fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
function journal(value){fs.appendFileSync(vault+'/activity.jsonl',JSON.stringify({at:new Date().toISOString(),cluster:'devnet',demoRun:state.runId,...value})+'\n',{mode:0o600});}
const rounds=Number(process.env.BITPOS_DEMO_ROUNDS||3);
assert.ok(Number.isInteger(rounds)&&rounds>=1&&rounds<=3,'Human-authorized filming checks allow at most three rounds per case');
const balance=BigInt((await chain.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7'),customer.publicKey,false,TOKEN_2022_PROGRAM_ID))).value.amount);
state.initialTokenBalance??=balance.toString();save();
const paymentMinor=BigInt(product.unitPrice.amountMinor)*10000n;
assert.ok(paymentMinor<=2000000n,'bounded validation order costs at most two test USDG');
assert.ok(balance>=BigInt(Math.max(0,rounds-state.rounds.filter(r=>r.paidAt).length))*paymentMinor,'existing test asset budget covers remaining bounded rounds');
for(let i=0;i<rounds;i++){
 let round=state.rounds[i];
 if(!round){round={index:i+1,idempotencyKey:state.runId+'-'+i};state.rounds.push(round);save();}
 if(!round.order){
  const draft={items:[{productId:product.id,qty:1}],serving:{kind:'table',tableId:routing.ids.table}};
  if(!round.quote){round.quote=await request('/registers/'+registerId+'/quotes',draft,session.token);save();}
  round.sourceFingerprint=JSON.parse(execFileSync('python3',['.omp/foreman.py','fingerprint'],{encoding:'utf8'})).source_fingerprint;
  round.order=await request('/registers/'+registerId+'/orders',{...draft,quoteId:round.quote.id,priceVersion:round.quote.priceVersion,idempotencyKey:round.idempotencyKey},session.token);
  assert.equal(round.order.authority.target.deviceId,deviceId);assert.equal(round.order.settlement.amountMinor,paymentMinor.toString());save();
 }
 const access=round.order.accessToken||new URL(round.order.paymentUrl).pathname.split('/').pop();
 let current=await request('/pay/'+access);
 if(!round.signature&&current.status!=='PAID'){
  const recent=(await db.query("SELECT created_at FROM bitpos.payment_attempts WHERE payer=$1 AND created_at>now()-interval '1 minute' ORDER BY created_at",[customer.publicKey.toBase58()])).rows;
  if(recent.length>=3)await new Promise(resolve=>setTimeout(resolve,Math.max(0,new Date(recent[0].created_at).getTime()+61000-Date.now())));
  const challenge=await request('/pay/'+access+'/challenge',{address:customer.publicKey.toBase58()});
  await request('/pay/'+access+'/bind',{challengeId:challenge.id,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),customer.secretKey))});
  const attempt=await request('/pay/'+access+'/attempt',{});
  const policy=(await db.query("SELECT a.*,o.usdg_minor FROM bitpos.payment_attempts a JOIN bitpos.orders o ON o.id=a.order_id WHERE a.id=$1 AND a.order_id=$2 AND a.payer=$3",[attempt.id,round.order.id,customer.publicKey.toBase58()])).rows[0];
  assert.ok(policy);assert.ok(manifest.wallets.some(role=>role.address===policy.recipient));
  assert.equal(policy.mint,'4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7');assert.equal(policy.token_program,'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  assert.equal(String(policy.amount_minor),String(policy.usdg_minor));assert.equal(attempt.base64,policy.transaction_base64);
  const tx=Transaction.from(Buffer.from(attempt.base64,'base64'));tx.partialSign(customer);
  round.attemptId=attempt.id;round.signature=bs58.encode(tx.signature);round.signedBase64=tx.serialize().toString('base64');round.lastValidHeight=attempt.lastValidHeight;save();
  journal({type:'signed',signature:round.signature,orderId:round.order.id,lastValidBlockHeight:round.lastValidHeight});
 }
 if(current.status!=='PAID'&&round.signature){
  // Never create a new attempt after ambiguous submit. Same signed bytes only; server reconciles.
  const chainStatus=(await chain.getSignatureStatuses([round.signature],{searchTransactionHistory:true})).value[0];
  if(chainStatus?.err)throw new Error('Recorded transaction failed; manual reconciliation required');
  if(!chainStatus&&!round.submitAcknowledged){const submitted=await request('/pay/'+access+'/submit',{attemptId:round.attemptId,base64:round.signedBase64});assert.equal(submitted.signature,round.signature);round.submitAcknowledged=true;save();journal({type:'submitted',signature:round.signature,orderId:round.order.id});}
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){current=await request('/pay/'+access);if(current.status==='PAID')break;if(['RECOVERY','EXPIRED'].includes(current.status))throw new Error('Payment requires recovery, stopping without repeated transfer');await new Promise(resolve=>setTimeout(resolve,2000));}
  assert.equal(current.status,'PAID','finalized settlement timed out; resume only recorded attempt');
 }
 assert.equal(current.status,'PAID');round.paidAt=new Date().toISOString();save();
 const ackDeadline=Date.now()+15000;let receipt;
 while(Date.now()<ackDeadline){receipt=(await db.query("SELECT d.event_id,d.latency_ms,d.connection_generation::text FROM bitpos.device_event_deliveries d JOIN bitpos.outbox_events e ON e.merchant_id=d.merchant_id AND e.id=d.event_id WHERE e.merchant_id=$1 AND e.order_id=$2 AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID' AND d.device_id=$3 AND d.status='rendered' AND d.rendered_at IS NOT NULL ORDER BY d.rendered_at LIMIT 1",[routing.merchantId,round.order.id,deviceId])).rows[0];if(receipt)break;await new Promise(resolve=>setTimeout(resolve,250));}
 assert.ok(receipt,'physical paid render ACK required before next order');
 round.physicalAck=receipt;round.transitions=(await db.query("SELECT payload->'payload'->>'status' AS status FROM bitpos.outbox_events WHERE merchant_id=$1 AND order_id=$2 AND type='ORDER' ORDER BY order_version",[routing.merchantId,round.order.id])).rows.map(r=>r.status);save();
 if(!round.dismissed&&process.env.BITPOS_DEMO_KEEP_RECEIPT!=='1'){
  const screen=(await db.query('SELECT screen_generation::text,kind,order_id FROM bitpos.device_screen_state WHERE merchant_id=$1 AND device_id=$2',[routing.merchantId,deviceId])).rows[0];
  if(screen.kind==='order'&&screen.order_id===round.order.id)await request('/registers/'+registerId+'/orders/'+round.order.id+'/dismiss',{orderVersion:current.version,screenGeneration:screen.screen_generation},session.token);
  else assert.equal(screen.kind,'idle','Never dismiss a different current screen owner');
  round.dismissed=true;save();
 }
 console.log(JSON.stringify({round:round.index,orderId:round.order.id,status:current.status,signature:round.signature,physicalAck:round.physicalAck,transitions:round.transitions,fixture:'dedicated scripted devnet signer; not physical mobile'}));
}
const finalSol=await chain.getBalance(customer.publicKey);assert.equal(finalSol,state.initialSol,'Merchant sponsor covers the network fee');
const finalTokenBalance=(await chain.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7'),customer.publicKey,false,TOKEN_2022_PROGRAM_ID))).value.amount;
assert.equal(BigInt(state.initialTokenBalance)-BigInt(finalTokenBalance),BigInt(rounds)*paymentMinor,'Customer token debit exactly matches paid orders');
for(const round of state.rounds){const status=(await chain.getSignatureStatuses([round.signature],{searchTransactionHistory:true})).value[0];assert.equal(status?.confirmationStatus,'finalized');assert.equal(status.err,null);}
await db.end();
const evidence={origin:'live_devnet_scripted_wallet',fixture:'Dedicated test-wallet signer; physical Android deferred; staff dismissal is not physical finger-touch proof',protocolVersion:2,runId:state.runId,registerId,deviceId,payer:state.payer,initialSol:state.initialSol,finalSol,initialTokenBalance:state.initialTokenBalance,finalTokenBalance,successful_rounds:state.rounds.filter(r=>r.paidAt&&r.physicalAck).length,customer_zero_sol:finalSol===0,rounds:state.rounds.map(r=>({index:r.index,orderId:r.order.id,signature:r.signature,paidAt:r.paidAt,physicalAck:r.physicalAck,transitions:r.transitions,sourceFingerprint:r.sourceFingerprint,dismissed:r.dismissed}))};
const evidencePath=process.env.BITPOS_DEMO_EVIDENCE||(rounds===3?'.omp/work/evidence/demo-three-rounds.json':'.omp/work/evidence/demo-table-single-round.json');
assert.match(evidencePath,/^\.omp\/work\/evidence\/[a-z0-9-]+\.json$/);
fs.mkdirSync('.omp/work/evidence',{recursive:true});fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
