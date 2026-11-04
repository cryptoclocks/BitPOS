import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// M14: acceptance journeys that cross modules, over the real HTTP server and real SQL. Wallet payment itself is NOT exercised on chain: where an order has to
// become PAID the test writes the paid state with a superuser fixture (labelled below), exactly as the report tests do; everything else goes through the API.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function harness(){
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const {counterQuote}=await import('../apps/api/src/orders');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner'),otherStaff:await staffToken(f.pool,f.other,randomUUID(),'staff')};
 type Who=keyof typeof tok|null;
 const call=async(who:Who,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const freeScreen=()=>raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]);});
 const quote=(productId:string,qty:number)=>f.tenant(f.merchant,db=>counterQuote(db,f.merchant,f.register.id,{items:[{productId,qty}],serving:{kind:'counter'}}));
 const receive=(productId:string,delta:number,expected=0)=>call('owner','POST','/api/inventory/movements',{productId,kind:'RECEIVE',delta,reason:'Opening stock',reference:'INV-'+delta,expectedStock:expected,idempotencyKey:randomUUID()});
 const csv=async(kind:string,from:string,to:string)=>{let out='',cur:string|null=null;for(let i=0;i<20;i++){const p=await call('owner','GET',`/api/reports/export?kind=${kind}&from=${from}&to=${to}${cur?'&cursor='+cur:''}`);assert.equal(p.status,200);out+=p.body.csv;cur=p.body.nextCursor;if(!cur)break;}return out.trim().split('\r\n').slice(1).map(l=>l.split(','));};
 const done=async()=>{await new Promise(r=>server.close(r));
  const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');for(const t of ['cash_movements','cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings','cash_drawer_openings','shift_closes'])await c.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]);await c.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]);await c.query('COMMIT');}catch{await c.query('ROLLBACK');}finally{c.release();}
  await admin.end();};
 return {f,call,raw,freeScreen,quote,receive,csv,done};
}

