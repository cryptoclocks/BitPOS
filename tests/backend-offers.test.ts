import test from 'node:test';
import assert from 'node:assert/strict';
import {tableFixture} from './backend-table-fixture';
import {setImmediate as yieldIO} from 'node:timers/promises';
test('immutable offer revisions bind actual price version and stale review never creates an order',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'},async()=>{
 // Loading boundary: skipped fixtures must not load runtime database configuration.
 const f=await tableFixture();const {productOffer,effectiveMenu}=await import('../apps/api/src/offers');const {publishPrices}=await import('../apps/api/src/catalog');
 const expiresAt=new Date(Date.now()+60000).toISOString();const discount={priceVersion:f.pricing.priceVersion,expectedRevision:'0',enabled:true,basePriceMinor:'270',currentPriceMinor:'230',expiresAt,discount:{kind:'percent',percent:15}};
 const stale=await f.quote();const enabled=await f.tenant(f.merchant,db=>productOffer(db,f.merchant,f.actor,'manager',f.product,'PUT',discount));assert.equal(enabled.effective.unitPrice.amountMinor,'230');assert.equal(enabled.offer?.revision,'1');await assert.rejects(f.create(stale),/QUOTE_CHANGED/);
 await assert.rejects(f.tenant(f.other,db=>productOffer(db,f.other,f.actor,'manager',f.product,'GET',null,f.pricing.priceVersion)),/RESOURCE_NOT_FOUND/);
 await assert.rejects(f.tenant(f.other,db=>productOffer(db,f.other,f.actor,'manager',f.product,'PUT',discount)),/RESOURCE_NOT_FOUND/);
 const foreignMenu=await f.tenant(f.other,db=>effectiveMenu(db,f.other));assert.equal(foreignMenu.products.some(product=>product.id===f.product),false,'another tenant cannot advertise the discounted product');
 const q=await f.quote(3);assert.equal(q.total.amountMinor,'690');assert.equal(q.settlement.amountMinor,'6900000');const frozen=await f.create(q);
 const race=await Promise.allSettled([f.tenant(f.merchant,db=>productOffer(db,f.merchant,f.actor,'owner',f.product,'PATCH',{priceVersion:f.pricing.priceVersion,expectedRevision:'1',enabled:false})),f.tenant(f.merchant,db=>productOffer(db,f.merchant,f.actor,'manager',f.product,'PATCH',{priceVersion:f.pricing.priceVersion,expectedRevision:'1',enabled:false}))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
 const revision=await f.tenant(f.merchant,async db=>(await db.query('SELECT revision::text FROM merchant_pricing WHERE merchant_id=$1',[f.merchant])).rows[0].revision);const next=await f.tenant(f.merchant,db=>publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:revision}));assert.notEqual(next.priceVersion,f.pricing.priceVersion);const menu=await f.tenant(f.merchant,db=>effectiveMenu(db,f.merchant));assert.equal(menu.products[0].unitPrice?.amountMinor,'270');assert.equal(menu.products[0].promotion,null,'equal numeric base never reactivates an old price-version offer');
 const read=await f.tenant(f.merchant,async db=>{const {orderView}=await import('../apps/api/src/orders');return orderView(db,(await db.query('SELECT * FROM orders WHERE id=$1',[frozen.order.id])).rows[0]);});assert.equal(read.pricing.total.amountMinor,'690');assert.equal(read.pricing.lines[0].promotion?.priceVersion,f.pricing.priceVersion);
 await assert.rejects(f.tenant(f.merchant,db=>db.query('UPDATE catalog_prices SET unit_minor=999 WHERE price_version_id=$1',[f.pricing.priceVersion])),/immutable/);await assert.rejects(f.tenant(f.merchant,db=>productOffer(db,f.merchant,f.actor,'staff',f.product,'GET',null)),/ROLE_REQUIRED/);
});
// Include remote fixture setup; the exercised lock itself retains its 10-second statement bound.
test('a product-lock wait crossing the immutable review deadline rejects, never silently reprices',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000},async()=>{
 const f=await tableFixture();const {productOffer}=await import('../apps/api/src/offers');const {createRoutedOrder}=await import('../apps/api/src/orders');
 const expiresAt=await f.tenant(f.merchant,async db=>new Date((await db.query("SELECT clock_timestamp()+interval '30 seconds' AS deadline")).rows[0].deadline).toISOString());
 await f.tenant(f.merchant,db=>productOffer(db,f.merchant,f.actor,'owner',f.product,'PUT',{priceVersion:f.pricing.priceVersion,expectedRevision:'0',enabled:true,basePriceMinor:'270',currentPriceMinor:'230',expiresAt,discount:{kind:'percent',percent:15}}));const q=await f.quote();
 assert.equal(q.validUntil,expiresAt,'the review must actually include the live offer deadline');
 // Approach the immutable deadline before taking locks. Remote setup is not a
 // product lock wait; the real blocked statements retain the 10-second bound.
 await f.tenant(f.merchant,db=>db.query('SELECT pg_sleep(greatest(0,extract(epoch FROM($1::timestamptz-clock_timestamp()))-5))',[q.validUntil]));
 const blocker=await f.pool.connect(),waiter=await f.pool.connect();let pending:Promise<unknown>|undefined;try{
 for(const db of [blocker,waiter]){await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);await db.query("SET LOCAL statement_timeout='10s'");}
 await blocker.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[f.product]);const pid=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 pending=createRoutedOrder(waiter,f.merchant,'register',f.register.id,f.input(q)).catch((error:unknown)=>error);let blocked=false;const until=Date.now()+5000;while(Date.now()<until){blocked=(await blocker.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;if(blocked)break;await yieldIO();}
 assert.ok(blocked,'exercise a real product lock wait before checking quote time');await blocker.query('SELECT pg_sleep(greatest(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.01)',[q.validUntil]);await blocker.query('COMMIT');const rejected=await pending;pending=undefined;assert.ok(rejected instanceof Error);assert.match(rejected.message,/QUOTE_EXPIRED/);await waiter.query('ROLLBACK');
 assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n),0);assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0].reserved),0);
 }finally{await blocker.query('ROLLBACK');if(pending)await pending;await waiter.query('ROLLBACK');blocker.release();waiter.release();}
});
