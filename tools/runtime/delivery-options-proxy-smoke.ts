import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
process.env.ADMIN_DATABASE_URL='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {pool,tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {staffToken}=await import('../../tests/backend-table-fixture');
const {MobileProductOptionsSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const origin=process.env.OPTIONS_PROXY_ORIGIN??'http://127.0.0.1:4322';
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin),'Disposable loopback proxy only');
const merchant=randomUUID(),other=randomUUID(),product=randomUUID(),actor=randomUUID(),passed:string[]=[];
const check=(name:string,fn:()=>void)=>{fn();passed.push(name);};
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'FIXTURE maximum option proxy','11111111111111111111111111111111'),($2,'FIXTURE other option proxy','11111111111111111111111111111111')",[merchant,other]);
 await tenant(merchant,db=>db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ทดสอบ','Fixture','',100,10)",[product,merchant]));
 const pricing=await tenant(merchant,db=>publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'MAX OPTIONS LOCAL FIXTURE'},prices:[{productId:product,unitMinor:'100'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}}));
 const owner=await staffToken(pool,merchant,actor),staff=await staffToken(pool,merchant,randomUUID(),'staff'),foreign=await staffToken(pool,other,randomUUID());
 const groups=Array.from({length:10},()=>({id:randomUUID(),name:'ก'.repeat(80),nameEn:'ก'.repeat(80),enabled:true,minSelections:1,maxSelections:1,choices:Array.from({length:20},()=>({id:randomUUID(),name:'ก'.repeat(80),nameEn:'ก'.repeat(80),enabled:true,maxQty:10,priceDelta:{currency:'USD',decimals:2,amountMinor:'999999999999999999'}}))}));
 const command={expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:pricing.priceVersion,noteEnabled:true,groups},raw=JSON.stringify(command),path=origin+'/api/products/'+product+'/online-options';
 async function request(method:string,body?:string,token:string|null=owner){const response=await fetch(path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body});return {status:response.status,body:await response.json()};}
 check('Maximum supported Unicode configuration exceeds old 16KB boundary',()=>assert.ok(Buffer.byteLength(raw)>16384&&Buffer.byteLength(raw)<160000));
 const noIdentity=await request('GET',undefined,null);check('Merchant proxy does not bypass identity',()=>assert.equal(noIdentity.status,401));
 const denied=await request('PUT',raw,staff);check('Staff cannot publish through merchant proxy',()=>assert.equal(denied.status,403));
 const wrong=await request('GET',undefined,foreign);check('Foreign tenant cannot read through merchant proxy',()=>assert.equal(wrong.status,404));
 const published=await request('PUT',raw);check('All 200 choices publish through actual built proxy and API',()=>{assert.equal(published.status,200);const value=MobileProductOptionsSchema.parse(published.body);assert.equal(value.revision,'1');assert.equal(value.groups.reduce((n,g)=>n+g.choices.length,0),200);assert.equal(value.groups[9].choices[19].name,groups[9].choices[19].name);assert.equal(value.groups[9].choices[19].priceDelta.amountMinor,'999999999999999999');});
 const replay=await request('PUT',raw);check('Identical proxy retry returns same immutable publication',()=>assert.deepEqual(replay,published));
 const recovered=await request('GET');check('Proxy reload restores exact configured version',()=>assert.deepEqual(recovered,published));
 const method=await request('PATCH',raw);check('Narrow proxy rejects unsupported publication method',()=>assert.equal(method.status,405));
 const oversized=await request('PUT',' '.repeat(160001));check('Scoped API capacity retains hard oversized-body rejection',()=>assert.equal(oversized.status,413));
 const persisted=await tenant(merchant,async db=>({pointer:(await db.query('SELECT revision::text FROM product_online_options WHERE merchant_id=$1 AND product_id=$2',[merchant,product])).rows,versions:(await db.query('SELECT count(*)::int AS n FROM product_option_versions WHERE merchant_id=$1 AND product_id=$2',[merchant,product])).rows[0].n,commands:(await db.query('SELECT count(*)::int AS n FROM product_option_commands WHERE merchant_id=$1 AND product_id=$2',[merchant,product])).rows[0].n,stock:(await db.query('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2',[merchant,product])).rows[0]}));
 check('Proxy retry has one persisted version and command and no inventory effect',()=>{assert.deepEqual(persisted.pointer,[{revision:'1'}]);assert.equal(persisted.versions,1);assert.equal(persisted.commands,1);assert.deepEqual(persisted.stock,{stock:10,reserved:0});});
 const receipt={environment:'local_disposable_fixture',origin,merchantId:merchant,productId:product,requestBytes:Buffer.byteLength(raw),assertions:passed.length,passed,persisted,physicalTesting:'deferred_by_user_2026-10-16',limits:['Publication only; configured customer quotes/orders not integrated','No production, real provider or physical testing']};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-proxy.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-proxy-failure-'+Date.now()+'.json',JSON.stringify({merchantId:merchant,passed,error:String(error)},null,2)+'\n');throw error;}
finally{await pool.end();}