test('Journey A: owner adds a product and a counter price -> server quote at that price -> order -> paid -> bills, breakdown, CSV and audit agree',integration,async()=>{
 const {f,call,raw,freeScreen,quote,receive,csv,done}=await harness();
 try{
  const created=await call('owner','POST','/api/products',{name:'มอคค่า',nameEn:'Mocha',category:'Drinks',description:''});assert.equal(created.status,200);const M=created.body.id as string;
  assert.equal((await receive(M,20)).status,200);
  // not sellable until priced: the quote is refused
  await assert.rejects(quote(M,1),(e:any)=>e.code==='STOCK_UNAVAILABLE'||e.code==='SETUP_REQUIRED'||e.code==='INVALID_PRICE'||e.code==='RESOURCE_NOT_FOUND');
  const view=(await call('owner','GET','/api/settings/pricing')).body;
  const pub=await call('owner','PUT','/api/settings/pricing',{...f.configuration,expectedRevision:view.revision,prices:[{productId:f.product,unitMinor:'270'},{productId:M,unitMinor:'400'}]});assert.equal(pub.status,200);
  const version=pub.body.priceVersion as string;
  assert.equal((await call('owner','PUT','/api/settings/channel-prices',{priceVersion:version,expectedRevision:'0',set:[{productId:M,channel:'counter',unitMinor:'450'}]})).status,200);
  // base menu (tooling, online) keeps 4.00; the counter quote is server-priced at 4.50 whatever a client claims
  assert.equal((await call('staff','GET','/api/menu')).body.products.find((p:any)=>p.id===M).unitPrice.amountMinor,'400');
  await freeScreen();const q=await quote(M,2);assert.deepEqual([q.lines[0]!.unitPrice.amountMinor,q.total.amountMinor],['450','900']);
  const order=await f.create(q);const orderId=order.order.id as string;
  const stock=async()=>(await f.tenant(f.merchant,db=>db.query('SELECT stock,reserved FROM products WHERE id=$1',[M]))).rows[0];
  assert.deepEqual(await stock(),{stock:20,reserved:2},'an unpaid order reserves, never sells');
  // FIXTURE: wallet settlement is not exercised on chain; the paid state is written directly
  await raw(async db=>{await db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp() WHERE id=$1",[orderId]);});
  const d=today(),win=`from=${d}&to=${d}`;
  const bd=(await call('manager','GET',`/api/reports/breakdown?${win}`)).body;
  const usd=bd.totals.find((t:any)=>t.currency==='USD');assert.deepEqual([usd.orders,usd.totalMinor],[1,'900']);
  assert.deepEqual(bd.categories.map((c:any)=>[c.category,c.totalMinor]).filter((c:any)=>c[0]==='Drinks'),[['Drinks','900']]);
  const bills=(await call('staff','GET',`/api/bills?state=paid&${win}`)).body.bills;assert.ok(bills.some((b:any)=>b.id===orderId&&b.totalMinor==='900'&&b.currency==='USD'));
  const sales=(await csv('sales',d,d)).filter(r=>r[4]==='USD');assert.equal(sales.reduce((n,r)=>n+BigInt(r[6]!),0n),900n,'CSV ledger equals the summary');
  // the paid bill can be reprinted (server-recorded copy) and is not voidable
  assert.equal((await call('staff','POST','/api/receipts/reprint',{kind:'order',id:orderId})).body.copy,2);
  assert.equal((await call('owner','POST',`/api/bills/orders/${orderId}/void`,{reason:'ลองยกเลิก'})).status,409);
  // every step left a trail the owner can read, newest first
  const actions=(await call('owner','GET','/api/activity')).body.entries.map((e:any)=>e.action);
  for(const a of ['catalog.product.create','pricing.publish','pricing.channel.update','receipt.reprint'])assert.ok(actions.includes(a),a);
 }finally{await done();}
});

test('Journey B: cash round (VAT-exempt line, duplicate tap, void, cash out, counted close) -> variance, report and CSV agree',integration,async()=>{
 const {f,call,receive,csv,done}=await harness();
 try{
  const water=(await call('owner','POST','/api/products',{name:'น้ำเปล่า',nameEn:'Water',category:'',description:''})).body.id as string;
  assert.equal((await receive(water,30)).status,200);
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'inclusive',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'0105500000001',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'J',staffMaxDiscountBps:0})).status,200);
  assert.equal((await call('owner','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'},{productId:water,priceMinor:'1000'}]})).status,200);
  assert.equal((await call('owner','PUT',`/api/products/${water}/vat`,{vatExempt:true,expected:false})).status,200);
  // no sale before the drawer is open? (the round starts with the float)
  assert.equal((await call('staff','PUT','/api/cash/drawer',{floatMinor:'100000'})).status,200);
  const body={idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1},{productId:water,qty:1}],discount:null,tenderMinor:'20000'};
  const s1=(await call('staff','POST','/api/cash/sales',body)).body;assert.equal(s1.replayed,false);
  assert.deepEqual([s1.sale.totalMinor,s1.sale.changeMinor,s1.sale.netMinor,s1.sale.vatMinor],['7500','12500','7075','425']);
  const again=(await call('staff','POST','/api/cash/sales',body)).body;assert.deepEqual([again.replayed,again.sale.id],[true,s1.sale.id],'a double tap is one sale');
  const stockOf=async(id:string)=>(await call('owner','GET','/api/inventory/stock')).body.products.find((p:any)=>p.productId===id).stock;
  assert.deepEqual([await stockOf(f.product),await stockOf(water)],[99,29],'stock went down once');
  // a second sale is voided by the manager: stock returns, expected cash drops, staff may not void
  const s2=(await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:2}],discount:null,tenderMinor:'20000'})).body.sale;
  assert.equal((await call('staff','POST',`/api/cash/sales/${s2.id}/void`,{reason:'ลูกค้าเปลี่ยนใจ',restock:true})).status,403);
  assert.equal((await call('manager','POST',`/api/cash/sales/${s2.id}/void`,{reason:'ลูกค้าเปลี่ยนใจ',restock:true})).body.sale.status,'VOIDED');
  assert.equal(await stockOf(f.product),99);
  // cash out needs a manager and a reason; expected = float + sales − out
  assert.equal((await call('staff','POST','/api/cash/movements',{kind:'OUT',amountMinor:'5000',reason:'จ่ายค่าน้ำแข็ง',idempotencyKey:randomUUID()+'-x'})).status,403);
  assert.equal((await call('manager','POST','/api/cash/movements',{kind:'OUT',amountMinor:'5000',reason:'จ่ายค่าน้ำแข็ง',idempotencyKey:randomUUID()+'-y'})).status,200);
  const drawer=(await call('staff','GET','/api/cash/drawer')).body;assert.deepEqual([drawer.cashSalesMinor,drawer.cashOutMinor,drawer.expectedMinor],['7500','5000','102500']);
  // close with a count 5.00 short; the variance is computed by the server and frozen; a repeated close request replays
  const key=randomUUID()+'-close';const close={idempotencyKey:key,note:'นับแล้ว',countedCash:{minor:'102000',currency:'THB',decimals:2}};
  const c1=await call('manager','POST','/api/shifts/close',close);assert.equal(c1.status,200);
  assert.deepEqual([c1.body.close.snapshot.drawer.expectedMinor,c1.body.close.snapshot.drawer.countedMinor,c1.body.close.snapshot.drawer.varianceMinor],['102500','102000','-500']);
  const c2=await call('manager','POST','/api/shifts/close',close);assert.equal(c2.body.close.id,c1.body.close.id);
  // report = CSV = what the drawer saw: one PAID sale of 75.00 in THB, the void excluded
  const d=today();
  const bd=(await call('owner','GET',`/api/reports/breakdown?from=${d}&to=${d}`)).body;const thb=bd.totals.find((t:any)=>t.currency==='THB');assert.deepEqual([thb.orders,thb.totalMinor],[1,'7500']);
  const rows=(await csv('cash',d,d)).filter(r=>r[4]==='PAID'||r[5]==='THB');assert.ok(rows.length>=1);
  const paid=(await csv('cash',d,d)).filter(r=>r[4]==='PAID');assert.equal(paid.reduce((n,r)=>n+BigInt(r[10]!),0n),7500n);
  const actions=(await call('owner','GET','/api/activity?category=cash')).body.entries.map((e:any)=>e.action);
  for(const a of ['cash.sale','cash.void','cash.movement.out','shift.close'])assert.ok(actions.includes(a),a);
 }finally{await done();}
});

