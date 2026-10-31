import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
type Fixture=Awaited<ReturnType<typeof tableFixture>>;
// One order at a time per display: create, then free the display (the same step the render harness uses for bulk data).
async function createOrder(f:Fixture,paid:boolean){
 const created=await f.create(await f.quote(1));
 if(paid)await f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp(),payer='SummaryPayer11111111111111111111111111111',version=version+1 WHERE id=$1",[created.order.id]));
 await f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.a.id]));
 return created.order.id as string;
}
// Shop-local wall clock: day offset from today and minutes after local midnight, as a timestamptz.
const at=(day:string,minutes:string)=>`(((now() AT TIME ZONE 'Asia/Bangkok')::date+${day}::int)::timestamp+(${minutes}::int||' minutes')::interval) AT TIME ZONE 'Asia/Bangkok'`;

test('overview summary: 230 paid orders are not capped, midnight straddlers follow one rule, currencies stay apart, tenant and role fenced',integration,async()=>{
 const f=await tableFixture(100000);
 const g=await tableFixture(1000);// a second merchant with its own orders: must never leak into f
 const {overviewSummary}=await import('../apps/api/src/overview-summary');
 const {salesReport}=await import('../apps/api/src/reports');
 const {reportExport}=await import('../apps/api/src/report-exports');
 const call=(fx:Fixture,role:string,query='')=>fx.tenant(fx.merchant,db=>overviewSummary(db,fx.merchant,role,new URL('http://localhost/api/overview/summary'+query)));
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();await admin.query('SET session_replication_role=replica');
 try{
  const ids:string[]=[];for(let i=0;i<230;i++)ids.push(await createOrder(f,true));
  const unpaid:string[]=[];for(let i=0;i<3;i++)unpaid.push(await createOrder(f,false));
  const x=await createOrder(f,true),y=await createOrder(f,true),z=await createOrder(f,true),w=await createOrder(f,true);
  const other=[await createOrder(g,true),await createOrder(g,true)];
  // 230 orders spread 00:00-15:16 shop time today (4 minutes apart), created and paid at the same minute.
  const minute=(i:number)=>i*4;
  await admin.query(`UPDATE bitpos.orders o SET created_at=${at('0','t.m')},paid_at=${at('0','t.m')} FROM unnest($1::uuid[],$2::int[]) AS t(id,m) WHERE o.id=t.id`,[ids,ids.map((_,i)=>minute(i))]);
  // Open bills created today after the paid ones (15:20, 15:24, 15:28).
  for(const [i,id] of unpaid.entries())await admin.query(`UPDATE bitpos.orders SET created_at=${at('0','$1')} WHERE id=$2`,[920+i*4,id]);
  // Midnight straddlers. X: created yesterday 23:50, paid today 00:10. Y: created today 23:50, paid tomorrow 00:10. Z: created and paid yesterday 23:59. W: created and paid tomorrow 00:00.
  const set=(id:string,created:[number,number],paid:[number,number])=>admin.query(`UPDATE bitpos.orders SET created_at=${at('$1','$2')},paid_at=${at('$3','$4')} WHERE id=$5`,[created[0],created[1],paid[0],paid[1],id]);
  await set(x,[-1,23*60+50],[0,10]);await set(y,[0,23*60+50],[1,10]);await set(z,[-1,23*60+59],[-1,23*60+59]);await set(w,[1,0],[1,0]);
  // Second denomination: 20 paid orders priced in THB (2 decimals); 12 other orders were served as takeaway.
  const thb=ids.slice(0,20),takeaway=ids.slice(20,32);
  await admin.query("UPDATE bitpos.order_authority a SET catalog_currency='THB',catalog_decimals=2,total_minor=1000+t.n FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id,n) WHERE a.order_id=t.id",[thb]);
  await admin.query("UPDATE bitpos.order_authority SET serving_kind='takeaway' WHERE order_id=ANY($1::uuid[])",[takeaway]);
  // Fulfilment: 40 collected, 25 preparing; the rest never had a row (RECEIVED). X and the far-future/yesterday-collected rule keep the board honest.
  const collected=ids.slice(100,140),preparing=ids.slice(140,165);
  for(const id of [...collected,y,z,w])await admin.query("INSERT INTO bitpos.order_fulfillment(merchant_id,order_id,status) SELECT merchant_id,id,'COLLECTED' FROM bitpos.orders WHERE id=$1",[id]);
  for(const id of preparing)await admin.query("INSERT INTO bitpos.order_fulfillment(merchant_id,order_id,status) SELECT merchant_id,id,'PREPARING' FROM bitpos.orders WHERE id=$1",[id]);
  const priced=async(id:string)=>(await admin.query<{currency:string;decimals:number;total:string}>('SELECT catalog_currency AS currency,catalog_decimals AS decimals,total_minor::text AS total FROM bitpos.order_authority WHERE order_id=$1',[id])).rows[0];

  // Expected values come from this test's own bookkeeping, not from the endpoint.
  const paidToday=[...ids,x];
  const expectedSales=new Map<string,bigint>();for(const id of paidToday){const p=await priced(id);const key=p.currency+':'+p.decimals;expectedSales.set(key,(expectedSales.get(key)??0n)+BigInt(p.total));}
  assert.equal(expectedSales.size,2,'two denominations in play');
  const summary=await call(f,'owner');
  assert.equal(summary.timeZone,'Asia/Bangkok');assert.deepEqual(summary.basis,{orders:'created_at',sales:'paid_at',hours:'paid_at',inProgress:'paid_since_yesterday_not_collected'});
  assert.equal(summary.orders.today,230+3+1,'created today incl. unpaid and Y (created 23:50), not X/Z (yesterday) or W (tomorrow)');
  assert.equal(summary.orders.paid,231,'paid today: 230 + X (paid 00:10), not Y/W (paid tomorrow) or Z (paid yesterday)');
  assert.ok(summary.orders.today>200&&summary.orders.paid>200,'not capped at the 200 newest orders');
  assert.deepEqual(summary.sales!.map(s=>s.currency+':'+s.decimals).sort(),['THB:2','USD:2'],'one row per denomination, never merged');
  for(const s of summary.sales!){assert.match(s.totalMinor,/^[0-9]+$/);assert.equal(BigInt(s.totalMinor),expectedSales.get(s.currency+':'+s.decimals));}
  assert.equal(summary.sales!.reduce((n,s)=>n+s.orders,0),231);assert.equal(summary.sales!.find(s=>s.currency==='THB')!.orders,20);
  assert.equal(summary.excludedOrders,0);
  // In progress: paid since yesterday, not collected: 231 paid today - 40 collected = 191, plus Z? Z is collected. W/Y are collected. So 191.
  assert.equal(summary.orders.inProgress,230-40+1);
  assert.deepEqual(summary.channels,{store:234-12,delivery:0,pickup:12},'channel shares by created orders; takeaway counts as pickup');
  // Hours: paid-time buckets in shop time. 230 orders every 4 minutes from 00:00, plus X at 00:10.
  const expectedHours=new Map<number,number>();for(let i=0;i<230;i++)expectedHours.set(Math.floor(minute(i)/60),(expectedHours.get(Math.floor(minute(i)/60))??0)+1);expectedHours.set(0,expectedHours.get(0)!+1);
  assert.deepEqual(summary.hours,[...expectedHours].sort(([a],[b])=>a-b).map(([hour,paid])=>({hour,paid})));
  assert.equal(summary.hours.reduce((n,h)=>n+h.paid,0),231);
  // Recent five by created time today: Y (23:50), the three open bills (15:28, 15:24, 15:20), then the newest paid order (15:16).
  assert.deepEqual(summary.recent.map(r=>r.id),[y,unpaid[2],unpaid[1],unpaid[0],ids[229]]);
  assert.equal(summary.recent[0].status,'PAID');assert.equal(summary.recent[0].fulfillmentStatus,'COLLECTED');assert.notEqual(summary.recent[1].status,'PAID');assert.equal(summary.recent[1].fulfillmentStatus,null);
  assert.equal(summary.recent[4].channel,'store');assert.equal(summary.recent[4].total.currency,'USD');assert.match(summary.recent[4].total.amountMinor,/^[0-9]+$/);

  // The same figures as the existing server report and the CSV export for the same shop day.
  const report=await f.tenant(f.merchant,db=>salesReport(db,f.merchant,'owner',new URL(`http://localhost/api/reports/sales?from=${summary.day}&to=${summary.day}`)));
  const reportGroups=report.days.flatMap(d=>d.groups);
  assert.equal(reportGroups.reduce((n,gr)=>n+gr.orders,0),231,'report counts the same paid orders');
  for(const s of summary.sales!)assert.equal(reportGroups.filter(gr=>gr.currency===s.currency&&gr.decimals===s.decimals).reduce((n,gr)=>n+BigInt(gr.totalMinor),0n).toString(),s.totalMinor);
  for(const hour of summary.hours)assert.equal(report.hours.filter(h=>h.hour===hour.hour).reduce((n,h)=>n+h.orders,0),hour.paid,'hour '+hour.hour+' equals the report');
  let cursor:string|undefined;const exported=new Map<string,bigint>();let rows=0;
  do{const page=await f.tenant(f.merchant,db=>reportExport(db,f.merchant,f.actor,'owner',new URL(`http://localhost/api/reports/export?kind=sales&from=${summary.day}&to=${summary.day}${cursor?'&cursor='+cursor:''}`)));
   for(const line of page.csv.trim().split('\r\n').filter(l=>!l.startsWith('order_id'))){const c=line.split(',');const key=c[4]+':'+c[5];exported.set(key,(exported.get(key)??0n)+BigInt(c[6]));rows++;}
   cursor=page.nextCursor??undefined;}while(cursor);
  assert.equal(rows,231);for(const s of summary.sales!)assert.equal(exported.get(s.currency+':'+s.decimals),BigInt(s.totalMinor),'CSV export agrees with the Overview');

  // Role fence: staff keep operational numbers but never receive money totals.
  const staff=await call(f,'staff');assert.equal(staff.sales,null);assert.equal(staff.excludedOrders,null);
  assert.deepEqual(staff.orders,summary.orders);assert.deepEqual(staff.hours,summary.hours);assert.deepEqual(staff.channels,summary.channels);
  assert.deepEqual((await call(f,'manager')).sales,summary.sales,'manager sees sales like the report');
  for(const bad of ['?x=1','?day=2026-01-01','?from=2026-01-01&to=2026-01-02'])await assert.rejects(call(f,'owner',bad),/INVALID_REQUEST/);

  // Tenant fence: the second merchant sees only its own two paid orders, and ours did not change.
  const theirs=await call(g,'owner');
  assert.equal(theirs.orders.today,2);assert.equal(theirs.orders.paid,2);assert.equal(theirs.sales!.length,1);assert.equal(theirs.sales![0].orders,2);assert.deepEqual(theirs.recent.map(r=>r.id).sort(),[...other].sort());
  assert.equal((await call(f,'owner')).orders.paid,231);
  // Cross-tenant read through the wrong tenant context returns nothing of the other merchant.
  const wrong=await f.tenant(f.merchant,db=>overviewSummary(db,g.merchant,'owner',new URL('http://localhost/api/overview/summary')));
  assert.equal(wrong.orders.today,0,'row level security hides another merchant even when asked for it');assert.equal(wrong.recent.length,0);
 }finally{await admin.end();}
});
