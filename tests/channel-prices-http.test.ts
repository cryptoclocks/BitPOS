import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken,success} from './backend-table-fixture';
// M03b: per-channel prices inside canonical quotes, and the VAT-exempt flag in the cash register, over the real HTTP server and real SQL.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const code=(c:string)=>(e:unknown)=>(e as {code?:string}).code===c;

test('channel prices: counter and table quote their own price, online menu too; stale quotes and screens are refused; promotions do not stack',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const {effectiveCatalog}=await import('../apps/api/src/catalog');const {productOffer}=await import('../apps/api/src/offers');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const freeScreen=()=>f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id])).catch(()=>undefined);
 try{
  const version=f.pricing.priceVersion as string;
  // access
  assert.equal((await call(null,'GET','/api/settings/channel-prices')).status,401);
  assert.equal((await call('staff','GET','/api/settings/channel-prices')).status,403);
  const read0=await call('manager','GET','/api/settings/channel-prices');assert.equal(read0.status,200);
  assert.deepEqual([read0.body.priceVersion,read0.body.revision,read0.body.prices.length,read0.body.currency],[version,'0',0,'USD']);
  const put=(who:keyof typeof tok|null,body:unknown)=>call(who,'PUT','/api/settings/channel-prices',body);
  const cell=(channel:string,unitMinor:string|null,productId=f.product)=>({productId,channel,unitMinor});
  assert.equal((await put('manager',{priceVersion:version,expectedRevision:'0',set:[cell('counter','300')]})).status,403);
  assert.equal((await put('staff',{priceVersion:version,expectedRevision:'0',set:[cell('counter','300')]})).status,403);
  // strict bodies
  for(const bad of [{priceVersion:version,expectedRevision:'0',set:[]},{priceVersion:version,expectedRevision:'0',set:[cell('cash','300')]},{priceVersion:version,expectedRevision:'0',set:[cell('counter','0')]},{priceVersion:version,expectedRevision:'0',set:[cell('counter','-5')]},{priceVersion:version,expectedRevision:'0',set:[cell('counter','1.5')]},{priceVersion:version,expectedRevision:'0',set:[cell('counter','300'),cell('counter','310')]},{priceVersion:version,expectedRevision:'0',set:[cell('counter','300')],x:1},{expectedRevision:'0',set:[cell('counter','300')]}])assert.equal((await put('owner',bad)).status,422,JSON.stringify(bad));
  assert.equal((await put('owner',{priceVersion:version,expectedRevision:'0',set:[cell('counter','300',randomUUID())]})).status,404);
  assert.equal((await put('owner',{priceVersion:randomUUID(),expectedRevision:'0',set:[cell('counter','300')]})).status,409);
  assert.equal((await put('other',{priceVersion:version,expectedRevision:'0',set:[cell('counter','300')]})).status,409,'another shop has no such price version');

  // an order made at the base price before any override stays exactly as it was
  const before=await f.quote();assert.equal(before.lines[0]!.unitPrice.amountMinor,'270');
  await freeScreen();const early=await f.create(before);const earlyId=early.order.id as string;

  // set counter 300 and table 250; online stays on the base price
  const s1=await put('owner',{priceVersion:version,expectedRevision:'0',set:[cell('counter','300'),cell('table','250')]});
  assert.equal(s1.status,200);assert.equal(s1.body.revision,'1');assert.deepEqual(s1.body.prices.map((p:any)=>p.channel+':'+p.unitMinor).sort(),['counter:300','table:250']);
  // no-op does not create a revision; stale expectedRevision is refused
  assert.equal((await put('owner',{priceVersion:version,expectedRevision:'1',set:[cell('counter','300')]})).body.revision,'1');
  assert.equal((await put('owner',{priceVersion:version,expectedRevision:'0',set:[cell('counter','310')]})).status,409);

  // counter quote follows the counter price; the older quote cannot be accepted any more (no silent repricing)
  await freeScreen();
  assert.equal((await f.quote()).lines[0]!.unitPrice.amountMinor,'300');
  assert.equal((await f.quote(2)).total.amountMinor,'600');
  await assert.rejects(f.create(before),code('QUOTE_CHANGED'));
  // the order made before the override is untouched
  const stored=await f.tenant(f.merchant,db=>db.query('SELECT total_minor::text t FROM order_authority WHERE order_id=$1',[earlyId]));assert.equal(stored.rows[0].t,'270');

  // table device quote uses the table price
  const sessionId=randomUUID();
  success(await f.command(f.b.id,{type:'CART_OPEN',sessionId,expectedScreenGeneration:'1',expectedAssignmentGeneration:'1',recoverSessionId:null} as any));
  success(await f.command(f.b.id,{type:'CART_SET',sessionId,expectedScreenGeneration:'2',expectedAssignmentGeneration:'1',expectedCartVersion:'0',items:[{productId:f.product,qty:2}]} as any));
  const reviewed=success(await f.command(f.b.id,{type:'CART_REVIEW',sessionId,cartVersion:'1',expectedScreenGeneration:'2',expectedPriceVersion:version} as any));
  assert.ok('quote' in reviewed);assert.equal(reviewed.quote.total.amountMinor,'500');

  // online menu (what mobile ordering quotes from) keeps the base price; the base menu is unchanged for tooling
  const menuOf=(ch:'counter'|'table'|'online'|null)=>f.tenant(f.merchant,async db=>(await effectiveCatalog(db,f.merchant,null,ch)).products.find(p=>p.id===f.product)!);
  assert.deepEqual(await Promise.all([menuOf('counter'),menuOf('table'),menuOf('online'),menuOf(null)]).then(r=>r.map(p=>p.unitPrice!.amountMinor)),['300','250','270','270']);

  // a catalog promotion is not stacked on a channel that has its own price; other channels keep it
  const expiresAt=new Date(Date.now()+600000).toISOString();
  await f.tenant(f.merchant,db=>productOffer(db,f.merchant,f.actor,'owner',f.product,'PUT',{priceVersion:version,expectedRevision:'0',enabled:true,basePriceMinor:'270',currentPriceMinor:'230',expiresAt,discount:{kind:'percent',percent:15}}));
  const withOffer=await Promise.all([menuOf('counter'),menuOf('online')]);
  assert.equal(withOffer[0]!.unitPrice!.amountMinor,'300');assert.equal(withOffer[0]!.promotion,null);
  assert.equal(withOffer[1]!.unitPrice!.amountMinor,'230');assert.ok(withOffer[1]!.promotion);

  // removing an override returns the channel to the base price and keeps the history (insert-only)
  const s2=await put('owner',{priceVersion:version,expectedRevision:'1',set:[cell('counter',null)]});
  assert.equal(s2.status,200);assert.equal(s2.body.revision,'2');assert.deepEqual(s2.body.prices.map((p:any)=>p.channel),['table']);
  assert.equal((await menuOf('counter'))!.unitPrice!.amountMinor,'230');
  const rows=(await f.tenant(f.merchant,db=>db.query('SELECT revision::int r,unit_minor::text u FROM catalog_channel_prices WHERE merchant_id=$1 AND channel=\'counter\' ORDER BY revision',[f.merchant]))).rows;
  assert.deepEqual(rows.map((r:any)=>[r.r,r.u]),[[1,'300'],[2,null]]);
  await assert.rejects(f.tenant(f.merchant,db=>db.query('UPDATE catalog_channel_prices SET unit_minor=1 WHERE merchant_id=$1',[f.merchant])),/immutable|permission denied/);
  await assert.rejects(f.tenant(f.merchant,db=>db.query('DELETE FROM catalog_channel_prices WHERE merchant_id=$1',[f.merchant])),/immutable|permission denied/);
  // another shop sees none of it
  assert.deepEqual((await call('other','GET','/api/settings/channel-prices')).body.prices,[]);
  assert.equal((await f.tenant(f.other,db=>db.query('SELECT 1 FROM catalog_channel_prices'))).rowCount,0);
  const audit=await f.tenant(f.merchant,db=>db.query("SELECT count(*)::int n FROM audit_logs WHERE merchant_id=$1 AND action='pricing.channel.update'",[f.merchant]));assert.equal(audit.rows[0].n,2);
 }finally{await new Promise(r=>server.close(r));}
});

