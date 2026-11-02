import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
// Needs a throwaway Postgres with migrations through 183 applied (CHANNEL_TEST_DB). Skipped otherwise. Fixture data only.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {saveSettings,getSettings,putPrices,getPrices}=await import('../apps/api/src/cash/settings');
const {createCashSale,quoteCashSale,voidCashSale,getCashSale,listCashSales}=await import('../apps/api/src/cash/sales');
const {salesReport}=await import('../apps/api/src/reports');
const {shiftsRequest}=await import('../apps/api/src/shifts');
const {addBarcode,lookupBarcode,removeBarcode,listBarcodes}=await import('../apps/api/src/cash/barcodes');
const M=randomUUID(),N=randomUUID(),P1=randomUUID(),P2=randomUUID(),PN=randomUUID();
const settings=(over:Record<string,unknown>={})=>({enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'R',staffMaxDiscountBps:0,...over});
type Db=pg.PoolClient;
async function withDb(fn:(db:Db)=>Promise<void>,opts:{stock?:number;configure?:boolean}={}){
 const c=new pg.Client({connectionString:url});await c.connect();const db=c as unknown as Db;
 try{await c.query('BEGIN');await c.query('SET LOCAL search_path=bitpos,public');
  for(const m of [M,N])await c.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Cash test',$2)",[m,'1'.repeat(32)]);
  for(const [m,p] of [[M,P1],[M,P2],[N,PN]])await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ลาเต้','Latte','x',100,$3)",[m,p,opts.stock??10]);
  if(opts.configure!==false){await saveSettings(db,M,'o','owner',settings());await putPrices(db,M,'o','owner',{set:[{productId:P1,priceMinor:'6500'},{productId:P2,priceMinor:'5500'}]});}
  await fn(db);}
 finally{await c.query('ROLLBACK');await c.end();}
}
const rows=async(db:Db,sql:string,a:unknown[]=[])=>(await db.query(sql,a)).rows;
const stock=async(db:Db,p=P1)=>(await rows(db,'SELECT stock FROM products WHERE id=$1',[p]))[0].stock as number;
const sale=(over:Record<string,unknown>={})=>({idempotencyKey:randomUUID(),items:[{productId:P1,qty:2},{productId:P2,qty:1}],discount:null,tenderMinor:'20000',...over});
const sp=async(db:Db,fn:()=>Promise<unknown>)=>{await db.query('SAVEPOINT s');try{await fn();}finally{await db.query('ROLLBACK TO s');}};
const rejectsWith=async(db:Db,fn:()=>Promise<unknown>,code:RegExp)=>{await db.query('SAVEPOINT r');await assert.rejects(fn(),code);await db.query('ROLLBACK TO r');};

