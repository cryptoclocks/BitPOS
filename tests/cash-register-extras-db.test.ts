import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
// Options, add-ons, units, held bills, drawer float and the cash CSV. Needs a throwaway Postgres with migrations through 184 (CHANNEL_TEST_DB).
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {saveSettings,putPrices,getPrices,putAddons,getAddons}=await import('../apps/api/src/cash/settings');
const {createCashSale,quoteCashSale,voidCashSale,getCashSale}=await import('../apps/api/src/cash/sales');
const {getDrawer,openDrawer}=await import('../apps/api/src/cash/drawer');
const {holdBill,listHeld,recallHeld,discardHeld}=await import('../apps/api/src/cash/held');
const {shiftsRequest}=await import('../apps/api/src/shifts');
const exportsModule=await import('../apps/api/src/report-exports');
const M=randomUUID(),P1=randomUUID(),P2=randomUUID();
type Db=pg.PoolClient;
const settings=(over:Record<string,unknown>={})=>({enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'R',staffMaxDiscountBps:0,...over});
async function withDb(fn:(db:Db)=>Promise<void>,opts:{stock?:number;asApp?:boolean}={}){
 const c=new pg.Client({connectionString:url});await c.connect();const db=c as unknown as Db;
 try{await c.query('BEGIN');await c.query('SET LOCAL search_path=bitpos,public');
  await c.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Extras test',$2)",[M,'1'.repeat(32)]);
  for(const p of [P1,P2])await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ลาเต้','Latte','x',100,$3)",[M,p,opts.stock??10]);
  await saveSettings(db,M,'o','owner',settings());
  await putPrices(db,M,'o','owner',{set:[{productId:P1,priceMinor:'6500',unit:'แก้ว',sweetnessEnabled:true},{productId:P2,priceMinor:'5500'}]});
  if(opts.asApp){await c.query('SET LOCAL ROLE bitpos_app');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);}
  await fn(db);}
 finally{await c.query('ROLLBACK');await c.end();}
}
const rows=async(db:Db,sql:string,a:unknown[]=[])=>(await db.query(sql,a)).rows;
const rejectsWith=async(db:Db,fn:()=>Promise<unknown>,code:RegExp)=>{await db.query('SAVEPOINT r');await assert.rejects(fn(),code);await db.query('ROLLBACK TO r');};
const sale=(items:unknown[],over:Record<string,unknown>={})=>({idempotencyKey:randomUUID(),items,discount:null,tenderMinor:'100000',...over});
const addonsOf=async(db:Db,p=P1)=>(await getAddons(db,M,'staff')).addons.filter(a=>a.productId===p);