test('VAT-exempt products: stay in the total, carry no VAT; the flag is owner-only, optimistic, and a receipt keeps the flag it was sold with',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 try{
  const water=randomUUID();
  await f.tenant(f.merchant,db=>db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'น้ำเปล่า','Water','',1,50)",[water,f.merchant]));
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'inclusive',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'0105500000001',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'V',staffMaxDiscountBps:2000})).status,200);
  assert.equal((await call('owner','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'10700'},{productId:water,priceMinor:'1000'}]})).status,200);
  // access + strict
  assert.equal((await call('staff','GET','/api/products/vat')).status,403);
  assert.equal((await call('manager','PUT',`/api/products/${water}/vat`,{vatExempt:true,expected:false})).status,403);
  for(const bad of [{vatExempt:true},{expected:false},{vatExempt:'yes',expected:false},{vatExempt:true,expected:false,x:1}])assert.equal((await call('owner','PUT',`/api/products/${water}/vat`,bad)).status,422);
  assert.equal((await call('owner','PUT',`/api/products/${randomUUID()}/vat`,{vatExempt:true,expected:false})).status,404);
  assert.equal((await call('other','PUT',`/api/products/${water}/vat`,{vatExempt:true,expected:false})).status,404);
  assert.equal((await call('owner','PUT',`/api/products/${water}/vat`,{vatExempt:true,expected:true})).status,409,'stale screen');

  const sale=(items:any[],discount:any=null,tender='100000')=>call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items,discount,tenderMinor:tender});
  // before the flag: 107.00 + 10.00 = 117.00 total, VAT 7.65 on the whole (inclusive 7%: 11700*7/107 = 765.4 -> net 10935, vat 765)
  const s0=(await sale([{productId:f.product,qty:1},{productId:water,qty:1}])).body.sale;
  assert.deepEqual([s0.totalMinor,s0.netMinor,s0.vatMinor],['11700','10935','765']);
  // flag water exempt
  const flagged=await call('owner','PUT',`/api/products/${water}/vat`,{vatExempt:true,expected:false});assert.equal(flagged.status,200);assert.equal(flagged.body.vatExempt,true);
  assert.equal((await call('manager','GET','/api/products/vat')).body.products.find((p:any)=>p.id===water).vatExempt,true);
  // same basket now: VAT only on the 107.00 part (700), the 10.00 stays in net
  const s1=(await sale([{productId:f.product,qty:1},{productId:water,qty:1}])).body.sale;
  assert.deepEqual([s1.totalMinor,s1.netMinor,s1.vatMinor],['11700','11000','700']);
  assert.deepEqual(s1.lines.map((l:any)=>l.vatExempt),[false,true]);
  // an exempt-only basket has no VAT at all
  const s2=(await sale([{productId:water,qty:3}])).body.sale;assert.deepEqual([s2.totalMinor,s2.netMinor,s2.vatMinor],['3000','3000','0']);
  // a bill discount is shared in proportion: 10% of 11700 = 1170; exempt part 1000*1170/11700 = 100 -> exempt 900, taxable 10600-... 
  const s3=(await call('manager','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1},{productId:water,qty:1}],discount:{kind:'percent',bps:1000},tenderMinor:'100000'})).body.sale;
  assert.equal(s3.discountMinor,'1170');assert.equal(s3.totalMinor,'10530');
  // exempt = 1000-100 = 900; taxable = 10530-900 = 9630; net_t = round(9630/1.07) = 9000; vat = 630; net = 900+9000
  assert.deepEqual([s3.netMinor,s3.vatMinor],['9900','630']);
  assert.equal(BigInt(s3.netMinor)+BigInt(s3.vatMinor),BigInt(s3.totalMinor));
  // the quote endpoint shows the same figures the sale will use
  const q=(await call('staff','POST','/api/cash/quote',{items:[{productId:f.product,qty:1},{productId:water,qty:1}],discount:null})).body;
  assert.deepEqual([q.totalMinor,q.netMinor,q.vatMinor,q.exemptMinor],['11700','11000','700','1000']);
  // un-flagging later does not rewrite what was sold
  assert.equal((await call('owner','PUT',`/api/products/${water}/vat`,{vatExempt:false,expected:true})).status,200);
  const again=(await call('staff','GET',`/api/cash/sales/${s1.id}`)).body.sale;assert.deepEqual([again.vatMinor,again.lines.map((l:any)=>l.vatExempt)],['700',[false,true]]);
  // idempotent no-op writes no audit row twice
  assert.equal((await call('owner','PUT',`/api/products/${water}/vat`,{vatExempt:false,expected:false})).status,200);
  const n=await f.tenant(f.merchant,db=>db.query("SELECT count(*)::int n FROM audit_logs WHERE merchant_id=$1 AND action='catalog.product.vat'",[f.merchant]));assert.equal(n.rows[0].n,2);
 }finally{
  await new Promise(r=>server.close(r));
  // the cash tables are shared by DB-level tests that count rows: leave none behind
  const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});const c=await admin.connect();
  try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings','cash_drawer_openings'])await c.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]);await c.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind='CASH_SALE'",[f.merchant]);await c.query('COMMIT');}catch{await c.query('ROLLBACK');}finally{c.release();await admin.end();}
 }
});
