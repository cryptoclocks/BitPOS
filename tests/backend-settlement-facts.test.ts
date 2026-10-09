import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import type {OrderRow,AttemptRow} from '../apps/api/src/types';
import type {tenant} from '../apps/api/src/db';
import {tableFixture} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const settlementSql='SELECT (r.updated_order).*,r.details AS settlement_details FROM bitpos.settle_verified_attempt($1::uuid,$2::uuid,$3::uuid,$4::boolean) AS r';
type Fixture={merchant:string;a:{id:string};tenant:typeof tenant};
async function submitted(f:Fixture,order:string,amount:string):Promise<AttemptRow>{
 return f.tenant(f.merchant,async db=>(await db.query<AttemptRow>(`INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,signature,status)
 VALUES($1,$2,$3,'settlement-test-payer','settlement-test-recipient',$4,'fixture-mint','fixture-program',$5,'SUBMITTED') RETURNING *`,[f.merchant,order,randomUUID(),amount,randomUUID()])).rows[0]);
}
// Compare every transactional financial/delivery field, not just an absent event.
async function settlementState(db:pg.PoolClient,f:Fixture,order:string,attempt:string){
 return {
  order:(await db.query('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,order])).rows,
  attempt:(await db.query('SELECT * FROM payment_attempts WHERE merchant_id=$1 AND id=$2',[f.merchant,attempt])).rows,
  products:(await db.query('SELECT p.* FROM products p JOIN order_items i ON i.merchant_id=p.merchant_id AND i.product_id=p.id WHERE i.merchant_id=$1 AND i.order_id=$2 ORDER BY p.id',[f.merchant,order])).rows,
  payments:(await db.query('SELECT * FROM payments WHERE merchant_id=$1 AND order_id=$2 ORDER BY id',[f.merchant,order])).rows,
  effects:(await db.query('SELECT * FROM device_sound_effects WHERE merchant_id=$1 AND order_id=$2 ORDER BY effect_id',[f.merchant,order])).rows,
  counter:(await db.query('SELECT * FROM device_event_counters WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id])).rows,
  events:(await db.query('SELECT * FROM outbox_events WHERE merchant_id=$1 AND order_id=$2 ORDER BY device_seq',[f.merchant,order])).rows,
  screen:(await db.query('SELECT * FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id])).rows
 };
}

test('settlement fact projection preserves unsafe bigints, frozen lines and ordinary DTO parity',integration,async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt,deviceOrderView,orderView}=await import('../apps/api/src/orders');
 const {publishPrices}=await import('../apps/api/src/catalog');
 const f=await tableFixture(3);const generation='9007199254740993';const price='9007199254740993';
 await f.tenant(f.merchant,async db=>{
  await db.query('UPDATE devices SET assignment_generation=$2 WHERE merchant_id=$3 AND id=$1',[f.a.id,generation,f.merchant]);
  await db.query('UPDATE registers SET pairing_generation=$2 WHERE merchant_id=$3 AND id=$1',[f.register.id,generation,f.merchant]);
  await db.query('UPDATE device_screen_state SET screen_generation=$2 WHERE merchant_id=$3 AND device_id=$1',[f.a.id,generation,f.merchant]);
  await publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:f.pricing.revision,catalogCurrency:'USDG',prices:[{productId:f.product,unitMinor:price}],settlement:{...f.configuration.settlement,quotePolicy:'USDG_RAW_IDENTITY'}});
 });
 const first=await f.create(await f.quote(2));const a=await submitted(f,first.order.id,first.order.settlement.amountMinor);
 const verifiedAt='2026-10-08T00:00:00.123Z';
 await f.tenant(f.merchant,async db=>{
  await db.query(`INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation,status,rendered_at)
   SELECT merchant_id,target_device_id,id,device_seq,1,'rendered',clock_timestamp() FROM outbox_events
   WHERE merchant_id=$1 AND order_id=$2 AND order_version=1`,[f.merchant,first.order.id]);
  await db.query('SAVEPOINT fact_projection');
  const row=(await db.query(settlementSql,[f.merchant,first.order.id,a.id,true])).rows[0];const d=row.settlement_details;
  assert.ok(row.paid_at instanceof Date);assert.ok(row.created_at instanceof Date);assert.equal(row.usdg_minor,'18014398509481986');
  assert.deepEqual(Object.keys(d).sort(),['merchant_id','order_id','source_kind','source_register_id','source_device_id','source_label_snapshot','target_device_id','target_assignment_generation','creation_pairing_generation','screen_generation','serving_kind','serving_table_id','serving_label_snapshot','quote_id','price_version_id','catalog_currency','catalog_decimals','total_minor','settlement','lines','legacy_items','effect_id','consumed_at','ambiguous','rendered'].sort());
  assert.equal(d.target_assignment_generation,generation);assert.equal(d.creation_pairing_generation,generation);
  assert.equal(d.screen_generation,'9007199254740994');assert.equal(d.total_minor,'18014398509481986');
  assert.deepEqual(d.lines,first.order.pricing.lines);assert.deepEqual(d.settlement,first.order.settlement);
  assert.equal(d.legacy_items,null);assert.equal(d.consumed_at,null);assert.equal(d.ambiguous,0);assert.equal(d.rendered,false);
  const effect=(await db.query('SELECT effect_id FROM device_sound_effects WHERE merchant_id=$1 AND order_id=$2',[f.merchant,row.id])).rows[0];
  assert.equal(d.effect_id,effect.effect_id,'the just-inserted effect is visible in the returned facts');
  const ordinary=await deviceOrderView(db,row,true);assert.equal(ordinary.effectId,d.effect_id);assert.equal(ordinary.sound,true);
  assert.deepEqual(ordinary.authority,first.order.authority);assert.deepEqual(ordinary.total,first.order.pricing.total);
  await db.query('ROLLBACK TO SAVEPOINT fact_projection');
  await settleAttempt(db,a,true,verifiedAt);
  const updated=(await db.query<OrderRow>('SELECT * FROM orders WHERE id=$1',[first.order.id])).rows[0];
  const event=(await db.query('SELECT payload FROM outbox_events WHERE order_id=$1 AND order_version=$2',[updated.id,updated.version])).rows[0].payload;
  assert.deepEqual(event.payload,await deviceOrderView(db,updated,true));assert.equal(event.occurredAt,verifiedAt);
  const full=await orderView(db,updated);assert.deepEqual(full.pricing,first.order.pricing);assert.deepEqual(full.authority,first.order.authority);
 });
});

test('confirming uses fresh JS time; duplicates and distinct recovery preserve sound and stock',integration,async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt}=await import('../apps/api/src/orders');
 const f=await tableFixture(3);const first=await f.create(await f.quote(2));const a=await submitted(f,first.order.id,first.order.settlement.amountMinor);
 const before=Date.now();await f.tenant(f.merchant,db=>settleAttempt(db,a,false,'2000-01-01T00:00:00.000Z'));const after=Date.now();
 let state=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id));
 const confirming=state.events.at(-1)!;
 assert.equal(confirming.payload.payload.status,'CONFIRMING');assert.equal(confirming.payload.payload.sound,false);assert.equal(confirming.payload.payload.effectId,null);
 assert.ok(Date.parse(confirming.payload.occurredAt)>=before&&Date.parse(confirming.payload.occurredAt)<=after);
 assert.equal(state.effects.length,0);assert.equal(state.payments.length,0);assert.equal(state.products[0].stock,3);assert.equal(state.products[0].reserved,2);
 await f.tenant(f.merchant,db=>settleAttempt(db,a,false));assert.deepEqual(await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id)),state);
 const verifiedAt='2026-10-08T00:00:00.456Z';
 await Promise.all([f.tenant(f.merchant,db=>settleAttempt(db,a,true,verifiedAt)),f.tenant(f.merchant,db=>settleAttempt(db,a,true,verifiedAt))]);
 state=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id));
 assert.equal(state.order[0].version,3);assert.equal(state.payments.length,1);assert.equal(state.effects.length,1);
 assert.equal(state.products[0].stock,1);assert.equal(state.products[0].reserved,0);
 assert.equal(state.events.filter(e=>e.payload.payload.status==='PAID').length,1);
 assert.equal(state.events.at(-1)!.payload.occurredAt,verifiedAt);
 await f.tenant(f.merchant,async db=>{await settleAttempt(db,a,false);await settleAttempt(db,a,true);});
 assert.deepEqual(await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id)),state,'lost commit response/reconciliation cannot repeat any durable effect');
 const b=await submitted(f,first.order.id,first.order.settlement.amountMinor);
 await f.tenant(f.merchant,db=>settleAttempt(db,b,true));
 const recovery=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,b.id));
 assert.equal(recovery.order[0].status,'RECOVERY');assert.equal(recovery.order[0].version,4);assert.equal(recovery.attempt[0].status,'FINALIZED');
 assert.deepEqual(recovery.payments.map(p=>p.state).sort(),['RECOVERY','SETTLED']);assert.deepEqual(recovery.products,state.products);
 assert.deepEqual(recovery.effects,state.effects,'distinct verified transfer does not replace the original paid sound');
 const event=recovery.events.at(-1)!;assert.equal(event.payload.payload.status,'RECOVERY');assert.equal(event.payload.payload.sound,false);assert.equal(event.payload.payload.effectId,null);assert.equal(event.payload.payload.canDismiss,false);
 await f.tenant(f.merchant,db=>settleAttempt(db,b,true));assert.deepEqual(await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,b.id)),recovery);
});

