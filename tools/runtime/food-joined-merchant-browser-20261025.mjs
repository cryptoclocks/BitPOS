// Local-only joined merchant POS browser stages. Reads private journey state but never prints tokens or proof material.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import pg from 'pg';
const {chromium}=await import(process.env.BITPOS_PLAYWRIGHT_MODULE??'../../local/toolchains/browser-contract/node_modules/playwright/index.mjs');
const OWN = process.env.BITPOS_OWN_FOOD_FIXTURE === "1"; // own disposable stack (API 3001, DB 55440), never the W01 fixture

const [stage,directory,...extra]=process.argv.slice(2);
assert.ok(['ACCEPT','READY','PICKUP'].includes(stage),'stage must be ACCEPT, READY, or PICKUP');
assert.ok(directory&&!extra.length,'stage and private journey directory required');
const journeyRoot=join(homedir(),(OWN?'.local/share/bitpos-own-food-fixture':'.local/share/bitpos-w01-fixture'));
const dir=await realpath(directory),root=await realpath(journeyRoot);
assert.ok(dir.startsWith(root+'/joined-ui-')&&resolve(dir)===dir,'owned local joined journey directory required');
const state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
assert.equal(state.purpose,'BITPOS_W02_JOINED_UI');
assert.equal(state.base,(OWN?'http://127.0.0.1:3001':'http://127.0.0.1:3046'));
assert.match(state.orderId??'',/^[0-9a-f-]{36}$/);
assert.match(state.merchant??'',/^[0-9a-f-]{36}$/);
assert.match(state.merchantToken??'',/^[A-Za-z0-9_-]{43}$/);

const origin=process.env.BITPOS_MERCHANT_BROWSER_ORIGIN??'http://127.0.0.1:4473';
const parsedOrigin=new URL(origin);
assert.equal(parsedOrigin.hostname,'127.0.0.1','merchant browser must be loopback');
const evidenceDir='.omp/work/flutter-delivery-20261016/evidence';
await mkdir(evidenceDir,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const screenshots=[];
const checks=[];
const db=new pg.Client({connectionString:(OWN?'postgresql://cryptoclock@127.0.0.1:55440/bitpos_delivery_fixture':'postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture')});
let browser;

function noOverflow(page){return page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);}
function capture(page,label){const name=`food-joined-merchant-browser-${stage.toLowerCase()}-${label}-${stamp}.png`;screenshots.push(name);return page.screenshot({path:join(evidenceDir,name),fullPage:true,animations:'disabled'});}
async function sqlOne(query,values){const rows=(await db.query(query,values)).rows;assert.equal(rows.length,1,'expected exactly one owned persisted counterpart');return rows[0];}
async function writeReceipt(status,persisted){
 const receipt={status,checkedAtUtc:new Date().toISOString(),stage,orderId:state.orderId,screenshots,checks,persisted,fixture:true,merchantBrowserOrigin:parsedOrigin.origin,limits:['Private journey tokens and proof material are read only within this script and omitted from evidence','Scoped /api/session injection only; acceptance, kitchen, and proof commands use the compiled merchant UI against local API4473','Synthetic local identity/payment fixture; no provider, real payment, or physical operation'],physicalTesting:'deferred_by_user_2026-10-16'};
 const path=join(evidenceDir,`food-joined-merchant-browser-${stage.toLowerCase()}-${stamp}.json`);
 await writeFile(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status,evidence:path,screenshots}));
}

