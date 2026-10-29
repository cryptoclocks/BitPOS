import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {pool,tenant}=await import('../../apps/api/src/db');
const {server}=await import('../../apps/api/src/index');
const {publishPrices,pricingView}=await import('../../apps/api/src/catalog');
const {aggregateConfiguredCart,configuredLines,configuredCartHash}=await import('../../apps/api/src/online-options');
const {staffToken}=await import('../../tests/backend-table-fixture');
const {MobileProductOptionsSchema,MobileConfiguredCartItemSchema,MobileConfiguredFoodLineSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const merchant=randomUUID(),other=randomUUID(),product=randomUUID(),actor=randomUUID(),group=randomUUID(),choice=randomUUID();
let checks=0;const passed:string[]=[];function check(name:string,fn:()=>void){fn();checks++;passed.push(name);}
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const bound=server.address();assert.ok(bound&&typeof bound!=='string');const base='http://127.0.0.1:'+bound.port;
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'FIXTURE online option authority','11111111111111111111111111111111'),($2,'FIXTURE other tenant','11111111111111111111111111111111')",[merchant,other]);
 await tenant(merchant,db=>db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟ','Coffee','',3500,100)",[product,merchant]));
 const configuration={expectedRevision:'0',catalogCurrency:'USD' as const,provenance:{kind:'demo_configured' as const,label:'OPTIONS LOCAL FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG' as const,network:'solana:devnet' as const,mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6 as const,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1' as const}};
 const pricing=await tenant(merchant,db=>publishPrices(db,merchant,actor,'owner',configuration));
 const owner=await staffToken(pool,merchant,actor),staff=await staffToken(pool,merchant,randomUUID(),'staff'),foreign=await staffToken(pool,other,randomUUID());
 const path='/api/products/'+product+'/online-options';
 async function request(method:string,body?:unknown,token=owner){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 const initial=await request('GET');check('No configuration is explicit null version',()=>assert.deepEqual(initial,{status:200,body:{version:null,revision:'0',noteEnabled:true,groups:[]}}));
 const d={expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:pricing.priceVersion,noteEnabled:true,groups:[{id:group,name:'ท็อปปิ้ง',nameEn:'Topping',enabled:true,minSelections:1,maxSelections:3,choices:[{id:choice,name:'ช็อต',nameEn:'Shot',enabled:true,maxQty:3,priceDelta:{currency:'USD',decimals:2,amountMinor:'35'}}]}]};
 const denied=await request('PUT',d,staff);check('Staff cannot publish',()=>assert.equal(denied.status,403));
 const wrong=await request('GET',undefined,foreign);check('Foreign tenant cannot read product',()=>assert.equal(wrong.status,404));
 const published=await request('PUT',d);check('Owner publishes version 1 through real HTTP',()=>{assert.equal(published.status,200);assert.equal(published.body.revision,'1');});
 const replay=await request('PUT',d);check('Exact durable publication replay',()=>assert.deepEqual(replay,published));
 const conflict=await request('PUT',{...d,noteEnabled:false});check('Changed idempotency payload rejected',()=>assert.equal(conflict.status,409));
 const duplicate=await request('PUT',{...d,expectedRevision:'1',idempotencyKey:randomUUID(),groups:[d.groups[0],d.groups[0]]});check('Duplicate group identity rejected',()=>assert.equal(duplicate.status,422));
 const wrongMoney=structuredClone(d);wrongMoney.expectedRevision='1';wrongMoney.idempotencyKey=randomUUID();wrongMoney.groups[0].choices[0].priceDelta.decimals=4;
 const wrongDenomination=await request('PUT',wrongMoney);check('Delta denomination mismatch rejected',()=>assert.equal(wrongDenomination.status,422));
 const concurrent=await Promise.all([true,false].map(noteEnabled=>request('PUT',{...d,noteEnabled,expectedRevision:'1',idempotencyKey:randomUUID()})));
 check('Concurrent owner edits have one winner',()=>assert.deepEqual(concurrent.map(v=>v.status).sort(),[200,409]));
 const historical=await request('PUT',d);check('Replay returns original immutable version after newer edit',()=>assert.deepEqual(historical,published));
 const options=MobileProductOptionsSchema.parse(published.body);
 const item=MobileConfiguredCartItemSchema.parse({lineId:randomUUID(),productId:product,qty:2,optionVersion:options.version,selections:[{groupId:group,choiceId:choice,qty:2}],allergyNote:'ไม่ใส่นม\nNo milk'});
 const second={...item,lineId:randomUUID(),qty:1,selections:[{groupId:group,choiceId:choice,qty:1}],allergyNote:null};
 const price={currency:'USD' as const,decimals:2 as const,amountMinor:'270'},line={productId:product,name:'กาแฟ',nameEn:'Coffee',qty:3,priceVersion:pricing.priceVersion,basePrice:price,unitPrice:{...price,amountMinor:'250'},promotion:null};
 const lines=configuredLines([item,second],[line],new Map([[product,options]]));lines.forEach(l=>MobileConfiguredFoodLineSchema.parse(l));
 check('Distinct variants preserve identity and exact undiscounted options',()=>{assert.equal(lines.length,2);assert.equal(lines.reduce((n,l)=>n+BigInt(l.lineTotal.amountMinor),0n),925n);assert.deepEqual(aggregateConfiguredCart([item,second]),[{productId:product,qty:3}]);});
 check('Configuration request order is hash invariant',()=>assert.equal(configuredCartHash([item,second]),configuredCartHash([second,item])));
 check('Required choice omission rejected',()=>assert.throws(()=>configuredLines([{...item,selections:[]}],[line],new Map([[product,options]])),/INVALID_REQUEST/));
 check('Stale option version cannot price',()=>assert.throws(()=>configuredLines([{...item,optionVersion:null}],[line],new Map([[product,options]])),/QUOTE_CHANGED/));
 check('Aggregate quantity limit cannot be bypassed with variants',()=>assert.throws(()=>aggregateConfiguredCart([{...item,qty:60},{...second,qty:60}]),/INVALID_REQUEST/));
 check('Repeated choice tuple rejected',()=>assert.throws(()=>configuredLines([{...item,selections:[item.selections[0],item.selections[0]]}],[line],new Map([[product,options]])),/INVALID_REQUEST/));
 check('Allergy control bytes rejected',()=>assert.throws(()=>configuredLines([{...item,allergyNote:'unsafe\u0001'}],[line],new Map([[product,options]])),/INVALID_REQUEST/));
 check('Client option price injection rejected by generated boundary',()=>assert.equal(MobileConfiguredCartItemSchema.safeParse({...item,selections:[{...item.selections[0],priceDelta:'0'}]}).success,false));
 await assert.rejects(tenant(merchant,db=>db.query("UPDATE product_option_versions SET groups='[]' WHERE merchant_id=$1 AND product_id=$2",[merchant,product])),(e:{code?:string})=>e.code==='42501'||e.code==='23514');passed.push('Immutable version cannot be updated');checks++;
 const latest=await request('GET');assert.equal(latest.body.revision,'2');
 async function direct(groups:unknown,pointer=false){return tenant(merchant,async db=>{
  const id=randomUUID();await db.query('INSERT INTO product_option_versions(merchant_id,product_id,id,revision,currency,decimals,note_enabled,groups,price_version_id,configured_by) VALUES($1,$2,$3,3,\'USD\',2,true,$4,$5,$6)',[merchant,product,id,JSON.stringify(groups),pricing.priceVersion,actor]);
  if(pointer)await db.query('UPDATE product_online_options SET active_version_id=$3,revision=3 WHERE merchant_id=$1 AND product_id=$2',[merchant,product,id]);
 });}
 await assert.rejects(direct([d.groups[0],d.groups[0]],true),(e:{code?:string})=>e.code==='23514');passed.push('Direct SQL duplicate groups refused');checks++;
 await assert.rejects(direct(d.groups),(e:{code?:string})=>e.code==='23514');passed.push('Deferred constraint refuses orphan unpublished version');checks++;
 const before=await tenant(merchant,db=>pricingView(db,merchant));
 await assert.rejects(tenant(merchant,db=>publishPrices(db,merchant,actor,'owner',{...configuration,expectedRevision:before.revision,catalogDecimals:4,settlement:{...configuration.settlement,quotePolicy:'USD_FIXED4_TO_USDG_1_TO_1'}})),(e:{code?:string})=>e.code==='23514');
 const after=await tenant(merchant,db=>pricingView(db,merchant));check('Catalog denomination cannot silently reinterpret option deltas',()=>assert.deepEqual(after,before));
 const state=await tenant(merchant,async db=>({versions:(await db.query('SELECT revision::text FROM product_option_versions WHERE merchant_id=$1 AND product_id=$2 ORDER BY revision',[merchant,product])).rows,commands:(await db.query('SELECT count(*)::int AS n FROM product_option_commands WHERE merchant_id=$1 AND product_id=$2',[merchant,product])).rows[0].n,stock:(await db.query('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2',[merchant,product])).rows[0]}));
 check('Persisted revisions commands and stock remain authoritative',()=>{assert.deepEqual(state.versions,[{revision:'1'},{revision:'2'}]);assert.equal(state.commands,2);assert.deepEqual(state.stock,{stock:100,reserved:0});});
 const receipt={environment:'local_disposable_fixture',merchantId:merchant,productId:product,assertions:checks,passed,persisted:state,limits:['Option publication and pure configured pricing only; quote/order wiring and customer/merchant UI not yet connected','No RPC, payment, provider, Mini, deployment or physical tests'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-publication.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-publication-failure-'+Date.now()+'.json',JSON.stringify({environment:'local_disposable_fixture',merchantId:merchant,checks,passed,error:String(error)},null,2)+'\n');throw error;}
finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();}