test('a sale is priced on the server, numbered, stored as a snapshot and takes stock through the ledger',integration,()=>withDb(async db=>{
 const r=await createCashSale(db,M,'cashier-1','staff',sale());
 const s=r.sale;
 assert.deepEqual([r.replayed,s.receiptNo,s.status,s.subtotalMinor,s.totalMinor,s.changeMinor,s.vatMinor],[false,'R000001','PAID','18500','18500','1500','0']);
 assert.deepEqual(s.lines.map(l=>[l.qty,l.unitMinor,l.lineTotalMinor,l.name]),[[2,'6500','13000','ลาเต้'],[1,'5500','5500','ลาเต้']]);
 assert.equal(await stock(db,P1),8);assert.equal(await stock(db,P2),9);
 const led=await rows(db,"SELECT kind,delta,reference,actor FROM stock_movements WHERE kind='CASH_SALE' ORDER BY delta");
 assert.deepEqual(led.map(x=>[x.kind,x.delta,x.reference,x.actor]),[['CASH_SALE',-2,'R000001','cashier-1'],['CASH_SALE',-1,'R000001','cashier-1']]);
 // later price changes never rewrite an old receipt
 await putPrices(db,M,'o','owner',{set:[{productId:P1,priceMinor:'9900'}]});
 assert.equal((await getCashSale(db,M,'staff',s.id)).sale.lines[0].unitMinor,'6500');
}));
test('replaying the same request returns the same sale; a different body under the same key is refused',integration,()=>withDb(async db=>{
 const body=sale();
 const a=await createCashSale(db,M,'c','staff',body),b=await createCashSale(db,M,'c','staff',body);
 assert.deepEqual([a.sale.id===b.sale.id,b.replayed,await stock(db,P1)],[true,true,8]);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',{...body,tenderMinor:'30000'}),/IDEMPOTENCY_CONFLICT/);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM cash_sales'))[0].n,1);
}));
test('receipt numbers run without gaps and a refused sale does not use one',integration,()=>withDb(async db=>{
 const n1=(await createCashSale(db,M,'c','staff',sale())).sale.receiptNo;
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({tenderMinor:'100'})),/INVALID_PRICE/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:99}]})),/STOCK_UNAVAILABLE/);
 const n2=(await createCashSale(db,M,'c','staff',sale())).sale.receiptNo;
 assert.deepEqual([n1,n2],['R000001','R000002']);
}));
test('stock rules: never below reserved, missing price, module disabled, unknown product',integration,()=>withDb(async db=>{
 await db.query('UPDATE products SET reserved=9 WHERE id=$1',[P1]);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:2}]})),/STOCK_UNAVAILABLE/);
 await createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:1}]}));
 await putPrices(db,M,'o','owner',{clear:[P2]});
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({items:[{productId:P2,qty:1}]})),/INVALID_PRICE/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({items:[{productId:randomUUID(),qty:1}]})),/RESOURCE_NOT_FOUND/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({items:[{productId:PN,qty:1}]})),/RESOURCE_NOT_FOUND/); // another shop's product
 await saveSettings(db,M,'o','owner',settings({enabled:false}));
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:1}]})),/CONFIGURATION_REQUIRED/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','customer',sale()),/ROLE_REQUIRED/);
}));
test('discount: staff only within the owner-set limit; owner and manager up to just under 100%',integration,()=>withDb(async db=>{
 const pct=(bps:number)=>sale({discount:{kind:'percent',bps}});
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',pct(100)),/ROLE_REQUIRED/);           // default limit 0
 await saveSettings(db,M,'o','owner',settings({staffMaxDiscountBps:1000}));
 const ok=await createCashSale(db,M,'c','staff',pct(1000));
 assert.deepEqual([ok.sale.discountMinor,ok.sale.totalMinor],['1850','16650']);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',pct(1001)),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale({discount:{kind:'amount',minor:'1851'}})),/ROLE_REQUIRED/); // amount counts as its percentage, rounded up
 assert.equal((await createCashSale(db,M,'m','manager',pct(5000))).sale.discountMinor,'9250');
 assert.equal((await createCashSale(db,M,'o','owner',sale({discount:{kind:'amount',minor:'18499'},tenderMinor:'100'}))).sale.totalMinor,'1');
 await rejectsWith(db,()=>createCashSale(db,M,'o','owner',sale({discount:{kind:'amount',minor:'18500'}})),/INVALID_PRICE/);
 const q=await quoteCashSale(db,M,'staff',{items:[{productId:P1,qty:1}],discount:null});
 assert.deepEqual([q.totalMinor,q.tenderMinor,q.changeMinor],['6500',null,null]);
}));
test('tax-inclusive sale stores net and VAT that add up to the total, with the seller snapshot',integration,()=>withDb(async db=>{
 await rejectsWith(db,()=>saveSettings(db,M,'o','owner',settings({vatMode:'inclusive'})),/INVALID_REQUEST/);        // needs seller name + tax id
 await rejectsWith(db,()=>saveSettings(db,M,'o','owner',settings({vatMode:'inclusive',sellerName:'ร้านทดสอบ',sellerTaxId:'123'})),/INVALID_REQUEST/);
 await saveSettings(db,M,'o','owner',settings({vatMode:'inclusive',sellerName:'ร้านทดสอบ',sellerTaxId:'0105500000001',sellerAddress:'1 ถนนทดสอบ',receiptPrefix:'T'}));
 const s=(await createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:1}],tenderMinor:'10000'}))).sale;
 assert.deepEqual([s.totalMinor,s.netMinor,s.vatMinor,s.vatMode,s.receiptNo],['6500','6075','425','inclusive','T000001']);
 assert.equal(BigInt(s.netMinor)+BigInt(s.vatMinor),BigInt(s.totalMinor));
 assert.deepEqual([s.seller.name,s.seller.taxId,s.seller.branch],['ร้านทดสอบ','0105500000001','00000']);
 // changing the shop's tax profile later does not rewrite the stored sale
 await saveSettings(db,M,'o','owner',settings({vatMode:'none'}));
 assert.equal((await getCashSale(db,M,'staff',s.id)).sale.vatMode,'inclusive');
}));
test('settings: owner only, and the currency cannot change once prices exist',integration,()=>withDb(async db=>{
 await rejectsWith(db,()=>saveSettings(db,M,'m','manager',settings()),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>saveSettings(db,M,'o','owner',settings({currency:'USD'})),/INVALID_REQUEST/);
 await rejectsWith(db,()=>saveSettings(db,M,'o','owner',{...settings(),extra:1}),/INVALID_REQUEST/);
 assert.equal((await getSettings(db,M,'staff')).settings.currency,'THB');
 await rejectsWith(db,()=>getSettings(db,M,'customer'),/ROLE_REQUIRED/);
 const prices=await getPrices(db,M,'staff');assert.deepEqual([prices.currency,prices.prices.length],['THB',2]);
 await rejectsWith(db,()=>putPrices(db,M,'s','staff',{set:[{productId:P1,priceMinor:'100'}]}),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>putPrices(db,M,'m','manager',{set:[{productId:PN,priceMinor:'100'}]}),/RESOURCE_NOT_FOUND/);
 await rejectsWith(db,()=>putPrices(db,M,'m','manager',{set:[{productId:P1,priceMinor:'0'}]}),/INVALID_REQUEST/);
 await rejectsWith(db,()=>putPrices(db,M,'m','manager',{set:[{productId:P1,priceMinor:'100'}],clear:[P1]}),/INVALID_REQUEST/);
}));
test('void: owner/manager with a reason, optional restock, never twice, receipt number kept',integration,()=>withDb(async db=>{
 const a=(await createCashSale(db,M,'c','staff',sale())).sale,b=(await createCashSale(db,M,'c','staff',sale())).sale;
 await rejectsWith(db,()=>voidCashSale(db,M,'c','staff',a.id,{reason:'x',restock:true}),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>voidCashSale(db,M,'m','manager',a.id,{reason:'  ',restock:true}),/INVALID_REQUEST/);
 assert.equal(await stock(db,P1),6);
 const v=(await voidCashSale(db,M,'m1','manager',a.id,{reason:'customer left',restock:true})).sale;
 assert.deepEqual([v.status,v.void?.by,v.void?.reason,v.void?.restocked,v.receiptNo],['VOIDED','m1','customer left',true,'R000001']);
 assert.equal(await stock(db,P1),8);
 assert.deepEqual((await rows(db,"SELECT delta FROM stock_movements WHERE kind='CASH_VOID_RETURN' ORDER BY delta")).map(x=>x.delta),[1,2]);
 await rejectsWith(db,()=>voidCashSale(db,M,'m','manager',a.id,{reason:'again',restock:true}),/INVALID_REQUEST/);
 await voidCashSale(db,M,'o','owner',b.id,{reason:'spoiled',restock:false});
 assert.equal(await stock(db,P1),8);  // not restocked
 const next=(await createCashSale(db,M,'c','staff',sale())).sale.receiptNo;assert.equal(next,'R000003');
 const list=(await listCashSales(db,M,'staff')).sales;assert.deepEqual(list.map(x=>x.status),['PAID','VOIDED','VOIDED']);
}));
test('a stored sale is history: only PAID to VOIDED is allowed, nothing can be deleted',integration,()=>withDb(async db=>{
 const s=(await createCashSale(db,M,'c','staff',sale())).sale;
 for(const sql of ["UPDATE cash_sales SET total_minor=total_minor+1,subtotal_minor=subtotal_minor+1","UPDATE cash_sales SET cashier='x'","DELETE FROM cash_sales","UPDATE cash_sale_lines SET qty=1","DELETE FROM cash_sale_lines","UPDATE cash_sales SET status='PAID'"])
  await rejectsWith(db,()=>db.query(sql),/immutable|cannot be deleted|check|violat/i);
 await db.query("UPDATE cash_sales SET status='VOIDED',voided_at=now(),voided_by='x',void_reason='r',void_restocked=false WHERE id=$1",[s.id]);
 await rejectsWith(db,()=>db.query("UPDATE cash_sales SET status='PAID',voided_at=NULL,voided_by=NULL,void_reason=NULL,void_restocked=NULL"),/immutable/);
}));
test('tenant isolation and grants as the app role',integration,()=>withDb(async db=>{
 await createCashSale(db,M,'c','staff',sale());
 await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[N]);
 for(const t of ['cash_sales','cash_sale_lines','cash_prices','cash_settings','cash_receipt_counters'])assert.equal((await rows(db,`SELECT count(*)::int n FROM ${t}`))[0].n,0,t);
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM cash_sales'))[0].n,1);
 await rejectsWith(db,()=>db.query('DELETE FROM cash_sales'),/permission denied/);
 await rejectsWith(db,()=>db.query('DELETE FROM cash_sale_lines'),/permission denied/);
 await rejectsWith(db,()=>db.query('DELETE FROM cash_receipt_counters'),/permission denied/);
 await rejectsWith(db,()=>db.query("INSERT INTO cash_prices(merchant_id,product_id,price_minor) VALUES($1,$2,100)",[N,PN]),/row-level security|violates/);
}));
test('barcodes: exact match, unique per shop, manager-managed, scanner-readable by staff',integration,()=>withDb(async db=>{
 await addBarcode(db,M,'m','manager',{productId:P1,barcode:'8850001112223'});
 assert.equal((await addBarcode(db,M,'m','manager',{productId:P1,barcode:'8850001112223'})).replayed,true);
 await rejectsWith(db,()=>addBarcode(db,M,'m','manager',{productId:P2,barcode:'8850001112223'}),/INVALID_REQUEST/);
 await rejectsWith(db,()=>addBarcode(db,M,'s','staff',{productId:P2,barcode:'8850009990000'}),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>addBarcode(db,M,'m','manager',{productId:PN,barcode:'8850009990000'}),/RESOURCE_NOT_FOUND/);
 await rejectsWith(db,()=>addBarcode(db,M,'m','manager',{productId:P2,barcode:'a b'}),/INVALID_REQUEST/);
 await addBarcode(db,N,'m','manager',{productId:PN,barcode:'8850001112223'}); // same code in another shop is a different record
 assert.deepEqual(await lookupBarcode(db,M,'staff','8850001112223'),{productId:P1,barcode:'8850001112223'});
 await rejectsWith(db,()=>lookupBarcode(db,M,'staff','885000111222'),/RESOURCE_NOT_FOUND/);   // one digit short is not a match
 await rejectsWith(db,()=>lookupBarcode(db,M,'customer','8850001112223'),/ROLE_REQUIRED/);
 await db.query('UPDATE products SET archived_at=now() WHERE id=$1',[P1]);
 await rejectsWith(db,()=>lookupBarcode(db,M,'staff','8850001112223'),/RESOURCE_NOT_FOUND/);
 assert.equal((await listBarcodes(db,M,'manager',null)).barcodes.length,1);
 await removeBarcode(db,M,'m','manager',{barcode:'8850001112223'});
 await rejectsWith(db,()=>removeBarcode(db,M,'m','manager',{barcode:'8850001112223'}),/RESOURCE_NOT_FOUND/);
}));

