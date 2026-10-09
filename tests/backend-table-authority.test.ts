import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture,success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Intentional loading boundary: database/config modules load only in opted-in tests.
test('full fifty-line device review/bill paging and origin-scoped submit survive reconnect/fences',integration,async()=>{
 const f=await tableFixture();const ids=[f.product,...Array.from({length:49},()=>randomUUID())];await f.tenant(f.merchant,async db=>{for(const [index,id] of ids.slice(1).entries())await db.query('INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,$3,$3,\'\',3500,10)',[id,f.merchant,'Text item '+index]);});const {publishPrices}=await import('../apps/api/src/catalog');const pricing=await f.tenant(f.merchant,db=>publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:f.pricing.revision,prices:ids.map(productId=>({productId,unitMinor:'100'}))}));
 const catalog=success(await f.command(f.b.id,{type:'CATALOG_PAGE',menuVersion:null,pageIndex:0}));assert.ok('catalog' in catalog);assert.equal(catalog.catalog.productCount,50);const reached=new Set<string>();for(let pageIndex=0;pageIndex<catalog.catalog.pageCount;pageIndex++){const value=success(await f.command(f.b.id,{type:'CATALOG_PAGE',menuVersion:catalog.catalog.menuVersion,pageIndex}));assert.ok('catalog' in value);assert.ok(value.catalog.products.length<=4);for(const p of value.catalog.products)reached.add(p.productId);}assert.equal(reached.size,50);
 const sessionId=randomUUID();success(await f.command(f.b.id,{type:'CART_OPEN',sessionId,expectedScreenGeneration:'1',expectedAssignmentGeneration:'1',recoverSessionId:null}));success(await f.command(f.b.id,{type:'CART_SET',sessionId,expectedScreenGeneration:'2',expectedAssignmentGeneration:'1',expectedCartVersion:'0',items:ids.map(productId=>({productId,qty:1}))}));const reviewed=success(await f.command(f.b.id,{type:'CART_REVIEW',sessionId,cartVersion:'1',expectedScreenGeneration:'2',expectedPriceVersion:pricing.priceVersion}));assert.ok('quote' in reviewed);assert.equal(reviewed.quote.lineCount,50);assert.equal(reviewed.quote.total.amountMinor,'5000');let sum=0n;for(let pageIndex=0;pageIndex<reviewed.quote.pageCount;pageIndex++){const value=success(await f.command(f.b.id,{type:'QUOTE_PAGE',quoteId:reviewed.quote.quoteId,pageIndex}));assert.ok('page' in value);sum+=value.page.lines.reduce((n,l)=>n+BigInt(l.unitPrice.amountMinor)*BigInt(l.qty),0n);}assert.equal(sum,5000n);
 const idempotencyKey=randomUUID();const submit={type:'ORDER_SUBMIT',sessionId,cartVersion:'1',quoteId:reviewed.quote.quoteId,priceVersion:reviewed.quote.priceVersion,idempotencyKey,expectedScreenGeneration:'2'};const first=success(await f.command(f.b.id,submit));assert.ok('order' in first);assert.equal(first.order.authority.kind,'versioned');assert.ok(first.order.authority.kind==='versioned');assert.equal(first.order.authority.serving.kind,'table');assert.equal(first.order.authority.target.deviceId,f.b.id);
 // Simulate a replaced authenticated connection without invoking hardware/chain.
 const a=f.devices.get(f.b.id);assert.ok(a);await f.tenant(f.merchant,db=>db.query('UPDATE device_presence SET connection_generation=2 WHERE device_id=$1',[f.b.id]));a.connectionGeneration='2';const replay=success(await f.command(f.b.id,{...submit,expectedScreenGeneration:'999'}));assert.ok('order' in replay);assert.equal(replay.order.id,first.order.id);assert.equal(replay.replayed,true);assert.equal(replay.order.sound,false);assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n),1);
 const incoming=await f.tenant(f.merchant,async db=>(await db.query('SELECT target_device_id,serving_label_snapshot FROM order_authority WHERE order_id=$1',[first.order.id])).rows[0]);assert.equal(incoming.serving_label_snapshot,'Table 4');assert.equal(incoming.target_device_id,f.b.id);
});
test('offline, busy, stale pairing/price, stock and tenant constraints refuse without side effects',integration,async()=>{
 const f=await tableFixture(2);const q=await f.quote();await f.tenant(f.merchant,db=>db.query('UPDATE device_presence SET connected_until=NULL WHERE device_id=$1',[f.a.id]));await assert.rejects(f.create(q),/DEVICE_OFFLINE/);assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n),0);
 await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connected_until=clock_timestamp()+interval '1 hour' WHERE device_id=$1",[f.a.id]));await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});await assert.rejects(f.create(q),/PAIRING_CHANGED/);await assert.rejects(f.reg('/api/devices/'+f.b.id,'PATCH',{tableId:randomUUID(),expectedAssignmentGeneration:'1'}),/RESOURCE_NOT_FOUND/);
 await assert.rejects(f.tenant(f.other,db=>db.query('INSERT INTO devices(merchant_id,label,table_id) VALUES($1,\'Wrong tenant\',$2)',[f.other,f.table.id])),e=>typeof e==='object'&&e!==null&&'code' in e&&e.code==='23503');
 const r2=await f.reg('/api/registers','POST',{label:'R2'});const r3=await f.reg('/api/registers','POST',{label:'R3'});const paired=await Promise.allSettled([f.reg('/api/registers/'+r2.id+'/pairing','PUT',{deviceId:f.a.id,expectedPairingGeneration:'1'}),f.reg('/api/registers/'+r3.id+'/pairing','PUT',{deviceId:f.a.id,expectedPairingGeneration:'1'})]);assert.equal(paired.filter(x=>x.status==='fulfilled').length,1);
 const fresh=await f.quote();await f.tenant(f.merchant,db=>db.query('UPDATE products SET stock=0 WHERE id=$1',[f.product]));await assert.rejects(f.create(fresh),/STOCK_UNAVAILABLE/);assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT reserved FROM products WHERE id=$1',[f.product])).rows[0].reserved),0);
});
test('order history preserves mixed legacy and frozen quotes in requested order without cross-tenant rows',integration,async()=>{
 const f=await tableFixture();const {order:created}=await f.create(await f.quote(2));
 const {orderViews}=await import('../apps/api/src/orders');const legacyId=randomUUID();
 await f.tenant(f.merchant,async db=>{
  const customer=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0];
  await db.query("INSERT INTO orders(id,merchant_id,customer_id,access_token,idempotency_key,request_hash,thb_minor,usdg_minor,treasury,quote_expires_at,terminal_id) VALUES($1,$2,$3,$4,$4,'legacy-fixture',3500,1000000,'11111111111111111111111111111111',now()+interval '1 hour','legacy-clock')",[legacyId,f.merchant,customer.id,randomUUID()]);
  await db.query("INSERT INTO order_items(order_id,merchant_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,'เดิม','Legacy coffee',1,3500)",[legacyId,f.merchant,f.product]);
  const rows=(await db.query('SELECT * FROM orders WHERE id=ANY($1::uuid[])',[ [legacyId,created.id] ])).rows;
  const ordered=[rows.find(row=>row.id===legacyId),rows.find(row=>row.id===created.id)];
  const views=await orderViews(db,ordered);
  assert.deepEqual(views.map(view=>view.id),[legacyId,created.id]);
  assert.equal(views[0].authority.kind,'legacy');assert.equal(views[0].pricing.total.currency,'THB');assert.equal(views[0].pricing.total.amountMinor,'3500');assert.equal(views[0].pricing.lines[0].nameEn,'Legacy coffee');
  assert.equal(views[1].authority.kind,'versioned');assert.equal(views[1].pricing.total.currency,'USD');assert.equal(views[1].pricing.total.amountMinor,'540');assert.equal(views[1].pricing.lines[0].qty,2);assert.equal(views[1].settlement.amountMinor,'5400000');
  const reversed=await orderViews(db,[...ordered].reverse(),true);assert.deepEqual(reversed.map(view=>view.id),[created.id,legacyId]);assert.ok(reversed.every(view=>!('customerId' in view)&&!('accessToken' in view)));
 });
 await f.tenant(f.other,async db=>{const rows=(await db.query('SELECT * FROM orders WHERE id=ANY($1::uuid[])',[[legacyId,created.id]])).rows;assert.deepEqual(await orderViews(db,rows),[]);});
});

