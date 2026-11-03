import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import pg from 'pg';
// Real HTTP server + real SQL: staff profile, disabling, allowed hours, PIN set/reset, PIN switch-user with lockout. Needs migrations through 187 (CHANNEL_TEST_DB).
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:url??'postgres://x',ADMIN_DATABASE_URL:url??'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {hash}=await import('../packages/domain/src/index');
const M=randomUUID(),M2=randomUUID();
const U={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),staff2:randomUUID(),other:randomUUID()};
const T=(k:string)=>`tok-${k}-${randomUUID()}`;
const TOKEN:Record<string,string>=Object.fromEntries(Object.keys(U).map(k=>[k,T(k)]));

test('staff profile, disable, allowed hours, PIN and PIN switch over HTTP',integration,async()=>{
 const {server}=await import('../apps/api/src/index');const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query('SET search_path=bitpos,public');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const callTok=async(tok:string|null,method:string,path:string,body?:unknown)=>{
  const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(tok?{Authorization:`Bearer ${tok}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json() as any};
 };
 const call=(k:string|null,method:string,path:string,body?:unknown)=>callTok(k?TOKEN[k]!:null,method,path,body);
 const hhmmNow=(plusMin:number)=>new Date(Date.now()+plusMin*60000+7*3600000).toISOString().slice(11,16); // Asia/Bangkok
 const prof=async(k:string)=>(await call('owner','GET','/api/team')).body.members.find((m:any)=>m.userId===U[k as keyof typeof U]);
 const session=async(k:string,merchant=M)=>{await admin.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour') ON CONFLICT DO NOTHING",[hash(TOKEN[k]!),U[k as keyof typeof U],merchant,k==='other'?'owner':k.startsWith('staff')?'staff':k]);};
 try{
  await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Staff shop',$2),($3,'Other',$2)",[M,'1'.repeat(32),M2]);
  for(const k of ['owner','manager','staff','staff2']){await admin.query('INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,$3)',[U[k as keyof typeof U],M,k.startsWith('staff')?'staff':k]);await session(k);}
  await admin.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[U.other,M2]);await session('other',M2);

  // directory empty at first; listing is owner only and carries profile fields
  assert.equal((await call('staff','GET','/api/team')).status,403);
  const all=(await call('owner','GET','/api/team')).body.members;assert.equal(all.length,4);assert.deepEqual([all[0].role,all[0].you,all[0].active,all[0].hasPin,all[0].revision],['owner',true,true,false,'0']);
  assert.deepEqual((await call('staff','GET','/api/team/directory')).body.people,[]);
  assert.equal((await call(null,'GET','/api/team/directory')).status,401);

  // profile: owner only, strict body, revision, foreign tenant
  const path=(k:string,s:string)=>`/api/team/${U[k as keyof typeof U]}/${s}`;
  assert.equal((await call('manager','PUT',path('staff','profile'),{expectedRevision:'0',displayName:'น้องมาย'})).status,403);
  assert.equal((await call('owner','PUT',path('staff','profile'),{expectedRevision:'0'})).status,422);
  assert.equal((await call('owner','PUT',path('staff','profile'),{expectedRevision:'0',displayName:'x',extra:1})).status,422);
  assert.equal((await call('owner','PUT',path('staff','profile'),{expectedRevision:'0',access:{from:'08:00',to:'08:00'}})).status,422);
  assert.equal((await call('other','PUT',path('staff','profile'),{expectedRevision:'0',displayName:'x'})).status,404);
  const named=await call('owner','PUT',path('staff','profile'),{expectedRevision:'0',displayName:'น้องมาย'});assert.deepEqual([named.status,named.body.displayName,named.body.revision],[200,'น้องมาย','2']);
  assert.equal((await call('owner','PUT',path('staff','profile'),{expectedRevision:'0',displayName:'ซ้ำ'})).status,409);
  // owners and yourself can never be disabled or time-limited
  assert.equal((await call('owner','PUT',path('owner','profile'),{expectedRevision:'0',active:false})).status,403);
  assert.equal((await call('owner','PUT',path('owner','profile'),{expectedRevision:'0',access:{from:'08:00',to:'09:00'}})).status,403);
  assert.equal((await call('owner','PUT',path('owner','profile'),{expectedRevision:'0',displayName:'เจ้าของ'})).status,200);

  // PIN: owner only, 4-8 digits, hashed, owners cannot get one; directory then lists only active staff with a PIN
  assert.equal((await call('manager','PUT',path('staff','pin'),{expectedRevision:'2',pin:'1234'})).status,403);
  for(const bad of ['123','123456789','12a4','']) assert.equal((await call('owner','PUT',path('staff','pin'),{expectedRevision:'2',pin:bad})).status,422);
  assert.equal((await call('owner','PUT',path('owner','pin'),{expectedRevision:'0',pin:'1234'})).status,403);
  const withPin=await call('owner','PUT',path('staff','pin'),{expectedRevision:'2',pin:'4321'});assert.deepEqual([withPin.status,withPin.body.hasPin,withPin.body.revision],[200,true,'3']);
  const stored=(await admin.query('SELECT pin_hash FROM staff_profiles WHERE user_id=$1',[U.staff])).rows[0].pin_hash as string;assert.ok(stored.startsWith('scrypt$')&&!stored.includes('4321'));
  await call('owner','PUT',path('manager','profile'),{expectedRevision:'0',displayName:'ผู้จัดการ'});await call('owner','PUT',path('manager','pin'),{expectedRevision:'2',pin:'9999'});
  const dir=(await call('staff','GET','/api/team/directory')).body.people;assert.deepEqual(dir.map((p:any)=>p.displayName).sort(),['น้องมาย','ผู้จัดการ'].sort());assert.ok(dir.every((p:any)=>!('pinHash' in p)&&p.role!=='owner'));

  // switch user: wrong PIN, owner target, no-PIN target, unauthenticated, strict body
  const sw=(tok:string|null,userId:string,pin:string)=>callTok(tok,'POST','/api/session/switch',{userId,pin});
  assert.equal((await sw(null,U.staff,'4321')).status,401);
  assert.equal((await sw(TOKEN.manager!,U.owner,'1234')).status,401);
  assert.equal((await sw(TOKEN.manager!,U.staff2,'4321')).status,401);
  assert.equal((await callTok(TOKEN.manager!,'POST','/api/session/switch',{userId:U.staff,pin:'4321',x:1})).status,422);
  const good=await sw(TOKEN.manager!,U.staff,'4321');assert.deepEqual([good.status,good.body.userId,good.body.role,good.body.merchantId],[200,U.staff,'staff',M]);
  assert.equal((await callTok(good.body.token,'GET','/api/session')).body.role,'staff');
  assert.equal((await callTok(good.body.token,'GET','/api/team')).status,403);
  // a staff till can switch to the manager with the manager's PIN (no owner ever)
  assert.equal((await sw(good.body.token,U.manager,'9999')).body.role,'manager');

  // lockout: 4 wrong -> still 401, 5th -> 429, then even the right PIN is refused; the counter survived the error responses
  for(let i=1;i<=4;i++)assert.equal((await sw(TOKEN.manager!,U.staff,'0000')).status,401);
  assert.equal((await sw(TOKEN.manager!,U.staff,'0000')).status,429);
  assert.equal((await sw(TOKEN.manager!,U.staff,'4321')).status,429);
  assert.ok((await admin.query('SELECT pin_failed,pin_locked_until FROM staff_profiles WHERE user_id=$1',[U.staff])).rows[0].pin_locked_until);
  assert.ok((await prof('staff')).pinLockedUntil);
  // owner reset clears the lock
  const reset=await call('owner','PUT',path('staff','pin'),{expectedRevision:(await prof('staff')).revision,pin:'5555'});assert.equal(reset.body.pinLockedUntil,null);
  assert.equal((await sw(TOKEN.manager!,U.staff,'5555')).status,200);

  // disabling revokes sessions at once and blocks new ones; allowed hours are enforced per request; owners are exempt
  const s2=await sw(TOKEN.manager!,U.staff,'5555');assert.equal((await callTok(s2.body.token,'GET','/api/session')).status,200);
  const off=await call('owner','PUT',path('staff','profile'),{expectedRevision:(await prof('staff')).revision,active:false});assert.equal(off.body.active,false);
  assert.equal((await callTok(s2.body.token,'GET','/api/session')).status,401);assert.equal((await callTok(TOKEN.staff!,'GET','/api/session')).status,401);
  assert.equal((await sw(TOKEN.manager!,U.staff,'5555')).status,401);assert.deepEqual((await call('staff','GET','/api/team/directory')).status,401);
  await session('staff');assert.deepEqual([(await call('staff','GET','/api/session')).status,(await call('staff','GET','/api/session')).body.error?.code],[403,'ACCOUNT_DISABLED']);
  const on=await call('owner','PUT',path('staff','profile'),{expectedRevision:(await prof('staff')).revision,active:true});assert.equal(on.body.active,true);
  await session('staff');assert.equal((await call('staff','GET','/api/session')).status,200);
  const closed=await call('owner','PUT',path('staff','profile'),{expectedRevision:(await prof('staff')).revision,access:{from:hhmmNow(120),to:hhmmNow(180)}});assert.equal(closed.status,200);
  const blocked=await call('staff','GET','/api/menu');assert.deepEqual([blocked.status,blocked.body.error?.code],[403,'OUTSIDE_ACCESS_HOURS']);
  assert.equal((await call('owner','GET','/api/menu')).status,200);assert.equal((await call('manager','GET','/api/menu')).status,200);
  assert.equal((await sw(TOKEN.manager!,U.staff,'5555')).status,403);
  const opened=await call('owner','PUT',path('staff','profile'),{expectedRevision:closed.body.revision,access:{from:hhmmNow(-60),to:hhmmNow(60)}});assert.equal(opened.status,200);assert.equal((await call('staff','GET','/api/menu')).status,200);
  assert.equal((await call('owner','PUT',path('staff','profile'),{expectedRevision:opened.body.revision,access:null})).body.accessFrom,null);

  // audit trail and tenant isolation
  const log=(await admin.query("SELECT action FROM audit_logs WHERE merchant_id=$1",[M])).rows.map(r=>r.action);
  for(const a of ['team.profile','team.pin.set','team.disable','team.enable','session.switch','session.switch.refused','session.switch.locked'])assert.ok(log.includes(a),a);
  assert.equal((await call('other','GET','/api/team')).body.members.length,1);
  const cross=await sw(TOKEN.other!,U.manager,'9999');assert.equal(cross.status,401);
 }finally{
  for(const m of [M,M2]){for(const t of ['audit_logs','sessions','staff_profiles','members'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[m]).catch(()=>undefined);await admin.query('DELETE FROM merchants WHERE id=$1',[m]).catch(()=>undefined);}
  await admin.end();server.close();await pool.end();
 }
});
