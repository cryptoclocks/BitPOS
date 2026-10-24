import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {tableFixture,success} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {publicPickupFixture} from './backend-pickup-fixture';

// Opt-in SQL/API regression fixtures only. No RPC verifier, signed transaction
// submission, physical display, acoustic, or wallet approval proof is performed.
// Run serially on a fixture DB migrated through 039, with no competing worker.
// Every history belongs to tableFixture's new random merchant; retain it rather
// than deleting immutable bills or another suite's fixture/history.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000};
type Fixture=Omit<Awaited<ReturnType<typeof tableFixture>>,'create'|'quote'>;
const quoteSchema=z.object({quote:z.object({id:z.string().uuid(),priceVersion:z.string().uuid()}).passthrough()}).passthrough();
const publicOrderSchema=z.object({order:z.object({id:z.string().uuid(),status:z.string(),version:z.number().int()}).passthrough(),replayed:z.boolean().optional()}).passthrough();
const clearSchema=z.object({cleared:z.literal(true),generation:z.string(),effects:z.array(z.object({deviceId:z.string(),eventId:z.string(),screenGeneration:z.string()})),preserved:z.object({bills:z.literal(true),payments:z.literal(true),walletPermissions:z.literal(true)})});
type Event={id:string;device_seq:string;screen_generation:string;order_id:string|null;order_version:number|null;target_device_id:string;payload:Record<string,unknown>};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

