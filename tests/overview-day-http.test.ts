import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// Overview: business-day filter, net after refunds (the refund join itself is covered by the sales report tests), role fence, strict query.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const bkk=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const plus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

test('overview summary for a chosen business day: that day only, today is live, future/invalid refused, staff sees no money',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,path:string)=>{const r=await fetch(base+path,{headers:who?{Authorization:`Bearer ${tok[who]}`}:{}});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 try{
  const today=bkk(new Date()),past=plus(today,-3);
  const mk=async(qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]);});return (await f.create(await f.quote(qty))).order.id as string;};
  const P=await mk(2),T=await mk(1);
  await raw(async db=>{await db.query("UPDATE orders SET status='PAID',paid_at=$2,created_at=$2 WHERE id=$1",[P,`${past}T05:00:00Z`]);await db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp() WHERE id=$1",[T]);});

  const now=(await call('owner','/api/overview/summary')).body;
  assert.deepEqual([now.day,now.isToday,now.orders.paid],[today,true,1]);
  const usd=(r:any)=>r.sales.find((s:any)=>s.currency==='USD');
  assert.equal(usd(now).totalMinor,'270');
  assert.deepEqual(now.net.map((n:any)=>[n.currency,n.salesMinor,n.refundedMinor,n.netMinor]),[['USD','270','0','270']]);

  const old=(await call('owner',`/api/overview/summary?day=${past}`)).body;
  assert.deepEqual([old.day,old.isToday,old.orders.paid,old.orders.today,old.orders.inProgress],[past,false,1,1,0]);
  assert.equal(usd(old).totalMinor,'540');assert.equal(old.net[0].netMinor,'540');
  assert.deepEqual(old.hours.map((h:any)=>h.hour),[12],'05:00Z is 12:00 in Bangkok');
  // an empty day is an empty, valid answer
  const empty=(await call('owner',`/api/overview/summary?day=${plus(today,-20)}`)).body;assert.deepEqual([empty.orders.paid,empty.sales,empty.net],[0,[],[]]);

  // strict query: future, impossible, malformed, extra and duplicate parameters are refused
  for(const bad of [`day=${plus(today,1)}`,'day=2026-13-40','day=nope','day=','x=1',`day=${past}&day=${today}`,`day=${past}&x=1`])assert.equal((await call('owner','/api/overview/summary?'+bad)).status,422,bad);
  // staff: counts only, no money, no net; anonymous refused; another shop sees only itself
  const st=(await call('staff',`/api/overview/summary?day=${past}`)).body;assert.deepEqual([st.orders.paid,st.sales,st.net],[1,null,null]);
  assert.equal((await call(null,'/api/overview/summary')).status,401);
  const other=(await call('other',`/api/overview/summary?day=${past}`)).body;assert.deepEqual([other.orders.paid,other.sales],[0,[]]);
 }finally{await new Promise(r=>server.close(r));await admin.end();}
});
