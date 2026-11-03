import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// M08: stock operations over the real HTTP server and SQL — supplier on receipts, ledger filters and paging, and "never oversell" when a counter
// order, a cash sale and a manual adjustment all go for the last unit at the same moment.
// Needs BITPOS_BACKEND_INTEGRATION=1 plus a throwaway Postgres with migrations through 190.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

async function harness(stock:number){
 const f=await tableFixture(stock);const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const cleanup=async()=>{server.close();const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');
  for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings'])await c.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]).catch(()=>undefined);
  await c.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]).catch(()=>undefined);await c.query('COMMIT');}catch{await c.query('ROLLBACK').catch(()=>undefined);}finally{c.release();await admin.end();}};
 return {f,call,cleanup};
}

test('receive names a supplier: same-shop active suppliers only, receipts only, replay-safe; ledger filters and paging; CSV carries the link',integration,async()=>{
 const {f,call,cleanup}=await harness(5);
 try{
  const mkSupplier=async(who:'owner'|'other',name:string)=>(await call(who,'POST','/api/suppliers',{name,idempotencyKey:randomUUID()})).body.supplier.id as string;
  const s1=await mkSupplier('owner','ร้านวัตถุดิบ A'),sOther=await mkSupplier('other','Foreign supplier');
  const move=(who:'owner'|'manager'|'staff'|'other',over:Record<string,unknown>={})=>call(who,'POST','/api/inventory/movements',{productId:f.product,kind:'RECEIVE',delta:2,reason:'Delivery',reference:'INV-1',expectedStock:5,idempotencyKey:randomUUID(),...over});
  assert.equal((await move('staff',{supplierId:s1})).status,403);
  // refusals leave stock untouched: unknown, another shop's, malformed, and a supplier on an adjustment
  assert.equal((await move('owner',{supplierId:randomUUID()})).status,404);
  assert.equal((await move('owner',{supplierId:sOther})).status,404,'another shop’s supplier is invisible');
  assert.equal((await move('owner',{supplierId:'nope'})).status,422);
  assert.equal((await move('owner',{kind:'ADJUST',delta:-1,supplierId:s1})).status,422);
  const key=randomUUID();
  const ok=await move('manager',{supplierId:s1,idempotencyKey:key});assert.deepEqual([ok.status,ok.body.replayed,ok.body.movement.supplierId,ok.body.movement.stockAfter],[200,false,s1,7]);
  const replay=await move('manager',{supplierId:s1,idempotencyKey:key});assert.deepEqual([replay.status,replay.body.replayed,replay.body.movement.id],[200,true,ok.body.movement.id]);
  assert.equal((await move('manager',{supplierId:null,idempotencyKey:key})).status,409,'same key with a different supplier is a conflict');
  // a deactivated supplier keeps its history but cannot take new receipts
  const sup=(await call('owner','GET','/api/suppliers')).body.suppliers.find((x:any)=>x.id===s1);
  assert.equal((await call('owner','PATCH','/api/suppliers/'+s1,{expectedVersion:sup.version,active:false})).status,200);
  const inactive=await move('owner',{supplierId:s1,expectedStock:7});assert.deepEqual([inactive.status,inactive.body.error?.code],[422,'SUPPLIER_INACTIVE']);
  assert.equal((await call('owner','GET','/api/inventory/stock')).body.products.find((p:any)=>p.productId===f.product).stock,7,'refusals changed nothing');
  // an unlinked receipt and an adjustment, then filter by kind and supplier
  assert.equal((await move('owner',{expectedStock:7,delta:1,reference:'no supplier'})).status,200);
  assert.equal((await move('owner',{kind:'ADJUST',delta:-1,reason:'Spoiled',expectedStock:8})).status,200);
  const ids=(q:string)=>call('owner','GET','/api/inventory/movements'+q).then(r=>{assert.equal(r.status,200,q);return r.body.movements as any[];});
  assert.deepEqual((await ids('?kind=ADJUST')).map(m=>m.kind),['ADJUST']);
  assert.deepEqual((await ids('?kind=RECEIVE')).map(m=>m.delta),[1,2]);
  assert.deepEqual((await ids('?supplierId='+s1)).map(m=>m.id),[ok.body.movement.id]);
  assert.deepEqual((await ids('?kind=ADJUST&supplierId='+s1)),[]);
  assert.equal((await ids('?kind=CASH_SALE')).length,0);
  for(const bad of ['?kind=NOPE','?supplierId=x','?x=1','?kind=ADJUST&kind=RECEIVE'])assert.equal((await call('owner','GET','/api/inventory/movements'+bad)).status,422,bad);
  assert.equal((await call('other','GET','/api/inventory/movements?supplierId='+s1)).body.movements.length,0);
  // paging: 60 more entries, 50 per page, newest first, no gaps or repeats, filters stay applied across pages
  let stock=7;for(let i=0;i<60;i++){const r=await move('owner',{kind:'ADJUST',delta:1,reason:'Count '+i,reference:'',expectedStock:stock});assert.equal(r.status,200);stock++;}
  const seen:string[]=[];let cursor:string|null=null;let pages=0;
  do{const p:any=await call('owner','GET','/api/inventory/movements?kind=ADJUST'+(cursor?'&cursor='+cursor:''));assert.equal(p.status,200);seen.push(...p.body.movements.map((m:any)=>m.id));cursor=p.body.nextCursor;pages++;}while(cursor&&pages<5);
  assert.equal(pages,2);assert.equal(seen.length,61);assert.equal(new Set(seen).size,61);
  // CSV: the supplier id is in the ledger export
  const sheet=await call('owner','GET',`/api/reports/export?kind=stock&from=${new Date(Date.now()-86400000).toISOString().slice(0,10)}&to=${new Date(Date.now()+86400000).toISOString().slice(0,10)}`);
  assert.equal(sheet.status,200);assert.ok(sheet.body.csv.split('\r\n')[0].endsWith(',supplier_id'));assert.ok(sheet.body.csv.includes(s1));
  // the link cannot be rewritten or the row removed by the application role
  await assert.rejects(f.tenant(f.merchant,async db=>{await db.query('SET LOCAL ROLE bitpos_app');await db.query('UPDATE stock_movements SET supplier_id=NULL WHERE id=$1',[ok.body.movement.id]);}),/permission denied|immutable/);
 }finally{await cleanup();}
});