test('preexisting exact-version consumed effect keeps its identity and remains silent',integration,async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt,deviceOrderView}=await import('../apps/api/src/orders');
 const f=await tableFixture();const first=await f.create(await f.quote());const a=await submitted(f,first.order.id,first.order.settlement.amountMinor);
 const effectId=randomUUID();const consumedAt='2026-10-08T00:00:00.789Z';
 await f.tenant(f.merchant,db=>db.query('INSERT INTO device_sound_effects(merchant_id,device_id,order_id,paid_version,effect_id,consumed_at) VALUES($1,$2,$3,2,$4,$5)',[f.merchant,f.a.id,first.order.id,effectId,consumedAt]));
 await f.tenant(f.merchant,async db=>{
  await db.query('SAVEPOINT consumed_facts');
  const d=(await db.query(settlementSql,[f.merchant,first.order.id,a.id,true])).rows[0].settlement_details;
  assert.equal(d.effect_id,effectId);assert.equal(new Date(d.consumed_at).toISOString(),consumedAt);
  await db.query('ROLLBACK TO SAVEPOINT consumed_facts');await settleAttempt(db,a,true);
  const row=(await db.query<OrderRow>('SELECT * FROM orders WHERE id=$1',[first.order.id])).rows[0];
  const event=(await db.query('SELECT payload FROM outbox_events WHERE order_id=$1 AND order_version=2',[row.id])).rows[0].payload.payload;
  assert.equal(event.sound,false);assert.equal(event.effectId,null);assert.deepEqual(event,await deviceOrderView(db,row,true));
  const effects=(await db.query('SELECT effect_id,consumed_at FROM device_sound_effects WHERE order_id=$1',[row.id])).rows;
  assert.equal(effects.length,1);assert.equal(effects[0].effect_id,effectId);assert.equal(effects[0].consumed_at.toISOString(),consumedAt);
 });
});