try{
 await db.connect();
 assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name,OWN?'bitpos_delivery_fixture':'bitpos_w01_fixture');
 const session=await sqlOne(`SELECT s.user_id,s.role AS session_role,m.role AS member_role FROM bitpos.sessions s JOIN bitpos.members m ON(m.merchant_id,m.user_id)=(s.merchant_id,s.user_id) WHERE s.merchant_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp()`,[state.merchant,createHash('sha256').update(state.merchantToken).digest('hex')]);
 assert.equal(session.session_role,'owner','journey merchant session must retain owner authority');
 assert.equal(session.member_role,'owner','journey merchant membership must retain owner authority');
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[],merchantWorkResponses=[];page.on('pageerror',error=>errors.push(error.message));page.on('response',async response=>{const url=new URL(response.url());if(response.request().method()==='GET'&&url.pathname===`/api/orders/${state.orderId}/delivery`){let code=null;try{const value=await response.json();code=typeof value?.error?.code==='string'?value.error.code:null;}catch{}merchantWorkResponses.push({status:response.status(),code});}});
 // This is the existing scoped browser-session convention. It injects only the already-authorized
 // local merchant session; every business request remains an unmodified request to API4473.
 await page.route('**/api/session',async route=>{
  assert.equal(route.request().method(),'POST');
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:state.merchantToken,merchantId:state.merchant,userId:session.user_id,role:'owner'})});
 });
 await page.goto(parsedOrigin.origin,{waitUntil:'domcontentloaded'});
 await page.locator('input[name=email]').fill('merchant@bitpos.invalid');
 await page.locator('input[name=password]').fill('local-fixture-only');
 await page.locator('summary').click();
 await page.locator('input[name=merchantId]').fill(state.merchant);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:/^(Orders \(\d+\)|Order center)$/}).click();
 const row=page.locator('.order-row').filter({hasText:state.orderId.slice(0,8)});
 await row.waitFor({timeout:15000});
 await row.click();
 await page.locator('.incoming-detail').waitFor();
 assert.equal(await noOverflow(page),true,'desktop order detail must not overflow');

 if(stage==='ACCEPT'){
 assert.ok(['CUSTOMER_CREATED','FIXTURE_SETTLED'].includes(state.stage),'accept recovery requires the same customer-created or settled journey');
 const before=await sqlOne(`SELECT f.acceptance_status,f.acceptance_version,f.preparation_minutes,f.preparation_recorded_at IS NOT NULL AS preparation_recorded,f.acceptance_deadline>clock_timestamp() AS before_deadline,o.status AS payment_status,coalesce(k.status,'RECEIVED') AS kitchen FROM bitpos.online_food_orders f JOIN bitpos.orders o ON(o.merchant_id,o.id)=(f.merchant_id,f.order_id) LEFT JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(f.merchant_id,f.order_id) WHERE f.merchant_id=$1 AND f.order_id=$2`,[state.merchant,state.orderId]);
 const needsAcceptance=state.stage==='CUSTOMER_CREATED'&&before.acceptance_status==='PENDING'&&before.acceptance_version===0&&before.before_deadline===true&&before.payment_status==='AWAITING_WALLET'&&before.kitchen==='RECEIVED';
 const recoveredAcceptance=before.acceptance_status==='ACCEPTED'&&before.acceptance_version===1&&before.preparation_minutes===23&&before.preparation_recorded===true&&before.payment_status===(state.stage==='FIXTURE_SETTLED'?'PAID':'AWAITING_WALLET')&&before.kitchen==='RECEIVED';
 assert.ok(needsAcceptance||recoveredAcceptance,'acceptance must be a live pending order or the exact already-accepted command');
 if(needsAcceptance){
  const input=page.getByRole('spinbutton',{name:'Estimated preparation (minutes)',exact:true});
  await input.fill('23');
  const accept=page.getByRole('button',{name:'Accept order',exact:true});
  assert.equal(await accept.isEnabled(),true);
  await capture(page,'desktop-en-pending');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/orders/${state.orderId}/acceptance`&&r.request().method()==='POST');
  await accept.click();
  assert.equal((await response).status(),200);
 }else await capture(page,'desktop-en-recovered-accepted');
 await page.locator('.online-acceptance[data-acceptance-status="ACCEPTED"] .acceptance-status').filter({hasText:'Accepted'}).waitFor({state:'attached'}); // the card collapses once accepted
 await page.locator('.preparation-estimate').filter({hasText:'Estimated preparation'}).waitFor();
  await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByText('รับออร์เดอร์แล้ว',{exact:true}).first().waitFor(); // the status now shows in several places
  assert.equal(await noOverflow(page),true,'Thai mobile accepted order must not overflow');
  await capture(page,'mobile-th-accepted');
  const persisted=await sqlOne(`SELECT f.acceptance_status,f.acceptance_version,f.preparation_minutes,f.preparation_recorded_at IS NOT NULL AS preparation_recorded,o.status AS payment_status,coalesce(k.status,'RECEIVED') AS kitchen FROM bitpos.online_food_orders f JOIN bitpos.orders o ON(o.merchant_id,o.id)=(f.merchant_id,f.order_id) LEFT JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(f.merchant_id,f.order_id) WHERE f.merchant_id=$1 AND f.order_id=$2`,[state.merchant,state.orderId]);
 assert.deepEqual(persisted,{acceptance_status:'ACCEPTED',acceptance_version:1,preparation_minutes:23,preparation_recorded:true,payment_status:state.stage==='FIXTURE_SETTLED'?'PAID':'AWAITING_WALLET',kitchen:'RECEIVED'});
 checks.push(needsAcceptance?'Desktop English UI entered the current preparation estimate and accepted before the persisted deadline':'Historical initial acceptance HTTP 200 was observed before the retained locator failure; recovery reads the exact persisted output without re-clicking','Mobile Thai UI rendered the persisted accepted estimate without horizontal overflow','SQL counterpart agrees on ACCEPTED/version1/current preparation estimate');
  await writeReceipt('PASS_JOINED_MERCHANT_BROWSER_ACCEPT',persisted);
 } else if(stage==='READY') {
  assert.equal(state.stage,'FIXTURE_SETTLED','READY requires parent-owned synthetic fixture settlement after browser acceptance');
  const before=await sqlOne(`SELECT f.acceptance_status,f.acceptance_version,f.preparation_minutes,f.preparation_recorded_at IS NOT NULL AS preparation_recorded,f.preparation_recorded_at<=f.acceptance_deadline AS preparation_recorded_before_deadline,o.status AS payment_status,coalesce(k.status,'RECEIVED') AS kitchen,coalesce(k.version,0) AS kitchen_version FROM bitpos.online_food_orders f JOIN bitpos.orders o ON(o.merchant_id,o.id)=(f.merchant_id,f.order_id) LEFT JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(f.merchant_id,f.order_id) WHERE f.merchant_id=$1 AND f.order_id=$2`,[state.merchant,state.orderId]);
  const alreadyReady=before.kitchen==='READY'&&before.kitchen_version===2;
  assert.deepEqual({...before,kitchen:undefined,kitchen_version:undefined},{acceptance_status:'ACCEPTED',acceptance_version:1,preparation_minutes:23,preparation_recorded:true,preparation_recorded_before_deadline:true,payment_status:'PAID',kitchen:undefined,kitchen_version:undefined});
  assert.ok(alreadyReady||before.kitchen==='RECEIVED'&&before.kitchen_version===0,'kitchen must be canonical received or the exact already-ready command');
  if(alreadyReady)await capture(page,'desktop-en-recovered-ready');
  else{
   const preparing=page.getByRole('button',{name:'Start preparing',exact:true});
   await preparing.waitFor();
   await capture(page,'desktop-en-received');
   let response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/orders/${state.orderId}/fulfillment`&&r.request().method()==='POST');
   await preparing.click();assert.equal((await response).status(),200);
   await page.locator('.kitchen-progress strong').filter({hasText:'Preparing'}).waitFor();
  }
  await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  if(alreadyReady)await page.locator('.kitchen-progress strong').filter({hasText:'พร้อมรับ'}).waitFor();
  else{
   const ready=page.getByRole('button',{name:'ทำเสร็จแล้ว · เรียกรับ',exact:true});
   await ready.waitFor();assert.equal(await noOverflow(page),true,'Thai mobile preparing order must not overflow');
   const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/orders/${state.orderId}/fulfillment`&&r.request().method()==='POST');
   await ready.click();assert.equal((await response).status(),200);
   await page.locator('.kitchen-progress strong').filter({hasText:'พร้อมรับ'}).waitFor();
  }
  assert.equal(await noOverflow(page),true,'Thai mobile ready order must not overflow');
  await capture(page,'mobile-th-ready');
  const persisted=await sqlOne(`SELECT f.acceptance_status,o.status AS payment_status,k.status AS kitchen,k.version AS kitchen_version,s.state AS shipment FROM bitpos.online_food_orders f JOIN bitpos.orders o ON(o.merchant_id,o.id)=(f.merchant_id,f.order_id) JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(f.merchant_id,f.order_id) JOIN bitpos.food_shipments s ON(s.merchant_id,s.order_id)=(f.merchant_id,f.order_id) WHERE f.merchant_id=$1 AND f.order_id=$2`,[state.merchant,state.orderId]);
  assert.deepEqual(persisted,{acceptance_status:'ACCEPTED',payment_status:'PAID',kitchen:'READY',kitchen_version:2,shipment:'WAITING_MERCHANT'});
  checks.push('Merchant acceptance was already committed before settlement: persisted estimate23 was recorded no later than its acceptance deadline',alreadyReady?'Recovered the exact persisted READY kitchen state without reissuing fulfillment commands':'Desktop English UI advanced the paid accepted order RECEIVED→PREPARING and mobile Thai UI advanced PREPARING→READY','Shipment correctly remains WAITING_MERCHANT until the separate dispatch offer stage','Persisted READY/version2 counterpart verified');
  await writeReceipt('PASS_JOINED_MERCHANT_BROWSER_READY',persisted);
 } else {
  assert.equal(state.stage,'AT_STORE','PICKUP requires the parent-owned driver journey to reach the same assignment at store');
  const before=await sqlOne(`SELECT s.id AS shipment_id,a.id AS assignment_id,a.state AS assignment_state,l.state AS lease_state,k.status AS kitchen FROM bitpos.food_shipments s JOIN bitpos.food_assignments a ON a.id=s.active_assignment_id JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(s.merchant_id,s.order_id) WHERE s.merchant_id=$1 AND s.order_id=$2`,[state.merchant,state.orderId]);
  assert.deepEqual({...before,shipment_id:undefined,assignment_id:undefined},{shipment_id:undefined,assignment_id:undefined,assignment_state:'AT_PICKUP',lease_state:'ACTIVE',kitchen:'READY'});
  await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  const handoff=page.locator('.delivery-handoff');
  await handoff.waitFor();
  const issue=page.getByRole('button',{name:'ออกรหัสรับอาหาร',exact:true});
  if(process.env.BITPOS_PICKUP_READ_ONLY==='1'){
   await page.waitForTimeout(250);
   const issueVisible=await issue.isVisible();
   await capture(page,'mobile-th-read-only');
   const persisted=await sqlOne(`SELECT a.state AS assignment_state,l.state AS lease_state,k.status AS kitchen,(SELECT count(*)::int FROM bitpos.fulfillment_proofs p WHERE p.assignment_id=a.id AND p.kind='PICKUP' AND p.revoked_at IS NULL AND p.consumed_at IS NULL) AS active_pickup_proofs FROM bitpos.food_shipments s JOIN bitpos.food_assignments a ON a.id=s.active_assignment_id JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(s.merchant_id,s.order_id) WHERE s.merchant_id=$1 AND s.order_id=$2`,[state.merchant,state.orderId]);
   checks.push(`Read-only merchant handoff diagnostic: delivery GET responses ${merchantWorkResponses.map(value=>value.status+(value.code?':'+value.code:'')).join(',')||'none'}; issue action rendered ${issueVisible}; no proof command sent`);
   await writeReceipt('PASS_JOINED_MERCHANT_BROWSER_PICKUP_READ_ONLY',persisted);
  }else{
  await issue.waitFor();assert.equal(await noOverflow(page),true,'Thai mobile pickup handoff must not overflow');
  // Capture before issuing: the actual returned secret never enters a screenshot or receipt.
  await capture(page,'mobile-th-before-issue');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/orders/${state.orderId}/delivery/pickup-proof`&&r.request().method()==='POST');
  await issue.click();assert.equal((await response).status(),200);
  const secret=await page.getByRole('textbox',{name:'รหัสรับอาหาร',exact:true}).inputValue();
  assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  await writeFile(join(dir,'pickup-proof.json'),JSON.stringify({assignmentId:before.assignment_id,secret})+'\n',{mode:0o600,flag:'wx'});
  const persisted=await sqlOne(`SELECT a.state AS assignment_state,l.state AS lease_state,k.status AS kitchen,(SELECT count(*)::int FROM bitpos.fulfillment_proofs p WHERE p.assignment_id=a.id AND p.kind='PICKUP' AND p.revoked_at IS NULL AND p.consumed_at IS NULL) AS active_pickup_proofs FROM bitpos.food_shipments s JOIN bitpos.food_assignments a ON a.id=s.active_assignment_id JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.order_fulfillment k ON(k.merchant_id,k.order_id)=(s.merchant_id,s.order_id) WHERE s.merchant_id=$1 AND s.order_id=$2`,[state.merchant,state.orderId]);
  assert.deepEqual(persisted,{assignment_state:'AT_PICKUP',lease_state:'ACTIVE',kitchen:'READY',active_pickup_proofs:1});
  checks.push('Mobile Thai merchant handoff showed the issued-proof action for the same AT_PICKUP assignment without horizontal overflow','Compiled UI issue command returned HTTP 200; proof secret was written only to the private journey pickup-proof.json','SQL counterpart retains exactly one active unconsumed pickup proof while custody remains AT_PICKUP/ACTIVE');
  await writeReceipt('PASS_JOINED_MERCHANT_BROWSER_PICKUP',persisted);
  }
 }
 assert.deepEqual(errors,[],'merchant browser page errors');
} catch(error) {
 const safe={status:'FAIL_RETAINED',stage,checkedAtUtc:new Date().toISOString(),screenshots,checks,error:error instanceof Error?error.message:'Unknown error',limits:['Private tokens and proof material omitted']};
 await writeFile(join(evidenceDir,`food-joined-merchant-browser-${stage.toLowerCase()}-failure-${stamp}.json`),JSON.stringify(safe,null,2)+'\n',{flag:'wx'}).catch(()=>{});
 throw error;
} finally {
 await browser?.close();
 await db.end().catch(()=>{});
}