test('the shift close counts cash as its own group and leaves voided sales out',integration,()=>withDb(async db=>{
 const a=(await createCashSale(db,M,'c','staff',sale())).sale;await createCashSale(db,M,'c','staff',sale({tenderMinor:'18500'}));
 await voidCashSale(db,M,'m','manager',a.id,{reason:'oops',restock:false});
 const get=()=>shiftsRequest(db,M,'o','owner',new URL('http://x/api/shifts'),'GET',undefined) as Promise<{open:{snapshot:{groups:{currency:string;sourceKind:string;orders:number;totalMinor:string}[]}}}>;
 let g=(await get()).open.snapshot.groups.filter(x=>x.sourceKind==='cash_counter');
 assert.deepEqual(g.map(x=>[x.currency,x.orders,x.totalMinor]),[['THB',1,'18500']]);
 const closed=await shiftsRequest(db,M,'o','owner',new URL('http://x/api/shifts/close'),'POST',{idempotencyKey:randomUUID(),note:'',countedCash:{minor:'18500',currency:'THB',decimals:2}}) as {close:{snapshot:{groups:{sourceKind:string}[]}}};
 assert.ok(closed.close.snapshot.groups.some(x=>x.sourceKind==='cash_counter'));
 g=(await get()).open.snapshot.groups.filter(x=>x.sourceKind==='cash_counter');assert.deepEqual(g,[]);
}));