test('the last unit goes to exactly one of: a counter order, a cash sale, a manual write-off — repeated, stock never negative or over-reserved',integration,async()=>{
 for(let round=0;round<3;round++){
  const {f,call,cleanup}=await harness(1);
  try{
   assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'H',staffMaxDiscountBps:0})).status,200);
   assert.equal((await call('manager','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'}]})).status,200);
   const quote=await f.quote(1);
   const results=await Promise.allSettled([
    f.create(quote),
    call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1}],tenderMinor:'10000'}).then(r=>{if(r.status!==200)throw Error(String(r.status));return r;}),
    call('owner','POST','/api/inventory/movements',{productId:f.product,kind:'ADJUST',delta:-1,reason:'Write off',reference:'',expectedStock:1,idempotencyKey:randomUUID()}).then(r=>{if(r.status!==200)throw Error(String(r.status));return r;}),
   ]);
   const won=results.map((r,i)=>r.status==='fulfilled'?i:-1).filter(i=>i>=0);
   assert.equal(won.length,1,`round ${round}: exactly one winner, got ${JSON.stringify(results.map(r=>r.status))}`);
   const p=(await f.tenant(f.merchant,async db=>(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0]));
   assert.ok(p.stock>=0&&p.reserved>=0&&p.reserved<=p.stock,JSON.stringify(p));
   // winner 0 (order): reserved 1 stock 1; winners 1/2 (cash sale, write-off): stock 0 and nothing reserved
   assert.deepEqual([p.stock,p.reserved],won[0]===0?[1,1]:[0,0]);
  }finally{await cleanup();}
 }
});
