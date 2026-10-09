import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Keypair,Transaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import pg from 'pg';
const base=process.env.BITPOS_API_URL||'http://127.0.0.1:3001/api';
const checks=[];const credentials=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8'));
async function call(path,{method='GET',body,token,status=200}={}){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(status===false)assert.ok(response.status>=400&&response.status<500,path+' must reject');else assert.equal(response.status,status,path+' '+JSON.stringify(value));return value;}
async function login(email){const credential=credentials.find(c=>c.email===email);return call('/session',{method:'POST',body:{email,password:credential.password}});}
const owner=await login('owner@bitpos.test'),staff=await login('staff@bitpos.test'),other=await login('other@bitpos.test');
const menu=await call('/menu',{token:owner.token}),otherMenu=await call('/menu',{token:other.token});
assert.notEqual(menu.merchant.id,otherMenu.merchant.id);
const settings=await call('/settings',{token:owner.token});
await call('/settings',{method:'PUT',body:{treasury:settings.treasury},token:staff.token,status:403});
checks.push({name:'tenant_roles',result:'staff treasury mutation rejected; independent merchant memberships'});
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.DEVNET_PRIVATE_DIR+'/keys/customer-no-sol.json','utf8'))));
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const bound=(await db.query("SELECT customer_id FROM bitpos.customer_wallets WHERE merchant_id=$1 AND chain='solana:devnet' AND address=$2",[owner.merchantId,wallet.publicKey.toBase58()])).rows[0];
const guest=await call('/customers',{method:'POST',body:{},token:owner.token});
// A reused dedicated wallet already belongs to its verified customer. Do not
// weaken the server's cross-customer refusal to make this smoke fixture pass.
const guestId=guest.id||guest.customer?.id;assert.ok(guestId);
const customerId=bound?.customer_id||guestId;
await call('/customers/'+customerId,{method:'PATCH',body:{name:'Browser fixture customer',phone:'',email:'',notes:'Test fixture, not production data'},token:owner.token});
await call('/customers/'+customerId+'/history',{token:other.token,status:false});
const order=await call('/orders',{method:'POST',body:{items:[{productId:menu.products[0].id,qty:1}],customerId,idempotencyKey:crypto.randomUUID()},token:owner.token});
await call('/orders/'+order.id,{token:other.token,status:false});
assert.equal(BigInt(order.thbMinor),BigInt(menu.products[0].priceMinor));
const access=order.accessToken||new URL(order.paymentUrl).pathname.split('/').pop();
const publicOrder=await call('/pay/'+access);
for(const field of ['name','phone','email','notes','customerId'])assert.equal(publicOrder[field],undefined,'public order leaks customer '+field);
const challenge=await call('/pay/'+access+'/challenge',{method:'POST',body:{address:wallet.publicKey.toBase58()}});
await call('/pay/'+access+'/bind',{method:'POST',body:{challengeId:challenge.id,signature:bs58.encode(new Uint8Array(64))},status:400});
const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),wallet.secretKey));
const binding=await call('/pay/'+access+'/bind',{method:'POST',body:{challengeId:challenge.id,signature}});assert.equal(binding.payer,wallet.publicKey.toBase58());assert.ok(binding.avatar);
await call('/pay/'+access+'/bind',{method:'POST',body:{challengeId:challenge.id,signature},status:false});
checks.push({name:'wallet_challenge',result:'forged signature rejected; genuine challenge bound; reuse rejected'});
await call('/customers/'+customerId,{method:'PATCH',body:{name:'Edited fixture',notes:'Contact edit is not payment proof'},token:owner.token});
assert.equal((await call('/pay/'+access)).status,'AWAITING_PAYMENT');
const history=await call('/customers/'+customerId+'/history',{token:owner.token});assert.ok(history.orders.some(o=>o.id===order.id));
checks.push({name:'customer_guest_avatar',result:'guest optional contact, edit/history, wallet avatar and no payment proof from profile edit'});
const attempt=await call('/pay/'+access+'/attempt',{method:'POST',body:{}});
const forged=Transaction.from(Buffer.from(attempt.base64,'base64'));forged.instructions[forged.instructions.length-1].data[2]^=1;forged.partialSign(wallet);
await call('/pay/'+access+'/submit',{method:'POST',body:{attemptId:attempt.id,base64:forged.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')},status:400});
const unsigned=Transaction.from(Buffer.from(attempt.base64,'base64'));
await call('/pay/'+access+'/submit',{method:'POST',body:{attemptId:attempt.id,base64:unsigned.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')},status:400});
assert.notEqual((await call('/pay/'+access)).status,'PAID');checks.push({name:'payment_rejections',result:'mutated transfer and absent customer signature rejected before broadcast'});
// Expiry is controlled only for this dedicated fixture order/challenge, not unrelated data.
await db.query("UPDATE bitpos.orders SET quote_expires_at=now()-interval '1 second' WHERE id=$1",[order.id]);
await call('/pay/'+access+'/attempt',{method:'POST',body:{},status:false});
await db.end();checks.push({name:'expired_attempt',result:'expired canonical order refuses fresh payment attempt'});
const evidence={origin:'real_api_single_oci_database',at:new Date().toISOString(),checks,fixtureOrderId:order.id,fixture:'Dedicated devnet test-wallet; no physical mobile test; no transaction submitted'};
fs.mkdirSync('.omp/work/evidence',{recursive:true});fs.writeFileSync('.omp/work/evidence/api-smoke.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
