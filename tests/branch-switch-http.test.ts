import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {tableFixture,staffToken} from './backend-table-fixture';
// M01: switching between the shops one account owns/manages: a new session for the target shop, the old one ended, nothing readable across.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

test('branch switch: only owner/manager memberships, fresh session for the target, old session ended, no cross-shop reads, refusals look alike',integration,async()=>{
 const a=await tableFixture(),b=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const call=async(token:string|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const U=randomUUID(),stranger=randomUUID();
 try{
  const tokA=await staffToken(a.pool,a.merchant,U,'owner');           // owner of A
  await staffToken(a.pool,b.merchant,U,'manager');                      // manager of B (its own session is irrelevant here)
  await staffToken(a.pool,a.other,U,'staff');                           // only staff in a third shop
  const tokStranger=await staffToken(a.pool,b.merchant,stranger,'owner'); // a different account, owner of B only
  const tokStaff=await staffToken(a.pool,a.merchant,randomUUID(),'staff');

  // listing: A (current) and B, never the staff-only shop; staff cannot list; anonymous refused
  assert.equal((await call(null,'GET','/api/branches')).status,401);
  assert.equal((await call(tokStaff,'GET','/api/branches')).status,403);
  const list=(await call(tokA,'GET','/api/branches')).body.branches;
  assert.deepEqual(list.map((x:any)=>[x.merchantId,x.role,x.current]).sort(),[[a.merchant,'owner',true],[b.merchant,'manager',false]].sort());
  assert.ok(!JSON.stringify(list).includes(a.other));

  // refusals: staff session, bad bodies, current shop, unknown shop, staff-only shop, shop of someone else — all 403/422 and the session stays valid
  assert.equal((await call(tokStaff,'POST','/api/branches/switch',{merchantId:b.merchant})).status,403);
  for(const bad of [{},{merchantId:'x'},{merchantId:b.merchant,x:1},{merchantId:a.merchant}])assert.equal((await call(tokA,'POST','/api/branches/switch',bad)).status,422,JSON.stringify(bad));
  assert.equal((await call(tokA,'POST','/api/branches/switch',{merchantId:a.other})).status,403,'staff-only shop');
  assert.equal((await call(tokA,'POST','/api/branches/switch',{merchantId:randomUUID()})).status,403,'unknown shop looks the same');
  assert.equal((await call(tokStranger,'POST','/api/branches/switch',{merchantId:a.merchant})).status,403,'another account cannot enter A');
  assert.equal((await call(tokA,'GET','/api/session')).status,200,'a refused switch leaves the session alone');

  // switch A -> B: new token, role of THAT membership, old token ended
  const sw=await call(tokA,'POST','/api/branches/switch',{merchantId:b.merchant});assert.equal(sw.status,200);
  assert.deepEqual([sw.body.merchantId,sw.body.role,sw.body.userId],[b.merchant,'manager',U]);assert.notEqual(sw.body.token,tokA);
  assert.equal((await call(tokA,'GET','/api/session')).status,401,'old session ended, so a late request from the old screen is refused');
  const tokB=sw.body.token as string;
  const sess=(await call(tokB,'GET','/api/session')).body;assert.deepEqual([sess.merchantId,sess.role],[b.merchant,'manager']);
  // data is B's only: B's product is visible, A's is not; B's manager role is enforced (owner-only route refused)
  const menu=(await call(tokB,'GET','/api/menu')).body.products.map((p:any)=>p.id);assert.ok(menu.includes(b.product));assert.ok(!menu.includes(a.product));
  assert.equal((await call(tokB,'GET','/api/settings/channel-prices')).status,200);
  assert.equal((await call(tokB,'PUT','/api/settings/channel-prices',{priceVersion:b.pricing.priceVersion,expectedRevision:'0',set:[{productId:b.product,channel:'counter',unitMinor:'300'}]})).status,403,'role in B is manager, not the owner role held in A');
  // audit trail in both shops
  const n=async(f:typeof a,action:string)=>Number((await f.tenant(f.merchant,db=>db.query('SELECT count(*) FROM audit_logs WHERE merchant_id=$1 AND action=$2',[f.merchant,action]))).rows[0].count);
  assert.deepEqual([await n(a,'session.branch_out'),await n(b,'session.branch_in')],[1,1]);

  // switch back B -> A: role owner again; the B token is ended
  const back=await call(tokB,'POST','/api/branches/switch',{merchantId:a.merchant});assert.equal(back.status,200);assert.deepEqual([back.body.merchantId,back.body.role],[a.merchant,'owner']);
  assert.equal((await call(tokB,'GET','/api/session')).status,401);
  assert.equal((await call(back.body.token,'GET','/api/menu')).body.products.some((p:any)=>p.id===b.product),false);

  // a shop that disables the account (or limits its hours) can no longer be entered or listed
  await a.pool.query('SELECT 1');
  await b.tenant(b.merchant,db=>db.query("INSERT INTO staff_profiles(merchant_id,user_id,active) VALUES($1,$2,false) ON CONFLICT(merchant_id,user_id) DO UPDATE SET active=false",[b.merchant,U]));
  assert.equal((await call(back.body.token,'POST','/api/branches/switch',{merchantId:b.merchant})).status,403);
  assert.ok(!(await call(back.body.token,'GET','/api/branches')).body.branches.some((x:any)=>x.merchantId===b.merchant));
  assert.equal((await call(back.body.token,'GET','/api/session')).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