test('the whole flow also works as the app database role under row-level security (what production runs as)',integration,()=>withDb(async db=>{
 await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);
 await saveSettings(db,M,'o','owner',settings({vatMode:'inclusive',sellerName:'ร้าน',sellerTaxId:'0105500000001'}));
 await putPrices(db,M,'o','owner',{set:[{productId:P1,priceMinor:'6500'}]});
 await addBarcode(db,M,'m','manager',{productId:P1,barcode:'8850001112223'});
 const s=(await createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:2}],tenderMinor:'13000'}))).sale;
 assert.deepEqual([s.receiptNo.length,s.changeMinor,s.vatMinor],[7,'0','850']);
 assert.equal((await createCashSale(db,M,'c','staff',sale({idempotencyKey:'same',items:[{productId:P1,qty:1}],tenderMinor:'6500'}))).replayed,false);
 await voidCashSale(db,M,'m','manager',s.id,{reason:'r',restock:true});
 assert.equal((await listCashSales(db,M,'staff')).sales.length,2);
 await removeBarcode(db,M,'m','manager',{barcode:'8850001112223'});
}));
test('a tiny tax-inclusive total (a few satang) still stores: net never rounds to zero',integration,()=>withDb(async db=>{
 await saveSettings(db,M,'o','owner',settings({vatMode:'inclusive',sellerName:'ร้าน',sellerTaxId:'0105500000001'}));
 await putPrices(db,M,'o','owner',{set:[{productId:P1,priceMinor:'3'}]});
 const s=(await createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:1}],tenderMinor:'100'}))).sale;
 assert.deepEqual([s.totalMinor,s.netMinor,s.vatMinor],['3','3','0']);
 await putPrices(db,M,'o','owner',{set:[{productId:P1,priceMinor:'1'}]});
 const one=(await createCashSale(db,M,'c','staff',sale({items:[{productId:P1,qty:1}],tenderMinor:'100'}))).sale;
 assert.equal(BigInt(one.netMinor)+BigInt(one.vatMinor),1n);
}));