test('table rename preserves the existing bill target and label while rejecting another tenant',integration,async()=>{
 const f=await tableFixture();const {counterQuote,createRoutedOrder,orderView}=await import('../apps/api/src/orders');const {registry}=await import('../apps/api/src/registry');
 const serving={kind:'table' as const,tableId:f.table.id};const q=await f.tenant(f.merchant,db=>counterQuote(db,f.merchant,f.register.id,{items:[{productId:f.product,qty:1}],serving}));
 const {order}=await f.tenant(f.merchant,db=>createRoutedOrder(db,f.merchant,'register',f.register.id,{...f.input(q),serving}));
 await f.reg('/api/tables/'+f.table.id,'PATCH',{label:'Renamed table'});
 const renamed=await f.tenant(f.merchant,async db=>(await db.query('SELECT label FROM merchant_tables WHERE id=$1',[f.table.id])).rows[0]);assert.equal(renamed.label,'Renamed table');
 const frozen=await f.tenant(f.merchant,async db=>orderView(db,(await db.query('SELECT * FROM orders WHERE id=$1',[order.id])).rows[0]));assert.equal(frozen.authority.serving.label,'Table 4');assert.equal(frozen.authority.kind,'versioned');assert.ok(frozen.authority.kind==='versioned');assert.equal(frozen.authority.target.deviceId,f.a.id);
 await assert.rejects(f.tenant(f.other,db=>registry(db,f.other,f.actor,'owner','/api/tables/'+f.table.id,'PATCH',{label:'Forged rename'})),/RESOURCE_NOT_FOUND/);
});
