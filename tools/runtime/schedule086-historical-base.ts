import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import {readFile,readdir,writeFile} from 'node:fs/promises';import pg from 'pg';
const name='bitpos_schedule086_fixture',admin=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/postgres'});await admin.connect();try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query('CREATE DATABASE bitpos_schedule086_fixture');}finally{await admin.end();}
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/'+name});await db.connect();try{
assert.equal((await db.query('SELECT current_database() n')).rows[0].n,name);
if(!(await db.query("SELECT to_regclass('bitpos.quote_configured_food') present")).rows[0].present){
 await db.query('BEGIN');
 for(const file of (await readdir('supabase/migrations')).filter(f=>/^\d{3}_.*\.sql$/.test(f)&&Number(f.slice(0,3))<=57).sort()){
  if(file.startsWith('029_')){
   // Migration029 requires historical starts. Explicit synthetic rows only:
   // no provider invocation, copied records, quota bypass or production effect.
   const historical=randomUUID();await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'SYNTHETIC migration029 historical prerequisite','11111111111111111111111111111111')",[historical]);
   await db.query("INSERT INTO bitpos.ai_generation_jobs(merchant_id,state,actor_id,input,products,attempts,provider_origin) SELECT $1,'FAILED','SYNTHETIC migration prerequisite','{\"fixture\":true}'::jsonb,'[]'::jsonb,1,'https://generativelanguage.googleapis.com' FROM generate_series(1,3)",[historical]);
  }
  await db.query(await readFile('supabase/migrations/'+file,'utf8'));
 }
 await db.query('COMMIT');
}
if(!(await db.query("SELECT to_regclass('bitpos.delivery_policy_versions') present")).rows[0].present){
 await db.query('BEGIN');
 for(const file of (await readdir('supabase/migrations')).filter(f=>/^0(58|59)_.*\.sql$/.test(f)).sort())await db.query(await readFile('supabase/migrations/'+file,'utf8'));
 await db.query('COMMIT');
}
process.env.DOTENV_CONFIG_PATH='/dev/null';Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/'+name,ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/'+name,AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {publishPrices,captureQuote}=await import('../../apps/api/src/catalog'),{publishProductOptions}=await import('../../apps/api/src/online-options'),{MINT,TOKEN_PROGRAM,hash}=await import('../../packages/domain/src/index'),{pool}=await import('../../apps/api/src/db');
const merchant=randomUUID(),branch=randomUUID(),product=randomUUID(),actor=randomUUID(),account=randomUUID(),session=randomUUID(),customer=randomUUID();await db.query('BEGIN');await db.query("SET LOCAL search_path=bitpos,public");await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'ISOLATED SCHEDULE086 SYNTHETIC','11111111111111111111111111111111')",[merchant]);await db.query("INSERT INTO members VALUES($1,$2,'owner')",[actor,merchant]);await db.query("INSERT INTO marketplace_branches(merchant_id,id,name,enabled,pickup_enabled) VALUES($1,$2,'Schedule synthetic pickup',true,true)",[merchant,branch]);await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,randomUUID(),hash(randomBytes(32).toString('base64url')),hash(randomBytes(32).toString('base64url'))]);await db.query('INSERT INTO customers(id,merchant_id) VALUES($1,$2)',[customer,merchant]);await db.query('INSERT INTO mobile_customer_links(account_id,merchant_id,customer_id) VALUES($1,$2,$3)',[account,merchant,customer]);await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟทดสอบ','Synthetic Coffee','',270,100)",[product,merchant]);
try{
 const client=db as unknown as pg.PoolClient;
 const prices=await publishPrices(client,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'ISOLATED SCHEDULE FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 const group=randomUUID(),choice=randomUUID();
 const options=await publishProductOptions(client,merchant,actor,'owner',product,{expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:prices.priceVersion,noteEnabled:true,groups:[{id:group,name:'นม',nameEn:'Milk',enabled:true,minSelections:0,maxSelections:1,choices:[{id:choice,name:'โอ๊ต',nameEn:'Oat',enabled:true,maxQty:1,priceDelta:{currency:'USD',decimals:2,amountMinor:'35'}}]}]});
 await captureQuote(client,merchant,{kind:'online',id:account,branchId:branch},[{lineId:randomUUID(),productId:product,qty:1,optionVersion:options.version,selections:[],allergyNote:null}],{kind:'versioned',source:{kind:'online',accountId:account,branchId:branch,channel:'customer_app',label:'Isolated synthetic schedule'},serving:{kind:'pickup',label:'Pickup'},target:null,pairingGeneration:null},customer);
 await db.query('COMMIT');
 console.log(JSON.stringify({status:'PREPARED_ISOLATED_HISTORICAL059_CONFIGURED_PICKUP',database:name,merchant,account,session,physicalTesting:'deferred_by_user_2026-10-16'}));
}finally{await pool.end();}
} catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
