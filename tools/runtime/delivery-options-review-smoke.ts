import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {MobileOptionGroup} from '../../packages/contracts/src/mobile-v1.generated';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
process.env.ADMIN_DATABASE_URL='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const {pool,tenant}=await import('../../apps/api/src/db');
const {publishPrices,pricingView}=await import('../../apps/api/src/catalog');
const {productOptions}=await import('../../apps/api/src/online-options');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const after=process.argv.includes('--after'),merchant=randomUUID(),product=randomUUID(),actor=randomUUID(),version=randomUUID();
let checks=0;const results:unknown[]=[];
const rollback=new Error('rollback-only fixture observation');
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'FIXTURE option R1 rollback observations','11111111111111111111111111111111')",[merchant]);
 await tenant(merchant,db=>db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟ','Coffee','',3500,10)",[product,merchant]));
 const configuration={expectedRevision:'0',catalogCurrency:'USD' as const,provenance:{kind:'demo_configured' as const,label:'OPTIONS REVIEW FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG' as const,network:'solana:devnet' as const,mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6 as const,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1' as const}};
 const pricing=await tenant(merchant,db=>publishPrices(db,merchant,actor,'owner',configuration));
 const group:MobileOptionGroup={id:randomUUID(),name:'ท็อปปิ้ง',nameEn:'Topping',enabled:true,minSelections:1,maxSelections:1,choices:[{id:randomUUID(),name:'ช็อต',nameEn:'Shot',enabled:true,maxQty:1,priceDelta:{currency:'USD',decimals:2,amountMinor:'35'}}]};
 for(const kind of ['denomination_order','group_uuid_spelling','choice_uuid_spelling'] as const){
  let sqlAccepted=false,apiReadable:boolean|null=null,code:string|undefined;
  try{await tenant(merchant,async db=>{
   const g=structuredClone(group);if(kind==='group_uuid_spelling')g.id=g.id.replaceAll('-','');if(kind==='choice_uuid_spelling')g.choices[0].id=g.choices[0].id.replaceAll('-','');
   await db.query('INSERT INTO product_option_versions(merchant_id,product_id,id,revision,currency,decimals,note_enabled,groups,price_version_id,configured_by) VALUES($1,$2,$3,1,\'USD\',2,true,$4,$5,$6)',[merchant,product,version,JSON.stringify([g]),pricing.priceVersion,actor]);
   if(kind==='denomination_order')await publishPrices(db,merchant,actor,'owner',{...configuration,expectedRevision:'1',catalogDecimals:4,settlement:{...configuration.settlement,quotePolicy:'USD_FIXED4_TO_USDG_1_TO_1'}});
   await db.query('INSERT INTO product_online_options(merchant_id,product_id,active_version_id,revision) VALUES($1,$2,$3,1)',[merchant,product,version]);
   await db.query('SET CONSTRAINTS ALL IMMEDIATE');sqlAccepted=true;
   try{await productOptions(db,merchant,product);apiReadable=true;}catch{apiReadable=false;}
   throw rollback;
  });}catch(error){if(error!==rollback)code=(error as {code?:string}).code;}
  assert.equal(sqlAccepted,!after,kind);checks++;
  if(after){assert.equal(code,'23514',kind);checks++;}else if(kind!=='denomination_order'){assert.equal(apiReadable,false,kind);checks++;}
  results.push({kind,sqlAccepted,apiReadable,code,alwaysRolledBack:true});
 }
 const current=await tenant(merchant,db=>pricingView(db,merchant));assert.equal(current.priceVersion,pricing.priceVersion);assert.equal(current.decimals,2);checks++;
 const persisted=await tenant(merchant,async db=>({versions:(await db.query('SELECT count(*)::int AS n FROM product_option_versions WHERE merchant_id=$1',[merchant])).rows[0].n,pointers:(await db.query('SELECT count(*)::int AS n FROM product_online_options WHERE merchant_id=$1',[merchant])).rows[0].n}));assert.deepEqual(persisted,{versions:0,pointers:0});checks++;
 const receipt={environment:'local_disposable_fixture',mode:after?'after':'before',assertions:checks,merchantId:merchant,results,persisted,limits:['All exploit transactions deliberately rolled back after forcing deferred constraints','No provider calls or actual-use changes'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-review-'+(after?'after':'before')+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await pool.end();}
