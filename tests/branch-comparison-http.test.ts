import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// M10 over the real HTTP server and SQL: the read-only comparison of the shops one account owns or manages. Membership scope, per-currency aggregate that
// never double counts, disabled/staff shops skipped, no data of a shop the account is only staff in, strict query, failure isolation.
// Needs BITPOS_BACKEND_INTEGRATION=1 plus a throwaway Postgres with migrations through 191.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const bkkDay=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const plus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

test('branch comparison: only shops the account owns/manages, per-shop numbers equal each shop’s own report, aggregate adds the same currency once, nothing leaks from staff/disabled shops',integration,async()=>{
 const A=await tableFixture(),B=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:2});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const get=async(token:string|null,path:string)=>{const r=await fetch(base+path,{headers:token?{Authorization:`Bearer ${token}`}:{}});return {status:r.status,body:await r.json() as any};};
 const post=async(token:string,method:string,path:string,body:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const today=bkkDay(new Date()),from=plus(today,-1),to=plus(today,1),win=`from=${from}&to=${to}`;
 const U=randomUUID(),Z=randomUUID(),staffOnlyA=randomUUID();
 try{
  // memberships: U owns A, manages B, is staff in A's sibling shop and a disabled manager of B's sibling shop
  const tA=await staffToken(A.pool,A.merchant,U,'owner'),tB=await staffToken(B.pool,B.merchant,U,'manager');
  await staffToken(A.pool,A.other,U,'staff');await staffToken(B.pool,B.other,U,'manager');
  await raw(async db=>{await db.query('INSERT INTO staff_profiles(merchant_id,user_id,active) VALUES($1,$2,false)',[B.other,U]);});
  // each shop: a cash sale (THB) and a paid counter order (USD), different amounts
  const owner=async(f:typeof A)=>staffToken(f.pool,f.merchant,randomUUID(),'owner');
  const cashSale=async(f:typeof A,qty:number)=>{const o=await owner(f);
   assert.equal((await post(o,'PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'H',staffMaxDiscountBps:0})).status,200);
   assert.equal((await post(o,'PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'}]})).status,200);
   assert.equal((await post(o,'POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty}],tenderMinor:'100000'})).status,200);};
  const paidOrder=async(f:typeof A,qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1",[f.merchant]);});
   const id=(await f.create(await f.quote(qty))).order.id as string;await raw(async db=>{await db.query("UPDATE orders SET status='PAID',paid_at=now() WHERE id=$1",[id]);});};
  await cashSale(A,2);await paidOrder(A,1);await cashSale(B,1);await paidOrder(B,2);await paidOrder(B,1);

  // access: anonymous, staff and a bad window are refused before any data is read
  assert.equal((await get(null,`/api/branches/comparison?${win}`)).status,401);
  const staffTok=await staffToken(A.pool,A.merchant,randomUUID(),'staff');assert.equal((await get(staffTok,`/api/branches/comparison?${win}`)).status,403);
  for(const bad of [`from=2026-13-40&to=${to}`,`from=${to}&to=${from}`,`${win}&x=1`,`${win}&from=${from}`,'from=2024-01-01&to=2026-01-01',''])assert.equal((await get(tA,'/api/branches/comparison?'+bad)).status,422,bad);

  // the comparison from A: A (current) first, then B; the two shops where U is staff/disabled are skipped and counted, not named
  const cmp=(await get(tA,`/api/branches/comparison?${win}`));assert.equal(cmp.status,200);const c=cmp.body;
  assert.deepEqual(c.shops.map((s:any)=>[s.merchantId,s.current,s.role,s.error]),[[A.merchant,true,'owner',false],[B.merchant,false,'manager',false]]);
  assert.deepEqual([c.excludedShops,c.truncated,c.complete],[2,false,true]);
  assert.ok(!JSON.stringify(c).includes(A.other)&&!JSON.stringify(c).includes(B.other),'skipped shops are not in the answer');
  // every shop's numbers equal that shop's own report; the aggregate is the sum per currency (and never across currencies)
  const own=async(f:typeof A)=>(await get(await owner(f),`/api/reports/breakdown?${win}`)).body;
  const [ra,rb]=[await own(A),await own(B)];
  assert.deepEqual(c.shops[0].totals,ra.totals);assert.deepEqual(c.shops[1].totals,rb.totals);assert.deepEqual(c.shops[0].channels,ra.channels);
  const want=new Map<string,{orders:number;sum:bigint;shops:number}>();
  for(const r of [ra,rb])for(const t of r.totals){const k=t.currency+'/'+t.decimals;const e=want.get(k)??{orders:0,sum:0n,shops:0};e.orders+=t.orders;e.sum+=BigInt(t.totalMinor);e.shops++;want.set(k,e);}
  assert.deepEqual(c.aggregate.map((a:any)=>[a.currency+'/'+a.decimals,a.orders,a.totalMinor,a.shops]),[...want].sort(([x],[y])=>x.localeCompare(y)).map(([k,e])=>[k,e.orders,e.sum.toString(),e.shops]));
  const thb=c.aggregate.find((a:any)=>a.currency==='THB');assert.deepEqual([thb.orders,thb.totalMinor,thb.shops],[2,'19500',2],'13000 + 6500, one cash sale counted once per shop');
  assert.ok(c.aggregate.length>=2&&new Set(c.aggregate.map((a:any)=>a.currency)).size===c.aggregate.length,'currencies stay in separate rows');
  assert.equal(c.shops[1].totals.find((t:any)=>t.currency==='USD').orders,2,'B’s two paid orders');

  // the same answer, other shop first, from B’s own session (current flag follows the session; the set of shops does not)
  const fromB=(await get(tB,`/api/branches/comparison?${win}`)).body;
  assert.deepEqual(fromB.shops.map((s:any)=>[s.merchantId,s.current]),[[B.merchant,true],[A.merchant,false]]);assert.deepEqual(fromB.aggregate,c.aggregate);

  // an account that is staff in A and owner in B cannot use A’s session, and from B’s session A is excluded and invisible
  const zA=await staffToken(A.pool,A.merchant,Z,'staff'),zB=await staffToken(B.pool,B.merchant,Z,'owner');
  assert.equal((await get(zA,`/api/branches/comparison?${win}`)).status,403);
  const zc=(await get(zB,`/api/branches/comparison?${win}`)).body;assert.deepEqual([zc.shops.map((s:any)=>s.merchantId),zc.excludedShops],[[B.merchant],1]);
  // a demoted account (A: owner -> staff) loses the shop at once, even with the old session
  await raw(async db=>{await db.query("UPDATE members SET role='staff' WHERE user_id=$1 AND merchant_id=$2",[U,A.merchant]);});
  assert.equal((await get(tA,`/api/branches/comparison?${win}`)).status,403);
  assert.deepEqual((await get(tB,`/api/branches/comparison?${win}`)).body.shops.map((s:any)=>s.merchantId),[B.merchant]);
  await raw(async db=>{await db.query("UPDATE members SET role='owner' WHERE user_id=$1 AND merchant_id=$2",[U,A.merchant]);});

  // one shop failing does not hide the others, and the answer says it is partial (a broken time zone makes that shop's report fail)
  await raw(async db=>{await db.query("INSERT INTO merchant_opening_hours(merchant_id,time_zone,week) VALUES($1,'Not/AZone','{}'::jsonb) ON CONFLICT(merchant_id) DO UPDATE SET time_zone='Not/AZone'",[B.merchant]);});
  const partial=(await get(tA,`/api/branches/comparison?${win}`)).body;
  assert.equal(partial.complete,false);
  assert.deepEqual(partial.shops.map((s:any)=>[s.merchantId,s.error,s.totals.length>0]),[[A.merchant,false,true],[B.merchant,true,false]]);
  assert.equal(partial.aggregate.find((a:any)=>a.currency==='THB').totalMinor,'13000','the aggregate holds only the shop that loaded');
 }finally{
  server.close();
  for(const f of [A,B])await raw(async db=>{for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings','merchant_opening_hours'])await db.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]).catch(()=>undefined);await db.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]).catch(()=>undefined);}).catch(()=>undefined);
  await admin.end();
 }
});
