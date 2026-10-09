import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Connection,Transaction,PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import pg from 'pg';

// Coordinator-only. Stop the own worker first. API durably records signed bytes;
// it never broadcasts. Restart the worker after this observed SUBMITTING boundary.
const tag=process.env.BITPOS_RESTART_TAG||'clean';assert.match(tag,/^[a-z0-9-]{1,32}$/);
const statePath=`local/private/worker-restart-${tag}.json`;
const beforePath=`.omp/work/evidence/worker-${tag}-restart-before.json`;
const api=process.env.BITPOS_API_URL||'http://127.0.0.1:3001/api';
const chain=new Connection('https://api.devnet.solana.com','confirmed');
assert.equal(await chain.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{idempotencyKey:crypto.randomUUID()};
function save(){fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
save();
async function request(path,body,token){const response=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();assert.ok(response.ok,'Restart fixture API request rejected');return result;}
const credentials=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8'))[0];
const session=await request('/session',{email:credentials.email,password:credentials.password});
if(!state.order){const menu=await request('/menu',undefined,session.token);const product=menu.products.reduce((a,b)=>BigInt(a.priceMinor)<BigInt(b.priceMinor)?a:b);assert.ok(BigInt(product.priceMinor)<=7000n);state.order=await request('/orders',{items:[{productId:product.id,qty:1}],idempotencyKey:state.idempotencyKey},session.token);save();}
const access=state.order.accessToken||new URL(state.order.paymentUrl).pathname.split('/').pop();
const quote=await request('/pay/'+access);assert.ok(BigInt(quote.usdgMinor)<=2000000n,'Bounded existing devnet test-asset budget');
function sign(operation,bytes=[]){const result=spawnSync(process.execPath,['tools/runtime/fixture-sign.cjs'],{input:JSON.stringify({orderId:state.order.id,operation,bytes}),encoding:'utf8'});assert.equal(result.status,0,'Fixed-order signer refused; output withheld');return JSON.parse(result.stdout);}
const address=sign('address');assert.equal(await chain.getBalance(new PublicKey(address)),0);
if(!state.signature){const challenge=await request('/pay/'+access+'/challenge',{address});const signature=bs58.encode(Uint8Array.from(sign('signMessage',Array.from(new TextEncoder().encode(challenge.message)))));await request('/pay/'+access+'/bind',{challengeId:challenge.id,signature});const attempt=await request('/pay/'+access+'/attempt',{});const signed=Buffer.from(sign('signTransaction',Array.from(Buffer.from(attempt.base64,'base64'))));state.attemptId=attempt.id;state.signature=bs58.encode(Transaction.from(signed).signature);state.signedBase64=signed.toString('base64');save();}
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
try {
 const existing=(await db.query('SELECT signature FROM bitpos.payment_attempts WHERE id=$1 AND order_id=$2',[state.attemptId,state.order.id])).rows[0];assert.ok(existing);
 if(!existing.signature){const result=await request('/pay/'+access+'/submit',{attemptId:state.attemptId,base64:state.signedBase64});assert.equal(result.signature,state.signature);}
 const before=(await db.query("SELECT a.id AS attempt_id,o.id AS order_id,a.signature,a.status AS attempt_status,o.status AS order_status,o.version,a.last_valid_height,(SELECT count(*)::int FROM bitpos.outbox_events WHERE order_id=o.id AND payload->>'paymentStatus'='PAID') AS paid_events FROM bitpos.payment_attempts a JOIN bitpos.orders o ON o.id=a.order_id WHERE a.id=$1 AND o.id=$2",[state.attemptId,state.order.id])).rows[0];
 assert.equal(before.signature,state.signature);assert.equal(before.attempt_status,'SUBMITTING','Worker must be stopped before fixture preparation; do not create another payment');assert.equal(before.paid_events,0);
 const chainStatus=(await chain.getSignatureStatuses([state.signature],{searchTransactionHistory:true})).value[0];assert.equal(chainStatus,null,'Persisted signature must precede worker broadcast');
 fs.writeFileSync(beforePath,JSON.stringify({origin:'actual_live_devnet_worker_stopped',...before,chain_status_before_broadcast:null,signed_before_submit:true,fixture:'dedicated zero-SOL test wallet; physical mobile deferred'},null,2)+'\n');
 console.log(JSON.stringify({evidence:beforePath,orderId:before.order_id,attemptStatus:before.attempt_status,signature:before.signature}));
} finally {await db.end();}