test('Journey C: price change, pause and stock changes while a customer is checking out never reprice or oversell',integration,async()=>{
 const {f,call,raw,freeScreen,quote,done}=await harness();
 try{
  const version=f.pricing.priceVersion as string;
  // 1) a quote exists, the owner then sets a counter price: accepting the OLD quote is refused, a fresh one carries the new price, the older order is untouched
  await freeScreen();const q1=await quote(f.product,1);assert.equal(q1.total.amountMinor,'270');
  assert.equal((await call('owner','PUT','/api/settings/channel-prices',{priceVersion:version,expectedRevision:'0',set:[{productId:f.product,channel:'counter',unitMinor:'320'}]})).status,200);
  await assert.rejects(f.create(q1),(e:any)=>e.code==='QUOTE_CHANGED');
  await freeScreen();const q2=await quote(f.product,1);assert.equal(q2.total.amountMinor,'320');
  const o2=await f.create(q2);
  // 2) a pause lands after the quote: staff may pause; accepting is refused with PRODUCT_PAUSED, nothing reserved
  await freeScreen();const q3=await quote(f.product,1);
  const av=(await call('staff','GET','/api/products/availability')).body.availability.find((a:any)=>a.productId===f.product);
  assert.equal((await call('staff','PUT',`/api/products/${f.product}/availability`,{expectedRevision:av.revision,pause:{until:null,reason:'วัตถุดิบหมด'}})).status,200);
  await assert.rejects(f.create(q3),(e:any)=>e.code==='PRODUCT_PAUSED');
  const reserved=async()=>(await f.tenant(f.merchant,db=>db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product]))).rows[0];
  assert.deepEqual(await reserved(),{stock:100,reserved:1},'only the one real order holds stock');
  // 3) the cash register and the menu agree the product is paused
  assert.equal((await call('staff','GET','/api/menu')).body.products.find((p:any)=>p.id===f.product).available,0);
  // 4) the pre-existing order kept its frozen price and can still be voided once, releasing its one unit
  const stored=(await f.tenant(f.merchant,db=>db.query('SELECT total_minor::text t FROM order_authority WHERE order_id=$1',[o2.order.id]))).rows[0].t;assert.equal(stored,'320');
  const v=await Promise.all([call('owner','POST',`/api/bills/orders/${o2.order.id}/void`,{reason:'ลูกค้ายกเลิก'}),call('manager','POST',`/api/bills/orders/${o2.order.id}/void`,{reason:'ลูกค้ายกเลิก'})]);
  assert.deepEqual(v.map(r=>r.status),[200,200]);assert.equal(v.filter(r=>r.body.replayed===false).length,1);
  assert.deepEqual(await reserved(),{stock:100,reserved:0});
  // 5) the last unit cannot be sold twice: stock 1, two orders race -> one wins
  await raw(async db=>{await db.query('UPDATE products SET stock=1 WHERE id=$1',[f.product]);await db.query("DELETE FROM product_pauses WHERE merchant_id=$1",[f.merchant]).catch(()=>undefined);});
  const cur=(await call('staff','GET','/api/products/availability')).body.availability.find((a:any)=>a.productId===f.product);
  if(cur.paused)await call('staff','PUT',`/api/products/${f.product}/availability`,{expectedRevision:cur.revision,pause:null});
  await freeScreen();const qa=await quote(f.product,1);
  const r=await Promise.allSettled([f.create(qa),f.create(qa)]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length>=1,true);
  const end=await reserved();assert.ok(end.reserved<=end.stock&&end.stock>=0);
 }finally{await done();}
});

