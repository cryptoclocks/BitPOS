import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('team: owner-only member list and manager/staff role changes, owners and self untouched, sessions follow, tenant fenced',integration,async()=>{
 const f=await tableFixture(10);
 // Loading boundary: skipped integration never loads private runtime config.
 const {teamRequest}=await import('../apps/api/src/team');
 const owner='fa000000-0000-4000-8000-000000000010',manager=randomUUID(),staff=randomUUID();
 const run=(role:string,path:string,method:string,input?:unknown,actor=owner,merchant=f.merchant)=>f.tenant(merchant,db=>teamRequest(db,merchant,actor,role,new URL('http://localhost'+path),method,input));
 await f.tenant(f.merchant,async db=>{
  await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$3,'manager'),($2,$3,'staff') ON CONFLICT DO NOTHING",[manager,staff,f.merchant]);
  await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner') ON CONFLICT(user_id,merchant_id) DO UPDATE SET role='owner'",[owner,f.merchant]);
  await db.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'manager',now()+interval '1 hour')",[randomUUID(),manager,f.merchant]);
 });
 type L={members:{userId:string;role:string;you:boolean}[]};
 const list=await run('owner','/api/team','GET') as L;
 assert.ok(list.members.some(m=>m.userId===owner&&m.role==='owner'&&m.you),'the owner sees themself');
 assert.equal(list.members.find(m=>m.userId===manager)!.role,'manager');
 assert.equal(list.members.find(m=>m.userId===staff)!.role,'staff');
 assert.equal(list.members[0].role,'owner','owners first');
 for(const role of ['manager','staff','cashier'])await assert.rejects(run(role,'/api/team','GET'),(e:{status?:number})=>e.status===403,role);
 assert.deepEqual(await run('owner','/api/team/'+staff,'PATCH',{role:'manager',expectedRole:'staff'}),{userId:staff,role:'manager'});
 await assert.rejects(run('owner','/api/team/'+staff,'PATCH',{role:'staff',expectedRole:'staff'}),(e:{code?:string})=>e.code==='VERSION_CONFLICT');
 await run('owner','/api/team/'+manager,'PATCH',{role:'staff',expectedRole:'manager'});
 const sessionRole=(await f.tenant(f.merchant,db=>db.query('SELECT role FROM sessions WHERE merchant_id=$1 AND user_id=$2',[f.merchant,manager]))).rows[0].role;
 assert.equal(sessionRole,'staff','an open session follows the new role at once');
 await assert.rejects(run('owner','/api/team/'+owner,'PATCH',{role:'staff',expectedRole:'manager'}),(e:{status?:number})=>e.status===403,'the owner cannot change themself');
 const other=randomUUID();
 await f.tenant(f.merchant,db=>db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[other,f.merchant]));
 await assert.rejects(run('owner','/api/team/'+other,'PATCH',{role:'staff',expectedRole:'manager'}),(e:{status?:number})=>e.status===403,'another owner is never demoted here');
 for(const bad of [{role:'owner',expectedRole:'staff'},{role:'staff'},{role:'staff',expectedRole:'staff',extra:1}])await assert.rejects(run('owner','/api/team/'+staff,'PATCH',bad),(e:{status?:number})=>e.status===422);
 await assert.rejects(run('owner','/api/team/'+randomUUID(),'PATCH',{role:'staff',expectedRole:'manager'}),(e:{status?:number})=>e.status===404);
 const foreign=(await f.tenant(f.merchant,db=>db.query('SELECT id FROM merchants WHERE id<>$1 LIMIT 1',[f.merchant]))).rows[0]?.id;
 if(foreign)await assert.rejects(run('owner','/api/team/'+staff,'PATCH',{role:'staff',expectedRole:'manager'},owner,foreign),(e:{status?:number})=>e.status===404,'another shop cannot reach this member');
});
