import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
test('account erase anonymises own data and signs out, keeps financial records, refuses while open, is idempotent',integration,async()=>{
 // Loading boundary: skipped integration never loads private runtime config.
 const {mobileProfileRequest}=await import('../apps/api/src/mobile-profile');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const mk=async(name:string)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')",[id,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  await admin.query("INSERT INTO bitpos.mobile_addresses(account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES($1,'Home','Real Name','+66000000001','1 Secret Road','gate 3',137000000,1005000000)",[id]);
  return {id,token};};
 const a=await mk('Erase Me'),b=await mk('Keep Me');
 const url=new URL('http://localhost/api/mobile/v1/account/erase');
 const erase=(token:string,body:unknown)=>mobileProfileRequest(url,'POST',body,'Bearer '+token) as Promise<any>;
 const key=randomUUID();
 try{
  await assert.rejects(erase(a.token,{idempotencyKey:randomUUID(),confirm:'yes'}),/./,'the confirmation word is required');
  await assert.rejects(mobileProfileRequest(url,'GET',undefined,'Bearer '+a.token),/INVALID_REQUEST/);
  await assert.rejects(erase('A'.repeat(43),{idempotencyKey:randomUUID(),confirm:'ERASE'}),/AUTH_REQUIRED/);
  const done=await erase(a.token,{idempotencyKey:key,confirm:'ERASE'});
  assert.deepEqual([done.addressesBlanked,done.favouritesDeleted],[1,0]);
  const row=(await admin.query('SELECT display_name,disabled_at FROM bitpos.mobile_accounts WHERE id=$1',[a.id])).rows[0];
  assert.equal(row.display_name,'');assert.ok(row.disabled_at,'account is disabled');
  const addr=(await admin.query('SELECT label,recipient_name,phone,address_text,instructions,latitude_e7,archived FROM bitpos.mobile_addresses WHERE account_id=$1',[a.id])).rows[0];
  assert.deepEqual(addr,{label:'Erased',recipient_name:'Erased',phone:'+10000000',address_text:'Erased',instructions:'',latitude_e7:null,archived:true});
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM bitpos.mobile_sessions WHERE account_id=$1 AND revoked_at IS NULL',[a.id])).rows[0].n,0,'every session is revoked');
  await assert.rejects(mobileProfileRequest(new URL('http://localhost/api/mobile/v1/account/export'),'GET',undefined,'Bearer '+a.token),/AUTH_REQUIRED/,'the old token no longer works');
  const replay=await erase(a.token,{idempotencyKey:key,confirm:'ERASE'}).catch(e=>e);
  assert.ok(replay instanceof Error&&/AUTH_REQUIRED/.test(String(replay.message??replay)),'after sign-out even a replay needs a fresh session');
  const other=(await admin.query('SELECT display_name,disabled_at FROM bitpos.mobile_accounts WHERE id=$1',[b.id])).rows[0];
  assert.deepEqual([other.display_name,other.disabled_at],['Keep Me',null],'another account is untouched');
  assert.equal((await admin.query("SELECT address_text FROM bitpos.mobile_addresses WHERE account_id=$1",[b.id])).rows[0].address_text,'1 Secret Road');
  // blockers: the guard function counts open work for a live session only
  const live=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')",[b.id,randomUUID(),digest(live),digest(randomBytes(8).toString('hex'))]);
  const sid=(await admin.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[b.id,digest(live)])).rows[0].id;
  assert.equal((await admin.query('SELECT bitpos.mobile_erase_blockers($1,$2) AS n',[b.id,sid])).rows[0].n,0,'no orders, nothing blocks');
  assert.equal((await admin.query('SELECT bitpos.mobile_erase_blockers($1,$2) AS n',[b.id,randomUUID()])).rows[0].n,null,'a session that is not this account\'s reads nothing');
  // open work blocks erasure (one real order relabelled as this account's online order, rolled back, triggers off for setup only)
  const f=await tableFixture(5);const orderId=(await f.create(await f.quote(1))).order.id as string;
  const blockers=async()=>(await admin.query('SELECT bitpos.mobile_erase_blockers($1,$2) AS n',[b.id,sid])).rows[0].n;
  await admin.query('BEGIN');
  try{
   await admin.query("SET LOCAL session_replication_role='replica'");
   const branch=(await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,name) VALUES($1,'Erase branch') RETURNING id",[f.merchant])).rows[0].id;
   await admin.query("INSERT INTO bitpos.online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_status,acceptance_version,acceptance_deadline,decision_by) VALUES($1,$2,$3,$4,'ACCEPTED',1,now()+interval '1 hour',$5)",[f.merchant,orderId,b.id,branch,f.actor]);
   assert.equal(await blockers(),1,'an unpaid order blocks');
   await admin.query("UPDATE bitpos.orders SET status='PAID',paid_at=now() WHERE id=$1",[orderId]);
   assert.equal(await blockers(),1,'a paid order that is not collected blocks');
   await admin.query("INSERT INTO bitpos.order_fulfillment(merchant_id,order_id,status) VALUES($1,$2,'COLLECTED') ON CONFLICT(merchant_id,order_id) DO UPDATE SET status='COLLECTED'",[f.merchant,orderId]);
   assert.equal(await blockers(),0,'a collected order does not block');
   await admin.query("INSERT INTO bitpos.refunds(merchant_id,order_id,payment_id,status,amount_minor,asset_descriptor,settlement,beneficiary,cause) VALUES($1,$2,$3,'REQUESTED',1,'{}'::jsonb,'{}'::jsonb,'test','LEGACY_REQUESTED')",[f.merchant,orderId,randomUUID()]);
   assert.equal(await blockers(),1,'any refund obligation blocks');
  }finally{await admin.query('ROLLBACK');}
 }finally{
  for(const {id} of [a,b]){await admin.query('DELETE FROM bitpos.mobile_sessions WHERE account_id=$1',[id]).catch(()=>undefined);}
  await admin.end();await pool.end();
 }
});
