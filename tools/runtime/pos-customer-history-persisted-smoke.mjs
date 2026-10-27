// Named disposable local fixture only. Real mobile quote/order attribution -> merchant history -> POS UI.
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
const database='postgres://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture';
const api='http://127.0.0.1:3046',web='http://127.0.0.1:4473';
const run='.omp/work/flutter-delivery-20261016/evidence/customer-history-persisted-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
await mkdir(run,{recursive:false});
const db=new pg.Client({connectionString:database,statement_timeout:10000});
const hash=value=>createHash('sha256').update(value).digest('hex');
const account=randomUUID(),mobileSession=randomUUID(),access=randomBytes(32).toString('base64url');
const fixtureUser='fa000000-0000-4000-8000-000000000010';
const shops=[];
const receipt={status:'RUNNING',fixture:true,checks:[],screens:[],limits:['Synthetic local auth identities and test-token pricing; no signing, payment, real customer or external provider.','Verifies canonical mobile account-to-merchant customer attribution, not wallet-consent attribution or all customer lifecycle races.'],physicalTesting:'deferred_by_user_2026-10-16'};
let pool,browser,stage='connect';
async function call(path,{token,body,status=200,method=body===undefined?'GET':'POST'}={}){
 const response=await fetch(api+'/api/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();
 assert.equal(response.status,status,`${method} ${path}: ${result.error?.code??response.status}`);
 return result;
}
try{
 await db.connect();
 const connected=(await db.query('SELECT current_database() name,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.deepEqual(connected,{name:'bitpos_w01_fixture',host:'127.0.0.1',port:55446});
 Object.assign(process.env,{DOTENV_CONFIG_PATH:'/dev/null',DATABASE_URL:database.replace('cryptoclock@','bitpos_app@'),ADMIN_DATABASE_URL:database,AUTH_URL:'http://127.0.0.1:55447',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:web,SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
 const databaseModule=await import('../../apps/api/src/db.ts');pool=databaseModule.pool;
 const {publishPrices}=await import('../../apps/api/src/catalog.ts');
 const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index.ts');
 await db.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,'LOCAL HISTORY FIXTURE','en')",[account,randomUUID()]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[mobileSession,account,randomUUID(),hash(access),hash(randomBytes(32))]);
 for(const label of ['A','B']){
  stage='canonical shop '+label;
  const shop={merchant:randomUUID(),branch:randomUUID(),product:randomUUID(),name:'LOCAL HISTORY FIXTURE '+label};shops.push(shop);
  await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,$2,'11111111111111111111111111111111')",[shop.merchant,shop.name]);
  await db.query("INSERT INTO bitpos.members(merchant_id,user_id,role) VALUES($1,$2,'owner')",[shop.merchant,fixtureUser]);
  await db.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled,delivery_enabled) VALUES($1,$2,$3,$3,true,true,false)",[shop.merchant,shop.branch,shop.name]);
  await databaseModule.tenant(shop.merchant,async client=>{
   await client.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบประวัติ','Local history fixture food','',270,5)",[shop.product,shop.merchant]);
   await publishPrices(client,shop.merchant,fixtureUser,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL HISTORY FIXTURE'},prices:[{productId:shop.product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
  });
  const quote=await call('mobile/v1/food/quotes',{token:access,body:{branchId:shop.branch,serving:'pickup',items:[{lineId:randomUUID(),productId:shop.product,qty:1,optionVersion:null,selections:[],allergyNote:null}]}});
  assert.equal(quote.total.amountMinor,'270');
  const created=await call('mobile/v1/food/orders',{token:access,body:{branchId:shop.branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()}});
  shop.order=created.order.id;
  const linked=(await db.query('SELECT l.customer_id,o.customer_id AS order_customer FROM bitpos.mobile_customer_links l JOIN bitpos.orders o ON o.merchant_id=l.merchant_id AND o.id=$3 WHERE l.merchant_id=$1 AND l.account_id=$2',[shop.merchant,account,shop.order])).rows[0];
  assert.ok(linked);assert.equal(linked.customer_id,linked.order_customer);shop.customer=linked.customer_id;
  const auth=await call('session',{body:{email:'merchant@bitpos.invalid',password:'local-fixture-only',merchantId:shop.merchant}});shop.token=auth.token;
  await call('customers/'+shop.customer,{token:shop.token,method:'PATCH',body:{name:shop.name,notes:'Synthetic history fixture; never a real customer'}});
  const history=await call('customers/'+shop.customer+'/history',{token:shop.token});
  assert.deepEqual(history.orders.map(order=>order.id),[shop.order]);
  assert.equal(history.orders[0].pricing.total.amountMinor,'270');
  receipt.checks.push({shop:label,canonicalOrder:shop.order,customer:shop.customer,accountLinkMatchesOrder:true,historyOrderMatches:true});
 }
 assert.notEqual(shops[0].customer,shops[1].customer,'Same mobile account must have distinct merchant customer profiles');
 stage='tenant isolation';
 for(const [own,other] of [[shops[0],shops[1]],[shops[1],shops[0]]]){
  await call('customers/'+other.customer+'/history',{token:own.token,status:404});
  await call('customers/'+other.customer,{token:own.token,method:'PATCH',body:{name:'MUST NOT WRITE'},status:404});
  const customers=await call('customers',{token:own.token});
  assert.deepEqual(customers.customers.map(customer=>customer.id),[own.customer]);
 }
 const names=(await db.query('SELECT id,name FROM bitpos.customers WHERE id=ANY($1::uuid[])',[shops.map(shop=>shop.customer)])).rows;
 for(const shop of shops)assert.equal(names.find(row=>row.id===shop.customer)?.name,shop.name);
 receipt.checks.push({twoWayCrossTenantHistory404:true,twoWayCrossTenantEdit404:true,foreignCustomersAbsent:true,refusedWritesLeftNamesUnchanged:true});
 stage='actual POS history';
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const [index,shop] of shops.entries()){
  const language=index?'th':'en',width=index?390:1440;
  const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();page.setDefaultTimeout(15000);
  await page.goto(web);
  await page.locator('input[name=email]').fill('merchant@bitpos.invalid');await page.locator('input[name=password]').fill('local-fixture-only');
  await page.locator('summary').click();await page.locator('input[name=merchantId]').fill(shop.merchant);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  if(language==='th')await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
  await page.getByRole('button',{name:language==='th'?'ลูกค้า':'Customers',exact:true}).click();
  await page.locator('.customer-profile-row').filter({hasText:shop.name}).click();
  await page.getByRole('button',{name:language==='th'?'โหลดประวัติ':'Load history',exact:true}).click();
  const history=page.getByRole('region',{name:language==='th'?'ประวัติคำสั่งซื้อ':'Order history'});
  const bills=history.locator(':scope>details');await bills.first().waitFor();assert.equal(await bills.count(),1);
  assert.ok((await bills.locator(':scope>summary').innerText()).includes(shop.order.slice(0,8)));
  await bills.locator(':scope>summary').click();
  await history.getByText(language==='th'?'อาหารทดสอบประวัติ':'Local history fixture food',{exact:false}).first().waitFor();
  assert.equal(await history.getByText(shops[1-index].order.slice(0,8),{exact:false}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const image=run+'/history-'+language+'-'+width+'.png';await page.screenshot({path:image,fullPage:true});receipt.screens.push(image);
  receipt.checks.push({language,width,actualUninterceptedPOSHistory:true,oneCanonicalBill:true});await context.close();
 }
 stage='persisted counterpart';
 receipt.sql=(await db.query('SELECT o.id,o.customer_id,o.status,(SELECT count(*)::int FROM bitpos.payment_attempts p WHERE p.order_id=o.id) AS payment_attempts FROM bitpos.orders o WHERE o.id=ANY($1::uuid[]) ORDER BY o.id',[shops.map(shop=>shop.order)])).rows;
 assert.equal(receipt.sql.length,2);for(const order of receipt.sql){assert.equal(order.payment_attempts,0);assert.ok(['AWAITING_WALLET','AWAITING_PAYMENT'].includes(order.status));}
 receipt.status='PASS_REAL_LOCAL_CUSTOMER_HISTORY_ATTRIBUTION_AND_TENANT_ISOLATION';
}catch(error){receipt.status='FAIL_RETAINED';receipt.stage=stage;receipt.error=String(error.message).replace(/[A-Za-z0-9_-]{43}/g,'[redacted]');process.exitCode=1;}
finally{
 await browser?.close();
 try{
  if(shops.length){await db.query('UPDATE bitpos.marketplace_branches SET enabled=false WHERE merchant_id=ANY($1::uuid[])',[shops.map(shop=>shop.merchant)]);await db.query('DELETE FROM bitpos.sessions WHERE merchant_id=ANY($1::uuid[]) AND user_id=$2',[shops.map(shop=>shop.merchant),fixtureUser]);await db.query('DELETE FROM bitpos.members WHERE merchant_id=ANY($1::uuid[]) AND user_id=$2',[shops.map(shop=>shop.merchant),fixtureUser]);}
  await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1',[mobileSession]);await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()) WHERE id=$1',[account]);
  receipt.cleanup=(await db.query(`SELECT
   (SELECT count(*)::int FROM bitpos.marketplace_branches WHERE merchant_id=ANY($1::uuid[]) AND enabled) AS enabled_branches,
   (SELECT count(*)::int FROM bitpos.sessions WHERE merchant_id=ANY($1::uuid[]) AND user_id=$2) AS merchant_sessions,
   (SELECT count(*)::int FROM bitpos.members WHERE merchant_id=ANY($1::uuid[]) AND user_id=$2) AS merchant_memberships,
   EXISTS(SELECT 1 FROM bitpos.mobile_accounts WHERE id=$3 AND disabled_at IS NOT NULL) AS account_disabled,
   EXISTS(SELECT 1 FROM bitpos.mobile_sessions WHERE id=$4 AND revoked_at IS NOT NULL) AS mobile_session_revoked`,
   [shops.map(shop=>shop.merchant),fixtureUser,account,mobileSession])).rows[0];
  if(receipt.status.startsWith('PASS'))assert.deepEqual(receipt.cleanup,{enabled_branches:0,merchant_sessions:0,merchant_memberships:0,account_disabled:true,mobile_session_revoked:true});
 }catch(error){receipt.cleanupError=error.name;receipt.status='FAIL_RETAINED';process.exitCode=1;}
 receipt.sourceFingerprints={};for(const file of ['apps/api/src/index.ts','apps/api/src/mobile-food.ts','apps/web/src/components/Customers.tsx','tools/runtime/pos-customer-history-persisted-smoke.mjs'])receipt.sourceFingerprints[file]=hash(await readFile(file));
 await writeFile(run+'/receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence:run+'/receipt.json',stage:receipt.stage,error:receipt.error}));
 await db.end();await pool?.end();
}
