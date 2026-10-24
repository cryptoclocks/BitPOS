// Canonical local quote/order -> real Astro Payment route. No wallet/provider signing.
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
const databaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL;
const url=new URL(databaseUrl??'');
assert.equal(url.hostname,'127.0.0.1');
const w01=url.port==='55446'&&url.pathname==='/bitpos_w01_fixture';
assert.ok(w01||url.port==='55440'&&url.pathname==='/bitpos_delivery_fixture','Named disposable local fixture only');
const apiOrigin=w01?'http://127.0.0.1:3046':'http://127.0.0.1:3043';
const base=apiOrigin+'/api/mobile/v1/',web=w01?'http://127.0.0.1:4422':'http://127.0.0.1:4326',evidence='.omp/work/flutter-delivery-20261016/evidence/';
const runStamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const scratchCaptures=[];
const db=new pg.Client({connectionString:databaseUrl,statement_timeout:10000});await db.connect();
const account=randomUUID(),session=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url'),hash=x=>createHash('sha256').update(x).digest('hex');let browser,orderId,appPool,fixtureMerchant,result,stage='seed';
const checks=[];
try{
 const connected=(await db.query('SELECT current_database() name,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.equal(connected.host,'127.0.0.1');assert.equal(connected.name,w01?'bitpos_w01_fixture':'bitpos_delivery_fixture');assert.equal(connected.port,Number(url.port));
 process.env.DOTENV_CONFIG_PATH='/dev/null';
 Object.assign(process.env,{DATABASE_URL:databaseUrl.replace('cryptoclock@','bitpos_app@'),ADMIN_DATABASE_URL:databaseUrl,AUTH_URL:w01?'http://127.0.0.1:55447':'http://127.0.0.1:55441',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:web,SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
 const {tenant,pool}=await import('../../apps/api/src/db.ts');appPool=pool;const {publishPrices}=await import('../../apps/api/src/catalog.ts');const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index.ts');
 const merchant=randomUUID(),branch=randomUUID(),product=randomUUID();fixtureMerchant=merchant;
 await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'PAY UI DISPOSABLE FIXTURE','11111111111111111111111111111111')",[merchant]);
 await db.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled,delivery_enabled) VALUES($1,$2,'Runtime UI fixture','Runtime UI fixture',true,true,false)",[merchant,branch]);
 await tenant(merchant,async client=>{
  await client.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Runtime UI fixture food','Runtime UI fixture food','',270,5)",[product,merchant]);
  await publishPrices(client,merchant,account,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL PAY UI FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 });
 const source={branch,snapshot:{lines:[{name:'Runtime UI fixture food'}]}};
 await db.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,'Pay runtime UI fixture','en')",[account,randomUUID()]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[session,account,randomUUID(),hash(access),hash(refresh)]);
 async function call(path,body){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,`Canonical ${path} status ${value.error?.code??""}`);return value;}
 stage='canonical-order';const quote=await call('food/quotes',{branchId:source.branch,serving:'pickup',items:[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}]});assert.equal(quote.total.amountMinor,'270');
 const created=await call('food/orders',{branchId:source.branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()});orderId=created.order.id;
 const persisted=(await db.query('SELECT status,access_token FROM bitpos.orders WHERE id=$1',[orderId])).rows[0];assert.ok(['AWAITING_WALLET','AWAITING_PAYMENT'].includes(persisted.status));
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const width of [1440,390,320]){
  stage='Payment route '+width;const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.goto(web+'/pay/'+persisted.access_token);await page.locator('.checkout-summary').waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.locator('.checkout-content').getByText('Total to pay',{exact:true}).or(page.locator('.checkout-content').getByText('ยอดชำระ',{exact:true})).waitFor();
  if(width<1000)await page.locator('.checkout-summary>summary').click();
  await page.getByText(source.snapshot.lines[0].name,{exact:false}).first().waitFor();
  await page.locator('#payment-asset-quote').waitFor();
  assert.equal((await page.locator('#payment-asset option:checked').innerText()).includes('2.700000'),false);
  assert.ok((await page.locator('#payment-asset-quote').innerText()).includes('2.700000'));
  const formula=page.getByText('USD_CENTS_TO_USDG_1_TO_1',{exact:false});assert.equal(await formula.isVisible(),false);
  await page.locator('.checkout-details>summary').click();assert.equal(await formula.isVisible(),true);
  await page.locator('.checkout-details>summary').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  const geometry=await page.locator('.checkout-summary,.checkout-content').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));assert.equal(geometry.length,2);
  if(width===1440){assert.ok(Math.abs(geometry[0].x-96)<1);assert.ok(Math.abs(geometry[0].width-744)<1);assert.ok(Math.abs(geometry[1].x-872)<1);assert.ok(Math.abs(geometry[1].width-472)<1);}
  const capture=`/tmp/bitpos-pay-unpaid-${width}-${runStamp}.png`;await page.screenshot({path:capture,fullPage:true});scratchCaptures.push(capture);
  checks.push({width,geometry,noHorizontalOverflow:true,pageErrors:errors,actualOrderBill:true});await page.close();
 }
 stage='post-run-sql';const after=(await db.query("SELECT status,(SELECT count(*)::int FROM bitpos.payment_attempts p WHERE p.order_id=o.id) attempts,(SELECT count(*)::int FROM bitpos.order_configured_food c WHERE c.order_id=o.id AND c.snapshot->'total'->>'amountMinor'='270') frozen_snapshot FROM bitpos.orders o WHERE id=$1",[orderId])).rows[0];assert.equal(after.status,persisted.status);assert.equal(after.attempts,0);assert.equal(after.frozen_snapshot,1);
 result={status:'PASS_ACTUAL_LOCAL_CANONICAL_ORDER_AND_PAYMENT_ROUTE_LAYOUT',orderId,checks,sql:after,scratchCaptures,fixture:`Synthetic seeded identity; actual quote/order HTTP; named disposable PostgreSQL${url.port}; real Astro Payment route${new URL(web).port} and ${apiOrigin}`,limits:['No wallet connected or signing/settlement/provider/chain transaction','Unconfigured payment assets may remain unavailable; not full checkout completion','Full-page pixel certification remains open'],physicalTesting:'deferred_by_user_2026-10-16'};
}catch(error){console.error('PAY_ROUTE_CHECK_FAILED',stage,error.name,String(error.message).replace(/[A-Za-z0-9_-]{43}/g,'[redacted]'));process.exitCode=1;}
finally{
 await browser?.close();
 try{
  if(fixtureMerchant)await db.query('UPDATE bitpos.marketplace_branches SET enabled=false WHERE merchant_id=$1',[fixtureMerchant]);
  await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1',[session]);
  await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()) WHERE id=$1',[account]);
  if(result){
   const cleanup=(await db.query('SELECT a.disabled_at IS NOT NULL AS account_disabled,s.revoked_at IS NOT NULL AS session_revoked,(SELECT count(*)::int FROM bitpos.marketplace_branches WHERE merchant_id=$3 AND enabled) AS enabled_branches FROM bitpos.mobile_accounts a JOIN bitpos.mobile_sessions s ON s.account_id=a.id WHERE a.id=$1 AND s.id=$2',[account,session,fixtureMerchant])).rows[0];
   assert.deepEqual(cleanup,{account_disabled:true,session_revoked:true,enabled_branches:0});
   result.cleanup=cleanup;result.checkedAtUtc=new Date().toISOString();
   result.sourceFingerprints={};for(const file of ['apps/web/src/components/Payment.tsx','apps/web/src/styles/customer-checkout.css','apps/web/src/styles/figcraft-checkout-metrics.css'])result.sourceFingerprints[file]=hash(await readFile(file));
   const receipt=evidence+'pay-layout-http-browser-'+runStamp+'.json';await writeFile(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'PASS_ACTUAL_LOCAL_PAYMENT_ROUTE_LAYOUT',evidence:receipt,scratchCaptures}));
  }
 }finally{await db.end();await appPool?.end();}
}
