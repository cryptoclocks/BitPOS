import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import pg from'pg';import{MobileBranchesSchema,MobileSessionSchema}from'../../../packages/contracts/src/mobile-v1.generated';
const base='http://127.0.0.1:3046';let token:string|undefined;
async function request(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
const db=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture'});await db.connect();
const existing=process.argv.includes('--existing');
const beforePayments=(await db.query('SELECT count(*)::int n FROM bitpos.payment_attempts')).rows[0].n;
if(!existing)assert.equal(beforePayments,0,'Fresh fixture required; use --existing for nonmutating counts');
try{
 await db.query("UPDATE bitpos.mobile_accounts SET disabled_at=NULL WHERE auth_subject='fa000000-0000-4000-8000-000000000001'");
 const catalog=await request('/api/mobile/v1/branches');assert.equal(catalog.status,200);const branches=MobileBranchesSchema.parse(catalog.body).branches;if(!existing)assert.equal(branches.length,0);
 assert.equal((await request('/api/mobile/v1/food/orders')).status,401);
 const otp=await request('/api/mobile/v1/auth/otp','POST',{phone:'+66900000001'});assert.equal(otp.status,200);
 const login=await request('/api/mobile/v1/auth/verify','POST',{phone:'+66900000001',code:'123456',deviceId:randomUUID()});assert.equal(login.status,200);
 token=MobileSessionSchema.parse(login.body).accessToken;
 assert.equal((await request('/api/mobile/v1/account')).status,200);
 const returnPath='/api/mobile/v1/platform/food/assignments/'+randomUUID()+'/return';
 assert.equal((await request(returnPath)).status,503);
 assert.equal((await request(returnPath,'DELETE')).status,405);
 assert.equal((await request(returnPath+'?unsafe=1')).status,422);
 const savedToken=token;token=undefined;assert.equal((await request(returnPath)).status,401);token=savedToken;

 assert.equal((await request('/api/mobile/v1/auth/logout','POST',{allDevices:false})).status,200);
 assert.equal((await request('/api/mobile/v1/account')).status,401);
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.payment_attempts')).rows[0].n,beforePayments);
 console.log(existing?'PASS_EXISTING_FIXTURE_AUTH_REVOKE_RETURN_ADMISSION_GATE_NO_NEW_PAYMENT':'PASS_W01_SYNTHETIC_AUTH_API_SQL_REVOKE_ZERO_PAYMENT');
}finally{
 await db.query("UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE account_id IN(SELECT id FROM bitpos.mobile_accounts WHERE auth_subject='fa000000-0000-4000-8000-000000000001')");
 await db.query("UPDATE bitpos.mobile_accounts SET disabled_at=clock_timestamp()WHERE auth_subject='fa000000-0000-4000-8000-000000000001'");await db.end();
}
