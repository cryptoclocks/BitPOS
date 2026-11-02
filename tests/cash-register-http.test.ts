import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import pg from 'pg';
// End to end through the real HTTP server: session lookup, role from the members table, routing, strict bodies, error shapes.
// Needs a throwaway Postgres with migrations through 184 (CHANNEL_TEST_DB). The test data is committed and removed afterwards.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:url??'postgres://x',ADMIN_DATABASE_URL:url??'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {hash}=await import('../packages/domain/src/index');
const M=randomUUID(),P1=randomUUID(),P2=randomUUID();
const USERS={owner:randomUUID(),manager:randomUUID(),staff:randomUUID()};
const TOKEN=Object.fromEntries(Object.keys(USERS).map(r=>[r,`tok-${r}-${randomUUID()}`])) as Record<keyof typeof USERS,string>;

test('cash register, barcodes, held bills, drawer, shift and reports over real HTTP with real roles',integration,async()=>{
 const {server}=await import('../apps/api/src/index');const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query('SET search_path=bitpos,public');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const call=async(role:keyof typeof USERS|null,method:string,path:string,body?:unknown)=>{
  const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${TOKEN[role]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json() as any};
 };
 try{
  await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Http cash',$2)",[M,'1'.repeat(32)]);
  for(const p of [P1,P2])await admin.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ลาเต้','Latte','x',100,20)",[M,p]);
  for(const r of Object.keys(USERS) as (keyof typeof USERS)[]){
   await admin.query('INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,$3)',[USERS[r],M,r]);
   await admin.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[hash(TOKEN[r]),USERS[r],M,r]);
  }
  // no token, wrong role, strict bodies
  assert.equal((await call(null,'GET','/api/cash/settings')).status,401);
  assert.equal((await call('staff','PUT','/api/cash/settings',{enabled:true})).status,403);
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true})).status,422);
  const settings={enabled:true,currency:'THB',decimals:2,vatMode:'inclusive',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'0105500000001',sellerBranch:'00000',sellerAddress:'1 ถนนทดสอบ',receiptPrefix:'H',staffMaxDiscountBps:1000};
  assert.equal((await call('manager','PUT','/api/cash/settings',settings)).status,403);
  assert.equal((await call('owner','PUT','/api/cash/settings',settings)).status,200);
  assert.equal((await call('staff','GET','/api/cash/settings')).body.settings.sellerTaxId,'0105500000001');
  // prices, add-ons, barcodes
  assert.equal((await call('staff','PUT','/api/cash/prices',{set:[{productId:P1,priceMinor:'6500'}]})).status,403);
  assert.equal((await call('manager','PUT','/api/cash/prices',{set:[{productId:P1,priceMinor:'6500',unit:'แก้ว',sweetnessEnabled:true},{productId:P2,priceMinor:'5500'}]})).status,200);
  assert.equal((await call('manager','PUT','/api/cash/addons',{productId:P1,addons:[{label:'วิปครีม',labelEn:'Whip',priceMinor:'1000'}]})).status,200);
  const addon=(await call('staff','GET','/api/cash/addons')).body.addons[0];assert.equal(addon.priceMinor,'1000');
  assert.equal((await call('manager','PUT','/api/barcodes',{productId:P1,barcode:'8850001112223'})).status,200);
  assert.equal((await call('staff','PUT','/api/barcodes',{productId:P2,barcode:'8850001112224'})).status,403);
  assert.equal((await call('staff','GET','/api/barcodes/lookup?code=8850001112223')).body.productId,P1);
  assert.equal((await call('staff','GET','/api/barcodes/lookup?code=8850001112220')).status,404);
  assert.equal((await call('staff','GET','/api/barcodes')).status,403);
  assert.equal((await call('manager','GET',`/api/barcodes?productId=${P1}`)).body.barcodes.length,1);
  // drawer
  assert.equal((await call('staff','PUT','/api/cash/drawer',{floatMinor:'100000'})).body.expectedMinor,'100000');
  assert.equal((await call('staff','PUT','/api/cash/drawer',{floatMinor:'5'})).status,409);
  // quote + sale + replay + conflict
  const items=[{productId:P1,qty:2,sweetness:50,addonIds:[addon.id]},{productId:P2,qty:1}];
  const q=(await call('staff','POST','/api/cash/quote',{items,discount:{kind:'percent',bps:1000}})).body;
  assert.deepEqual([q.subtotalMinor,q.discountMinor,q.totalMinor,q.vatMode],['20500','2050','18450','inclusive']);
  assert.equal((await call('staff','POST','/api/cash/quote',{items,discount:{kind:'percent',bps:2000}})).status,403);
  const key=randomUUID(),sale={idempotencyKey:key,items,discount:{kind:'percent',bps:1000},tenderMinor:'20000'};
  const s1=await call('staff','POST','/api/cash/sales',sale);
  assert.deepEqual([s1.status,s1.body.sale.receiptNo,s1.body.sale.changeMinor,s1.body.sale.vatMinor,s1.body.replayed],[200,'H000001','1550','1207',false]);
  assert.equal(BigInt(s1.body.sale.netMinor)+BigInt(s1.body.sale.vatMinor),BigInt(s1.body.sale.totalMinor));
  assert.equal((await call('staff','POST','/api/cash/sales',sale)).body.replayed,true);
  assert.equal((await call('staff','POST','/api/cash/sales',{...sale,tenderMinor:'30000'})).status,409);
  assert.equal((await call('staff','POST','/api/cash/sales',{...sale,idempotencyKey:randomUUID(),tenderMinor:'100'})).status,422);
  assert.equal((await call('staff','POST','/api/cash/sales',{...sale,idempotencyKey:randomUUID(),extra:1})).status,422);
  assert.equal((await call('staff','GET',`/api/cash/sales/${s1.body.sale.id}`)).body.sale.lines[0].addons[0].label,'วิปครีม');
  assert.equal((await call('staff','GET','/api/cash/sales')).body.sales.length,1);
  assert.equal((await call('staff','GET','/api/cash/sales/not-a-uuid')).status,422);
  // held bills
  const held=(await call('staff','POST','/api/cash/held',{label:'โต๊ะ B1',items:[{productId:P2,qty:3}],discount:null})).body.held;
  assert.equal((await call('staff','GET','/api/cash/held')).body.held.length,1);
  assert.equal((await call('staff','POST',`/api/cash/held/${held.id}/recall`)).body.held.items[0].qty,3);
  assert.equal((await call('staff','POST',`/api/cash/held/${held.id}/recall`)).status,404);
  // void
  assert.equal((await call('staff','POST',`/api/cash/sales/${s1.body.sale.id}/void`,{reason:'x',restock:true})).status,403);
  assert.equal((await call('manager','POST',`/api/cash/sales/${s1.body.sale.id}/void`,{reason:'wrong order',restock:true})).body.sale.status,'VOIDED');
  assert.equal((await call('manager','POST',`/api/cash/sales/${s1.body.sale.id}/void`,{reason:'again',restock:true})).status,409);
  // second sale stays in the round; drawer, report, export, shift
  await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:P2,qty:2}],discount:null,tenderMinor:'20000'});
  assert.equal((await call('staff','GET','/api/cash/drawer')).body.expectedMinor,'111000');
  const today=(await admin.query("SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') d")).rows[0].d as string;
  const rep=await call('owner','GET',`/api/reports/sales?from=${today}&to=${today}`);
  assert.deepEqual(rep.body.days.flatMap((d:any)=>d.groups).filter((g:any)=>g.sourceKind==='cash_counter').map((g:any)=>[g.orders,g.totalMinor]),[[1,'11000']]);
  assert.equal((await call('staff','GET',`/api/reports/sales?from=${today}&to=${today}`)).status,403);
  const csv=await call('owner','GET',`/api/reports/export?kind=cash&from=${today}&to=${today}`);
  assert.equal(csv.body.rows,2);assert.ok(csv.body.csv.includes('H000001')&&csv.body.csv.includes('VOIDED'));
  const closed=await call('owner','POST','/api/shifts/close',{idempotencyKey:randomUUID(),note:'',countedCash:{minor:'111000',currency:'THB',decimals:2}});
  assert.equal(closed.body.close.snapshot.drawer.expectedMinor,'111000');
  // routes that must not exist for these methods
  assert.equal((await call('owner','DELETE','/api/cash/sales')).status===404||(await call('owner','DELETE','/api/cash/sales')).status===405,true);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  await admin.query('SET session_replication_role=replica');
  for(const t of ['cash_drawer_openings','cash_held_bills','cash_sale_lines','cash_sales','cash_receipt_counters','cash_addons','product_barcodes','cash_prices','cash_settings','shift_closes','stock_movements','audit_logs','sessions','members','products'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[M]).catch(()=>undefined);
  await admin.query('DELETE FROM merchants WHERE id=$1',[M]);await admin.end();await pool.end();
 }
});
