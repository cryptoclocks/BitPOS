import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// Shop support requests over the real HTTP server and real SQL: the shop writes, platform staff (mobile session + merchant-scoped grant) answer.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');

test('shop support: owner/manager open and follow a request, platform staff scoped to the shop answer, nobody else sees it',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const mobileBefore=process.env.BITPOS_MOBILE_ENABLED;process.env.BITPOS_MOBILE_ENABLED='1'; // staff answer through the mobile-session routes
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 // platform staff: a mobile account with a live session and a grant scoped to THIS shop only
 const staffAccount=randomUUID(),staffAccess=randomBytes(32).toString('base64url');
 const mkStaff=async(role:string,scopeMerchant:string|null,expiresSql="clock_timestamp()+interval '1 day'")=>{
  const account=randomUUID(),access=randomBytes(32).toString('base64url'),session=randomUUID(),grant=randomUUID();
  await admin.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,randomUUID(),sha(access),sha(randomBytes(32).toString('base64url'))]);
  await admin.query(`INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,$3,'test',${expiresSql})`,[grant,account,role]);
  if(scopeMerchant)await admin.query('INSERT INTO bitpos.platform_role_scopes(grant_id,merchant_id) VALUES($1,$2)',[grant,scopeMerchant]);
  return access;
 };
 void staffAccount;void staffAccess;
 const staff=async(token:string|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+'/api/mobile/v1/platform/merchant-support'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 try{
  const support=await mkStaff('support',f.merchant),finance=await mkStaff('finance',f.merchant),unscoped=await mkStaff('support',f.other),expired=await mkStaff('support',f.merchant,"clock_timestamp()+interval '1 second'");
  const k=()=>randomUUID();
  // ---- shop side
  assert.equal((await call(null,'GET','/api/support/cases')).status,401);
  assert.equal((await call('staff','GET','/api/support/cases')).status,403);
  assert.equal((await call('staff','POST','/api/support/cases',{subject:'ปัญหา',body:'x',idempotencyKey:k()})).status,403);
  for(const bad of [{},{subject:'ab',body:'x',idempotencyKey:k()},{subject:'ปัญหาเครื่องพิมพ์',body:'',idempotencyKey:k()},{subject:'ปัญหาเครื่องพิมพ์',body:'x',idempotencyKey:'short'},{subject:'ปัญหาเครื่องพิมพ์',body:'x',idempotencyKey:k(),x:1},{subject:'ปัญหาเครื่องพิมพ์',body:'x'.repeat(4001),idempotencyKey:k()}])assert.equal((await call('owner','POST','/api/support/cases',bad)).status,422,JSON.stringify(bad).slice(0,60));
  const key=k(),open={subject:'เครื่องพิมพ์ใบเสร็จไม่ออก',body:'พิมพ์แล้วกระดาษว่าง',idempotencyKey:key};
  const c1=await call('manager','POST','/api/support/cases',open);assert.equal(c1.status,200);assert.deepEqual([c1.body.case.state,c1.body.case.version,c1.body.replayed],['OPEN','1',false]);
  const id=c1.body.case.id as string;
  assert.deepEqual([(await call('owner','POST','/api/support/cases',open)).body.replayed,(await call('owner','POST','/api/support/cases',open)).body.case.id],[true,id],'same key and text = same case');
  assert.equal((await call('owner','POST','/api/support/cases',{...open,body:'ข้อความอื่น'})).status,409);
  assert.equal((await call('owner','GET','/api/support/cases')).body.cases.length,1);
  // another shop sees nothing and cannot touch it
  assert.deepEqual((await call('other','GET','/api/support/cases')).body.cases,[]);
  for(const [m,p,b] of [['GET',`/api/support/cases/${id}`,undefined],['POST',`/api/support/cases/${id}/messages`,{body:'x',idempotencyKey:k()}],['POST',`/api/support/cases/${id}/resolve`,undefined]] as const)assert.equal((await call('other',m,p,b)).status,404,p);
  assert.equal((await call('owner','GET','/api/support/cases/not-a-uuid')).status,422);

  // ---- staff side: access
  const purpose='purpose='+encodeURIComponent('ตอบคำร้องของร้านทดสอบ');
  assert.equal((await staff(null,'GET',`?queue=${f.merchant}&${purpose}`)).status,401);
  assert.equal((await staff(finance,'GET',`?queue=${f.merchant}&${purpose}`)).status,403,'finance role cannot read support');
  assert.equal((await staff(unscoped,'GET',`?queue=${f.merchant}&${purpose}`)).status,403,'scoped to another shop');
  assert.equal((await staff(support,'GET',`?queue=${f.other}&${purpose}`)).status,403,'this staff has no scope on the other shop');
  assert.equal((await staff(support,'GET',`?queue=${f.merchant}`)).status,422,'a purpose is mandatory');
  assert.equal((await staff(support,'GET',`?queue=general&${purpose}`)).status,422);
  assert.equal((await staff(support,'GET',`?queue=${f.merchant}&${purpose}&x=1`)).status,422);
  const list=await staff(support,'GET',`?queue=${f.merchant}&${purpose}`);assert.equal(list.status,200);assert.deepEqual(list.body.items.map((x:any)=>x.id),[id]);
  const read=await staff(support,'GET',`/${id}?${purpose}`);assert.equal(read.status,200);assert.deepEqual([read.body.ticket.version,read.body.messages.map((m:any)=>m.authorKind)],['1',['SHOP']]);
  assert.equal((await staff(unscoped,'GET',`/${id}?${purpose}`)).status,403);
  assert.equal((await staff(support,'GET',`/${randomUUID()}?${purpose}`)).status,404);

  // ---- staff side: commands
  const cmd=(over:Record<string,unknown>={})=>({commandId:k(),expectedVersion:'1',action:'REPLY',message:'ลองเปลี่ยนม้วนกระดาษความร้อนครับ',reason:'ตอบคำร้อง',...over});
  assert.equal((await staff(support,'POST',`/${id}`,{...cmd(),extra:1})).status,422);
  assert.equal((await staff(support,'POST',`/${id}`,cmd({message:''}))).status,422);
  assert.equal((await staff(support,'POST',`/${id}`,cmd({action:'RESOLVE'}))).status,422,'resolve carries no message');
  assert.equal((await staff(finance,'POST',`/${id}`,cmd())).status,403);
  assert.equal((await staff(unscoped,'POST',`/${id}`,cmd())).status,403);
  const first=cmd();const r1=await staff(support,'POST',`/${id}`,first);assert.equal(r1.status,200);assert.deepEqual([r1.body.state,r1.body.version],['ANSWERED','2']);
  assert.deepEqual([(await staff(support,'POST',`/${id}`,first)).body.version],['2'],'the same command again is not applied twice');
  assert.equal((await staff(support,'POST',`/${id}`,cmd())).status,409,'stale expectedVersion');
  // the shop sees the answer and the state
  const thread=(await call('owner','GET',`/api/support/cases/${id}`)).body;assert.deepEqual([thread.case.state,thread.messages.map((m:any)=>m.authorKind)],['ANSWERED',['SHOP','STAFF']]);
  // shop replies: back to OPEN, replay safe, conflicting replay refused
  const rk=k();const sr=await call('owner','POST',`/api/support/cases/${id}/messages`,{body:'ได้แล้ว ขอบคุณครับ แต่ขอเรื่องใหม่',idempotencyKey:rk});assert.deepEqual([sr.status,sr.body.case.state,sr.body.case.version],[200,'OPEN','3']);
  assert.equal((await call('owner','POST',`/api/support/cases/${id}/messages`,{body:'ได้แล้ว ขอบคุณครับ แต่ขอเรื่องใหม่',idempotencyKey:rk})).body.replayed,true);
  assert.equal((await call('owner','POST',`/api/support/cases/${id}/messages`,{body:'อย่างอื่น',idempotencyKey:rk})).status,409);
  assert.equal((await call('owner','GET',`/api/support/cases/${id}`)).body.messages.length,3);
  // staff resolves, the shop can no longer reply, staff reopens
  assert.equal((await staff(support,'POST',`/${id}`,cmd({action:'RESOLVE',message:'',expectedVersion:'3'}))).body.state,'RESOLVED');
  assert.equal((await call('owner','POST',`/api/support/cases/${id}/messages`,{body:'ยังมีปัญหา',idempotencyKey:k()})).status,409);
  assert.equal((await staff(support,'POST',`/${id}`,cmd({expectedVersion:'4'}))).status,409,'cannot reply on a resolved case');
  assert.equal((await staff(support,'POST',`/${id}`,cmd({action:'REOPEN',message:'',expectedVersion:'4'}))).body.state,'OPEN');
  assert.equal((await call('owner','POST',`/api/support/cases/${id}/resolve`)).body.case.state,'RESOLVED');
  assert.equal((await call('manager','POST',`/api/support/cases/${id}/resolve`)).body.case.state,'RESOLVED','closing again is a no-op');
  // staff access is audited with the purpose; the audit is closed to the app role
  const audited=(await admin.query('SELECT operation,purpose FROM bitpos.merchant_support_staff_audit WHERE merchant_id=$1 ORDER BY created_at',[f.merchant])).rows;
  for(const op of ['LIST','READ','REPLY','RESOLVE','REOPEN'])assert.ok(audited.some((a:any)=>a.operation===op),op);
  assert.ok(audited.every((a:any)=>a.purpose.length>0));
  await assert.rejects(f.tenant(f.merchant,db=>db.query('SELECT 1 FROM merchant_support_staff_audit')),/permission denied/);
  await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE merchant_support_messages SET body='x'")),/immutable|permission denied/);
  // an expired grant is refused (wait out its one-second life)
  await new Promise(r=>setTimeout(r,1300));
  assert.equal((await staff(expired,'GET',`?queue=${f.merchant}&${purpose}`)).status,403);

  // the open-case limit: 20 unresolved requests per shop, resolved ones do not count
  const ids:string[]=[];
  for(let i=0;i<19;i++){const r=await call('owner','POST','/api/support/cases',{subject:'คำร้องที่ '+i+' ของร้าน',body:'ทดสอบ',idempotencyKey:k()});assert.equal(r.status,200);ids.push(r.body.case.id);}
  const last=await call('owner','POST','/api/support/cases',{subject:'คำร้องที่ 20 ของร้าน',body:'ทดสอบ',idempotencyKey:k()});assert.equal(last.status,200);
  assert.equal((await call('owner','POST','/api/support/cases',{subject:'คำร้องที่ 21 ของร้าน',body:'ทดสอบ',idempotencyKey:k()})).status,409);
  assert.equal((await call('owner','POST',`/api/support/cases/${ids[0]}/resolve`)).status,200);
  assert.equal((await call('owner','POST','/api/support/cases',{subject:'คำร้องที่ 22 ของร้าน',body:'ทดสอบ',idempotencyKey:k()})).status,200);
 }finally{if(mobileBefore===undefined)delete process.env.BITPOS_MOBILE_ENABLED;else process.env.BITPOS_MOBILE_ENABLED=mobileBefore;await new Promise(r=>server.close(r));await admin.end();}
});
