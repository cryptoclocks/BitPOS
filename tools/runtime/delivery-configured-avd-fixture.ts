import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_MOBILE_ENABLED:'1'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {publishProductOptions}=await import('../../apps/api/src/online-options');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const merchant=randomUUID(),branch='00000000-0000-4000-8000-'+randomUUID().replaceAll('-','').slice(0,12),product=randomUUID(),actor='fa000000-0000-4000-8000-000000000010',group=randomUUID(),choice=randomUUID();
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'AVD configured food FIXTURE','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ร้านตัวเลือก AVD ทดสอบ','AVD Options Fixture',true,true)",[merchant,branch]);
 await admin.query("INSERT INTO bitpos.members(merchant_id,user_id,role) VALUES($1,$2,'owner')",[merchant,actor]);
 const published=await tenant(merchant,async db=>{await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟทดสอบ','Fixture Coffee','',270,100)",[product,merchant]);const prices=await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'AVD EMULATOR LOCAL FIXTURE ONLY'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});return publishProductOptions(db,merchant,actor,'owner',product,{expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:prices.priceVersion,noteEnabled:true,groups:[{id:group,name:'ท็อปปิ้ง',nameEn:'Topping',enabled:true,minSelections:1,maxSelections:3,choices:[{id:choice,name:'ช็อตเพิ่ม',nameEn:'Extra shot',enabled:true,maxQty:3,priceDelta:{currency:'USD',decimals:2,amountMinor:'35'}}]}]});});
 const fixture={merchantId:merchant,branchId:branch,productId:product,groupId:group,choiceId:choice,optionVersion:published.version,environment:'local_disposable_avd_fixture',physicalTesting:'deferred_by_user_2026-10-16',providerCalls:0};await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-configured-avd-fixture.json',JSON.stringify(fixture,null,2)+'\n');console.log(JSON.stringify(fixture));
}finally{await admin.end();await pool.end();}