for(const paidBytes of [7100,7101])test(`full settlement validates actual UTF-8 frame at ${paidBytes} bytes with sequence growth`,integration,async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt,createRoutedOrder,counterQuote}=await import('../apps/api/src/orders');
 const f=await tableFixture(3);const initialSequence='999999999999999998';
 // Dedicated SQL test merchant only: pad frozen settlement recipient, not a secret
 // or real chain address. No chain proof, signing, RPC or phone is exercised here.
 const first=await f.tenant(f.merchant,async db=>{
  await db.query('UPDATE device_event_counters SET device_seq=$2 WHERE device_id=$1',[f.a.id,initialSequence]);
  await db.query('SAVEPOINT measure_frame');
  const q=await counterQuote(db,f.merchant,f.register.id,{items:[{productId:f.product,qty:2}],serving:{kind:'counter'}});
  const dry=await createRoutedOrder(db,f.merchant,'register',f.register.id,f.input(q));
  const frame=(await db.query('SELECT payload FROM outbox_events WHERE order_id=$1',[dry.order.id])).rows[0].payload;
  const baseline=Buffer.byteLength(JSON.stringify(frame));
  const paid={...frame,deviceSeq:'1000000000000000000',payload:{...frame.payload,status:'PAID',version:2,sound:true,effectId:randomUUID()}};
  const delta=Buffer.byteLength(JSON.stringify(paid))-baseline;
  await db.query('ROLLBACK TO SAVEPOINT measure_frame');
  const padding=paidBytes-delta-baseline;assert.ok(padding>0);
  const recipient='11111111111111111111111111111111'+'ก'.repeat(Math.floor(padding/3))+'x'.repeat(padding%3);
  await db.query('UPDATE merchants SET treasury=$2 WHERE id=$1',[f.merchant,recipient]);
  const padded=await counterQuote(db,f.merchant,f.register.id,{items:[{productId:f.product,qty:2}],serving:{kind:'counter'}});
  const created=await createRoutedOrder(db,f.merchant,'register',f.register.id,f.input(padded));
  const actual=(await db.query('SELECT payload FROM outbox_events WHERE order_id=$1',[created.order.id])).rows[0].payload;
  assert.equal(Buffer.byteLength(JSON.stringify(actual)),paidBytes-delta);
  assert.ok(JSON.stringify(actual).length<7100,'UTF-8 byte count is not JS character count');return created;
 });
 const a=await submitted(f,first.order.id,first.order.settlement.amountMinor);
 const before=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id));
 if(paidBytes===7101){
  await assert.rejects(f.tenant(f.merchant,db=>settleAttempt(db,a,true)),/FRAME_TOO_LARGE/);
  assert.deepEqual(await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id)),before,'order/paid_at/attempt/payment/stock/reservation/sound/counter/outbox all roll back');
  // An immutable oversized bill remains rejected; lowering a durable sequence
  // to make retry fit would violate the device delivery contract.
  await f.tenant(f.merchant,db=>db.query("UPDATE payment_attempts SET status='REJECTED',error='Completed SQL-only oversize fixture' WHERE merchant_id=$1 AND id=$2",[f.merchant,a.id]));
  return;
 }
 await f.tenant(f.merchant,db=>settleAttempt(db,a,true));
 const after=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id));
 assert.equal(after.order[0].status,'PAID');assert.equal(after.order[0].version,2);assert.equal(after.attempt[0].status,'FINALIZED');assert.ok(after.order[0].paid_at instanceof Date);
 assert.equal(after.payments.length,1);assert.equal(after.effects.length,1);assert.equal(after.products[0].stock,1);assert.equal(after.products[0].reserved,0);assert.equal(after.order[0].reservation_released,true);
 assert.equal(after.events.length,before.events.length+1);const frame=after.events.at(-1)!.payload;
 assert.equal(frame.payload.effectId,after.effects[0].effect_id);assert.equal(frame.payload.sound,true);
 if(paidBytes===7100){assert.equal(Buffer.byteLength(JSON.stringify(frame)),7100);assert.equal(frame.deviceSeq,'1000000000000000000');}
});

