// Actual anonymous local PayMenu GET; fault/empty responses explicitly labelled presentation fixtures.
// No identity seeding, order creation, wallet discovery, signing or payment writes.
import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID,createHash} from 'node:crypto';import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
const web=new URL(process.env.BITPOS_PAY_UI_ORIGIN??'');assert.equal(web.hostname,'127.0.0.1');assert.equal(web.protocol,'http:');
const db=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture',statement_timeout:10000});await db.connect();
const evidence='.omp/work/flutter-delivery-20261016/evidence/pay-menu-read-'+new Date().toISOString().replaceAll(':','-')+'.json',scratch=await mkdtemp(join(tmpdir(),'bitpos-pay-menu-read-'));
const receipt={status:'RUNNING',fixture:true,scratchDirectory:scratch,captures:[],checks:[],limits:['Actual existing local anonymous menu GET and unchanged SQL authority; injected403/404/503/empty responses are presentation fixtures','No wallet/payment/provider/chain or field operations','Full WD02/Pay design and platform acceptance not inferred'],physicalTesting:'deferred_by_user_2026-10-16'};
let browser;
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_w01_fixture');
 const candidates=(await db.query("SELECT o.id,o.access_token FROM bitpos.orders o JOIN bitpos.order_authority a ON(a.merchant_id,a.order_id)=(o.merchant_id,o.id) WHERE a.source_kind='online' AND o.status IN('PAID','RECOVERY','EXPIRED') ORDER BY o.created_at DESC LIMIT 30")).rows;
 let selected;
 for(const order of candidates){const response=await fetch('http://127.0.0.1:3046/api/pay/'+encodeURIComponent(order.access_token)+'/menu');if(!response.ok)continue;const body=await response.json();if(body.menu?.products?.some(p=>p.unitPrice)&&body.menu.products.every(p=>!p.imageUrl||p.imageUrl.startsWith('/'))){selected={order,body};break;}}
 assert.ok(selected,'Existing named disposable fixture must have an anonymous menu with authoritative prices and local/no product images');
 receipt.orderId=selected.order.id;const menuUrl='/pay/'+encodeURIComponent(selected.order.access_token)+'/menu';
 const facts=async()=>(await db.query('SELECT o.status,o.version,(SELECT count(*)::int FROM bitpos.payment_attempts a WHERE a.order_id=o.id) attempts,(SELECT jsonb_agg(jsonb_build_array(p.id,p.stock,p.reserved) ORDER BY p.id) FROM bitpos.products p WHERE p.merchant_id=o.merchant_id) stock FROM bitpos.orders o WHERE o.id=$1',[selected.order.id])).rows[0];const before=await facts();
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const {width,language} of [{width:1440,language:'en'},{width:390,language:'th'},{width:320,language:'en'}]){
  const th=language==='th',page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(4000);let phase='hold',release;const hold=new Promise(resolve=>{release=resolve;});const mutations=[],errors=[];
  page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))mutations.push({method:request.method(),path:new URL(request.url()).pathname.replace(/[A-Za-z0-9_-]{43}/g,'[fixture-token]')});});page.on('pageerror',error=>errors.push(error.name));
  const captureState=async state=>{const name='pay-menu-'+state+'-'+language+'-'+width+'.png';await page.screenshot({path:join(scratch,name),fullPage:true});receipt.captures.push(name);};
  await page.clock.install();
  await page.route('**/api/pay/*/menu',async route=>{
   if(phase==='hold')await hold;
   if(phase==='live')return route.continue();
   if(phase==='empty')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...selected.body,menu:{...selected.body.menu,products:[],asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString()}})});
   const status=phase==='unauthorized'?401:phase==='denied'?403:phase==='unavailable'?404:503;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:status===401?'UNAUTHORIZED':status===403?'FORBIDDEN':status===404?'RESOURCE_NOT_FOUND':'FIXTURE_READ_FAILED',message:'Labelled synthetic menu read failure',retryable:status===503}})});
  });
  await page.goto(new URL(menuUrl,web).href,{waitUntil:'domcontentloaded'});await page.locator('.table-loading').waitFor();if(th)await page.getByRole('button',{name:'เปลี่ยนเป็นภาษาไทย',exact:true}).click();
  phase='denied';release();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.table-loading').count(),0,'Denied first read must not continue to claim loading');
  await captureState('denied');
  const refresh=async()=>{const response=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/menu')&&new URL(response.url()).pathname.startsWith('/api/pay/'));await page.getByRole('button',{name:th?'รีเฟรชเมนู':'Refresh menu',exact:true}).click();await response;await page.waitForFunction(()=>!document.querySelector('.table-footer button').disabled);};phase='live';await refresh();await page.locator('.table-product').first().waitFor();
  assert.equal(await page.locator('.table-product').count(),selected.body.menu.products.length);const livePrices=await page.locator('.table-product-price strong').allTextContents();assert.ok(livePrices.some(price=>/\d/.test(price)));
  const search=page.getByRole('searchbox');await search.fill('no-fixture-match-'+randomUUID());await page.locator('.pay-menu-empty').waitFor();await page.getByRole('button',{name:th?'ล้างการค้นหา':'Clear search',exact:true}).click();await page.locator('.table-product').first().waitFor();
  phase='transient';await refresh();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.table-product').count(),selected.body.menu.products.length);assert.ok((await page.locator('.table-product-price strong').allTextContents()).every(price=>!(/\d/.test(price))),'Failed refresh must not advertise stale amounts as current prices');
  await captureState('transient');
  phase='live';await refresh();await page.getByRole('alert').waitFor({state:'detached'});assert.ok((await page.locator('.table-product-price strong').allTextContents()).some(price=>/\d/.test(price)));
  phase='empty';await refresh();await page.locator('.table-product').first().waitFor({state:'detached'});await page.locator('.pay-menu-empty').waitFor();assert.equal(await page.getByRole('button',{name:th?'ล้างการค้นหา':'Clear search',exact:true}).count(),0);
  await captureState('empty');
  phase='unavailable';await refresh();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.table-loading').count(),0);assert.equal(await page.locator('.pay-menu-empty').count(),0,'Unavailable response is not authoritative empty');
  phase='live';await refresh();await page.locator('.table-product').first().waitFor();assert.equal(await page.getByRole('link',{name:th?'กลับไปบิลเดิม':'Back to my bill',exact:true}).getAttribute('href'),menuUrl.slice(0,-5));
  for(const deniedPhase of ['unauthorized','denied','unavailable']){
   phase='live';await refresh();await page.locator('.table-product').first().waitFor();
   phase=deniedPhase;await refresh();assert.equal(await page.locator('.table-product').count(),0);
   phase='transient';await refresh();await page.clock.fastForward(61000);
   assert.equal(await page.locator('.table-product').count(),0,'Denied catalog must stay absent across transient failure and the original lease expiry');
   assert.equal(await page.locator('.table-heading a[href^="/table/"]').count(),0);
  }
  phase='live';await refresh();await page.locator('.table-product').first().waitFor();
  receipt.checks.push({width,language,deniedTransientLeaseFence:[401,403,404],clock:'Playwright controlled elapsed time; HTTP failures are presentation fixtures'});
  await page.evaluate(async()=>{await document.fonts.ready;});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  const capture='pay-menu-recovered-'+language+'-'+width+'.png';await page.screenshot({path:join(scratch,capture),fullPage:true});receipt.captures.push(capture);receipt.checks.push({width,language,loadingDeniedRecovery:true,searchClearRecovery:true,transientStalePriceSuppression:true,emptyDistinctFromUnavailable:true,recoveredActualLocalGet:true,billLinkPreserved:true,mutations,errors});await page.close();
 }
 assert.deepEqual(await facts(),before);receipt.persistedAuthorityUnchanged={orderStatus:before.status,orderVersion:before.version,paymentAttempts:before.attempts,stockUnchanged:true};
 receipt.sourceHashes=Object.fromEntries(await Promise.all(['apps/web/src/components/PayMenu.tsx','apps/web/src/lib/menu.ts','tools/runtime/pay-menu-read-smoke.mjs'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));receipt.status='PASS_ACTUAL_ANONYMOUS_MENU_READ_AND_RECOVERY_FIXTURES';
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error?.message??error).replace(/[A-Za-z0-9_-]{43}/g,'[fixture-token]');process.exitCode=1;}
finally{await browser?.close();await db.end();await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,scratch,error:receipt.error}));}
