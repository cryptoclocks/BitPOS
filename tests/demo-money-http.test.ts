import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// Demo money buttons: pay an unpaid order / simulate a refund, only in a demo-catalog shop, owner/manager, through the real settlement routine.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

test('demo pay settles through the real routine and demo refund is only a simulated record; both refuse outside a demo shop',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const mk=async(qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]);});return (await f.create(await f.quote(qty))).order.id as string;};
 const row=async<T=any>(sql:string,args:unknown[])=>(await f.tenant(f.merchant,db=>db.query(sql,args))).rows as T[];
 try{
  const A=await mk(2);
  // detail says what may be done
  const d0=(await call('owner','GET',`/api/bills/orders/${A}`)).body.demo;assert.deepEqual([d0.available,d0.canPay,d0.canRefund,d0.paidByDemo,d0.refund],[true,true,false,false,null]);
  assert.deepEqual((await call('staff','GET',`/api/bills/orders/${A}`)).body.demo.available,false);
  // access
  assert.equal((await call(null,'POST',`/api/bills/orders/${A}/demo-pay`)).status,401);
  assert.equal((await call('staff','POST',`/api/bills/orders/${A}/demo-pay`)).status,403);
  assert.equal((await call('other','POST',`/api/bills/orders/${A}/demo-pay`)).status,403,'another shop is not a demo shop');
  assert.equal((await call('owner','POST','/api/bills/orders/not-a-uuid/demo-pay')).status,422);
  assert.equal((await call('owner','POST',`/api/bills/orders/${randomUUID()}/demo-pay`)).status,404);
  // an unpaid order cannot be refunded; nothing was paid yet
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/demo-refund`,{reason:'ทดสอบเดโม'})).status,409);

  // pay: real settlement routine, stock sold once, reservation released, a payment row that cannot be mistaken for a transaction
  const paid=await call('manager','POST',`/api/bills/orders/${A}/demo-pay`);assert.equal(paid.status,200);assert.deepEqual([paid.body.status,paid.body.demo,paid.body.replayed],['PAID',true,false]);
  assert.equal((await row('SELECT status FROM orders WHERE id=$1',[A]))[0].status,'PAID');
  assert.deepEqual((await row('SELECT stock,reserved FROM products WHERE id=$1',[f.product]))[0],{stock:98,reserved:0});
  const pay=await row('SELECT signature,state FROM payments WHERE order_id=$1',[A]);assert.equal(pay.length,1);assert.ok(pay[0].signature.startsWith('demo:'));
  // the sale is in the stock ledger exactly once, reconciling products.stock (100 -> 98)
  const led=await row('SELECT kind,delta,stock_before,stock_after,reference FROM stock_movements WHERE kind=$1 AND product_id=$2',['ORDER_SALE',f.product]);
  assert.deepEqual(led.map(r=>[r.kind,r.delta,r.stock_before,r.stock_after,r.reference]),[['ORDER_SALE',-2,100,98,'order:'+A]]);
  const viaApi=(await call('owner','GET','/api/inventory/movements?kind=ORDER_SALE')).body;assert.equal(viaApi.movements.filter((m:any)=>m.reference==='order:'+A).length,1);
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/demo-pay`)).body.replayed,true);
  assert.deepEqual((await row('SELECT stock FROM products WHERE id=$1',[f.product]))[0],{stock:98},'a second tap sells nothing more');
  assert.equal((await row('SELECT count(*)::int n FROM stock_movements WHERE kind=$1 AND product_id=$2',['ORDER_SALE',f.product]))[0].n,1);
  const d1=(await call('owner','GET',`/api/bills/orders/${A}`)).body;assert.deepEqual([d1.order.status,d1.demo.paidByDemo,d1.demo.canPay,d1.demo.canRefund],['PAID',true,false,true]);
  // it is a normal paid sale for reports
  const day=today();const bd=(await call('owner','GET',`/api/reports/breakdown?from=${day}&to=${day}`)).body;assert.equal(bd.totals.find((t:any)=>t.currency==='USD').totalMinor,'540');
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/void`,{reason:'ลองยกเลิก'})).status,409,'a paid order is still never voided');

  // refund: reason, role, simulated record, replay, immutable, reports untouched
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/demo-refund`,{})).status,422);
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/demo-refund`,{reason:'ok',x:1})).status,422);
  assert.equal((await call('staff','POST',`/api/bills/orders/${A}/demo-refund`,{reason:'ทดสอบเดโม'})).status,403);
  const rf=await call('manager','POST',`/api/bills/orders/${A}/demo-refund`,{reason:'ลูกค้าไม่พอใจ (เดโม)'});assert.equal(rf.status,200);
  assert.deepEqual([rf.body.simulated,rf.body.amount,rf.body.replayed],[true,{currency:'USD',decimals:2,amountMinor:'540'},false]);
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/demo-refund`,{reason:'อีกครั้ง'})).body.replayed,true);
  assert.equal((await row('SELECT count(*)::int n FROM demo_refunds WHERE order_id=$1',[A]))[0].n,1);
  const d2=(await call('owner','GET',`/api/bills/orders/${A}`)).body.demo;assert.deepEqual([d2.canRefund,d2.refund.reason],[false,'ลูกค้าไม่พอใจ (เดโม)']);
  await assert.rejects(f.tenant(f.merchant,db=>db.query('UPDATE demo_refunds SET amount_minor=1 WHERE order_id=$1',[A])),/immutable|permission denied/);
  assert.equal((await call('owner','GET',`/api/reports/breakdown?from=${day}&to=${day}`)).body.totals.find((t:any)=>t.currency==='USD').totalMinor,'540','a simulated refund never changes real figures');
  const actions=(await call('owner','GET','/api/activity')).body.entries.map((e:any)=>e.action);
  assert.ok(actions.includes('order.demo_pay')&&actions.includes('order.demo_refund'));

  // a really-paid order cannot be paid again nor "refunded" by the simulation
  const B=await mk(1);await raw(async db=>{await db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp() WHERE id=$1",[B]);});
  assert.equal((await call('owner','POST',`/api/bills/orders/${B}/demo-pay`)).status,409);
  assert.equal((await call('owner','POST',`/api/bills/orders/${B}/demo-refund`,{reason:'ทดสอบเดโม'})).status,403);

  // outside a demo catalog every demo button is refused
  const C=await mk(1);
  const view=(await call('owner','GET','/api/settings/pricing')).body;
  assert.equal((await call('owner','PUT','/api/settings/pricing',{...f.configuration,provenance:{kind:'owner_configured'},expectedRevision:view.revision})).status,200);
  assert.equal((await call('owner','GET',`/api/bills/orders/${C}`)).body.demo.available,false);
  assert.equal((await call('owner','POST',`/api/bills/orders/${C}/demo-pay`)).status,403);
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/demo-refund`,{reason:'ทดสอบเดโม'})).status,403);
  assert.equal((await row('SELECT status FROM orders WHERE id=$1',[C]))[0].status,'AWAITING_WALLET','the refused order stays unpaid');
 }finally{await new Promise(r=>server.close(r));await admin.end();}
});

test('PromptPay demo payment and simulated cash refund: labelled, demo shops only, nothing real moves',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff')};
 const call=async(who:keyof typeof tok,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${tok[who]}`},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const mk=async(qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]);});return (await f.create(await f.quote(qty))).order.id as string;};
 try{
  // PromptPay (simulated): same real settlement routine, a signature that says which demo method, no QR/bank involved
  const P=await mk(1);
  assert.equal((await call('owner','POST',`/api/bills/orders/${P}/demo-pay`,{method:'CASH'})).status,422);
  assert.equal((await call('owner','POST',`/api/bills/orders/${P}/demo-pay`,{method:'PROMPTPAY',x:1})).status,422);
  const paid=await call('manager','POST',`/api/bills/orders/${P}/demo-pay`,{method:'PROMPTPAY'});assert.deepEqual([paid.status,paid.body.method,paid.body.replayed],[200,'PROMPTPAY',false]);
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT signature FROM payments WHERE order_id=$1',[P]))).rows[0].signature.startsWith('demo:promptpay:'),true);
  const again=await call('owner','POST',`/api/bills/orders/${P}/demo-pay`,{method:'DEMO'});assert.deepEqual([again.body.replayed,again.body.method],[true,'PROMPTPAY'],'the first method stays');
  assert.equal((await call('owner','GET',`/api/bills/orders/${P}`)).body.demo.paymentMethod,'PROMPTPAY');
  assert.equal((await call('owner','POST',`/api/bills/orders/${P}/demo-refund`,{reason:'ลูกค้าขอคืน PromptPay (เดโม)'})).body.simulated,true);

  // simulated cash refund
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'D',staffMaxDiscountBps:0})).status,200);
  assert.equal((await call('owner','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'}]})).status,200);
  const sale=async()=>(await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1}],discount:null,tenderMinor:'10000'})).body.sale.id as string;
  const S1=await sale(),S2=await sale();
  const d0=(await call('manager','GET',`/api/cash/sales/${S1}`)).body.demo;assert.deepEqual([d0.available,d0.canRefund,d0.refund],[true,true,null]);
  assert.equal((await call('staff','GET',`/api/cash/sales/${S1}`)).body.demo.available,false);
  assert.equal((await call('staff','POST',`/api/cash/sales/${S1}/demo-refund`,{reason:'ลูกค้าขอคืนเงินสด'})).status,403);
  assert.equal((await call('manager','POST',`/api/cash/sales/${S1}/demo-refund`,{})).status,422);
  const drawerBefore=(await call('staff','GET','/api/cash/drawer')).body;
  const rf=await call('manager','POST',`/api/cash/sales/${S1}/demo-refund`,{reason:'ลูกค้าขอคืนเงินสด (เดโม)'});assert.deepEqual([rf.status,rf.body.simulated,rf.body.amount,rf.body.replayed],[200,true,{currency:'THB',decimals:2,amountMinor:'6500'},false]);
  assert.equal((await call('owner','POST',`/api/cash/sales/${S1}/demo-refund`,{reason:'อีกครั้ง'})).body.replayed,true);
  assert.equal(JSON.stringify((await call('staff','GET','/api/cash/drawer')).body),JSON.stringify(drawerBefore),'the simulated refund never touches the drawer');
  assert.deepEqual((await call('owner','GET',`/api/cash/sales/${S1}`)).body.demo.canRefund,false);
  assert.equal((await call('manager','POST',`/api/cash/sales/${S2}/void`,{reason:'คิดเงินผิด',restock:true})).body.sale.status,'VOIDED');
  assert.equal((await call('manager','POST',`/api/cash/sales/${S2}/demo-refund`,{reason:'ลองคืนบิลที่ยกเลิก'})).status,409,'a voided sale cannot be refunded');
  // outside a demo catalog: refused
  const view=(await call('owner','GET','/api/settings/pricing')).body;
  assert.equal((await call('owner','PUT','/api/settings/pricing',{...f.configuration,provenance:{kind:'owner_configured'},expectedRevision:view.revision})).status,200);
  const S3=await sale();assert.equal((await call('owner','POST',`/api/cash/sales/${S3}/demo-refund`,{reason:'ลองนอกโหมดเดโม'})).status,403);
 }finally{
  await new Promise(r=>server.close(r));
  const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');for(const t of ['demo_cash_refunds','cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings','cash_drawer_openings'])await c.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]);await c.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]);await c.query('COMMIT');}catch{await c.query('ROLLBACK');}finally{c.release();}
  await admin.end();
 }
});
