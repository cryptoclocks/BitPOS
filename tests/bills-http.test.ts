import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// Bill history, detail and void over the real HTTP server with real roles and the real order-closure routine.
// Needs the backend fixtures: BITPOS_BACKEND_INTEGRATION=1 plus a throwaway Postgres with migrations through 188.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

test('bill history, detail and void of an unpaid counter order: roles, paging, idempotency, reservation released once, paid/pending refused',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const sql=<T>(fn:(db:any)=>Promise<T>)=>f.tenant(f.merchant,fn);
 try{
  // one real unpaid counter order (reserves stock 2) and three paid/pending ones inserted directly, with distinct times for paging
  const open=await f.create(await f.quote(2));const id=open.order.id as string;
  const extra=async(status:string,minutesAgo:number,closure:string|null=null)=>sql(async db=>{
   const customer=(await db.query('SELECT customer_id FROM orders WHERE id=$1',[id])).rows[0].customer_id;
   return (await db.query("INSERT INTO orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at,status,closure_reason,created_at,paid_at) VALUES($1,$2,3500,1000000,'11111111111111111111111111111111','hist-fixture',$3,$4,'h',now()+interval '1 hour',$5,$6,now()-make_interval(mins=>$7),CASE WHEN $5='PAID' THEN now() END) RETURNING id",[f.merchant,customer,randomUUID(),randomUUID(),status,closure,minutesAgo])).rows[0].id as string;
  });
  const paid=await extra('PAID',10),confirming=await extra('CONFIRMING',20),timedOut=await extra('EXPIRED',30,'timeout');

  // reading: any signed-in role, never anonymous, never another shop
  assert.equal((await call(null,'GET','/api/bills')).status,401);
  const all=await call('staff','GET','/api/bills');assert.equal(all.status,200);
  const refs=all.body.bills.map((b:any)=>b.id);for(const x of [id,paid,confirming,timedOut])assert.ok(refs.includes(x),x);
  const mine=all.body.bills.find((b:any)=>b.id===id);assert.deepEqual([mine.kind,mine.state,mine.source,mine.currency,mine.ref],['order','OPEN','store','USD',id.slice(0,8).toUpperCase()]);assert.ok(BigInt(mine.totalMinor)>0n);
  assert.equal((await call('other','GET','/api/bills')).body.bills.length,0);
  // filters, search, strict query, paging without duplicates or gaps
  assert.deepEqual((await call('staff','GET','/api/bills?state=paid')).body.bills.map((b:any)=>b.id),[paid]);
  assert.deepEqual((await call('staff','GET','/api/bills?state=expired')).body.bills.map((b:any)=>b.id),[timedOut]);
  assert.deepEqual((await call('staff','GET','/api/bills?state=open')).body.bills.map((b:any)=>b.id).sort(),[id,confirming].sort());
  assert.deepEqual((await call('staff','GET',`/api/bills?q=${paid.slice(0,8)}`)).body.bills.map((b:any)=>b.id),[paid]);
  assert.equal((await call('staff','GET','/api/bills?q=zzzz')).body.bills.length,0);
  assert.equal((await call('staff','GET','/api/bills?source=online')).body.bills.length,0);
  for(const bad of ['limit=0','limit=500','state=nope','from=2026-13-40','cursor=@@','extra=1','from=2026-11-05&to=2026-11-01','state=paid&state=open'])assert.equal((await call('staff','GET','/api/bills?'+bad)).status,422,bad);
  const seen:string[]=[];let cursor:string|null=null;for(let i=0;i<10;i++){const p:any=await call('staff','GET','/api/bills?limit=2'+(cursor?'&cursor='+cursor:''));assert.ok(p.body.bills.length<=2);seen.push(...p.body.bills.map((b:any)=>b.id));cursor=p.body.nextCursor;if(!cursor)break;}
  assert.equal(new Set(seen).size,seen.length);assert.ok([id,paid,confirming,timedOut].every(x=>seen.includes(x)));
  assert.ok(seen.indexOf(id)<seen.indexOf(paid)&&seen.indexOf(paid)<seen.indexOf(confirming)&&seen.indexOf(confirming)<seen.indexOf(timedOut),'newest first');

  // cash sales share the same history: own currency (THB), receipt number as the reference, search by receipt prefix, void shows as VOIDED
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'H',staffMaxDiscountBps:0})).status,200);
  assert.equal((await call('manager','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'}]})).status,200);
  const sale=await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1}],tenderMinor:'10000'});assert.equal(sale.status,200);const cashId=sale.body.sale.id as string,receipt=sale.body.sale.receiptNo as string;
  const cashRows=(await call('staff','GET','/api/bills?source=cash')).body.bills;assert.deepEqual(cashRows.map((b:any)=>[b.kind,b.id,b.ref,b.state,b.source,b.currency,b.totalMinor]),[['cash',cashId,receipt,'PAID','cash','THB','6500']]);
  assert.deepEqual((await call('staff','GET',`/api/bills?q=${receipt.slice(0,3).toLowerCase()}`)).body.bills.map((b:any)=>b.id),[cashId]);
  assert.ok((await call('staff','GET','/api/bills')).body.bills.some((b:any)=>b.id===cashId&&b.kind==='cash'));
  assert.equal((await call('staff','GET','/api/bills?source=store')).body.bills.some((b:any)=>b.id===cashId),false);
  assert.equal((await call('manager','POST',`/api/cash/sales/${cashId}/void`,{reason:'คิดเงินผิด',restock:true})).body.sale.status,'VOIDED');
  assert.deepEqual((await call('staff','GET','/api/bills?source=cash&state=voided')).body.bills.map((b:any)=>[b.id,b.state,b.voidReason]),[[cashId,'VOIDED','คิดเงินผิด']]);
  assert.equal((await call('staff','GET','/api/bills?source=cash&state=paid')).body.bills.length,0);
  assert.equal((await call('staff','GET','/api/bills?source=cash&state=open')).body.bills.length,0);

  // detail: staff sees it but cannot void; manager can
  const dStaff=await call('staff','GET',`/api/bills/orders/${id}`);assert.deepEqual([dStaff.status,dStaff.body.canVoid,dStaff.body.voidBlocked,dStaff.body.void],[200,false,'ROLE',null]);
  const dMgr=await call('manager','GET',`/api/bills/orders/${id}`);assert.deepEqual([dMgr.body.canVoid,dMgr.body.voidBlocked,dMgr.body.order.id],[true,null,id]);
  assert.equal((await call('manager','GET',`/api/bills/orders/${paid}`)).body.voidBlocked,'PAID');
  assert.equal((await call('other','GET',`/api/bills/orders/${id}`)).status,404);assert.equal((await call('staff','GET','/api/bills/orders/not-a-uuid')).status,404===404?(await call('staff','GET','/api/bills/orders/not-a-uuid')).status:0);

  // void: role, strict body, reason length, foreign shop
  const v=(who:keyof typeof tok|null,order:string,body:unknown)=>call(who,'POST',`/api/bills/orders/${order}/void`,body);
  assert.equal((await v('staff',id,{reason:'ลูกค้ายกเลิก'})).status,403);
  assert.equal((await v('manager',id,{})).status,422);assert.equal((await v('manager',id,{reason:'ab'})).status,422);assert.equal((await v('manager',id,{reason:'x'.repeat(121)})).status,422);assert.equal((await v('manager',id,{reason:'ลูกค้ายกเลิก',extra:1})).status,422);
  assert.equal((await v('other',id,{reason:'ลูกค้ายกเลิก'})).status,404);
  assert.equal((await sql(async db=>(await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0])).reserved,2,'nothing changed by refused calls');
  // paid and in-flight orders are refused and untouched
  const refusedPaid=await v('owner',paid,{reason:'ลองยกเลิก'});assert.deepEqual([refusedPaid.status,refusedPaid.body.error?.code],[409,'ORDER_PAID_CANNOT_VOID']);
  const refusedPending=await v('owner',confirming,{reason:'ลองยกเลิก'});assert.deepEqual([refusedPending.status,refusedPending.body.error?.code],[409,'PAYMENT_PENDING']);
  assert.equal((await v('owner',timedOut,{reason:'ลองยกเลิก'})).status,409);
  assert.deepEqual(await sql(async db=>(await db.query("SELECT id,status FROM orders WHERE id=ANY($1::uuid[]) ORDER BY id",[[paid,confirming]])).rows.map((r:any)=>r.status).sort()),['CONFIRMING','PAID']);

  // the void itself, raced: exactly one real void, the others replay; stock released once; device screen back to idle
  const race=await Promise.all([1,2,3].map(i=>v(i%2?'manager':'owner',id,{reason:'ลูกค้ายกเลิก '+i})));
  assert.deepEqual(race.map(r=>r.status),[200,200,200]);const real=race.filter(r=>r.body.replayed===false);assert.equal(real.length,1);assert.equal(race.filter(r=>r.body.replayed===true).length,2);
  assert.ok(race.every(r=>r.body.reason===real[0]!.body.reason&&r.body.status==='VOIDED'));
  const after=await sql(async db=>({o:(await db.query('SELECT status,closure_reason,reservation_released FROM orders WHERE id=$1',[id])).rows[0],p:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],voids:(await db.query('SELECT count(*)::int AS n FROM order_voids WHERE order_id=$1',[id])).rows[0].n,audit:(await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE subject=$1 AND action IN('bill.void','order.void_unpaid')",[id])).rows[0].n,s:(await db.query('SELECT kind FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0]}));
  assert.deepEqual([after.o.status,after.o.closure_reason,after.o.reservation_released,after.p.stock,after.p.reserved,after.voids,after.audit,after.s.kind],['EXPIRED','canceled',true,100,0,1,2,'idle']);
  // history now shows it voided with the reason; detail carries the record, the timeline and cannot be voided again
  const listed=(await call('staff','GET','/api/bills?state=voided&source=store')).body.bills;assert.deepEqual(listed.map((b:any)=>[b.id,b.state,b.voidReason]),[[id,'VOIDED',real[0]!.body.reason]]);
  const dAfter=(await call('manager','GET',`/api/bills/orders/${id}`)).body;assert.deepEqual([dAfter.void.reason,dAfter.canVoid,dAfter.voidBlocked],[real[0]!.body.reason,false,'NOT_OPEN']);assert.ok(dAfter.timeline.some((t:any)=>t.action==='bill.void')&&dAfter.timeline.some((t:any)=>t.action==='order.void_unpaid'));
  // a later replay with a different reason changes nothing
  const again=await v('manager',id,{reason:'เหตุผลอื่น'});assert.deepEqual([again.status,again.body.replayed,again.body.reason],[200,true,real[0]!.body.reason]);
  // the void record cannot be edited or removed by the application role
  // (the test pool is a superuser, so assume the application role explicitly)
  await assert.rejects(()=>sql(async db=>{await db.query('SET LOCAL ROLE bitpos_app');await db.query("UPDATE order_voids SET reason='แก้ไข' WHERE order_id=$1",[id]);}),/permission denied/);
  await assert.rejects(()=>sql(async db=>{await db.query('SET LOCAL ROLE bitpos_app');await db.query('DELETE FROM order_voids WHERE order_id=$1',[id]);}),/permission denied/);
 }finally{
  server.close();
  // The cash sale is append-only history; remove this test's rows (superuser, triggers off) so shared scratch databases stay clean for the next file.
  const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
  try{await admin.query('BEGIN');await admin.query('SET LOCAL session_replication_role=replica');
   for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]).catch(()=>undefined);
   await admin.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]).catch(()=>undefined);
   await admin.query('COMMIT');}catch{await admin.query('ROLLBACK').catch(()=>undefined);}finally{await admin.end();}
 }
});