for(const failure of ['malformed_facts','publication_unavailable'])test(`settlement ${failure} rolls back the entire transaction and retries cleanly`,integration,async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt}=await import('../apps/api/src/orders');
 const f=await tableFixture(3);const first=await f.create(await f.quote(2));const a=await submitted(f,first.order.id,first.order.settlement.amountMinor);
 const before=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id));
 await assert.rejects(f.tenant(f.merchant,async db=>{
  if(failure==='publication_unavailable'){
   await db.query('DELETE FROM device_event_counters WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id]);
   await settleAttempt(db,a,true);
  }else{
   // Exercise the external SQL decoding boundary after genuine DB settlement
   // writes, rather than mocking financial behavior or asserting query counts.
   const corrupt=new Proxy(db,{get(target,key,receiver){
    if(key!=='query')return Reflect.get(target,key,receiver);
    return async(text:string,values?:unknown[])=>{
     const result=await target.query(text,values);
     if(text.includes('AS settlement_details'))result.rows[0].settlement_details.total_minor=9007199254740992;
     return result;
    };
   }});
   await settleAttempt(corrupt,a,true);
  }
 }),failure==='publication_unavailable'?/DELIVERY_UNAVAILABLE/:/total_minor/);
 assert.deepEqual(await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id)),before);
 await f.tenant(f.merchant,db=>settleAttempt(db,a,true));
 const after=await f.tenant(f.merchant,db=>settlementState(db,f,first.order.id,a.id));
 assert.equal(after.order[0].status,'PAID');assert.equal(after.order[0].version,2);assert.equal(after.attempt[0].status,'FINALIZED');
 assert.equal(after.products[0].stock,1);assert.equal(after.products[0].reserved,0);assert.equal(after.payments.length,1);assert.equal(after.effects.length,1);assert.equal(after.events.length,before.events.length+1);
});

