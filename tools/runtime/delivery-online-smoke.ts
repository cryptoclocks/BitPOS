import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
// Fixed disposable environment only; never loads root/private environment files.
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {captureQuote,publishPrices,validateQuote}=await import('../../apps/api/src/catalog');
const {createQuotedOrder,orderView,settleAttempt,emitOrder}=await import('../../apps/api/src/orders');
const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const merchant=randomUUID(),account=randomUUID(),branch=randomUUID(),product=randomUUID(),actor=randomUUID();
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'ONLINE SQL FIXTURE - no chain payment','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)",[account,randomUUID()]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,enabled) VALUES($1,$2,'Fixture pickup branch',true)",[merchant,branch]);
 const order=await tenant(merchant,async db=>{
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบ','Fixture food','',270,2)",[product,merchant]);
  await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL SQL FIXTURE ONLY'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
  const customer=(await db.query<{id:string}>('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;
  await db.query('INSERT INTO mobile_customer_links(account_id,merchant_id,customer_id) VALUES($1,$2,$3)',[account,merchant,customer]);
  const authority={kind:'versioned' as const,source:{kind:'online' as const,accountId:account,branchId:branch,channel:'customer_app' as const,label:'BitPOS customer app'},serving:{kind:'pickup' as const,label:'Fixture pickup'},target:null,pairingGeneration:null};
  const q=await captureQuote(db,merchant,{kind:'online',id:account,branchId:branch},[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}],authority,customer);
  await validateQuote(db,merchant,q);
  const o=await createQuotedOrder(db,merchant,{quote:q,customerId:customer,idempotencyKey:randomUUID(),requestHash:'fixture-only',screenGeneration:null});
  await emitOrder(db,o);const v=await orderView(db,o);
  assert.equal(v.authority.source.kind,'online');assert.equal(v.authority.target,null);assert.notEqual(v.status,'PAID','creating an order cannot confirm payment');assert.equal(v.pricing.total.amountMinor,'270');
  return o;
 });
 const attempt=await tenant(merchant,async db=>(await fixturePaymentAttempt(db,{merchant,order:order.id,status:'SUBMITTED',signature:'SQL-only-online-'+randomUUID()})).rows[0]);
 assert.ok(attempt,'canonical payment selection exists');
 await Promise.all([tenant(merchant,db=>settleAttempt(db,attempt,true)),tenant(merchant,db=>settleAttempt(db,attempt,true))]);
 const persisted=await tenant(merchant,async db=>({order:(await db.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0],product:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[product])).rows[0],payments:(await db.query('SELECT count(*)::int AS n FROM payments WHERE order_id=$1',[order.id])).rows[0].n,devices:(await db.query('SELECT count(*)::int AS n FROM devices')).rows[0].n,registers:(await db.query('SELECT count(*)::int AS n FROM registers')).rows[0].n,outbox:(await db.query('SELECT count(*)::int AS n FROM outbox_events WHERE order_id=$1',[order.id])).rows[0].n,sounds:(await db.query('SELECT count(*)::int AS n FROM device_sound_effects WHERE order_id=$1',[order.id])).rows[0].n}));
 assert.deepEqual(persisted,{order:{status:'PAID'},product:{stock:1,reserved:0},payments:1,devices:0,registers:0,outbox:0,sounds:0});
 const receipt={environment:'local_disposable_fixture',scenario:'online canonical quote/order/duplicate settlement without register or device',merchantId:merchant,orderId:order.id,persisted,limits:['SQL-only synthetic verifier seam, not chain verification or real payment','No mobile endpoints or merchant acceptance exercised','Durable mobile event publication not implemented in this slice'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/online-authority-smoke.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await admin.end();await pool.end();}
