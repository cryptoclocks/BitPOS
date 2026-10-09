import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {z} from 'zod';
import {tableFixture,staffToken} from './backend-table-fixture';
test('HTTP v2 registry roles, tenant non-disclosure, immutable public quote, guest proof and profile history',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'},async()=>{
 // Loading boundary: skipped tests must not load environment/private runtime config.
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const owner=await staffToken(f.pool,f.merchant,f.actor),staff=await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other=await staffToken(f.pool,f.other,randomUUID());server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as AddressInfo).port;
 async function request(path:string,method='GET',value?:unknown,token=owner){const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});return {status:response.status,data:z.record(z.string(),z.unknown()).parse(await response.json())};}
 try{
 assert.equal((await request('/api/session')).data.userId,f.actor);for(const path of ['/api/tables','/api/devices','/api/registers'])assert.equal((await request(path,'GET',undefined,staff)).status,200);
 assert.equal((await request('/api/tables','POST',{label:'Unauthorized'},staff)).status,403);assert.equal((await request('/api/settings/pricing','PUT',f.configuration,staff)).status,403);assert.equal((await request('/api/devices/'+f.a.id+'/credential','POST',{},staff)).status,403);assert.equal((await request('/api/devices/'+f.a.id,'PATCH',{label:'Leak'},other)).status,404);
 assert.equal((await request('/api/orders','POST',{items:[{productId:f.product,qty:1}],idempotencyKey:'obsolete'})).status,404);
 const draft={items:[{productId:f.product,qty:1}],serving:{kind:'table',tableId:f.table.id}};
 const q=z.object({id:z.string(),priceVersion:z.string()}).parse((await request('/api/registers/'+f.register.id+'/quotes','POST',draft,staff)).data);
 const input={...draft,quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()};const created=await request('/api/registers/'+f.register.id+'/orders','POST',input,staff);assert.equal(created.status,201,JSON.stringify(created.data.error));
 const order=z.object({id:z.string(),accessToken:z.string(),customerId:z.string(),authority:z.object({serving:z.object({label:z.string()})}),pricing:z.object({total:z.object({currency:z.string()})}),settlement:z.object({amountMinor:z.string()})}).parse(created.data);
 assert.equal(order.authority.serving.label,'Table 4');assert.equal(order.pricing.total.currency,'USD');assert.equal(order.settlement.amountMinor,'2700000');assert.equal((await request('/api/registers/'+f.register.id+'/orders','POST',input,staff)).status,200);assert.equal((await request('/api/orders/'+order.id,'GET',undefined,other)).status,404);
 const path='/api/pay/'+order.accessToken;const publicOrder=(await request(path)).data;for(const key of ['customerId','accessToken','phone','name','email','notes'])assert.equal(key in publicOrder,false);
 const wallet=nacl.sign.keyPair(),address=new PublicKey(wallet.publicKey).toBase58();const challenge=z.object({id:z.string(),message:z.string()}).parse((await request(path+'/challenge','POST',{address})).data);
 assert.equal((await request(path+'/bind','POST',{challengeId:challenge.id,signature:bs58.encode(new Uint8Array(64))})).status,422);const signature=bs58.encode(nacl.sign.detached(Buffer.from(challenge.message),wallet.secretKey));assert.equal((await request(path+'/bind','POST',{challengeId:challenge.id,signature})).status,200);assert.equal((await request(path+'/bind','POST',{challengeId:challenge.id,signature})).status,409);
 assert.equal((await request('/api/customers/'+order.customerId,'PATCH',{name:'Private fixture edit',notes:'No chain PII'})).status,200);const after=(await request(path)).data;assert.equal(after.payer,address);assert.equal(JSON.stringify(after).includes('Private fixture'),false);
 const history=z.object({orders:z.array(z.object({id:z.string()}))}).parse((await request('/api/customers/'+order.customerId+'/history')).data);assert.equal(history.orders[0].id,order.id);
 const expiring=z.object({id:z.string(),message:z.string()}).parse((await request(path+'/challenge','POST',{address})).data);await f.tenant(f.merchant,db=>db.query("UPDATE challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expiring.id]));assert.equal((await request(path+'/bind','POST',{challengeId:expiring.id,signature:bs58.encode(nacl.sign.detached(Buffer.from(expiring.message),wallet.secretKey))})).status,409);
 await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});
 const returningQuote=z.object({id:z.string(),priceVersion:z.string()}).parse((await request('/api/registers/'+f.register.id+'/quotes','POST',draft)).data);
 const returning=z.object({id:z.string(),accessToken:z.string()}).parse((await request('/api/registers/'+f.register.id+'/orders','POST',{...draft,quoteId:returningQuote.id,priceVersion:returningQuote.priceVersion,idempotencyKey:randomUUID()})).data);
 const repeatPath='/api/pay/'+returning.accessToken;const repeatChallenge=z.object({id:z.string(),message:z.string()}).parse((await request(repeatPath+'/challenge','POST',{address})).data);assert.equal((await request(repeatPath+'/bind','POST',{challengeId:repeatChallenge.id,signature:bs58.encode(nacl.sign.detached(Buffer.from(repeatChallenge.message),wallet.secretKey))})).status,200);assert.equal((await request('/api/orders/'+returning.id)).data.customerId,order.customerId,'only wallet proof associates returning guest');
 const fresh=z.object({id:z.string()}).parse((await request('/api/devices','POST',{label:'Named profile fixture target'})).data);await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connection_generation=1,connected_until=clock_timestamp()+interval '1 hour' WHERE device_id=$1",[fresh.id]));await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:fresh.id,expectedPairingGeneration:'3'});
 const named=z.object({id:z.string()}).parse((await request('/api/customers','POST',{name:'Different named fixture'})).data);const namedDraft={...draft,customerId:named.id};const namedQuote=z.object({id:z.string(),priceVersion:z.string()}).parse((await request('/api/registers/'+f.register.id+'/quotes','POST',namedDraft)).data);const namedOrder=z.object({accessToken:z.string()}).parse((await request('/api/registers/'+f.register.id+'/orders','POST',{...namedDraft,quoteId:namedQuote.id,priceVersion:namedQuote.priceVersion,idempotencyKey:randomUUID()})).data);
 const namedPath='/api/pay/'+namedOrder.accessToken;const namedChallenge=z.object({id:z.string(),message:z.string()}).parse((await request(namedPath+'/challenge','POST',{address})).data);assert.equal((await request(namedPath+'/bind','POST',{challengeId:namedChallenge.id,signature:bs58.encode(nacl.sign.detached(Buffer.from(namedChallenge.message),wallet.secretKey))})).status,409,'valid proof cannot overwrite a different named profile');
 assert.equal((await request('/api/session','DELETE')).status,200);assert.equal((await request('/api/orders')).status,401);
 }finally{server.close();await once(server,'close');}
});
