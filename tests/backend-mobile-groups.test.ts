import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {MobileGroupSchema,MobileGroupsSchema,MobileGroupInviteSchema,MobileGroupLeftSchema} from '../packages/contracts/src/mobile-v1.generated';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
test('group carts: owner/member rules, invite token, line validation, optimistic lock, privacy, caps',integration,async()=>{
 // Loading boundary: skipped integration never loads private runtime config.
 const {mobileGroupRequest}=await import('../apps/api/src/mobile-groups');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const mk=async(name:string)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 hour')",[id,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  return {id,bearer:'Bearer '+token};};
 const merchant=randomUUID(),branch=randomUUID(),offBranch=randomUUID(),product=randomUUID(),archived=randomUUID(),otherProduct=randomUUID();
 await admin.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Group cafe','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled) VALUES($1,$2,'สาขา','Open branch',true),($1,$3,'ปิด','Off branch',false)",[merchant,branch,offBranch]);
 await admin.query("INSERT INTO bitpos.products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'a','Latte','',100,5),($3,$2,'b','Old','',100,0)",[product,merchant,archived]);
 await admin.query('UPDATE bitpos.products SET archived_at=now() WHERE id=$1',[archived]);
 const otherMerchant=randomUUID();await admin.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Other','11111111111111111111111111111111')",[otherMerchant]);
 await admin.query("INSERT INTO bitpos.products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'c','Foreign','',100,5)",[otherProduct,otherMerchant]);
 const owner=await mk('Owner'),guest=await mk('Guest'),stranger=await mk('Stranger');
 const call=(who:{bearer:string}|null,method:string,path:string,body?:unknown)=>mobileGroupRequest(new URL('http://localhost/api/mobile/v1/groups'+path),method,body,who?.bearer) as Promise<any>;
 try{
  await assert.rejects(call(null,'POST',''),/AUTH_REQUIRED|UNAUTHORI|401/i,'a bearer is required');
  const made=MobileGroupSchema.parse(await call(owner,'POST',''));
  assert.equal(made.state,'OPEN');assert.equal(made.youAreOwner,true);assert.deepEqual(made.members,[owner.id]);
  const id=made.id;
  await assert.rejects(call(stranger,'GET','/'+id),/RESOURCE_NOT_FOUND/,'a non-member cannot read the group');
  await assert.rejects(call(guest,'POST','/'+id+'/invite'),/RESOURCE_NOT_FOUND/,'only the owner invites');
  const invite=MobileGroupInviteSchema.parse(await call(owner,'POST','/'+id+'/invite'));
  const stored=(await admin.query('SELECT token_hash FROM bitpos.group_cart_invites WHERE group_id=$1',[id])).rows[0];
  assert.notEqual(stored.token_hash,invite.token,'only a hash is stored');
  await assert.rejects(call(stranger,'POST','/join',{token:invite.token.slice(0,-3)+'zzz'}),/RESOURCE_NOT_FOUND/,'a wrong token reveals nothing');
  const joined=MobileGroupSchema.parse(await call(guest,'POST','/join',{token:invite.token}));
  assert.equal(joined.youAreOwner,false);assert.equal(joined.members.length,2);
  assert.equal((await call(guest,'POST','/join',{token:invite.token})).members.length,2,'rejoin is a no-op');
  // Lines.
  const line=(over:Record<string,unknown>={})=>({branchId:branch,productId:product,qty:2,...over});
  assert.equal(MobileGroupSchema.parse(await call(guest,'POST','/'+id+'/lines',line())).lines[0].qty,2);
  await assert.rejects(call(guest,'POST','/'+id+'/lines',line({branchId:offBranch})),/PRODUCT_UNAVAILABLE/,'a disabled branch is refused');
  await assert.rejects(call(guest,'POST','/'+id+'/lines',line({productId:archived})),/PRODUCT_UNAVAILABLE/,'an archived product is refused');
  await assert.rejects(call(guest,'POST','/'+id+'/lines',line({productId:otherProduct})),/PRODUCT_UNAVAILABLE/,'a product of another merchant is refused');
  await assert.rejects(call(guest,'POST','/'+id+'/lines',line({qty:100})),/INVALID_REQUEST/);
  await assert.rejects(call(guest,'POST','/'+id+'/lines',{...line(),price:1}),/INVALID_REQUEST/,'no client price is accepted');
  await assert.rejects(call(stranger,'POST','/'+id+'/lines',line()),/RESOURCE_NOT_FOUND/);
  await call(owner,'POST','/'+id+'/lines',line({qty:1}));
  const view=MobileGroupSchema.parse(await call(owner,'GET','/'+id));
  assert.deepEqual(view.branches,[{branchId:branch,qty:3,members:2}],'per-branch roll-up, no money');
  // Owner can remove a member's line; a member cannot remove another's.
  await assert.rejects(call(guest,'POST','/'+id+'/members/'+owner.id,line({qty:0})),/NOT_YOUR_LINE/);
  await assert.rejects(call(owner,'POST','/'+id+'/members/'+guest.id,line({qty:1})),/INVALID_REQUEST/,'owner removal needs qty 0');
  assert.equal((await call(owner,'POST','/'+id+'/members/'+guest.id,line({qty:0}))).lines.length,1);
  await call(guest,'POST','/'+id+'/lines',line({qty:4}));
  assert.equal((await call(guest,'POST','/'+id+'/lines',line({qty:0}))).lines.length,1,'qty 0 removes your own line');
  // Lock: owner only, optimistic, freezes.
  const open=await call(owner,'GET','/'+id);
  await assert.rejects(call(guest,'POST','/'+id+'/lock',{expectedVersion:open.version}),/RESOURCE_NOT_FOUND/);
  await assert.rejects(call(owner,'POST','/'+id+'/lock',{expectedVersion:'1'}),/GROUP_CHANGED/,'stale version refused');
  const locked=MobileGroupSchema.parse(await call(owner,'POST','/'+id+'/lock',{expectedVersion:open.version}));
  assert.equal(locked.state,'LOCKED');
  await assert.rejects(call(guest,'POST','/'+id+'/lines',line()),/GROUP_NOT_OPEN/,'locked groups are frozen');
  await assert.rejects(call(stranger,'POST','/join',{token:invite.token}),/RESOURCE_NOT_FOUND/,'lock revokes the invite');
  await assert.rejects(call(guest,'POST','/'+id+'/leave'),/GROUP_NOT_OPEN/);
  assert.equal(MobileGroupsSchema.parse(await call(owner,'GET','')).groups.some((g:{id:string})=>g.id===id),true);
  // Empty lock, leave, cancel, caps.
  const g2=await call(owner,'POST','');await assert.rejects(call(owner,'POST','/'+g2.id+'/lock',{expectedVersion:g2.version}),/EMPTY_CART/);
  const inv2=await call(owner,'POST','/'+g2.id+'/invite');await call(guest,'POST','/join',{token:inv2.token});await call(guest,'POST','/'+g2.id+'/lines',line());
  await assert.rejects(call(owner,'POST','/'+g2.id+'/leave'),/OWNER_CANNOT_LEAVE/);
  assert.equal(MobileGroupLeftSchema.parse(await call(guest,'POST','/'+g2.id+'/leave')).left,true);
  assert.equal((await admin.query('SELECT count(*)::int n FROM bitpos.group_cart_lines WHERE group_id=$1 AND account_id=$2',[g2.id,guest.id])).rows[0].n,0,'leaving removes the member lines');
  assert.equal((await call(owner,'POST','/'+g2.id+'/cancel')).state,'CANCELLED');
  assert.equal((await call(owner,'POST','/'+g2.id+'/cancel')).state,'CANCELLED','cancel is idempotent');
  await assert.rejects(call(owner,'POST','/'+g2.id+'/invite'),/GROUP_NOT_OPEN/);
  for(let i=0;i<5;i++)await call(owner,'POST','');
  await assert.rejects(call(owner,'POST',''),/GROUP_LIMIT/,'at most 5 open groups per owner');
  const g3=(await call(owner,'GET','')).groups.find((g:{state:string;id:string})=>g.state==='OPEN'&&g.id!==id)!;
  const inv3=await call(owner,'POST','/'+g3.id+'/invite');
  const extra=await Promise.all(Array.from({length:11},(_,i)=>mk('M'+i)));
  for(const m of extra.slice(0,10))await call(m,'POST','/join',{token:inv3.token});
  assert.equal((await call(owner,'GET','/'+g3.id)).members.length,11);
  await call(extra[10],'POST','/join',{token:inv3.token});
  await assert.rejects(call(stranger,'POST','/join',{token:inv3.token}),/GROUP_FULL/,'12 members max');
  await assert.rejects(call(owner,'DELETE','/'+id),/INVALID_REQUEST/);
 }finally{await admin.end();await pool.end();}
});
