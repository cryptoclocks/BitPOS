import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {tableFixture} from './backend-table-fixture';

test('order mutation and simultaneous order snapshot publish without a counter/order foreign-key deadlock',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000},async()=>{
 const f=await tableFixture();const first=await f.create(await f.quote());
 const {streamEvent,deviceOrderView}=await import('../apps/api/src/orders');
 const captured=await f.tenant(f.merchant,async db=>{const order=(await db.query('SELECT * FROM orders WHERE id=$1',[first.order.id])).rows[0];const authority=(await db.query('SELECT target_assignment_generation::text,screen_generation::text FROM order_authority WHERE order_id=$1',[first.order.id])).rows[0];return {order,authority,payload:await deviceOrderView(db,order)};});
 const mutation=await f.pool.connect(),snapshot=await f.pool.connect();let pending:Promise<unknown>|undefined;
 const publish=(db:typeof mutation)=>streamEvent(db,f.merchant,f.a.id,captured.authority.target_assignment_generation,captured.authority.screen_generation,'ORDER',captured.payload,captured.order);
 try {
  for(const db of [mutation,snapshot]){await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);await db.query("SET LOCAL statement_timeout='10s'");}
  await mutation.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[first.order.id]);
  const pid=(await snapshot.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=publish(snapshot).catch(error=>error);
  let blocked=false;const deadline=Date.now()+5000;
  while(Date.now()<deadline){blocked=(await mutation.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;if(blocked)break;await yieldIO();}
  assert.ok(blocked,'snapshot really waits for the order transaction before concurrent publish');
  const mutated=await publish(mutation);await mutation.query('COMMIT');
  const snapshotted=await pending;pending=undefined;assert.ok(!(snapshotted instanceof Error),String(snapshotted));await snapshot.query('COMMIT');
  const sequence=(snapshotted as typeof mutated).deviceSeq;assert.equal(BigInt(sequence),BigInt(mutated.deviceSeq)+1n,'both committed publications retain exact serial order');
  const retained=await f.tenant(f.merchant,async db=>({order:(await db.query('SELECT status,version FROM orders WHERE id=$1',[first.order.id])).rows[0],payments:(await db.query('SELECT count(*)::int AS n FROM payments WHERE order_id=$1',[first.order.id])).rows[0].n}));
  assert.deepEqual(retained,{order:{status:'AWAITING_WALLET',version:1},payments:0},'publication cannot invent settlement');
 }finally{await mutation.query('ROLLBACK');if(pending)await pending;await snapshot.query('ROLLBACK');mutation.release();snapshot.release();}
});
