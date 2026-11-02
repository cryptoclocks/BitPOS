import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
// Needs a throwaway Postgres with migrations 179 and 181 applied (CHANNEL_TEST_DB). Skipped otherwise. Provider data is fixture data only.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {ingestGrabOrder}=await import('../apps/api/src/channels/grabfood-orders');
const {listItemMap,saveItemMap}=await import('../apps/api/src/channels/item-map');
const M=randomUUID(),N=randomUUID(),STORE='STORE-1',P1=randomUUID(),P2=randomUUID(),PN=randomUUID();
const order=(id:string,items:{id:string;quantity:number;price:number}[],over:Record<string,unknown>={})=>({orderID:id,shortOrderNumber:'A1',merchantID:STORE,paymentType:'GRABPAY',orderTime:'2026-10-31T03:00:00Z',currency:{code:'THB',symbol:'฿',exponent:2},
 items,price:{subtotal:1000,total:1000,eaterPayment:1000},...over}) as never;
async function withDb(fn:(db:pg.PoolClient)=>Promise<void>){
 const c=new pg.Client({connectionString:url});await c.connect();
 try{await c.query('BEGIN');await c.query('SET LOCAL search_path=bitpos,public');
  for(const m of [M,N])await c.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Channel test',$2)",[m,'1'.repeat(32)]);
  for(const p of [P1,P2])await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Test','Test','x',100,10)",[M,p]);
  await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Test','Test','x',100,10)",[N,PN]);
  await fn(c as unknown as pg.PoolClient);}
 finally{await c.query('ROLLBACK');await c.end();}
}
const rows=async(db:pg.PoolClient,sql:string,a:unknown[]=[])=>(await db.query(sql,a)).rows;

test('unmapped platform items are listed once with how often they were seen',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-latte',quantity:2,price:5500},{id:'g-tea',quantity:1,price:4000}]));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o2',[{id:'g-latte',quantity:1,price:5500}]));
 const l=await listItemMap(db,M,'staff','grabfood');
 const latte=l.unmapped.find(u=>u.externalItemId==='g-latte')!;
 assert.deepEqual([l.unmapped.length,latte.lines,latte.qty,latte.lastUnit.amountMinor,latte.lastUnit.currency],[2,2,3,'5500','THB']);
 assert.deepEqual(l.mapped,[]);
}));
test('choosing a product fills open lines now and applies to later orders; names are never used',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-latte',quantity:1,price:5500}]));
 const r=await saveItemMap(db,M,'u','manager',{source:'grabfood',externalItemId:'g-latte',productId:P1});assert.equal(r.updatedLines,1);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o2',[{id:'g-latte',quantity:3,price:5500}]));
 assert.deepEqual((await rows(db,'SELECT mapped_product_id FROM channel_order_lines ORDER BY order_id,line_no')).map(x=>x.mapped_product_id),[P1,P1]);
 assert.equal((await listItemMap(db,M,'staff','grabfood')).unmapped.length,0);
 // changing the choice re-points the map but does not rewrite lines that are already mapped
 await saveItemMap(db,M,'u','owner',{source:'grabfood',externalItemId:'g-latte',productId:P2});
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o3',[{id:'g-latte',quantity:1,price:5500}]));
 const byOrder=await rows(db,"SELECT o.external_order_id e,l.mapped_product_id p FROM channel_order_lines l JOIN channel_orders o ON o.id=l.order_id ORDER BY o.external_order_id");
 assert.deepEqual(byOrder.map(x=>[x.e,x.p]),[['o1',P1],['o2',P1],['o3',P2]]);
}));
test('clearing a mapping un-maps open orders only; finished orders keep their history',integration,()=>withDb(async db=>{
 await saveItemMap(db,M,'u','owner',{source:'grabfood',externalItemId:'g-latte',productId:P1});
 await ingestGrabOrder(db,M,'sandbox',STORE,order('open',[{id:'g-latte',quantity:1,price:100}]));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('done',[{id:'g-latte',quantity:1,price:100}],{orderState:'COMPLETED'}));
 const r=await saveItemMap(db,M,'u','owner',{source:'grabfood',externalItemId:'g-latte',productId:null});assert.equal(r.updatedLines,1);
 const m=await rows(db,"SELECT o.external_order_id e,l.mapped_product_id p FROM channel_order_lines l JOIN channel_orders o ON o.id=l.order_id ORDER BY o.external_order_id");
 assert.deepEqual(m.map(x=>[x.e,x.p]),[['done',P1],['open',null]]);
 assert.deepEqual((await listItemMap(db,M,'staff','grabfood')).mapped,[]);
}));
test('only owner/manager can change a mapping; a product of another merchant is refused',integration,()=>withDb(async db=>{
 const b={source:'grabfood',externalItemId:'g-latte',productId:P1};
 await assert.rejects(saveItemMap(db,M,'u','staff',b));
 await assert.rejects(saveItemMap(db,M,'u','customer',b));
 await assert.rejects(saveItemMap(db,M,'u','owner',{...b,productId:PN}));
 await assert.rejects(saveItemMap(db,M,'u','owner',{...b,productId:'not-a-uuid'}));
 await assert.rejects(saveItemMap(db,M,'u','owner',{...b,source:'bitpos'}));
 await assert.rejects(saveItemMap(db,M,'u','owner',{...b,extra:1}));
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_item_map'))[0].n,0);
 await assert.rejects(listItemMap(db,M,'customer','grabfood'));
}));
test('tenant isolation of the map and the line-update grant (as the app role)',integration,()=>withDb(async db=>{
 await saveItemMap(db,M,'u','owner',{source:'grabfood',externalItemId:'g-latte',productId:P1});
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-tea',quantity:1,price:100}]));
 await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[N]);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_item_map'))[0].n,0);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_order_lines'))[0].n,0);
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_item_map'))[0].n,1);
 await db.query('UPDATE channel_order_lines SET mapped_product_id=$1',[P2]);
 await assert.rejects(db.query('UPDATE channel_order_lines SET qty=99'),/permission denied/);
}));