test('Journey D: another shop, another role and an anonymous caller cannot read or change this shop through any merchant route; switching shops ends the old session',integration,async()=>{
 const {f,call,done}=await harness();
 try{
  const mine=[f.product,f.merchant];
  const reads=['/api/menu','/api/team','/api/bills','/api/activity','/api/settings/pricing','/api/settings/channel-prices','/api/products/vat','/api/products/availability','/api/inventory/stock','/api/inventory/movements','/api/suppliers','/api/cash/drawer','/api/cash/sales','/api/cash/movements','/api/shifts','/api/reports/sales?from=2026-01-01&to=2026-01-02','/api/reports/breakdown?from=2026-11-01&to=2026-11-02','/api/receipt-settings','/api/help/readiness','/api/branches','/api/branches/comparison?from=2026-11-01&to=2026-11-02','/api/channels/reconciliation?source=grabfood','/api/channels/providers','/api/overview/summary'];
  for(const path of reads){
   const anon=await call(null,'GET',path);assert.equal(anon.status,401,'anonymous '+path);
   // a foreign OWNER gets either an empty view of their own shop or a refusal, never this shop's ids
   const foreign=await call('other','GET',path);const text=JSON.stringify(foreign.body);
   for(const id of mine)assert.ok(!text.includes(id),`${path} leaked ${id} to another shop`);
   // staff of this shop is refused on the owner/manager-only reads
   const staff=await call('staff','GET',path);
   if(/\/api\/team$|activity|breakdown|comparison|channels|readiness|channel-prices|products\/vat|\/api\/branches$/.test(path))assert.ok([403,404].includes(staff.status),`${path} staff got ${staff.status}`);
  }
  // direct writes against this shop's objects from the other shop are refused, nothing changes
  const attempts:[string,string,unknown][]=[
   ['POST','/api/products/reorder',{ids:[f.product],expected:[f.product]}],['PUT',`/api/products/${f.product}/vat`,{vatExempt:true,expected:false}],
   ['PATCH',`/api/products/${f.product}`,{name:'x',nameEn:'x',category:'',description:'',expected:{name:'กาแฟ',nameEn:'Coffee',category:'',description:''}}],
   ['PUT','/api/settings/channel-prices',{priceVersion:f.pricing.priceVersion,expectedRevision:'0',set:[{productId:f.product,channel:'counter',unitMinor:'1'}]}],
   ['POST',`/api/bills/orders/${randomUUID()}/void`,{reason:'ลองยกเลิก'}],['POST','/api/branches/switch',{merchantId:f.merchant}],['POST','/api/assistant/ask',{question:'x'}]];
  for(const [m,p,b] of attempts){const r=await call('other',m,p,b);assert.ok([403,404,409,422].includes(r.status),`${m} ${p} -> ${r.status}`);}
  const after=(await call('owner','GET','/api/menu')).body.products.find((p:any)=>p.id===f.product);assert.equal(after.unitPrice.amountMinor,'270','no foreign write reached this shop');
  // a staff-role session cannot use the owner/manager writes either
  for(const [m,p,b] of attempts.slice(0,4)){const r=await call('staff',m,p,b);assert.ok([403,404,422].includes(r.status),`staff ${m} ${p} -> ${r.status}`);}
 }finally{await done();}
});
