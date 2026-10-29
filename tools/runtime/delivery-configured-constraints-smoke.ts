import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_MOBILE_ENABLED:'1'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {server}=await import('../../apps/api/src/index');
const {publishPrices,captureQuote}=await import('../../apps/api/src/catalog');
const {createQuotedOrder}=await import('../../apps/api/src/orders');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {MobileConfiguredFoodSnapshotSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const merchant=randomUUID(),branch=randomUUID(),product=randomUUID(),actor=randomUUID(),mode=process.argv.includes('--before')?'before':'after';
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'FIXTURE configured constraint probes','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ร้านทดสอบข้อจำกัด','Constraint fixture',true,true)",[merchant,branch]);
 await tenant(merchant,async db=>{await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟ','Coffee','',270,10)",[product,merchant]);await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL CONSTRAINT FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});});
 const verified=await fetch('http://127.0.0.1:'+address.port+'/api/mobile/v1/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'+66900000001',code:'123456',deviceId:randomUUID()})});assert.equal(verified.status,200);const account=(await verified.json()).accountId;
 const customer=await tenant(merchant,async db=>{const id=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;await db.query('INSERT INTO mobile_customer_links(account_id,merchant_id,customer_id) VALUES($1,$2,$3)',[account,merchant,id]);return id;});
 const items=[{lineId:randomUUID(),productId:product,qty:2,optionVersion:null,selections:[],allergyNote:null}];
 const origin={kind:'online' as const,id:account,branchId:branch};
 const authority={kind:'versioned' as const,source:{kind:'online' as const,accountId:account,branchId:branch,channel:'customer_app' as const,label:'BitPOS customer app'},serving:{kind:'pickup' as const,label:'Pickup'},target:null,pairingGeneration:null};
 const results:Record<string,unknown>[]=[];
 for(const fault of ['missing_base','null_base','missing_unit','missing_name','null_name'] as const){
  let committed=false,quoteId:string|undefined,code:string|undefined;
  try{await tenant(merchant,async db=>{
   const altered=new Proxy(db,{get(target,key){if(key==='query')return async(sql:string,values?:unknown[])=>{
    if(sql.startsWith('INSERT INTO order_quotes')){const next=[...values!],lines=JSON.parse(next[11] as string);for(const line of lines){if(fault==='missing_base')delete line.basePrice;if(fault==='null_base')line.basePrice=null;if(fault==='missing_unit')delete line.unitPrice;if(fault==='missing_name')delete line.name;if(fault==='null_name')line.name=null;}next[11]=JSON.stringify(lines);return target.query(sql,next);}
    if(sql.startsWith('INSERT INTO quote_configured_food')){const next=[...values!],expected=(await target.query('SELECT bitpos.expected_configured_food($1,$2,$3::jsonb) AS snapshot',[next[0],next[1],next[2]])).rows[0].snapshot;next[3]=JSON.stringify(expected);return target.query(sql,next);}
    return target.query(sql,values);
   };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
   quoteId=(await captureQuote(altered,merchant,origin,items,authority,customer)).id;
  });committed=true;}catch(error){code=(error as {code?:string}).code;}
  if(mode==='after'){assert.equal(committed,false,fault+' committed');assert.equal(code,'23514',fault+' wrong error');}
  if(mode==='before'&&fault==='missing_base'){assert.equal(committed,true);const stored=await tenant(merchant,db=>db.query('SELECT snapshot FROM quote_configured_food WHERE merchant_id=$1 AND quote_id=$2',[merchant,quoteId]));assert.equal(MobileConfiguredFoodSnapshotSchema.safeParse(stored.rows[0].snapshot).success,false);}
  results.push({fault,committed,code:code??null});
 }
 for(const contextSwitch of [false,true]){
 const valid=await tenant(merchant,db=>captureQuote(db,merchant,origin,items,authority,customer));
 const before=await tenant(merchant,async db=>({orders:(await db.query('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[merchant])).rows[0].n,reserved:(await db.query('SELECT reserved FROM products WHERE merchant_id=$1 AND id=$2',[merchant,product])).rows[0].reserved,paymentQuotes:(await db.query('SELECT count(*)::int AS n FROM payment_quotes WHERE merchant_id=$1',[merchant])).rows[0].n,lifecycle:(await db.query('SELECT count(*)::int AS n FROM online_food_orders WHERE merchant_id=$1',[merchant])).rows[0].n}));
 let orderCommitted=false,orderCode:string|undefined;
 try{await tenant(merchant,async db=>{
  if(!contextSwitch)await db.query('SET CONSTRAINTS bitpos.configured_order_parent IMMEDIATE');
  const altered=new Proxy(db,{get(target,key){if(key==='query')return(sql:string,values?:unknown[])=>sql.startsWith('INSERT INTO order_configured_food')?Promise.resolve({rowCount:1,rows:[]}):target.query(sql,values);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await createQuotedOrder(altered,merchant,{quote:valid,customerId:customer,idempotencyKey:randomUUID(),requestHash:'fixture-constraint-omission',screenGeneration:null});
  if(contextSwitch){await db.query('SET CONSTRAINTS bitpos.v2_order_complete,bitpos.bill_complete IMMEDIATE');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[randomUUID()]);}
 });orderCommitted=true;}catch(error){orderCode=(error as {code?:string}).code;}
 const after=await tenant(merchant,async db=>({orders:(await db.query('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[merchant])).rows[0].n,reserved:(await db.query('SELECT reserved FROM products WHERE merchant_id=$1 AND id=$2',[merchant,product])).rows[0].reserved,paymentQuotes:(await db.query('SELECT count(*)::int AS n FROM payment_quotes WHERE merchant_id=$1',[merchant])).rows[0].n,lifecycle:(await db.query('SELECT count(*)::int AS n FROM online_food_orders WHERE merchant_id=$1',[merchant])).rows[0].n}));
 if(mode==='before'||contextSwitch&&process.argv.includes('--context-before'))assert.equal(orderCommitted,true);else{assert.equal(orderCommitted,false);assert.equal(orderCode,'23514');assert.deepEqual(after,before);}
 results.push({fault:contextSwitch?'changed_tenant_after_aggregate_checks':'immediate_parent_late_authority_missing_document',committed:orderCommitted,code:orderCode??null,before,after});
 }
 const label=process.argv.includes('--context-before')?'context-before':mode,receipt={mode:label,merchantId:merchant,results,environment:'local_disposable_fixture',physicalTesting:'deferred_by_user_2026-10-16',limits:['Real PostgreSQL constraint probes; persistence-boundary statement omission is deliberate','No provider, payment broadcast or production operation']};await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-configured-constraints-'+label+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await admin.end();await pool.end();}
