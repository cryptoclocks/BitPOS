import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {tableFixture,success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
test('device Cancel releases exact unpaid order once, never a new bill or foreign target',integration,async()=>{
 const f=await tableFixture();const created=await f.create(await f.quote(2));const id=created.order.id;
 const read=()=>f.tenant(f.merchant,async db=>(await db.query('SELECT screen_generation::text FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0]);const screen=await read();
 const body={type:'ORDER_CANCEL',orderId:id,orderVersion:created.order.version,screenGeneration:screen.screen_generation};
 const wrong=await f.command(f.b.id,body);assert.equal(wrong.result.ok,false);
 success(await f.command(f.a.id,body));
 const state=await f.tenant(f.merchant,async db=>({o:(await db.query('SELECT status,closure_reason,reservation_released FROM orders WHERE id=$1',[id])).rows[0],p:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],s:(await db.query('SELECT kind FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0]}));
 assert.equal(state.o.closure_reason,'canceled');assert.equal(state.o.status,'EXPIRED');assert.equal(state.o.reservation_released,true);assert.equal(state.p.stock,100);assert.equal(state.p.reserved,0);assert.equal(state.s.kind,'idle');
 const newer=await f.create(await f.quote());success(await f.command(f.a.id,body));assert.equal((await f.tenant(f.merchant,async db=>(await db.query('SELECT order_id FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0])).order_id,newer.order.id);
});
test('timeout leaves unexpired and CONFIRMING orders owned; Cancel refuses confirming',integration,async()=>{
 const f=await tableFixture();const {expireUnpaidOrders}=await import('../apps/api/src/order-closure');const o=await f.create(await f.quote());
 await f.tenant(f.merchant,db=>expireUnpaidOrders(db,f.merchant));
 assert.equal((await f.tenant(f.merchant,async db=>(await db.query('SELECT order_id FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0])).order_id,o.order.id);
 await f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='CONFIRMING',version=version+1 WHERE id=$1",[o.order.id]));
 const row=await f.tenant(f.merchant,async db=>(await db.query('SELECT screen_generation::text FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0]);
 const refusal=await f.command(f.a.id,{type:'ORDER_CANCEL',orderId:o.order.id,orderVersion:o.order.version+1,screenGeneration:row.screen_generation});assert.equal(refusal.result.ok,false);
 await f.tenant(f.merchant,db=>expireUnpaidOrders(db,f.merchant));
 assert.equal((await f.tenant(f.merchant,async db=>(await db.query('SELECT status,closure_reason FROM orders WHERE id=$1',[o.order.id])).rows[0])).status,'CONFIRMING');
});
test('an inconsistent old reservation cannot roll back safe expiry of another bill',integration,async()=>{
 const f=await tableFixture();const {expireUnpaidOrders}=await import('../apps/api/src/order-closure');
 await f.tenant(f.merchant,async db=>{
  const customer=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0].id;
  const ids:string[]=[];
  for(const qty of [2,1]){
   const order=(await db.query("INSERT INTO orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at) VALUES($1,$2,3500,1000000,'11111111111111111111111111111111','expiry-isolation-fixture',gen_random_uuid()::text,gen_random_uuid()::text,'fixture',clock_timestamp()-interval '1 minute') RETURNING id",[f.merchant,customer])).rows[0];ids.push(order.id);
   await db.query("INSERT INTO order_items(merchant_id,order_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,'Coffee','Coffee',$4,3500)",[f.merchant,order.id,f.product,qty]);
  }
  // Deliberately inconsistent history is contained entirely in this transaction.
  await db.query('UPDATE products SET reserved=1 WHERE id=$1',[f.product]);
  await expireUnpaidOrders(db,f.merchant);
  const rows=(await db.query('SELECT id,status,closure_reason,reservation_released FROM orders WHERE id=ANY($1::uuid[])',[ids])).rows;
  assert.equal(rows.find(row=>row.id===ids[0]).reservation_released,false);
  assert.equal(rows.find(row=>row.id===ids[1]).closure_reason,'timeout');
  assert.equal((await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0].reserved,0);
  await db.query('UPDATE products SET reserved=2 WHERE id=$1',[f.product]);await expireUnpaidOrders(db,f.merchant);
  assert.equal((await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0].reserved,0);
 });
});
