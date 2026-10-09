import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture,success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Fixtures are dedicated test-DB records, retained because authority/history is immutable.
test('counter/local race has one screen owner and no invisible reservation; replay survives re-pair and reprice',integration,async()=>{
 const f=await tableFixture();const q=await f.quote();const session=randomUUID();const key=randomUUID();const outcomes=await Promise.allSettled([f.create(q,key),f.command(f.a.id,{type:'CART_OPEN',sessionId:session,expectedScreenGeneration:'1',expectedAssignmentGeneration:'1',recoverSessionId:null})]);
 const state=await f.tenant(f.merchant,async db=>({screen:(await db.query('SELECT * FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0],reserved:(await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0].reserved,orders:(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n}));
 assert.equal(state.screen.kind==='order'||state.screen.kind==='cart',true);assert.equal(state.orders,state.screen.kind==='order'?1:0);assert.equal(state.reserved,state.orders);
 if(state.screen.kind==='cart'){const result=outcomes[1];assert.equal(result.status,'fulfilled');await f.command(f.a.id,{type:'CART_RELEASE',sessionId:session,cartVersion:'0',expectedScreenGeneration:String(state.screen.screen_generation)});}
 const first=await f.create(q,key);await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});await f.tenant(f.merchant,db=>db.query('UPDATE device_presence SET connected_until=NULL WHERE device_id=$1',[f.a.id]));await f.tenant(f.merchant,async db=>{const {publishPrices}=await import('../apps/api/src/catalog');await publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:f.pricing.revision,prices:[{productId:f.product,unitMinor:'999'}]});});
 const replay=await f.create(q,key);assert.equal(replay.order.id,first.order.id);assert.equal(replay.replayed,true);assert.deepEqual(replay.order.authority,first.order.authority);assert.equal(replay.order.pricing.total.amountMinor,'270');await assert.rejects(f.tenant(f.merchant,async db=>{const {createRoutedOrder}=await import('../apps/api/src/orders');return createRoutedOrder(db,f.merchant,'register',f.register.id,{...f.input(q,key),items:[{productId:f.product,qty:2}]});}),/IDEMPOTENCY_CONFLICT/);
 assert.equal(await f.tenant(f.other,async db=>(await db.query('SELECT id FROM orders WHERE id=$1',[first.order.id])).rowCount),0);
});
test('settlement duplicates race submit locks without duplicate stock/payment; ACK is required before dismissal',integration,async()=>{
 const f=await tableFixture(3);const first=await f.create(await f.quote(2));const attempt=await f.tenant(f.merchant,async db=>(await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,signature,status) VALUES($1,$2,$3,'fixture-payer','fixture-recipient',$4,'fixture-mint','fixture-program',$5,'SUBMITTED') RETURNING *",[f.merchant,first.order.id,randomUUID(),first.order.settlement.amountMinor,randomUUID()])).rows[0]);
 // Loading boundary: skipped tests must not load private runtime configuration.
 const {settleAttempt,dismissOrder}=await import('../apps/api/src/orders');
 const submitLocks=f.tenant(f.merchant,async db=>{await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[first.order.id]);await db.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE',[attempt.id]);});
 await Promise.all([submitLocks,f.tenant(f.merchant,db=>settleAttempt(db,attempt,true)),f.tenant(f.merchant,db=>settleAttempt(db,attempt,true))]);
 const state=await f.tenant(f.merchant,async db=>({p:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],payments:(await db.query('SELECT count(*)::int AS n FROM payments WHERE order_id=$1',[first.order.id])).rows[0].n,e:(await db.query("SELECT * FROM outbox_events WHERE order_id=$1 AND type='ORDER' AND payload->'payload'->>'status'='PAID'",[first.order.id])).rows}));assert.deepEqual(state.p,{stock:1,reserved:0});assert.equal(state.payments,1);assert.equal(state.e.length,1);const event=state.e[0];
 await assert.rejects(f.tenant(f.merchant,db=>dismissOrder(db,f.merchant,f.a.id,first.order.id,event.order_version,String(event.screen_generation))),/PAYMENT_PENDING/);
 await f.tenant(f.merchant,db=>db.query('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,1)',[f.merchant,f.a.id,event.id,event.device_seq]));const ack={type:'ACK',eventId:event.id,deviceSeq:String(event.device_seq),orderId:first.order.id,orderVersion:event.order_version,screenGeneration:String(event.screen_generation),rendered:true};assert.equal((await f.command(f.b.id,ack)).result.ok,false);assert.equal((await f.command(f.a.id,ack)).result.ok,true);await f.tenant(f.merchant,db=>dismissOrder(db,f.merchant,f.a.id,first.order.id,event.order_version,String(event.screen_generation)));const sync=success(await f.command(f.a.id,{type:'SESSION_SYNC',sessionId:null,pendingRequestId:null,pendingSubmissionKey:null}));assert.ok('screen' in sync);assert.equal(sync.screen.kind,'idle');
});
test('safe expiry retains ambiguous payment owner; late finalization requires audited recovery acknowledgement',integration,async()=>{const f=await tableFixture();const first=await f.create(await f.quote());const {releaseReservation,dismissOrder,settleAttempt}=await import('../apps/api/src/orders');const attempt=await f.tenant(f.merchant,async db=>{const o=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[first.order.id])).rows[0];await releaseReservation(db,o);await db.query("UPDATE orders SET status='EXPIRED',version=version+1 WHERE id=$1",[o.id]);return (await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,signature,status) VALUES($1,$2,$3,'p','r',$4,'m','t',$5,'SUBMITTED') RETURNING *",[f.merchant,o.id,randomUUID(),o.usdg_minor,randomUUID()])).rows[0];});await assert.rejects(f.tenant(f.merchant,db=>dismissOrder(db,f.merchant,f.a.id,first.order.id,2,'2')),/PAYMENT_PENDING/);await f.tenant(f.merchant,db=>settleAttempt(db,attempt,true));const o=await f.tenant(f.merchant,async db=>(await db.query('SELECT * FROM orders WHERE id=$1',[first.order.id])).rows[0]);assert.equal(o.status,'RECOVERY');await assert.rejects(f.tenant(f.merchant,db=>dismissOrder(db,f.merchant,f.a.id,o.id,o.version,'2')),/RECOVERY_REQUIRED/);assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0].reserved),0);});
test('compact settlement preserves verifier time, exact sequence, bill and durable sound consumption',integration,async()=>{
 // Intentional module loading boundary: a skipped integration test must not load required private runtime configuration.
 const f=await tableFixture(3);const first=await f.create(await f.quote(2));const {settleAttempt,deviceOrderView,orderView,streamEvent}=await import('../apps/api/src/orders');
 const attempt=await f.tenant(f.merchant,async db=>(await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,signature,status) VALUES($1,$2,$3,'p','r',$4,'m','t',$5,'SUBMITTED') RETURNING *",[f.merchant,first.order.id,randomUUID(),first.order.settlement.amountMinor,randomUUID()])).rows[0]);
 const sequence='9007199254740993';await f.tenant(f.merchant,db=>db.query('UPDATE device_event_counters SET device_seq=$2 WHERE device_id=$1',[f.a.id,sequence]));
 const verifiedAt=new Date().toISOString();
 await f.tenant(f.merchant,db=>settleAttempt(db,attempt,true,verifiedAt));
 const state=await f.tenant(f.merchant,async db=>({
 order:(await db.query('SELECT * FROM orders WHERE id=$1',[first.order.id])).rows[0],
 events:(await db.query("SELECT * FROM outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='PAID'",[first.order.id])).rows,
 effect:(await db.query('SELECT * FROM device_sound_effects WHERE order_id=$1',[first.order.id])).rows[0],
 payment:(await db.query('SELECT * FROM payments WHERE attempt_id=$1',[attempt.id])).rows[0]
 }));
 assert.equal(state.events.length,1);const event=state.events[0];assert.equal(event.payload.occurredAt,verifiedAt);assert.equal(event.payload.deviceSeq,'9007199254740994');assert.equal(event.target_device_id,f.a.id);
 assert.equal(event.payload.payload.effectId,state.effect.effect_id);assert.equal(event.payload.payload.sound,true);assert.equal(event.payload.payload.canDismiss,false);assert.deepEqual(event.payload.payload.total,first.order.pricing.total);assert.deepEqual(event.payload.payload.settlement,first.order.settlement);assert.equal(event.payload.payload.items[0],'2 x Coffee');assert.equal(state.payment.state,'SETTLED');assert.equal(state.payment.amount_minor,first.order.settlement.amountMinor);
 await f.tenant(f.merchant,async db=>{
 const full=await orderView(db,state.order);assert.deepEqual(full.pricing,first.order.pricing);assert.deepEqual(full.authority,first.order.authority);
 const silent=await deviceOrderView(db,state.order);assert.equal(silent.sound,false);assert.equal(silent.effectId,null);assert.equal('payer' in silent,false);assert.equal('customerId' in silent,false);
 await db.query('UPDATE device_sound_effects SET consumed_at=clock_timestamp() WHERE effect_id=$1',[state.effect.effect_id]);const consumed=await deviceOrderView(db,state.order,true);assert.equal(consumed.sound,false);assert.equal(consumed.effectId,null);
 });
 await f.tenant(f.merchant,db=>settleAttempt(db,attempt,false));await f.tenant(f.merchant,db=>settleAttempt(db,attempt,true));
 assert.equal(await f.tenant(f.merchant,async db=>(await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='PAID'",[first.order.id])).rows[0].n),1);
 const before=await f.tenant(f.merchant,async db=>(await db.query('SELECT device_seq FROM device_event_counters WHERE device_id=$1',[f.a.id])).rows[0].device_seq);
 await assert.rejects(f.tenant(f.merchant,db=>streamEvent(db,f.merchant,f.a.id,'1','2','ORDER',{oversized:'x'.repeat(7200)},state.order)),/FRAME_TOO_LARGE/);
 assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT device_seq FROM device_event_counters WHERE device_id=$1',[f.a.id])).rows[0].device_seq),before,'invalid event rolls back its sequence allocation and insert');
});
test('late duplicate finalization leaves a newer order reservation and original routing untouched',integration,async()=>{
 // Intentional module loading boundary: skipped integration tests cannot load required private runtime configuration.
 const f=await tableFixture(3);const first=await f.create(await f.quote());const {releaseReservation,settleAttempt}=await import('../apps/api/src/orders');
 const attempt=await f.tenant(f.merchant,async db=>{
 const old=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[first.order.id])).rows[0];await releaseReservation(db,old);await db.query("UPDATE orders SET status='EXPIRED',version=version+1 WHERE id=$1",[old.id]);
 return (await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,signature,status) VALUES($1,$2,$3,'p','r',$4,'m','t',$5,'SUBMITTED') RETURNING *",[f.merchant,old.id,randomUUID(),old.usdg_minor,randomUUID()])).rows[0];
 });
 await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});const next=await f.create(await f.quote());
 await Promise.all([f.tenant(f.merchant,db=>settleAttempt(db,attempt,true)),f.tenant(f.merchant,db=>settleAttempt(db,attempt,true))]);
 const state=await f.tenant(f.merchant,async db=>({
 product:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],
 next:(await db.query('SELECT status,reservation_released FROM orders WHERE id=$1',[next.order.id])).rows[0],
 payments:(await db.query('SELECT state FROM payments WHERE order_id=$1',[first.order.id])).rows,
 events:(await db.query("SELECT target_device_id,payload FROM outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='RECOVERY'",[first.order.id])).rows
 }));
 assert.deepEqual(state.product,{stock:3,reserved:1});assert.deepEqual(state.next,{status:'AWAITING_WALLET',reservation_released:false});assert.deepEqual(state.payments,[{state:'RECOVERY'}]);assert.equal(state.events.length,1);assert.equal(state.events[0].target_device_id,f.a.id);assert.deepEqual(state.events[0].payload.payload.authority,first.order.authority);assert.equal(state.events[0].payload.payload.sound,false);assert.equal(state.events[0].payload.payload.canDismiss,false);
});
test('finalization uses post-lock wall time for expiry, not transaction-start time',integration,async()=>{
 // Intentional loading boundary: skipped integration tests cannot load required private config.
 // A transaction-start expiry check would incorrectly consume stock and mark PAID.
 const f=await tableFixture(3);const {settleAttempt}=await import('../apps/api/src/orders');
 const settled=await f.tenant(f.merchant,async db=>{
 // Use a legacy order to set immutable expiry at INSERT, after BEGIN but before
 // settlement, without bypassing quote guards or waiting for a five-minute quote.
 const o=(await db.query(`WITH customer AS (INSERT INTO customers(merchant_id) VALUES($1) RETURNING id)
 INSERT INTO orders(merchant_id,customer_id,access_token,idempotency_key,request_hash,thb_minor,usdg_minor,treasury,terminal_id,quote_expires_at)
 SELECT $1,id,$2,$3,'expiry-fixture',7000,5400000,'fixture-recipient','rollback-expiry-fixture',clock_timestamp() FROM customer
 RETURNING *,now()<quote_expires_at AS after_transaction_start`,[f.merchant,randomUUID(),randomUUID()])).rows[0];
 assert.equal(o.after_transaction_start,true);
 await db.query('UPDATE products SET reserved=reserved+2 WHERE id=$1',[f.product]);
 await db.query("INSERT INTO order_items(merchant_id,order_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,'กาแฟ','Coffee',2,3500)",[f.merchant,o.id,f.product]);
 const a=(await db.query("INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,signature,status) VALUES($1,$2,$3,'p','fixture-recipient',$4,'m','t',$5,'SUBMITTED') RETURNING *",[f.merchant,o.id,randomUUID(),o.usdg_minor,randomUUID()])).rows[0];
 await settleAttempt(db,a,true);
 return {order:o.id,attempt:a.id};
 });
 const state=await f.tenant(f.merchant,async db=>({
 product:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],
 order:(await db.query('SELECT status,version,reservation_released FROM orders WHERE id=$1',[settled.order])).rows[0],
 attempt:(await db.query('SELECT status FROM payment_attempts WHERE id=$1',[settled.attempt])).rows[0],
 payments:(await db.query('SELECT state FROM payments WHERE order_id=$1',[settled.order])).rows
 }));
 assert.deepEqual(state.product,{stock:3,reserved:0});assert.deepEqual(state.order,{status:'RECOVERY',version:2,reservation_released:true});assert.deepEqual(state.attempt,{status:'FINALIZED'});assert.deepEqual(state.payments,[{state:'RECOVERY'}]);
});
