import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';
// Include remote fixture construction; actual conflicting statements stay bounded at 2s below.
test('worker skips an HTTP-owned order without locking its attempt or stalling submit',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000},async()=>{
 // Intentional loading boundary: skipped tests must not load runtime RPC/database config.
 const f=await tableFixture();const {lockReconciliationAttempt}=await import('../apps/worker/src/index');const first=await f.create(await f.quote());const attempt=await f.tenant(f.merchant,async db=>(await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status) VALUES($1,$2,$3,'fixture-payer','fixture-recipient',$4,'fixture-mint','fixture-program','READY') RETURNING *",[f.merchant,first.order.id,randomUUID(),first.order.settlement.amountMinor])).rows[0]);
 const http=await f.pool.connect(),worker=await f.pool.connect();try{
 for(const db of [http,worker]){await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);await db.query("SET LOCAL statement_timeout='2s'");}
 await http.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[first.order.id]);assert.equal(await lockReconciliationAttempt(worker,first.order.id,attempt.id),null,'worker must not take attempt then wait for HTTP order');
 assert.equal((await http.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE NOWAIT',[attempt.id])).rowCount,1,'HTTP can complete its order→attempt path while worker yields');await worker.query('ROLLBACK');await http.query('COMMIT');
 await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE payment_attempts SET amount_minor=amount_minor+1 WHERE id=$1",[attempt.id])),/immutable payment attempt proof/);
 const locked=await f.tenant(f.merchant,db=>lockReconciliationAttempt(db,first.order.id,attempt.id));assert.equal(locked?.id,attempt.id,'persisted work remains available after the HTTP transaction commits');
 }finally{await http.query('ROLLBACK');await worker.query('ROLLBACK');http.release();worker.release();}
});
test('crash-retained unsigned BUILDING expires without broadcasting and releases its old reservation',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'},async()=>{
 const f=await tableFixture();const {reconcileMerchant}=await import('../apps/worker/src/index');const old=await f.tenant(f.merchant,async db=>{
 const customer=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0];
 const order=(await db.query("INSERT INTO orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at) VALUES($1,$2,3500,1000000,'11111111111111111111111111111111','fixture-legacy',$3,$4,'fixture',clock_timestamp()-interval '1 second') RETURNING *",[f.merchant,customer.id,randomUUID(),randomUUID()])).rows[0];
 await db.query("INSERT INTO order_items(merchant_id,order_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,'กาแฟ','Coffee',1,3500)",[f.merchant,order.id,f.product]);await db.query('UPDATE products SET reserved=1 WHERE id=$1',[f.product]);
 const attempt=(await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status) VALUES($1,$2,$3,'fixture-payer','fixture-recipient',1000000,'fixture-mint','fixture-program','BUILDING') RETURNING id",[f.merchant,order.id,randomUUID()])).rows[0];return {order:order.id,attempt:attempt.id};
 });await reconcileMerchant(f.merchant);await reconcileMerchant(f.merchant);
 const state=await f.tenant(f.merchant,async db=>({order:(await db.query('SELECT status,reservation_released FROM orders WHERE id=$1',[old.order])).rows[0],attempt:(await db.query('SELECT status,signature FROM payment_attempts WHERE id=$1',[old.attempt])).rows[0],product:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0]}));
 assert.deepEqual(state.order,{status:'EXPIRED',reservation_released:true});assert.deepEqual(state.attempt,{status:'EXPIRED',signature:null});assert.deepEqual(state.product,{stock:100,reserved:0});
});