function clearInput(generation='1',key=randomUUID()){
 return {expectedGeneration:generation,idempotencyKey:key,confirmClear:true as const};
}
async function clear(f:Fixture,input=clearInput()){
 return clearSchema.parse(await f.reg('/api/tables/'+f.table.id+'/clear','POST',input));
}
async function guestFixture(){
 const f=await tableFixture();
 // Backend/config imports remain behind the integration opt-in boundary.
 const {tableRequest}=await import('../apps/api/src/table-ordering');
 const entry=await f.tenant(f.merchant,async db=>(await db.query('SELECT e.entry_token FROM table_entries e JOIN devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation WHERE d.id=$1',[f.b.id])).rows[0]);
 assert.ok(entry);
 const base='/api/table/'+entry.entry_token;
 const visit=z.object({visitToken:z.string()}).passthrough().parse(await tableRequest(base+'/visit','POST',{requestId:randomUUID()}));
 const path=base+'/visit/'+visit.visitToken;
 const quote=quoteSchema.parse(await tableRequest(path+'/quotes','POST',{items:[{productId:f.product,qty:1}]})).quote;
 const submit={quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()};
 const create=async()=>publicOrderSchema.parse(await tableRequest(path+'/orders','POST',submit)).order;
 return {...f,base,path,publicQuote:quote,submit,create,request:tableRequest};
}
async function orderEvent(f:Fixture,order:string,version?:number):Promise<Event>{
 const event=await f.tenant(f.merchant,async db=>(await db.query('SELECT * FROM outbox_events WHERE merchant_id=$1 AND order_id=$2 AND ($3::integer IS NULL OR order_version=$3) ORDER BY device_seq DESC LIMIT 1',[f.merchant,order,version??null])).rows[0]);
 assert.ok(event,'the real order publisher must emit a receipt event');
 return event;
}
function ack(event:Event){
 return {type:'ACK',eventId:event.id,deviceSeq:String(event.device_seq),orderId:event.order_id,orderVersion:event.order_version,screenGeneration:String(event.screen_generation),rendered:true};
}
async function deliver(f:Fixture,event:Event){
 const actor=f.devices.get(event.target_device_id);assert.ok(actor);
 // Synthetic stream delivery, not fabricated render: only the authenticated ACK
 // command below may record device_event_deliveries.status='rendered'.
 await f.tenant(f.merchant,db=>db.query('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[f.merchant,event.target_device_id,event.id,event.device_seq,actor.connectionGeneration]));
}
async function render(f:Fixture,event:Event){
 await deliver(f,event);success(await f.command(event.target_device_id,ack(event)));
 const receipt=await f.tenant(f.merchant,async db=>(await db.query('SELECT status,rendered_at FROM device_event_deliveries WHERE merchant_id=$1 AND device_id=$2 AND event_id=$3',[f.merchant,event.target_device_id,event.id])).rows[0]);
 assert.equal(receipt.status,'rendered');assert.ok(receipt.rendered_at);
}
async function syntheticAttempt(f:Fixture,order:string,status='FAILED',reconciled=true,signedBytesOnly=false){
 // The established SQL-only verifier seam freezes the real selected quote/asset.
 // The deliberately invalid fixture signature/message never enter a live worker.
 const attempt=await f.tenant(f.merchant,async db=>{
  const inserted=(await fixturePaymentAttempt(db,{merchant:f.merchant,order,status,signature:signedBytesOnly?null:'SQL-only-table-guard-'+randomUUID(),failureReconciled:reconciled})).rows[0];
  assert.ok(inserted);
  // Proof may be added once, never cleared/replaced (008 attempt_proof).
  return signedBytesOnly?(await db.query<typeof inserted>("UPDATE payment_attempts SET signed_base64='SQL-only-fixture-proof',transaction_base64='SQL-only-fixture-message' WHERE merchant_id=$1 AND id=$2 RETURNING *",[f.merchant,inserted.id])).rows[0]:inserted;
 });
 assert.ok(attempt);return attempt;
}
async function syntheticFinalize(f:Fixture,order:string){
 const {settleAttempt}=await import('../apps/api/src/orders');
 const attempt=await syntheticAttempt(f,order);
 // Invoke the actual atomic settlement writer after an explicitly synthetic
 // verifier seam; this is not evidence that any chain transfer was verified.
 await f.tenant(f.merchant,db=>settleAttempt(db,attempt,true));
 return {attempt,event:await orderEvent(f,order)};
}
async function financial(f:Fixture){
 return f.tenant(f.merchant,async db=>(await db.query(`SELECT
 (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]'::jsonb) FROM orders o WHERE merchant_id=$1) AS bills,
 (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY order_id),'[]'::jsonb) FROM order_authority a WHERE merchant_id=$1) AS authority,
 (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]'::jsonb) FROM order_quotes q WHERE merchant_id=$1) AS quotes,
 (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY order_id,product_id),'[]'::jsonb) FROM order_items i WHERE merchant_id=$1) AS items,
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM payments p WHERE merchant_id=$1) AS payments,
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM payment_attempts p WHERE merchant_id=$1) AS attempts,
 (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY attempt_id),'[]'::jsonb) FROM payment_attempt_assets a WHERE merchant_id=$1) AS attempt_assets,
 (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]'::jsonb) FROM payment_quotes q WHERE merchant_id=$1) AS payment_quotes,
 (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY order_id),'[]'::jsonb) FROM order_payment_selection s WHERE merchant_id=$1) AS payment_selection,
 (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY order_id),'[]'::jsonb) FROM order_submissions s WHERE merchant_id=$1) AS submissions,
 (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM customers c WHERE merchant_id=$1) AS customers,
 (SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY chain,address),'[]'::jsonb) FROM customer_wallets w WHERE merchant_id=$1) AS wallets,
 (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM customer_auth_sessions s WHERE merchant_id=$1) AS consent_sessions,
 (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY id),'[]'::jsonb) FROM delegated_grants g WHERE merchant_id=$1) AS wallet_permissions,
 (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM delegated_owner_sessions s WHERE merchant_id=$1) AS owner_sessions,
 (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]'::jsonb) FROM delegated_holds h WHERE merchant_id=$1) AS wallet_holds,
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM products p WHERE merchant_id=$1) AS products`,[f.merchant])).rows[0]);
}
async function operational(f:Fixture){
 return f.tenant(f.merchant,async db=>(await db.query(`SELECT
 (SELECT occupancy_generation::text FROM merchant_tables WHERE merchant_id=$1 AND id=$2) AS generation,
 (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]'::jsonb) FROM table_occupancies o WHERE merchant_id=$1) AS occupancies,
 (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY device_id),'[]'::jsonb) FROM device_screen_state s WHERE merchant_id=$1) AS screens,
 (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM devices d WHERE merchant_id=$1) AS devices,
 (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM device_sessions s WHERE merchant_id=$1) AS sessions,
 (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY target_device_id,device_seq),'[]'::jsonb) FROM outbox_events e WHERE merchant_id=$1) AS events,
 (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY table_id,idempotency_key),'[]'::jsonb) FROM table_clear_requests r WHERE merchant_id=$1) AS requests,
 (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY table_id,generation,device_id),'[]'::jsonb) FROM table_clear_effects e WHERE merchant_id=$1) AS effects`,[f.merchant,f.table.id])).rows[0]);
}
async function seedWalletPermission(f:Fixture){
 // Nonempty, paused SQL-only permission detects accidental clear revocation or
 // budget reset without inventing an on-chain approval or a live owner identity.
 await f.tenant(f.merchant,async db=>{
  await db.query("INSERT INTO delegated_owner_sessions(merchant_id,owner,domain,token_hash,expires_at) VALUES($1,'SQL-only-table-guard-owner','https://fixture.invalid',$2,clock_timestamp()+interval '1 hour')",[f.merchant,randomUUID()]);
  await db.query("INSERT INTO delegated_grants(merchant_id,id,policy,policy_hash,owner,source_ata,delegate,status,spent,reserved) VALUES($1,$2,$3,'SQL-only-table-guard-policy','SQL-only-table-guard-owner',$4,$5,'PAUSED',7,0)",[f.merchant,randomUUID(),{totalMinor:'100',label:'ISOLATED SYNTHETIC TABLE GUARD; NO CHAIN APPROVAL'},randomUUID(),randomUUID()]);
 });
}
async function transactions(f:Fixture){
 const first=await f.pool.connect();let second:pg.PoolClient;
 try{second=await f.pool.connect();}catch(error){first.release();throw error;}
 try{
  for(const db of [first,second]){
   await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);
   await db.query("SET LOCAL statement_timeout='8s'");
  }
 }catch(error){await first.query('ROLLBACK');await second.query('ROLLBACK');first.release();second.release();throw error;}
 const close=async()=>{await first.query('ROLLBACK');await second.query('ROLLBACK');first.release();second.release();};
 return {first,second,close};
}
async function blockedBy(observer:pg.PoolClient,waiterPid:number,holderPid:number){
 // Three bounded observations, not unbounded races or repeated test rounds.
 let blocked=false;
 for(let observation=0;observation<3&&!blocked;observation++){
  await observer.query('SELECT pg_sleep(0.05)');
  blocked=(await observer.query('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked',[waiterPid,holderPid])).rows[0].blocked;
 }
 assert.equal(blocked,true,'the consumer operation must actually contend on the held transaction lock');
}
async function pid(db:pg.PoolClient){return (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;}

for(const scenario of [
 {attempt:'FAILED',parent:'EXPIRED'},
 {attempt:'EXPIRED',parent:'EXPIRED'},
 {attempt:'REJECTED',parent:'PAID'},
] as const)test(`signed unresolved ${scenario.attempt} blocks clear even with ${scenario.parent} parent; reconciliation preserves history`,integration,async(t)=>{
 const f=await guestFixture(),order=await f.create();
 if(scenario.parent==='PAID'){
  const paid=await syntheticFinalize(f,order.id);await render(f,paid.event);
 }else{
  const event=await orderEvent(f,order.id);
  success(await f.command(f.b.id,{type:'ORDER_CANCEL',orderId:order.id,orderVersion:order.version,screenGeneration:String(event.screen_generation)}));
 }
 // Intentionally isolated synthetic terminal-parent/signed-unknown history:
 // this seed tests the independent attempt guard, not cancellation or chain truth.
 // EXPIRED exercises signed bytes alone; FAILED/REJECTED also carry a signature.
 const unresolved=await syntheticAttempt(f,order.id,scenario.attempt,false,scenario.attempt==='EXPIRED');
 t.after(()=>f.tenant(f.merchant,db=>db.query('UPDATE payment_attempts SET failure_reconciled_at=coalesce(failure_reconciled_at,clock_timestamp()) WHERE merchant_id=$1 AND id=$2',[f.merchant,unresolved.id])));
 const beforeFinancial=await financial(f),beforeOperational=await operational(f);
 assert.equal(beforeFinancial.bills[0].status,scenario.parent);
 await assert.rejects(clear(f),{code:'TABLE_CLEAR_BLOCKED',details:{reason:'PAYMENT_RECONCILIATION_REQUIRED',count:1}});
 assert.deepEqual(await financial(f),beforeFinancial,'refusal must not lose the signed attempt, bill, payment or stock');
 assert.deepEqual(await operational(f),beforeOperational,'refusal must not close occupancy, advance generation, dismiss a screen or enqueue invalidation');
 await f.tenant(f.merchant,db=>db.query('UPDATE payment_attempts SET failure_reconciled_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[f.merchant,unresolved.id]));
 const reconciled=await financial(f);assert.equal((await clear(f)).generation,'2');
 assert.deepEqual(await financial(f),reconciled,'clearing after reconciliation must retain the signed history verbatim');
});

test('current PAID clear requires matching authenticated render ACK; paid public history and exact submit replay survive clear',integration,async()=>{
 const f=await guestFixture(),order=await f.create();await seedWalletPermission(f);
 // Rendering an older unpaid version cannot authorize clearing the paid receipt.
 await render(f,await orderEvent(f,order.id,order.version));
 const paid=await syntheticFinalize(f,order.id);assert.equal(paid.event.order_version,order.version+1);
 const before=await operational(f);
 await assert.rejects(clear(f),{code:'PAYMENT_PENDING'});assert.deepEqual(await operational(f),before);
 const noDelivery=await f.command(f.b.id,ack(paid.event));assert.equal(noDelivery.result.ok,false);
 if(!noDelivery.result.ok)assert.equal(noDelivery.result.error.code,'INVALID_ACK');
 await deliver(f,paid.event);
 const wrongDevice=await f.command(f.c.id,ack(paid.event));assert.equal(wrongDevice.result.ok,false);
 const wrongVersion=await f.command(f.b.id,{...ack(paid.event),orderVersion:order.version});assert.equal(wrongVersion.result.ok,false);
 const wrongScreen=await f.command(f.b.id,{...ack(paid.event),screenGeneration:String(BigInt(paid.event.screen_generation)+1n)});assert.equal(wrongScreen.result.ok,false);
 await assert.rejects(clear(f),{code:'PAYMENT_PENDING'});
 await render(f,paid.event);
 const historical=publicOrderSchema.parse(await f.request(f.path,'GET',undefined)).order;
 assert.equal(historical.status,'PAID');assert.equal('customerId' in historical,false);assert.equal('accessToken' in historical,false);
 const immutable=await financial(f);assert.equal(immutable.payments.length,1);assert.equal(immutable.payments[0].state,'SETTLED');assert.equal(immutable.wallet_permissions.length,1);
 const input=clearInput(),result=await clear(f,input);assert.equal(result.generation,'2');
 const once=await operational(f);assert.deepEqual(await clear(f,input),result);assert.deepEqual(await operational(f),once,'exact clear replay cannot emit a second invalidation');
 assert.deepEqual(publicOrderSchema.parse(await f.request(f.path,'GET',undefined)).order,historical);
 const replay=publicOrderSchema.parse(await f.request(f.path+'/orders','POST',f.submit));assert.equal(replay.replayed,true);assert.deepEqual(replay.order,historical);
 await assert.rejects(f.request(f.path+'/orders','POST',{...f.submit,idempotencyKey:randomUUID()}),/LEASE_EXPIRED|TABLE_OCCUPANCY_CHANGED/);
 assert.deepEqual(await financial(f),immutable,'clear and historical recovery must not rewrite immutable finance or wallet permissions');
});

test('clear fences old public visit quotes/orders and sends durable idle invalidation only to its assigned device',integration,async()=>{
 const f=await guestFixture();
 const before=await operational(f),immutable=await financial(f),result=await clear(f);
 assert.deepEqual(result.effects.map(effect=>effect.deviceId),[f.b.id],'counter and unrelated device must not be cleared');
 const effects=await f.tenant(f.merchant,db=>db.query('SELECT e.*,c.generation::text AS clear_generation FROM table_clear_effects c JOIN outbox_events e ON e.merchant_id=c.merchant_id AND e.id=c.event_id WHERE c.merchant_id=$1 AND c.table_id=$2',[f.merchant,f.table.id]));
 assert.equal(effects.rows.length,1);const event=effects.rows[0],effect=result.effects[0];
 assert.equal(event.id,effect.eventId);assert.equal(event.target_device_id,f.b.id);assert.equal(String(event.target_assignment_generation),'1');assert.equal(String(event.screen_generation),effect.screenGeneration);assert.equal(event.clear_generation,'2');assert.equal(event.type,'CART');assert.equal(event.order_id,null);
 assert.equal(event.payload.deviceId,f.b.id);assert.equal(event.payload.assignmentGeneration,'1');assert.equal(event.payload.screenGeneration,effect.screenGeneration);assert.equal(event.payload.payload.kind,'idle');assert.equal(event.payload.payload.screenGeneration,effect.screenGeneration);
 assert.equal(event.payload.payload.promotionPlaylist.tableId,f.table.id);assert.equal(event.payload.payload.promotionPlaylist.occupancyGeneration,'2');assert.deepEqual(event.payload.payload.promotionPlaylist.items,[]);
 const after=await operational(f);
 for(const device of [f.a.id,f.c.id]){
  assert.deepEqual(after.screens.find((s:{device_id:string})=>s.device_id===device),before.screens.find((s:{device_id:string})=>s.device_id===device));
  assert.deepEqual(after.devices.find((d:{id:string})=>d.id===device),before.devices.find((d:{id:string})=>d.id===device));
  assert.deepEqual(after.events.filter((e:{target_device_id:string})=>e.target_device_id===device),before.events.filter((e:{target_device_id:string})=>e.target_device_id===device));
 }
 await assert.rejects(f.request(f.path+'/quotes','POST',{items:[{productId:f.product,qty:1}]}),{code:'TABLE_OCCUPANCY_CHANGED'});
 await assert.rejects(f.request(f.path+'/orders','POST',f.submit),{code:'TABLE_OCCUPANCY_CHANGED'});
 await assert.rejects(f.request(f.path,'GET',undefined),{code:'TABLE_OCCUPANCY_CHANGED'});
 await assert.rejects(clear(f,clearInput('1')),{code:'TABLE_OCCUPANCY_CHANGED'});
 assert.deepEqual(await financial(f),immutable,'old-generation draft must not reserve stock or create an order');
 const menu=z.object({occupancy:z.object({generation:z.string(),active:z.boolean()})}).passthrough().parse(await f.request(f.base,'GET',undefined));assert.deepEqual(menu.occupancy,{generation:'2',active:false});
 const visit=z.object({visitToken:z.string()}).passthrough().parse(await f.request(f.base+'/visit','POST',{requestId:randomUUID()}));
 const fresh=quoteSchema.parse(await f.request(f.base+'/visit/'+visit.visitToken+'/quotes','POST',{items:[{productId:f.product,qty:1}]}));
 const binding=await f.tenant(f.merchant,async db=>(await db.query('SELECT generation::text,target_device_id FROM quote_table_occupancies WHERE merchant_id=$1 AND quote_id=$2',[f.merchant,fresh.quote.id])).rows[0]);assert.deepEqual(binding,{generation:'2',target_device_id:f.b.id});
});

for(const fence of ['assignment','auth'] as const)test(`stale ${fence} rejects frozen table quote/order and old public entry without financial effects`,integration,async()=>{
 const f=await tableFixture(),{counterQuote,createRoutedOrder}=await import('../apps/api/src/orders'),{tableRequest}=await import('../apps/api/src/table-ordering');
 const serving={kind:'table' as const,tableId:f.table.id};
 const quote=await f.tenant(f.merchant,db=>counterQuote(db,f.merchant,f.register.id,{items:[{productId:f.product,qty:1}],serving}));
 const entry=await f.tenant(f.merchant,async db=>(await db.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1',[f.merchant,f.b.id])).rows[0]);
 if(fence==='assignment'){
  const otherTable=await f.reg('/api/tables','POST',{label:'Isolated other table'});
  await f.reg('/api/devices/'+f.a.id,'PATCH',{tableId:otherTable.id,expectedAssignmentGeneration:'1'});
  await f.reg('/api/devices/'+f.b.id,'PATCH',{tableId:null,expectedAssignmentGeneration:'1'});
 }else{
  await f.reg('/api/devices/'+f.a.id+'/credential','POST',{});
  await f.reg('/api/devices/'+f.b.id+'/credential','POST',{});
  // A synthetic online reconnect keeps offline refusal from masking quote auth
  // fencing. The revoked original device actor itself is never refreshed.
  await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]));
 }
 const before=await financial(f);
 await assert.rejects(f.tenant(f.merchant,db=>createRoutedOrder(db,f.merchant,'register',f.register.id,{...f.input(quote),serving})),{code:fence==='assignment'?'ASSIGNMENT_CHANGED':'TABLE_OCCUPANCY_CHANGED'});
 await assert.rejects(tableRequest('/api/table/'+entry.entry_token,'GET',undefined),{code:'ASSIGNMENT_CHANGED'});
 if(fence==='auth')await assert.rejects(f.command(f.a.id,{type:'HEARTBEAT',sessionId:null}),{code:'DEVICE_AUTH_INVALID'});
 assert.deepEqual(await financial(f),before,'stale authority cannot allocate a customer/order, charge or reserve stock');
});

for(const fence of ['assignment','auth'] as const)test(`durable clear event delivery and ACK stay fenced after ${fence} identity changes`,integration,async()=>{
 const f=await tableFixture(),result=await clear(f),effect=result.effects[0];
 assert.equal(effect.deviceId,f.b.id);
 const event=await f.tenant(f.merchant,async db=>(await db.query('SELECT * FROM outbox_events WHERE merchant_id=$1 AND id=$2',[f.merchant,effect.eventId])).rows[0]) as Event;
 const validate=()=>f.tenant(f.merchant,async db=>{
  const actor=f.devices.get(f.b.id)!;
  return (await db.query('SELECT bitpos.device_validate_send($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid) AS checked',[f.merchant,f.b.id,actor.tokenHash,actor.authGeneration,actor.connectionGeneration,actor.connectionId,event.id])).rows[0].checked;
 });
 assert.equal((await validate()).allowed,true);
 await deliver(f,event);
 const foreign=await f.command(f.c.id,ack(event));assert.equal(foreign.result.ok,false);
 await render(f,event);
 if(fence==='assignment')await f.reg('/api/devices/'+f.b.id,'PATCH',{tableId:null,expectedAssignmentGeneration:'1'});
 else await f.reg('/api/devices/'+f.b.id+'/credential','POST',{});
 const immutable=await financial(f);
 assert.equal((await validate()).allowed,false,'an old clear intent must not be sent to the replacement assignment/auth identity');
 if(fence==='assignment'){
  const stale=await f.command(f.b.id,ack(event));assert.equal(stale.result.ok,false);
  if(!stale.result.ok)assert.equal(stale.result.error.code,'INVALID_ACK');
 }else await assert.rejects(f.command(f.b.id,ack(event)),{code:'DEVICE_AUTH_INVALID'});
 assert.deepEqual(await financial(f),immutable);
});

for(const winner of ['quote','clear'] as const)test(`clear/quote contention is linearizable when ${winner} holds routing lock first`,integration,async()=>{
 const f=await tableFixture(),{routingLock}=await import('../apps/api/src/authority'),{counterQuote,createRoutedOrder}=await import('../apps/api/src/orders'),{clearTableOccupancy}=await import('../apps/api/src/table-occupancy');
 const serving={kind:'table' as const,tableId:f.table.id},tx=await transactions(f);
 let pending:Promise<unknown>|undefined;
 try{
  const holderPid=await pid(tx.first),waiterPid=await pid(tx.second);
  await routingLock(tx.first,f.merchant);
  const initial=await counterQuote(tx.first,f.merchant,f.register.id,{items:[{productId:f.product,qty:1}],serving});
  if(winner==='quote'){
   pending=clearTableOccupancy(tx.second,f.merchant,f.actor,'owner',f.table.id,clearInput());void pending.catch(()=>{});
   await blockedBy(tx.first,waiterPid,holderPid);await tx.first.query('COMMIT');
   const result=clearSchema.parse(await pending);assert.equal(result.generation,'2');await tx.second.query('COMMIT');
  }else{
   pending=counterQuote(tx.second,f.merchant,f.register.id,{items:[{productId:f.product,qty:1}],serving});void pending.catch(()=>{});
   await blockedBy(tx.first,waiterPid,holderPid);
   assert.equal((await clearTableOccupancy(tx.first,f.merchant,f.actor,'owner',f.table.id,clearInput())).generation,'2');await tx.first.query('COMMIT');
   const fresh=await pending as Awaited<ReturnType<typeof counterQuote>>;await tx.second.query('COMMIT');
   const binding=await f.tenant(f.merchant,async db=>(await db.query('SELECT generation::text FROM quote_table_occupancies WHERE merchant_id=$1 AND quote_id=$2',[f.merchant,fresh.id])).rows[0]);assert.equal(binding.generation,'2','a quote admitted after clear must belong to the new generation');
  }
  await assert.rejects(f.tenant(f.merchant,db=>createRoutedOrder(db,f.merchant,'register',f.register.id,{...f.input(initial),serving})),{code:'TABLE_OCCUPANCY_CHANGED'});
  const state=await financial(f);assert.equal(state.bills.length,0);assert.equal(state.products[0].reserved,0);assert.equal(state.products[0].stock,100);
  const occupancy=await f.tenant(f.merchant,db=>db.query('SELECT generation::text,closed_at FROM table_occupancies WHERE merchant_id=$1 AND table_id=$2 ORDER BY generation',[f.merchant,f.table.id]));assert.ok(occupancy.rows[0].closed_at);assert.equal(occupancy.rows[0].generation,'1');
  if(winner==='clear'){assert.equal(occupancy.rows[1].generation,'2');assert.equal(occupancy.rows[1].closed_at,null);}else assert.equal(occupancy.rows.length,1);
 }finally{await tx.close();if(pending)await pending.catch(()=>{});}
});

test('clear racing uncommitted first finalization refuses old unpaid state without losing the canonical payment',integration,async()=>{
 const f=await guestFixture(),order=await f.create(),attempt=await syntheticAttempt(f,order.id),{settleAttempt}=await import('../apps/api/src/orders');
 const tx=await transactions(f);
 try{
  await settleAttempt(tx.first,attempt,true);
  // The financial transaction is deliberately paused before COMMIT. Clear sees
  // the old unpaid order and must refuse rather than release its reservation.
  const before=await operational(f);await assert.rejects(clear(f),{code:'TABLE_CLEAR_BLOCKED',details:{reason:'UNPAID_ORDER',count:1}});assert.deepEqual(await operational(f),before);
  await tx.first.query('COMMIT');
  const state=await financial(f);assert.equal(state.bills[0].status,'PAID');assert.equal(state.payments.length,1);assert.equal(state.payments[0].attempt_id,attempt.id);assert.equal(state.payments[0].amount_minor,2700000);assert.equal(state.payments[0].state,'SETTLED');assert.equal(state.products[0].stock,99);assert.equal(state.products[0].reserved,0);
  await assert.rejects(clear(f),{code:'PAYMENT_PENDING'});await render(f,await orderEvent(f,order.id));
  const immutable=await financial(f);assert.equal((await clear(f)).generation,'2');assert.deepEqual(await financial(f),immutable);
 }finally{await tx.close();}
});

test('late second finalization during clear screen-lock wait refuses atomically and preserves settled plus recovery funds',integration,async()=>{
 const f=await guestFixture(),order=await f.create();const paid=await syntheticFinalize(f,order.id);await render(f,paid.event);
 // Explicit reconciled SQL-only second history, not a successful chain payment.
 const late=await syntheticAttempt(f,order.id),{settleAttempt}=await import('../apps/api/src/orders'),{clearTableOccupancy}=await import('../apps/api/src/table-occupancy');
 const tx=await transactions(f);let pending:Promise<unknown>|undefined;
 const before=await operational(f);
 try{
  const holderPid=await pid(tx.first),waiterPid=await pid(tx.second);
  await tx.first.query('SELECT device_id FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2 FOR UPDATE',[f.merchant,f.b.id]);
  pending=clearTableOccupancy(tx.second,f.merchant,f.actor,'owner',f.table.id,clearInput());void pending.catch(()=>{});
  // Clear has passed the PAID/attempt checks and is now contending on the real
  // screen row, so finalizing here tests its freshness after that exact boundary.
  await blockedBy(tx.first,waiterPid,holderPid);await settleAttempt(tx.first,late,true);await tx.first.query('COMMIT');
  await assert.rejects(pending,/ORDER_NOT_RELEASABLE|RECOVERY_REQUIRED|TABLE_CLEAR_BLOCKED/);await tx.second.query('ROLLBACK');
  const state=await financial(f);assert.equal(state.bills[0].status,'RECOVERY');assert.equal(state.payments.length,2);
  assert.deepEqual(state.payments.map((p:{state:string})=>p.state).sort(),['RECOVERY','SETTLED']);
  assert.ok(state.payments.every((p:{amount_minor:number})=>p.amount_minor===2700000));assert.equal(state.payments.find((p:{attempt_id:string})=>p.attempt_id===late.id).state,'RECOVERY');assert.equal(state.products[0].stock,99);assert.equal(state.products[0].reserved,0);
  const after=await operational(f);assert.equal(after.generation,before.generation);assert.deepEqual(after.occupancies,before.occupancies);assert.deepEqual(after.effects,before.effects);assert.deepEqual(after.requests,before.requests);assert.deepEqual(after.screens,before.screens);assert.deepEqual(after.devices,before.devices);assert.deepEqual(after.sessions,before.sessions);
  assert.equal(after.events.length,before.events.length+1,'only the real recovery publisher emits a new financial event; clear emits none');
  await assert.rejects(clear(f),{code:'TABLE_CLEAR_BLOCKED',details:{reason:'UNPAID_ORDER',count:1}});assert.deepEqual(await financial(f),state);
 }finally{await tx.close();if(pending)await pending.catch(()=>{});}
});

for(const guestAcknowledges of [false,true])test(`pickup READY/render/${guestAcknowledges?'guest ACK':'no guest ACK'}/clear never fabricates collection`,integration,async()=>{
 const f=await publicPickupFixture();await seedWalletPermission(f);
 success(await f.command(f.b.id,{type:'CAPABILITIES',capabilities:['pickup_ready_v1']}));
 await f.kitchen('PREPARING',0);const ready=await f.kitchen('READY',1);assert.equal(ready.fulfillment.status,'READY');
 await f.reconcile();const notice=await f.notice(),event=await f.event();assert.ok(event);assert.equal(notice.state,'DELIVERED');assert.equal(event.target_device_id,f.b.id);
 const premature=await f.command(f.b.id,{type:'PICKUP_ACK',notificationId:notice.id,screenGeneration:String(event.screen_generation)});assert.equal(premature.result.ok,false);
 if(!premature.result.ok)assert.equal(premature.result.error.code,'INVALID_ACK');
 assert.equal((await f.fulfillment()).status,'READY');assert.equal((await f.notice()).acknowledged_at,null);
 await f.delivery(event);success(await f.command(f.b.id,f.ack(event)));
 const rendered=await f.notice();assert.equal(rendered.state,'RENDERED');assert.ok(rendered.rendered_at);assert.equal(rendered.acknowledged_at,null);assert.equal((await f.fulfillment()).status,'READY');
 if(guestAcknowledges){success(await f.command(f.b.id,{type:'PICKUP_ACK',notificationId:notice.id,screenGeneration:String(event.screen_generation)}));assert.equal((await f.notice()).state,'ACKNOWLEDGED');assert.ok((await f.notice()).acknowledged_at);}
 const immutable=await financial(f),priorNotice=await f.notice(),result=await clear(f);assert.equal(result.generation,'2');assert.deepEqual(result.effects.map(effect=>effect.deviceId),[f.b.id]);
 const fulfillment=await f.fulfillment(),afterNotice=await f.notice();assert.equal(fulfillment.status,'READY');assert.equal(fulfillment.version,2);assert.equal(afterNotice.state,guestAcknowledges?'ACKNOWLEDGED':'CANCELED');assert.deepEqual(afterNotice.acknowledged_at,priorNotice.acknowledged_at);assert.deepEqual(afterNotice.rendered_at,priorNotice.rendered_at);
 const tombstone=await f.event(afterNotice.cancel_event_id);assert.ok(tombstone);assert.equal(tombstone.target_device_id,f.b.id);assert.equal(String(tombstone.target_assignment_generation),String(notice.assignment_generation));assert.equal(tombstone.order_id,null);assert.equal(tombstone.payload.payload.notificationId,notice.id);assert.equal(tombstone.payload.payload.state,'CANCELED');assert.equal(tombstone.payload.payload.sound,false);
 assert.equal((await f.validate(event.id)).allowed,false,'the old READY event cannot be resent into the next occupancy');
 const stale=await f.command(f.b.id,{type:'PICKUP_ACK',notificationId:notice.id,screenGeneration:String(event.screen_generation)});assert.equal(stale.result.ok,false);
 assert.equal((await f.fulfillment()).status,'READY');assert.deepEqual(await financial(f),immutable);
 await f.kitchen('COLLECTED',2);assert.equal((await f.fulfillment()).status,'COLLECTED');assert.deepEqual(await financial(f),immutable,'only explicit staff collection changes fulfillment, never financial truth');
});
