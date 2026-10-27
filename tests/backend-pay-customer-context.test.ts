import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
import type {OrderView,Quote} from '../packages/contracts/src/index';
import type {CustomerAuthChallenge,CustomerAuthVerification} from '../packages/contracts/src/customer-auth';
import {tableFixture} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:120000};
// Local HTTP/SQL/authentication fixtures only. No model, RPC, chain transaction,
// physical device or Android proof. Run serially against the migrated fixture DB.
// Intentional opt-in module-loading boundary: static API/config imports would
// require private runtime settings even when integration tests are skipped.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
interface PayView extends OrderView {customerContext:{merchantId:string;menuUrl:string}}
async function fixture(){
 const f=await tableFixture(),{server}=await import('../apps/api/src/index'),{customerOrigin}=await import('../apps/api/src/config');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
 const inspect=(sql:string,args:unknown[]=[])=>f.tenant(f.merchant,db=>db.query(sql,args));
 async function request<T>(path:string,input?:unknown,originHeader=customerOrigin,method=input===undefined?'GET':'POST'){
  const response=await fetch(origin+path,{method,headers:{Origin:originHeader,...(input===undefined?{}:{'Content-Type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:response.status,value:await response.json() as T};
 }
 async function ok<T>(path:string,input?:unknown){const result=await request<T>(path,input);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
 async function access(order:OrderView){return '/api/pay/'+(await inspect('SELECT access_token FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,order.id])).rows[0].access_token;}
 async function snapshot(){
  const result:Record<string,unknown>={};
  for(const table of ['orders','order_items','order_authority','order_quotes','order_payment_selection','payment_quotes','payment_attempts','payment_attempt_assets','payments','products','device_screen_state','device_sessions','table_visits','table_occupancies','table_occupancy_visits','table_visit_recipients','quote_table_occupancies','order_table_occupancies','outbox_events','delegated_grants'])result[table]=(await inspect(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM ${table} r WHERE merchant_id=$1`,[f.merchant])).rows[0].rows;
  return result;
 }
 async function tableOrder(){
  const entry=(await inspect('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 AND auth_generation=$3',[f.merchant,f.b.id,f.devices.get(f.b.id)!.authGeneration])).rows[0].entry_token;
  const v=await ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()}),base='/api/table/'+entry+'/visit/'+v.visitToken;
  const {quote}=await ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:1}],confirmJoin:true});
  return {entry,order:(await ok<{order:OrderView}>(base+'/orders',{quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()})).order};
 }
 async function authenticate(base:string){
  const seed=randomBytes(32),walletAddress=new PublicKey(ed25519.getPublicKey(seed)).toBase58();
  try{
   const challenge=await ok<CustomerAuthChallenge>(base+'/customer/challenge',{walletAddress});
   return await ok<CustomerAuthVerification>(base+'/customer/verify',{challengeId:challenge.challengeId,walletAddress,signature:bs58.encode(ed25519.sign(new TextEncoder().encode(challenge.message),seed)),consent:{version:challenge.consentVersion,profile:true,purchaseHistory:true}});
  }finally{seed.fill(0);}
 }
 return {...f,inspect,request,ok,access,snapshot,tableOrder,authenticate,close:async()=>{
  const closed=once(server,'close');server.close();await closed;
 }};
}
test('anonymous pay menu opens before payment and after expiry without changing any bill, lock, recipient or occupancy',integration,async()=>{
 const f=await fixture();try{
  const source=await f.tableOrder(),base=await f.access(source.order),before=await f.snapshot();
  const pay=await f.ok<PayView>(base);assert.equal(pay.customerContext.merchantId,f.merchant);assert.equal(pay.customerContext.menuUrl,base.slice(4)+'/menu');
  const view=await f.ok<{menu:{merchant:{id:string};products:unknown[]};tableUrl:string|null}>(base+'/menu');assert.equal(view.menu.merchant.id,f.merchant);assert.equal(view.tableUrl,'/table/'+source.entry);assert.equal(view.menu.products.length,1);
  assert.deepEqual(await f.snapshot(),before,'Browsing cannot close, allocate or acquire anything');
  assert.equal((await f.request(base+'/dismiss',{})).status,409,'Unpaid Done remains forbidden');
  assert.equal((await f.request(base+'/menu',{})).status,404,'Menu is GET-only');
  // SQL status fixture only; the original immutable quote/expiry stays intact.
  await f.inspect("UPDATE orders SET status='EXPIRED' WHERE merchant_id=$1 AND id=$2",[f.merchant,source.order.id]);
  const expired=await f.snapshot();assert.equal((await f.ok<PayView>(base)).status,'EXPIRED');assert.equal((await f.ok<{tableUrl:string}>(base+'/menu')).tableUrl,'/table/'+source.entry);assert.deepEqual(await f.snapshot(),expired);
  assert.equal((await f.request('/api/pay/'+randomBytes(32).toString('base64url')+'/menu')).status,404);
 }finally{await f.close();}
});
test('counter and stale-table bills never borrow an arbitrary current table entry',integration,async()=>{
 const f=await fixture();try{
  const counter=await f.create(await f.quote()),counterBase=await f.access(counter.order);assert.equal((await f.ok<{tableUrl:string|null}>(counterBase+'/menu')).tableUrl,null,'Counter catalog has no guessed table');
  const table=await f.tableOrder(),base=await f.access(table.order);
  // Credential rotation changes the current entry generation while the frozen
  // quote remains read-only. No lifecycle release/reassignment is performed.
  await f.reg('/api/devices/'+f.b.id+'/credential','POST',{});
  const before=await f.snapshot();const current=await f.ok<{tableUrl:string|null;menu:{merchant:{id:string}}}>(base+'/menu');assert.equal(current.tableUrl,null);assert.equal(current.menu.merchant.id,f.merchant);assert.deepEqual(await f.snapshot(),before);
 }finally{await f.close();}
});
test('one seven-day wallet session revalidates across bills; explicit use binds only private identity, and wrong wallet/origin/tenant/revocation/expiry fail closed',integration,async()=>{
 const f=await fixture();try{
  const first=await f.create(await f.quote()),firstBase=await f.access(first.order),identity=await f.authenticate(firstBase);
  await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});
  const second=await f.create(await f.quote()),secondBase=await f.access(second.order),before=await f.snapshot();
  assert.equal((await f.ok<CustomerAuthVerification>(secondBase+'/customer/session',{sessionToken:identity.sessionToken})).sessionId,identity.sessionId);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM order_customer_profiles WHERE merchant_id=$1 AND order_id=$2',[f.merchant,second.order.id])).rows[0].n,0,'Restore does not bind this bill');
  const wrongWallet=new PublicKey(ed25519.getPublicKey(randomBytes(32))).toBase58();
  assert.equal((await f.request(secondBase+'/customer/use',{sessionToken:identity.sessionToken,walletAddress:wrongWallet})).status,401);
  assert.equal((await f.request(secondBase+'/customer/use',{sessionToken:identity.sessionToken,walletAddress:identity.walletAddress},'https://foreign.example')).status,403);
  assert.deepEqual(await f.snapshot(),before);
  const body={sessionToken:identity.sessionToken,walletAddress:identity.walletAddress};
  assert.equal((await f.ok<CustomerAuthVerification>(secondBase+'/customer/use',body)).sessionId,identity.sessionId);
  assert.equal((await f.inspect('SELECT customer_id FROM order_customer_profiles WHERE merchant_id=$1 AND order_id=$2',[f.merchant,second.order.id])).rows[0].customer_id,identity.customerId);
  assert.deepEqual(await f.snapshot(),before,'Identity sidecars never replace guest customer/payer, quote, payment or membership');
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM customer_auth_challenges WHERE merchant_id=$1',[f.merchant])).rows[0].n,1,'Second bill issues no fresh wallet challenge');
  const foreignAccess=randomBytes(32).toString('base64url');await f.tenant(f.other,async db=>{
   const customer=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.other])).rows[0].id;
   await db.query("INSERT INTO orders(merchant_id,customer_id,access_token,idempotency_key,request_hash,thb_minor,usdg_minor,treasury,terminal_id,quote_expires_at) VALUES($1,$2,$3,$4,'foreign-fixture',1,1,'11111111111111111111111111111111','SQL-only-foreign-fixture',clock_timestamp()+interval '1 hour')",[f.other,customer,foreignAccess,randomUUID()]);
  });
  assert.equal((await f.request('/api/pay/'+foreignAccess+'/customer/session',{sessionToken:identity.sessionToken})).status,401);
  // A short-lived SQL auth fixture exercises expiry without modifying the
  // immutable seven-day session or manufacturing another wallet signature.
  const expiringToken=randomBytes(32).toString('base64url'),challengeId=randomUUID();
  await f.tenant(f.merchant,async db=>{
   await db.query(`WITH moment AS (SELECT clock_timestamp() AS now)
    INSERT INTO customer_auth_challenges(merchant_id,id,order_id,wallet_address,origin,order_context,nonce,issued_at,expires_at,consent_version,message,consumed_at)
    SELECT $1,$2,$3::uuid,$4,$5,jsonb_build_object('orderId',($3::uuid)::text),$6,now,now+interval '5 minutes',$7,'SQL-only expiry fixture, no wallet signature',now FROM moment`,
    [f.merchant,challengeId,second.order.id,identity.walletAddress,identity.origin,randomBytes(32).toString('base64url'),identity.consentVersion]);
   await db.query(`INSERT INTO customer_auth_sessions(merchant_id,challenge_id,customer_id,wallet_address,origin,token_hash,consent_version,consent_profile,consent_purchase_history,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,true,true,clock_timestamp()+interval '25 milliseconds')`,
    [f.merchant,challengeId,identity.customerId,identity.walletAddress,identity.origin,createHash('sha256').update(expiringToken).digest('hex'),identity.consentVersion]);
  });
  // This integration guard uses PostgreSQL clock_timestamp(), which JS fake
  // timers cannot advance; the wait deliberately crosses the stored 25ms TTL.
  await delay(80);
  assert.equal((await f.request(secondBase+'/customer/session',{sessionToken:expiringToken})).status,401);
  assert.equal((await f.request(secondBase+'/customer/use',{sessionToken:expiringToken,walletAddress:identity.walletAddress})).status,401);
  await f.ok(firstBase+'/customer/revoke',{sessionToken:identity.sessionToken});
  assert.equal((await f.request(secondBase+'/customer/session',{sessionToken:identity.sessionToken})).status,401);assert.equal((await f.request(secondBase+'/customer/use',body)).status,401);
 }finally{await f.close();}
});
