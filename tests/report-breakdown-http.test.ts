import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// M07: summary = breakdown = drill-down = CSV ledger over the real HTTP server and real SQL.
// Needs the backend fixtures: BITPOS_BACKEND_INTEGRATION=1 plus a throwaway Postgres with migrations through 189.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const bkkDay=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const plus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
type Sum=Record<string,bigint>;
const add=(s:Sum,cur:string,v:string|bigint)=>{s[cur]=(s[cur]??0n)+BigInt(v);};

test('sales summary, breakdown, bill drill-down and CSV agree: windows, voids, pending, late settlement, currencies, formula-safe cells',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const sql=<T>(fn:(db:any)=>Promise<T>)=>f.tenant(f.merchant,fn);
 // Superuser connection: fixtures that bend append-only history (paid times, a discount) the way no application path can.
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const today=bkkDay(new Date()),dayX=plus(today,-5),dayY=plus(dayX,1);
 try{
  const category='=HYPERLINK("http://x/y","z")';
  await raw(async db=>{await db.query('UPDATE products SET category=$2 WHERE id=$1',[f.product,category]);});
  // real orders (server-priced, with authority): A and B become paid either side of local midnight, C stays open, D is voided, E is a late settlement
  // The register has one customer screen: free it (as the closure routine does) before each fixture order.
  const mk=async(qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1",[f.merchant]);});return (await f.create(await f.quote(qty))).order.id as string;};
  const A=await mk(1),B=await mk(2),C=await mk(1),D=await mk(1),E=await mk(1);
  await raw(async db=>{await db.query("UPDATE orders SET status='PAID',paid_at=$2 WHERE id=$1",[A,`${dayX}T16:59:59.999Z`]);});
  await raw(async db=>{await db.query("UPDATE orders SET status='PAID',paid_at=$2 WHERE id=$1",[B,`${dayX}T17:00:00Z`]);});
  await raw(async db=>{await db.query("UPDATE orders SET status='RECOVERY' WHERE id=$1",[E]);});
  assert.equal((await call('owner','POST',`/api/bills/orders/${D}/void`,{reason:'ลูกค้ายกเลิก'})).status,200);
  // B carries a 10-minor discount that no line shows: it must surface as an explicit unallocated row, not vanish
  await raw(async db=>{await db.query('UPDATE order_authority SET total_minor=total_minor-10 WHERE order_id=$1',[B]);});
  // cash (THB): one paid sale on dayY, one voided sale on dayX
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'H',staffMaxDiscountBps:0})).status,200);
  assert.equal((await call('manager','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'}]})).status,200);
  const s1=(await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:2}],tenderMinor:'20000'})).body.sale.id as string;
  const s2=(await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1}],tenderMinor:'10000'})).body.sale.id as string;
  assert.equal((await call('manager','POST',`/api/cash/sales/${s2}/void`,{reason:'คิดเงินผิด',restock:true})).body.sale.status,'VOIDED');
  await raw(async db=>{await db.query("UPDATE cash_sales SET created_at=$2 WHERE id=$1",[s1,`${dayY}T05:00:00Z`]);await db.query("UPDATE cash_sales SET created_at=$2 WHERE id=$1",[s2,`${dayX}T05:00:00Z`]);});

  // access: owner/manager only, never anonymous, never another shop, strict query
  const q=(a:string,b:string)=>`from=${a}&to=${b}`;
  assert.equal((await call(null,'GET',`/api/reports/breakdown?${q(dayX,dayY)}`)).status,401);
  assert.equal((await call('staff','GET',`/api/reports/breakdown?${q(dayX,dayY)}`)).status,403);
  assert.equal((await call('staff','GET',`/api/reports/export?kind=breakdown&${q(dayX,dayY)}`)).status,403);
  for(const bad of ['from=2026-13-40&to=2026-11-01',`from=${dayY}&to=${dayX}`,`${q(dayX,dayY)}&x=1`,`${q(dayX,dayY)}&from=${dayX}`,'from=2024-01-01&to=2026-01-01'])assert.equal((await call('owner','GET','/api/reports/breakdown?'+bad)).status,422,bad);
  const none=(await call('other','GET',`/api/reports/breakdown?${q(dayX,today)}`)).body;assert.deepEqual([none.totals,none.channels,none.categories,none.pipeline],[[],[],[],[]]);

  // date boundaries: A is the last millisecond of dayX, B is the first instant of dayY (shop time zone), exactly one window each
  const one=async(a:string,b:string)=>(await call('manager','GET',`/api/reports/breakdown?${q(a,b)}`)).body;
  const bx=await one(dayX,dayX),by=await one(dayY,dayY),both=await one(dayX,dayY);
  const usd=(r:any)=>r.totals.find((t:any)=>t.currency==='USD');
  assert.deepEqual([usd(bx).orders,usd(by).orders,usd(both).orders],[1,1,2]);
  assert.equal(bx.totals.find((t:any)=>t.currency==='THB'),undefined,'cash sale of dayY is not in dayX');
  assert.equal(by.totals.find((t:any)=>t.currency==='THB').orders,1);
  assert.equal(BigInt(usd(bx).totalMinor)+BigInt(usd(by).totalMinor),BigInt(usd(both).totalMinor));

  // 1) summary: /api/reports/sales (what the Reports screen totals)
  const rep=(await call('owner','GET',`/api/reports/sales?${q(dayX,dayY)}`)).body;
  const summary:Sum={};for(const d of rep.days)for(const g of d.groups)add(summary,g.currency,g.totalMinor);
  // 2) breakdown, three ways
  const fromTotals:Sum={},fromChannels:Sum={},fromMethods:Sum={},fromCategories:Sum={};
  for(const t of both.totals)add(fromTotals,t.currency,t.totalMinor);
  for(const c of both.channels)add(fromChannels,c.currency,c.totalMinor);
  for(const m of both.methods)add(fromMethods,m.currency,m.totalMinor);
  for(const c of both.categories)add(fromCategories,c.currency,c.totalMinor);
  for(const u of both.unallocated)add(fromCategories,u.currency,u.totalMinor);
  assert.deepEqual([fromTotals,fromChannels,fromMethods,fromCategories],[summary,summary,summary,summary]);
  assert.deepEqual(Object.keys(summary).sort(),['THB','USD'],'two currencies, never merged');
  assert.deepEqual(both.unallocated,[{currency:'USD',decimals:2,totalMinor:'-10'}],'the discount is shown, not hidden');
  assert.deepEqual(both.channels.map((c:any)=>c.channel).sort(),['cash_counter','register']);
  assert.deepEqual(both.methods.map((m:any)=>m.method).sort(),['CASH','USDG']);
  const cat=both.categories.find((c:any)=>c.currency==='THB');assert.deepEqual([cat.category,cat.units,cat.totalMinor],[category,2,'13000']);
  // 3) drill-down: every paid bill in the same window, all pages, grouped by currency
  const drill:Sum={};const ids:string[]=[];let cursor:string|null=null;
  for(let i=0;i<20;i++){const p:any=await call('staff','GET',`/api/bills?state=paid&${q(dayX,dayY)}&limit=1${cursor?'&cursor='+cursor:''}`);assert.equal(p.status,200);for(const b of p.body.bills){add(drill,b.currency,b.totalMinor);ids.push(b.id);}cursor=p.body.nextCursor;if(!cursor)break;}
  assert.equal(cursor,null);assert.deepEqual(drill,summary);assert.deepEqual(ids.sort(),[A,B,s1].sort());
  // the narrow windows drill down to the same single bill the summary counts (paid_at, not creation time)
  assert.deepEqual((await call('staff','GET',`/api/bills?state=paid&${q(dayX,dayX)}`)).body.bills.map((b:any)=>b.id),[A]);
  assert.deepEqual((await call('staff','GET',`/api/bills?state=paid&${q(dayY,dayY)}`)).body.bills.map((b:any)=>b.id).sort(),[B,s1].sort());
  // 4) CSV ledger: sales rows (orders) + cash rows that are PAID
  const csv=async(kind:string,a:string,b:string)=>{let out='',cur:string|null=null;for(let i=0;i<20;i++){const p:any=await call('owner','GET',`/api/reports/export?kind=${kind}&${q(a,b)}${cur?'&cursor='+cur:''}`);assert.equal(p.status,200);out+=p.body.csv;cur=p.body.nextCursor;if(!cur)break;}return out;};
  const ledger:Sum={};
  for(const l of (await csv('sales',dayX,dayY)).trim().split('\r\n').slice(1)){const c=l.split(',');add(ledger,c[4]!,c[6]!);}
  for(const l of (await csv('cash',dayX,dayY)).trim().split('\r\n').slice(1)){const c=l.split(',');if(c[4]==='PAID')add(ledger,c[5]!,c[10]!);}
  assert.deepEqual(ledger,summary);

  // not revenue: open / voided / late settlement / voided cash are reported apart and never in the totals
  const wide=(await one(dayX,today));
  const pipe=(s:string)=>wide.pipeline.filter((p:any)=>p.state===s);
  assert.deepEqual([pipe('open')[0].count,pipe('voided')[0].count,pipe('late_settlement')[0].count,pipe('cash_voided')[0].count],[1,1,1,1]);
  assert.equal(pipe('cash_voided')[0].currency,'THB');assert.equal(pipe('cash_voided')[0].totalMinor,'6500');
  assert.deepEqual(wide.totals,both.totals,'pending, void and late settlement add nothing to revenue');

  // breakdown CSV: one sheet that ties to the screen, formula-neutralised text, integers only, not pageable
  const sheet=await call('owner','GET',`/api/reports/export?kind=breakdown&${q(dayX,today)}`);assert.equal(sheet.status,200);
  const text=sheet.body.csv as string;assert.ok(text.startsWith('section,key,currency,decimals,orders_or_units,total_minor\r\n'));
  assert.ok(text.includes("'=HYPERLINK"),'formula text is neutralised');assert.ok(!/(^|,)=HYPERLINK/m.test(text));
  assert.ok(text.includes('total,all,USD,2,2,')&&text.includes('unallocated,,USD,2,0,-10')&&text.includes('not_revenue_late_settlement,,'));
  assert.equal(sheet.body.nextCursor,null);
  assert.equal((await call('owner','GET',`/api/reports/export?kind=breakdown&${q(dayX,today)}&cursor=${randomUUID()}`)).status,422);
  assert.equal((await call('other','GET',`/api/reports/export?kind=breakdown&${q(dayX,today)}`)).body.rows,0,'another shop sees no rows of this shop');
 }finally{
  server.close();
  await raw(async db=>{
   for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings'])await db.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]).catch(()=>undefined);
   await db.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]).catch(()=>undefined);
  }).catch(()=>undefined);
  await admin.end();
 }
});