test('finalization waits across expiry and uses fresh post-order-lock wall time',{...integration,timeout:30000},async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt}=await import('../apps/api/src/orders');
 const f=await tableFixture(3);
 const fixture=await f.tenant(f.merchant,async db=>{
  const o=(await db.query(`WITH customer AS (INSERT INTO customers(merchant_id) VALUES($1) RETURNING id)
   INSERT INTO orders(merchant_id,customer_id,access_token,idempotency_key,request_hash,thb_minor,usdg_minor,treasury,terminal_id,quote_expires_at)
   SELECT $1,id,$2,$3,'post-lock-expiry',7000,5400000,'fixture-recipient','settlement-lock-test',clock_timestamp()+interval '5 seconds' FROM customer RETURNING *`,[f.merchant,randomUUID(),randomUUID()])).rows[0];
  await db.query('UPDATE products SET reserved=reserved+2 WHERE id=$1',[f.product]);
  await db.query("INSERT INTO order_items(merchant_id,order_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,'กาแฟ','Coffee',2,3500)",[f.merchant,o.id,f.product]);
  return o;
 });
 const a=await submitted(f,fixture.id,fixture.usdg_minor);
 let locked!:()=>void;const orderLocked=new Promise<void>(resolve=>{locked=resolve;});
 let waiting!:(pid:number)=>void;const waiterStarted=new Promise<number>(resolve=>{waiting=resolve;});
 const holder=f.tenant(f.merchant,async db=>{
  await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[fixture.id]);locked();
  const pid=await waiterStarted;
  let blocked=false;
  for(let n=0;n<100&&!blocked;n++){
   blocked=(await db.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;
   if(!blocked)await db.query('SELECT pg_sleep(0.01)');
  }
  assert.equal(blocked,true,'the routine actually waits on the held order, not just a delayed callback');
  await db.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM quote_expires_at-clock_timestamp()))::double precision+0.03) FROM orders WHERE id=$1",[fixture.id]);
 });
 const waiter=(async()=>{
  await orderLocked;
  await f.tenant(f.merchant,async db=>{
   const start=(await db.query('SELECT pg_backend_pid() AS pid,now()<quote_expires_at AS transaction_before_expiry,clock_timestamp()<quote_expires_at AS still_fresh FROM orders WHERE id=$1',[fixture.id])).rows[0];
   waiting(start.pid);assert.equal(start.transaction_before_expiry,true);assert.equal(start.still_fresh,true);
   await settleAttempt(db,a,true);
  });
 })();
 await Promise.all([holder,waiter]);
 const state=await f.tenant(f.merchant,db=>settlementState(db,f,fixture.id,a.id));
 assert.equal(state.order[0].status,'RECOVERY');assert.equal(state.order[0].version,2);assert.equal(state.order[0].reservation_released,true);
 assert.equal(state.attempt[0].status,'FINALIZED');assert.equal(state.products[0].stock,3);assert.equal(state.products[0].reserved,0);
 assert.equal(state.payments.length,1);assert.equal(state.payments[0].state,'RECOVERY');assert.equal(state.effects.length,0);assert.equal(state.events.length,0);
});

test('legacy settlement does not add v2 validation or publication to historical native values',integration,async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {settleAttempt}=await import('../apps/api/src/orders');const f=await tableFixture(3);
 const o=await f.tenant(f.merchant,async db=>(await db.query(`WITH customer AS (INSERT INTO customers(merchant_id) VALUES($1) RETURNING id)
  INSERT INTO orders(merchant_id,customer_id,access_token,idempotency_key,request_hash,thb_minor,usdg_minor,treasury,terminal_id,quote_expires_at)
  SELECT $1,id,$2,$3,'legacy-native-range',-1,1,'fixture-recipient','legacy-native-fixture','infinity'::timestamptz FROM customer RETURNING *`,[f.merchant,randomUUID(),randomUUID()])).rows[0]);
 const a=await submitted(f,o.id,'1');
 await f.tenant(f.merchant,db=>settleAttempt(db,a,true));
 const state=await f.tenant(f.merchant,db=>settlementState(db,f,o.id,a.id));
 assert.equal(state.order[0].status,'PAID');assert.equal(state.order[0].version,2);assert.equal(state.order[0].thb_minor,'-1');
 assert.equal(state.attempt[0].status,'FINALIZED');assert.equal(state.payments.length,1);assert.equal(state.payments[0].state,'SETTLED');
 assert.equal(state.effects.length,0);assert.equal(state.events.length,0);
 await f.tenant(f.merchant,db=>settleAttempt(db,a,true));
 assert.deepEqual(await f.tenant(f.merchant,db=>settlementState(db,f,o.id,a.id)),state);
});
