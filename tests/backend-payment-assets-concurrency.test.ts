import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import type {OrderRow} from '../apps/api/src/types';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000};

for(const status of ['BUILDING','READY'] as const)test(`concurrent unsigned ${status} attempt wins the order lock; selection waits then rejects without financial effects`,integration,async()=>{
 // Intentional module-loading boundary: skipped tests cannot load private DB/RPC config.
 const {selectPaymentAsset}=await import('../apps/api/src/payment-assets');
 const f=await tableFixture(),created=await f.create(await f.quote());
 const submit=await f.pool.connect(),select=await f.pool.connect();
 try{
  for(const db of [submit,select]){await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);await db.query("SET LOCAL statement_timeout='5s'");}
  await submit.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[created.order.id]);
  const a=(await fixturePaymentAttempt(submit,{merchant:f.merchant,order:created.order.id,status})).rows[0];
  const pid=(await select.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const pending=(async()=>{const o=(await select.query<OrderRow>('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[created.order.id])).rows[0];return selectPaymentAsset(select,o,{assetId:'usdg-devnet',expectedVersion:created.order.version,idempotencyKey:randomUUID()});})();
  void pending.catch(()=>{});
  let blocked=false;for(let n=0;n<100&&!blocked;n++){blocked=(await submit.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;if(!blocked)await submit.query('SELECT pg_sleep(0.01)');}
  assert.equal(blocked,true,'selection really waits on the submit-side order lock');await submit.query('COMMIT');
  await assert.rejects(pending,/PAYMENT_PENDING/);await select.query('ROLLBACK');
  await f.tenant(f.merchant,async db=>{
   assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_quotes WHERE order_id=$1',[created.order.id])).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_asset_requests WHERE order_id=$1',[created.order.id])).rows[0].n,0);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_attempt_assets WHERE attempt_id=$1',[a.id])).rows[0].n,1);
   assert.equal((await db.query('SELECT version FROM orders WHERE id=$1',[created.order.id])).rows[0].version,created.order.version);
   assert.deepEqual((await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],{stock:100,reserved:1});
   // End this SQL-only fixture without presenting its bytes to the live worker.
   await db.query("UPDATE payment_attempts SET status='EXPIRED',failure_reconciled_at=clock_timestamp() WHERE id=$1",[a.id]);
  });
 }finally{await submit.query('ROLLBACK');await select.query('ROLLBACK');submit.release();select.release();}
});

test('concurrent same-version selections create one new quote/request; loser sees fresh version after lock',integration,async()=>{
 // Intentional module-loading boundary: skipped tests cannot load private DB/RPC config.
 const {selectPaymentAsset}=await import('../apps/api/src/payment-assets');
 const f=await tableFixture(),created=await f.create(await f.quote());
 const results=await Promise.allSettled([1,2].map(()=>f.tenant(f.merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[created.order.id])).rows[0];
  return selectPaymentAsset(db,o,{assetId:'usdg-devnet',expectedVersion:created.order.version,idempotencyKey:randomUUID()});
 })));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected&&rejected.status==='rejected');assert.match(String(rejected.reason),/PAYMENT_ASSET_VERSION_CONFLICT/);
 await f.tenant(f.merchant,async db=>{
  assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_quotes WHERE order_id=$1',[created.order.id])).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_asset_requests WHERE order_id=$1',[created.order.id])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1',[created.order.id])).rows[0].n,0);
  assert.equal((await db.query('SELECT version FROM orders WHERE id=$1',[created.order.id])).rows[0].version,created.order.version+1);
 });
});