test('the sales report lists cash as its own source per day and hour, and leaves voided sales out',integration,()=>withDb(async db=>{
 const a=(await createCashSale(db,M,'c','staff',sale())).sale;await createCashSale(db,M,'c','staff',sale({tenderMinor:'18500'}));
 await voidCashSale(db,M,'m','manager',a.id,{reason:'oops',restock:false});
 const today=(await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') d")).rows[0].d as string;
 const r=await salesReport(db,M,'owner',new URL(`http://x/api/reports/sales?from=${today}&to=${today}`));
 const cash=r.days.flatMap(d=>d.groups).filter(g=>g.sourceKind==='cash_counter');
 assert.deepEqual(cash.map(g=>[g.currency,g.orders,g.totalMinor]),[['THB',1,'18500']]);
 assert.equal(r.hours.reduce((n,h)=>n+h.orders,0),1);
 await assert.rejects(salesReport(db,M,'staff',new URL(`http://x/api/reports/sales?from=${today}&to=${today}`)),/ROLE_REQUIRED/);
}));

test('the English shop name and address are saved and frozen on each receipt',integration,()=>withDb(async db=>{
 await saveSettings(db,M,'o','owner',settings({sellerName:'ร้านทดสอบ',sellerNameEn:'Test Cafe',sellerAddress:'1 ถนน',sellerAddressEn:'1 Test Rd'}));
 assert.deepEqual([(await getSettings(db,M,'staff')).settings.sellerNameEn,(await getSettings(db,M,'staff')).settings.sellerAddressEn],['Test Cafe','1 Test Rd']);
 const s=(await createCashSale(db,M,'c','staff',sale())).sale;
 assert.deepEqual([s.seller.name,s.seller.nameEn,s.seller.addressEn],['ร้านทดสอบ','Test Cafe','1 Test Rd']);
 await saveSettings(db,M,'o','owner',settings({sellerNameEn:'Renamed'}));
 assert.equal((await getCashSale(db,M,'staff',s.id)).sale.seller.nameEn,'Test Cafe');
}));

// Real concurrency: two connections commit for real (cleaned up afterwards); the row locks and the unique keys are what is tested.
test('two cashiers selling the last unit at once: exactly one succeeds and numbers stay gapless',integration,async()=>{
 const m=randomUUID(),p=randomUUID(),admin=new pg.Client({connectionString:url});await admin.connect();
 const open=async()=>{const c=new pg.Client({connectionString:url});await c.connect();await c.query('SET search_path=bitpos,public');return c;};
 try{
  await admin.query('SET search_path=bitpos,public');
  await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Race cash',$2)",[m,'1'.repeat(32)]);
  await admin.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'T','T','x',100,1)",[m,p]);
  await saveSettings(admin as unknown as Db,m,'o','owner',settings());
  await putPrices(admin as unknown as Db,m,'o','owner',{set:[{productId:p,priceMinor:'5000'}]});
  const run=async()=>{const c=await open();try{await c.query('BEGIN');const r=await createCashSale(c as unknown as Db,m,'c','staff',{idempotencyKey:randomUUID(),items:[{productId:p,qty:1}],discount:null,tenderMinor:'5000'});await c.query('COMMIT');return r.sale.receiptNo;}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}};
  const results=await Promise.allSettled([run(),run()]);
  assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);
  assert.equal((results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value,'R000001');
  assert.equal((await admin.query('SELECT stock FROM products WHERE id=$1',[p])).rows[0].stock,0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM cash_sales WHERE merchant_id=$1',[m])).rows[0].n,1);
 }finally{
  await admin.query('SET session_replication_role=replica');
  for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings','stock_movements','audit_logs','products'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[m]);
  await admin.query('DELETE FROM merchants WHERE id=$1',[m]);await admin.end();
 }
});
