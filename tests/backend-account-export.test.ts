import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
test('account export returns only the caller\'s own data, is read-only and refuses bad requests',integration,async()=>{
 // Loading boundary: skipped integration never loads private runtime config.
 const {mobileProfileRequest}=await import('../apps/api/src/mobile-profile');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const ids:{account:string;token:string}[]=[];
 try{
  for(const name of ['Export Owner','Export Other']){
   const account=randomUUID(),token=randomBytes(32).toString('base64url');
   await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[account,randomUUID(),name]);
   await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')",[account,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
   ids.push({account,token});
  }
  const [mine,other]=ids;
  await admin.query("INSERT INTO bitpos.mobile_addresses(account_id,label,recipient_name,phone,address_text,instructions) VALUES($1,'Home','Me','+66000000001','1 Test Road',''),($1,'Old','Me','+66000000001','2 Test Road','')",[mine.account]);
  await admin.query("UPDATE bitpos.mobile_addresses SET archived=true WHERE account_id=$1 AND label='Old'",[mine.account]);
  await admin.query("INSERT INTO bitpos.mobile_addresses(account_id,label,recipient_name,phone,address_text,instructions) VALUES($1,'Other home','Other','+66000000002','9 Other Road','')",[other.account]);
  const url=new URL('http://localhost/api/mobile/v1/account/export');
  const before=(await admin.query('SELECT (SELECT count(*) FROM bitpos.mobile_account_commands WHERE account_id=ANY($1::uuid[]))::int AS commands,(SELECT count(*) FROM bitpos.mobile_identity_audit WHERE account_id=ANY($1::uuid[]))::int AS audit',[ids.map(i=>i.account)])).rows[0];
  const copy=await mobileProfileRequest(url,'GET',undefined,'Bearer '+mine.token) as any;
  assert.equal(copy.profile.id,mine.account);assert.equal(copy.profile.displayName,'Export Owner');
  assert.deepEqual(copy.addresses.map((a:any)=>a.address.label).sort(),['Home','Old']);
  assert.equal(copy.addresses.find((a:any)=>a.address.label==='Old').archived,true,'archived addresses are part of the copy');
  assert.deepEqual([copy.favourites,copy.orders,copy.supportCases,copy.truncated],[[],[],[],false]);
  assert.ok(Math.abs(Date.now()-Date.parse(copy.generatedAt))<60000);
  const theirs=await mobileProfileRequest(url,'GET',undefined,'Bearer '+other.token) as any;
  assert.deepEqual(theirs.addresses.map((a:any)=>a.address.label),['Other home']);
  assert.equal(JSON.stringify(theirs).includes('1 Test Road'),false,'another account never sees these addresses');
  assert.deepEqual((await admin.query('SELECT (SELECT count(*) FROM bitpos.mobile_account_commands WHERE account_id=ANY($1::uuid[]))::int AS commands,(SELECT count(*) FROM bitpos.mobile_identity_audit WHERE account_id=ANY($1::uuid[]))::int AS audit',[ids.map(i=>i.account)])).rows[0],before,'export writes nothing');
  await assert.rejects(mobileProfileRequest(url,'GET',undefined,undefined),/AUTH_REQUIRED/);
  await assert.rejects(mobileProfileRequest(url,'GET',undefined,'Bearer '+'A'.repeat(43)),/AUTH_REQUIRED/);
  await assert.rejects(mobileProfileRequest(new URL('http://localhost/api/mobile/v1/account/export?x=1'),'GET',undefined,'Bearer '+mine.token),/INVALID_REQUEST/);
  await assert.rejects(mobileProfileRequest(url,'POST',{},'Bearer '+mine.token),/INVALID_REQUEST/);
 }finally{
  for(const {account} of ids){
   await admin.query('DELETE FROM bitpos.mobile_addresses WHERE account_id=$1',[account]);
   await admin.query('DELETE FROM bitpos.mobile_sessions WHERE account_id=$1',[account]);
   await admin.query('DELETE FROM bitpos.mobile_accounts WHERE id=$1',[account]);
  }
  await admin.end();await pool.end();
 }
});