test('sweetness, paid add-ons and the unit are priced on the server and kept on the receipt',integration,()=>withDb(async db=>{
 await putAddons(db,M,'m','manager',{productId:P1,addons:[{label:'วิปครีม',labelEn:'Whipped cream',priceMinor:'1000'},{label:'ช็อตเพิ่ม',labelEn:'Extra shot',priceMinor:'1500'}]});
 const [whip,shot]=await addonsOf(db);
 const q=await quoteCashSale(db,M,'staff',{items:[{productId:P1,qty:2,sweetness:50,addonIds:[whip.id,shot.id]}],discount:null});
 assert.equal(q.subtotalMinor,String((6500+1000+1500)*2));
 const s=(await createCashSale(db,M,'c','staff',sale([{productId:P1,qty:2,sweetness:50,addonIds:[shot.id,whip.id]},{productId:P2,qty:1}]))).sale;
 assert.deepEqual(s.lines.map(l=>[l.qty,l.unit,l.sweetness,l.baseMinor,l.unitMinor,l.addons.map(a=>a.label)]),[[2,'แก้ว',50,'6500','9000',['ช็อตเพิ่ม','วิปครีม']],[1,'',null,'5500','5500',[]]]);
 // later changes never rewrite the receipt
 await putAddons(db,M,'m','manager',{productId:P1,addons:[]});
 await putPrices(db,M,'m','manager',{set:[{productId:P1,priceMinor:'9900',unit:'ถ้วย'}]});
 const again=(await getCashSale(db,M,'staff',s.id)).sale.lines[0];
 assert.deepEqual([again.unit,again.unitMinor,again.addons.length],['แก้ว','9000',2]);
}));
test('options are validated: sweetness only where enabled, add-ons only of that product, no duplicate lines',integration,()=>withDb(async db=>{
 await putAddons(db,M,'m','manager',{productId:P2,addons:[{label:'นมโอ๊ต',priceMinor:'2000'}]});
 const other=(await addonsOf(db,P2))[0];
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale([{productId:P2,qty:1,sweetness:50}])),/INVALID_REQUEST/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale([{productId:P1,qty:1,addonIds:[other.id]}])),/RESOURCE_NOT_FOUND/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale([{productId:P1,qty:1,sweetness:30}])),/INVALID_REQUEST/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale([{productId:P1,qty:1,sweetness:50},{productId:P1,qty:2,sweetness:50}])),/INVALID_REQUEST/);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale([{productId:P2,qty:1,addonIds:[other.id,other.id]}])),/INVALID_REQUEST/);
 await rejectsWith(db,()=>putAddons(db,M,'s','staff',{productId:P1,addons:[]}),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>putAddons(db,M,'m','manager',{productId:P1,addons:[{id:randomUUID(),label:'x',priceMinor:'1'}]}),/RESOURCE_NOT_FOUND/);
}));
test('the same drink with different options is two lines but one stock pool and a consistent ledger',integration,()=>withDb(async db=>{
 await db.query('UPDATE products SET stock=5 WHERE id=$1',[P1]);
 const s=(await createCashSale(db,M,'c','staff',sale([{productId:P1,qty:2,sweetness:0},{productId:P1,qty:2,sweetness:100}]))).sale;
 assert.equal(s.lines.length,2);
 assert.equal((await rows(db,'SELECT stock FROM products WHERE id=$1',[P1]))[0].stock,1);
 const led=await rows(db,"SELECT stock_before,stock_after FROM stock_movements WHERE kind='CASH_SALE' ORDER BY stock_before DESC");
 assert.deepEqual(led.map(l=>[l.stock_before,l.stock_after]),[[5,3],[3,1]]);
 await rejectsWith(db,()=>createCashSale(db,M,'c','staff',sale([{productId:P1,qty:1,sweetness:0},{productId:P1,qty:1,sweetness:25}])),/STOCK_UNAVAILABLE/);
 await voidCashSale(db,M,'m','manager',s.id,{reason:'r',restock:true});
 assert.equal((await rows(db,'SELECT stock FROM products WHERE id=$1',[P1]))[0].stock,5);
}));
test('units and the sweetness switch are saved with the price and kept when only the price changes',integration,()=>withDb(async db=>{
 await putPrices(db,M,'m','manager',{set:[{productId:P1,priceMinor:'7000'}]});
 const p=(await getPrices(db,M,'staff')).prices.find(x=>x.productId===P1)!;
 assert.deepEqual([p.priceMinor,p.unit,p.sweetnessEnabled],['7000','แก้ว',true]);
 await putPrices(db,M,'m','manager',{set:[{productId:P1,priceMinor:'7000',unit:'',sweetnessEnabled:false}]});
 const q=(await getPrices(db,M,'staff')).prices.find(x=>x.productId===P1)!;assert.deepEqual([q.unit,q.sweetnessEnabled],['',false]);
}));
test('held bills: park under a label, recall once, discard by creator or manager, capped at 50',integration,()=>withDb(async db=>{
 const items=[{productId:P1,qty:2,sweetness:50}],discount={kind:'percent',bps:500};
 const h=(await holdBill(db,M,'alice','staff',{label:'โต๊ะ B1',items,discount})).held;
 assert.deepEqual([h.label,h.createdBy],['โต๊ะ B1','alice']);
 assert.equal((await rows(db,'SELECT stock FROM products WHERE id=$1',[P1]))[0].stock,10);   // nothing reserved
 assert.equal((await listHeld(db,M,'staff')).held.length,1);
 await rejectsWith(db,()=>discardHeld(db,M,'bob','staff',h.id),/ROLE_REQUIRED/);
 const back=(await recallHeld(db,M,'bob','staff',h.id)).held;
 assert.deepEqual([back.items,back.discount],[items,discount]);
 await rejectsWith(db,()=>recallHeld(db,M,'bob','staff',h.id),/RESOURCE_NOT_FOUND/);
 const h2=(await holdBill(db,M,'alice','staff',{label:'บาร์ 2',items:[{productId:P2,qty:1}],discount:null})).held;
 await discardHeld(db,M,'alice','staff',h2.id);
 const h3=(await holdBill(db,M,'alice','staff',{label:'x',items:[{productId:P2,qty:1}],discount:null})).held;
 await discardHeld(db,M,'mgr','manager',h3.id);
 await rejectsWith(db,()=>holdBill(db,M,'a','staff',{label:'',items,discount:null}),/INVALID_REQUEST/);
 await rejectsWith(db,()=>holdBill(db,M,'a','staff',{label:'ok',items:[{productId:randomUUID(),qty:1}],discount:null}),/RESOURCE_NOT_FOUND/);
 await rejectsWith(db,()=>holdBill(db,M,'a','customer',{label:'ok',items,discount:null}),/ROLE_REQUIRED/);
 for(let i=0;i<50;i++)await holdBill(db,M,'a','staff',{label:`b${i}`,items:[{productId:P2,qty:1}],discount:null});
 await rejectsWith(db,()=>holdBill(db,M,'a','staff',{label:'51st',items:[{productId:P2,qty:1}],discount:null}),/INVALID_REQUEST/);
}));
test('drawer: one opening float per round, expected cash = float + cash sales, frozen into the shift close',integration,()=>withDb(async db=>{
 assert.equal((await getDrawer(db,M,'staff')).opening,null);
 const d=await openDrawer(db,M,'alice','staff',{floatMinor:'200000'});
 assert.deepEqual([d.replayed,d.opening?.floatMinor,d.opening?.openedBy,d.expectedMinor],[false,'200000','alice','200000']);
 assert.equal((await openDrawer(db,M,'alice','staff',{floatMinor:'200000'})).replayed,true);
 await rejectsWith(db,()=>openDrawer(db,M,'bob','staff',{floatMinor:'1'}),/INVALID_REQUEST/);
 await rejectsWith(db,()=>openDrawer(db,M,'bob','customer',{floatMinor:'1'}),/ROLE_REQUIRED/);
 await rejectsWith(db,()=>openDrawer(db,M,'bob','staff',{floatMinor:'-5'}),/INVALID_REQUEST/);
 const a=(await createCashSale(db,M,'c','staff',sale([{productId:P2,qty:2}]))).sale;
 await createCashSale(db,M,'c','staff',sale([{productId:P2,qty:1}]));
 await voidCashSale(db,M,'m','manager',a.id,{reason:'r',restock:false});
 const now=await getDrawer(db,M,'staff');assert.deepEqual([now.cashSalesMinor,now.expectedMinor,now.orders],['5500','205500',1]);
 const closed=await shiftsRequest(db,M,'o','owner',new URL('http://x/api/shifts/close'),'POST',{idempotencyKey:randomUUID(),note:'',countedCash:{minor:'205000',currency:'THB',decimals:2}}) as {close:{snapshot:{drawer:{openingFloatMinor:string;cashSalesMinor:string;expectedMinor:string}|null}}};
 assert.deepEqual(closed.close.snapshot.drawer,{currency:'THB',decimals:2,openingFloatMinor:'200000',cashSalesMinor:'5500',cashInMinor:'0',cashOutMinor:'0',expectedMinor:'205500',countedMinor:'205000',varianceMinor:'-500'});
 assert.equal((await getDrawer(db,M,'staff')).opening,null);   // a new round starts without a float until one is recorded
}));
test('a round closed without an opening float has no drawer figure',integration,()=>withDb(async db=>{
 await createCashSale(db,M,'c','staff',sale([{productId:P2,qty:1}]));
 const closed=await shiftsRequest(db,M,'o','owner',new URL('http://x/api/shifts/close'),'POST',{idempotencyKey:randomUUID(),note:'',countedCash:null}) as {close:{snapshot:{drawer:unknown}}};
 assert.equal(closed.close.snapshot.drawer,null);
}));
test('cash CSV export: integer minor units, voids marked, paged, owner/manager only',integration,()=>withDb(async db=>{
 const a=(await createCashSale(db,M,'c','staff',sale([{productId:P2,qty:1}]))).sale;await createCashSale(db,M,'c','staff',sale([{productId:P1,qty:1}]));
 await voidCashSale(db,M,'m','manager',a.id,{reason:'r',restock:false});
 const today=(await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') d")).rows[0].d as string;
 const u=new URL(`http://x/api/reports/export?kind=cash&from=${today}&to=${today}`);
 const r=await exportsModule.reportExport(db,M,'o','owner',u);
 assert.equal(r.rows,2);
 const lines=r.csv.trim().split('\n');assert.ok(lines[0].startsWith('sale_id,receipt_no'));
 assert.ok(lines.some(l=>l.includes('R000001')&&l.includes('VOIDED')&&l.includes(',5500,')));
 assert.ok(lines.some(l=>l.includes('R000002')&&l.includes('PAID')&&l.includes(',6500,')));
 await rejectsWith(db,()=>exportsModule.reportExport(db,M,'s','staff',u),/ROLE_REQUIRED/);
}));
test('the extras also run as the app database role under row-level security',integration,()=>withDb(async db=>{
 await putAddons(db,M,'m','manager',{productId:P1,addons:[{label:'วิป',priceMinor:'1000'}]});
 const add=(await addonsOf(db))[0];
 const h=(await holdBill(db,M,'a','staff',{label:'T1',items:[{productId:P1,qty:1,addonIds:[add.id]}],discount:null})).held;
 await recallHeld(db,M,'a','staff',h.id);
 await openDrawer(db,M,'a','staff',{floatMinor:'100'});
 const s=(await createCashSale(db,M,'c','staff',sale([{productId:P1,qty:1,sweetness:25,addonIds:[add.id]}]))).sale;
 assert.equal(s.totalMinor,'7500');
 await putAddons(db,M,'m','manager',{productId:P1,addons:[]});
 assert.equal((await getDrawer(db,M,'staff')).expectedMinor,'7600');
},{asApp:true}));
