import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');

test('group cart: simultaneous member edits, lock-vs-edit race, lock replay and expired invite (DS50)',integration,async()=>{
 const {mobileGroupRequest}=await import('../apps/api/src/mobile-groups');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const mk=async(name:string)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 hour')",[id,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  return {id,bearer:'Bearer '+token};};
 const merchant=randomUUID(),branch=randomUUID(),product=randomUUID();
 await admin.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Group race cafe','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled) VALUES($1,$2,'สาขา','Race branch',true)",[merchant,branch]);
 await admin.query("INSERT INTO bitpos.products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'a','Latte','',100,50)",[product,merchant]);
 const owner=await mk('Race owner'),members=await Promise.all([1,2,3,4,5].map(i=>mk('Race member '+i)));
 const call=(who:{bearer:string},method:string,path:string,body?:unknown)=>mobileGroupRequest(new URL('http://localhost/api/mobile/v1/groups'+path),method,body,who.bearer) as Promise<any>;
 const line=(qty:number)=>({branchId:branch,productId:product,qty});
 try{
  const g=await call(owner,'POST','');const id=g.id;
  const inv=await call(owner,'POST','/'+id+'/invite');
  await Promise.all(members.map(m=>call(m,'POST','/join',{token:inv.token})));
  // Simultaneous edits: each member sets a different quantity at once; every edit lands once, none is lost or doubled.
  await Promise.all(members.map((m,i)=>call(m,'POST','/'+id+'/lines',line(i+1))));
  await Promise.all(members.map((m,i)=>call(m,'POST','/'+id+'/lines',line(i+1))));
  const after=await call(owner,'GET','/'+id);
  assert.equal(after.lines.length,5,'one line per member, replays do not duplicate');
  assert.deepEqual(after.lines.map((l:{qty:number})=>l.qty).sort(),[1,2,3,4,5]);
  assert.equal(after.branches[0].qty,15);
  // Lock races with a member edit: either the edit lands before the freeze or it is refused; the frozen cart equals the database.
  const open=await call(owner,'GET','/'+id);
  const results=await Promise.allSettled([call(owner,'POST','/'+id+'/lock',{expectedVersion:open.version}),...members.map(m=>call(m,'POST','/'+id+'/lines',line(9)))]);
  // Optimistic lock: if an edit bumped the version first the owner is told GROUP_CHANGED and must re-read, never freezing an unseen cart.
  if(results[0].status==='rejected'){
   assert.match(String((results[0] as PromiseRejectedResult).reason?.message??''),/GROUP_CHANGED/);
   const fresh=await call(owner,'GET','/'+id);
   await call(owner,'POST','/'+id+'/lock',{expectedVersion:fresh.version});
  }
  for(const r of results.slice(1))if(r.status==='rejected')assert.match(String(r.reason?.message??r.reason),/GROUP_NOT_OPEN/,'a late edit is refused as frozen');
  const frozen=await call(owner,'GET','/'+id);assert.equal(frozen.state,'LOCKED');
  const rows=(await admin.query('SELECT account_id,qty FROM bitpos.group_cart_lines WHERE group_id=$1',[id])).rows;
  assert.equal(frozen.lines.length,rows.length);
  assert.equal(frozen.branches[0].qty,rows.reduce((s:number,r:{qty:number})=>s+r.qty,0),'view equals database after the race');
  // Freeze is stable: later edits and a replayed lock change nothing.
  await assert.rejects(call(members[0],'POST','/'+id+'/lines',line(3)),/GROUP_NOT_OPEN/);
  await assert.rejects(call(owner,'POST','/'+id+'/lock',{expectedVersion:open.version}),/GROUP_NOT_OPEN|GROUP_CHANGED/,'a replayed lock is refused');
  const again=await call(owner,'GET','/'+id);assert.equal(again.version,frozen.version,'replay does not bump the version');
  assert.deepEqual(again.lines,frozen.lines);
  // Expired invite: a late joiner is refused and the member list is unchanged.
  const g2=await call(owner,'POST','');const inv2=await call(owner,'POST','/'+g2.id+'/invite');
  await admin.query("UPDATE bitpos.group_cart_invites SET expires_at=now()-interval '1 second' WHERE group_id=$1",[g2.id]);
  const late=await mk('Late joiner');
  await assert.rejects(call(late,'POST','/join',{token:inv2.token}),/RESOURCE_NOT_FOUND/,'an expired invite is refused');
  assert.equal((await call(owner,'GET','/'+g2.id)).members.length,1);
  // Concurrent duplicate joins with one token add the member once.
  const inv3=await call(owner,'POST','/'+g2.id+'/invite');
  await Promise.all([call(late,'POST','/join',{token:inv3.token}),call(late,'POST','/join',{token:inv3.token})]);
  assert.equal((await call(owner,'GET','/'+g2.id)).members.length,2);
 }finally{await admin.end();await pool.end();}
});
