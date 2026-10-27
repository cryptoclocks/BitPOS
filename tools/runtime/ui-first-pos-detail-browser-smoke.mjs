// Read-only local presentation matrix. GET overrides are fixtures, not persisted delivery proof.
import assert from 'node:assert/strict';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const origin=process.env.BITPOS_UI_ORIGIN;
assert.ok(origin,'BITPOS_UI_ORIGIN is required');
assert.equal(new URL(origin).hostname,'127.0.0.1','Loopback fixtures only');
const stageStates=process.env.BITPOS_UI_STATE_MATRIX==='handoff-stages';
const stageLabels={
 WAITING_MERCHANT:['รอร้านจัดเตรียม','Waiting for the kitchen'],
 WAITING_PAYMENT:['รอยืนยันการชำระเงิน','Waiting for payment confirmation'],
 READY_FOR_DISPATCH:['กำลังหาคนส่ง','Finding a rider'],
 OFFERING:['กำลังเสนอให้คนส่ง','Offering the job to riders'],
 PICKED_UP:['กำลังจัดส่ง','On the way'],
 AT_DROPOFF:['คนส่งถึงจุดส่งแล้ว','Rider at destination'],
 DELIVERED:['ส่งถึงลูกค้าแล้ว','Delivered to customer'],
 CANCELLED:['ยกเลิกการจัดส่ง','Delivery cancelled'],
 FAILED:['การจัดส่งมีปัญหา','Delivery needs attention'],
 INCIDENT:['เกิดปัญหาการจัดส่ง · ต้องตรวจสอบ','Delivery incident · attention required'],
};
const kitchenStates=process.env.BITPOS_UI_STATE_MATRIX==='kitchen';
const boardStates=process.env.BITPOS_UI_STATE_MATRIX==='board'||kitchenStates;
const pendingStates=process.env.BITPOS_UI_STATE_MATRIX==='handoff-pending';
const detailReadStates=process.env.BITPOS_UI_STATE_MATRIX==='detail-read';
const detailRecoveryStates=process.env.BITPOS_UI_STATE_MATRIX==='detail-recovery';
const postCommandRecoveryStates=process.env.BITPOS_UI_STATE_MATRIX==='post-command-recovery';
const readStates=process.env.BITPOS_UI_STATE_MATRIX==='handoff-read'||pendingStates;
const acceptanceMatrixStates=process.env.BITPOS_UI_STATE_MATRIX==='acceptance-matrix';
const revision=postCommandRecoveryStates?'r17-post-command-recovery':detailRecoveryStates?'r16-detail-recovery':detailReadStates?'r15-detail-read':kitchenStates?'r14-kitchen-final':stageStates?'r13-handoff-stages':boardStates?'r12-board':pendingStates?'r11-handoff-pending':readStates?'r10-handoff-read':'r9';
const evidence=process.env.BITPOS_UI_EVIDENCE_DIR??'.omp/work/flutter-delivery-20261016/evidence/';
const stamp=new Date().toISOString().replaceAll(':','-'),scratch=await mkdtemp(join(tmpdir(),'bitpos-pos-fidelity-')),captureDirectory=process.env.BITPOS_UI_CAPTURE_DIR??scratch;
const fingerprint=JSON.parse(execFileSync('python3',['.omp/work/flutter-delivery-20261016/gate.py','fingerprint'],{encoding:'utf8'})).source_fingerprint;
const receipt={status:'RUNNING',source_fingerprint:fingerprint,origin,fixture:true,evidenceDirectory:evidence,scratchDirectory:scratch,scratchCleanup:'CLEANED_BY_AUTHOR_AFTER_CAPTURE',checks:[],captures:[],limits:['Only GET order/detail/delivery responses overridden; no business commands permitted','Full compiled POS shell, synthetic domain state; not persisted custody/payment or joined E2E proof','Evidence watermark is injected by runner, not product UI','Physical testing deferred_by_user_2026-10-16']};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const scenario of (postCommandRecoveryStates?[{state:'AT_PICKUP',language:'en',width:1440}]:detailRecoveryStates?[{state:'AT_PICKUP',language:'th',width:390},{state:'AT_PICKUP',language:'en',width:1440}]:detailReadStates?[{state:'AT_PICKUP',language:'en',width:1440,readStatus:503},{state:'AT_PICKUP',language:'th',width:390,readStatus:403},{state:'AT_PICKUP',language:'en',width:320,readStatus:404}]:stageStates?Object.keys(stageLabels).flatMap(state=>[{state,language:'en',width:1440},{state,language:'th',width:320}]):boardStates?[
  {state:'AT_PICKUP',language:'th',width:1440},
  {state:'AT_PICKUP',language:'en',width:1440},
  {state:'AT_PICKUP',language:'th',width:390},
  {state:'AT_PICKUP',language:'en',width:390},
  {state:'AT_PICKUP',language:'th',width:320},
 ]:pendingStates?[
  {state:'AT_PICKUP',language:'en',width:320,readStatus:503,pending:true},
 ]:readStates?[
  {state:'AT_PICKUP',language:'en',width:320,readStatus:403},
  {state:'AT_PICKUP',language:'th',width:390,readStatus:403},
  {state:'AT_PICKUP',language:'en',width:1440,readStatus:503},
  {state:'AT_PICKUP',language:'th',width:320,readStatus:503},
  {state:'AT_PICKUP',language:'en',width:390,readStatus:404},
  {state:'AT_PICKUP',language:'th',width:1440,readStatus:404},
 ]:acceptanceMatrixStates?[
  {state:'PENDING',language:'th',width:390},
  {state:'PENDING',language:'en',width:1440},
  {state:'AT_PICKUP',language:'th',width:390},
  {state:'AT_PICKUP',language:'th',width:1440,preparationMinutes:37},
  {state:'AT_PICKUP',language:'en',width:320},
  {state:'AT_PICKUP',language:'en',width:1440,preparationMinutes:37},
 ]:[
  {state:'PENDING',language:'th',width:390},
  {state:'PENDING',language:'en',width:320},
  {state:'PENDING',language:'en',width:1440},
  {state:'ASSIGNED',language:'en',width:1440},
  {state:'AT_PICKUP',language:'th',width:1440,preparationMinutes:37},
  {state:'AT_PICKUP',language:'en',width:320},
  {state:'AT_PICKUP',language:'th',width:390,longNotes:true},
 ]).filter(scenario=>process.env.BITPOS_UI_FOCUS==='S12'?scenario.state==='PENDING':process.env.BITPOS_UI_FOCUS==='P40_EN'?scenario.state==='AT_PICKUP'&&scenario.language==='en'&&scenario.width===1440:process.env.BITPOS_UI_FOCUS!=='P40'||scenario.state==='AT_PICKUP'&&scenario.language==='th'&&scenario.width===1440)){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const commandRequests=[];
  await page.goto(origin);
  await page.locator('input[name=email]').fill('merchant@bitpos.invalid');
  await page.locator('input[name=password]').fill('local-fixture-only');
  await page.locator('summary').click();
  await page.locator('input[name=merchantId]').fill('32d7d169-28b8-490a-b773-f81db3f447c4');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const listResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='GET'&&r.ok());
  await page.getByRole('button',{name:'Orders (0)',exact:true}).click();
  const list=await (await listResponse).json();
  assert.ok(list.orders?.length,'Local order fixture missing');
  const detailResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/orders/'+list.orders[0].id&&response.request().method()==='GET'&&response.status()===200);
  await page.locator('.order-row').first().click();
  const baseline=await (await detailResponse).json();
  await page.getByRole('button',{name:'Close order details',exact:true}).click();
  assert.equal(baseline.authority.source.kind,'online');
  assert.equal(baseline.authority.serving.kind,'delivery');
  if(baseline.configuredFoodLineCount)assert.ok(baseline.configuredFood,'Full selected-order DTO must retain its immutable configured-food snapshot');
  const fixture=structuredClone(baseline);
  fixture.onlineAcceptance={...fixture.onlineAcceptance,status:scenario.state==='PENDING'?'PENDING':'ACCEPTED',deadline:new Date(Date.now()+3600000).toISOString(),preparation:scenario.preparationMinutes?{minutes:scenario.preparationMinutes,recordedAt:'2026-10-23T20:00:00.000Z'}:null};
  fixture.fulfillment={...fixture.fulfillment,status:scenario.state==='PENDING'?'RECEIVED':'READY'};
  if(stageStates&&scenario.state==='WAITING_PAYMENT')fixture.status='AWAITING_PAYMENT';
  const allergy='LOCAL FIXTURE: Peanut and shellfish allergy. Keep preparation utensils separate. ข้อมูลจำลอง แพ้ถั่วและกุ้ง กรุณาแยกอุปกรณ์ประกอบอาหาร';
  if(scenario.longNotes){assert.ok(fixture.configuredFood?.lines.length);fixture.configuredFood.lines[0].allergyNote=allergy;}
  const shipmentId='10000000-0000-4000-8000-000000000004',assignmentId='10000000-0000-4000-8000-000000000005';
  let readFailureActive=!!scenario.readStatus&&!scenario.pending&&!detailReadStates;
  let selectedReadFailure=0,selectedReadLoading=detailRecoveryStates,selectedRefreshLoading=false,listReadFailure=0,listReadLoading=false,listReadEmpty=false,postCommandRefreshFailure=false,releaseSelectedRead,releaseSelectedRefresh,releaseListRead;
  const selectedReadGate=new Promise(resolve=>{releaseSelectedRead=resolve;}),selectedRefreshGate=new Promise(resolve=>{releaseSelectedRefresh=resolve;}),listReadGate=new Promise(resolve=>{releaseListRead=resolve;});
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(postCommandRecoveryStates&&request.method()==='POST'&&path==='/api/orders/'+fixture.id+'/delivery/pickup-proof'){
    commandRequests.push({method:request.method(),path,body:request.postDataJSON()});
    postCommandRefreshFailure=true;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({proofId:'10000000-0000-4000-8000-000000000006',assignmentId,kind:'PICKUP',expiresAt:new Date(Date.now()+300000).toISOString(),generation:'1',leaseGeneration:'1',replayed:false,secretRecoveryRequired:false,secret:'abcdefghijklmnopqrstuvwxyzABCDEFG1234567890'})});
    return;
   }
   if(request.method()!=='GET'){commandRequests.push({method:request.method(),path,body:scenario.pending?request.postDataJSON():undefined});await route.abort();return;}
   if(path==='/api/orders/'+fixture.id&&selectedReadLoading)await selectedReadGate;
   if(path==='/api/orders/'+fixture.id&&selectedRefreshLoading)await selectedRefreshGate;
   if(postCommandRecoveryStates&&postCommandRefreshFailure&&path==='/api/orders/'+fixture.id){
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'REQUEST_FAILED',message:'Local post-command refresh fixture',retryable:true}})});
    return;
   }
   if(path==='/api/orders/'+fixture.id&&selectedReadFailure){
    await route.fulfill({status:selectedReadFailure,contentType:'application/json',body:JSON.stringify({error:{code:selectedReadFailure===403?'FORBIDDEN':'REQUEST_FAILED',message:'Local selected-order read fixture',retryable:selectedReadFailure===503}})});
    return;
   }
   if(path==='/api/orders/'+fixture.id+(detailReadStates?'':'/delivery')&&readFailureActive){
    await route.fulfill({status:scenario.readStatus,contentType:'application/json',body:JSON.stringify({error:{code:scenario.readStatus===404?'RESOURCE_NOT_FOUND':'REQUEST_FAILED',message:'Local handoff read fixture',retryable:scenario.readStatus===503}})});
    return;
   }
   if(path==='/api/orders'&&listReadLoading)await listReadGate;
   if(path==='/api/orders'&&listReadFailure){
    await route.fulfill({status:listReadFailure,contentType:'application/json',body:JSON.stringify({error:{code:listReadFailure===401?'AUTH_REQUIRED':listReadFailure===403?'FORBIDDEN':'REQUEST_FAILED',message:'Local order-list read fixture',retryable:listReadFailure===503}})});
    return;
   }
   let body;
   if(path==='/api/orders')body={orders:listReadEmpty?[]:kitchenStates?['RECEIVED','PREPARING','READY','COLLECTED'].map((status,index)=>({...structuredClone(fixture),id:index===0?fixture.id:`10000000-0000-4000-8000-00000000000${index+1}`,fulfillment:{...structuredClone(fixture.fulfillment),status},authority:index===0?{...structuredClone(fixture.authority),serving:{...structuredClone(fixture.authority.serving),kind:'delivery',label:'Delivery'}}:structuredClone(fixture.authority)})):[fixture]};
   else if(path==='/api/orders/'+fixture.id)body=fixture;
   else if(path==='/api/orders/'+fixture.id+'/delivery'){
    const activeStage=({ASSIGNED:'ACCEPTED',AT_PICKUP:'AT_PICKUP',PICKED_UP:'PICKED_UP',AT_DROPOFF:'AT_DROPOFF',INCIDENT:'INCIDENT'})[scenario.state];
    body={shipmentId,state:scenario.state==='PENDING'?'WAITING_MERCHANT':scenario.state,version:'1',generation:'1',assignment:activeStage?{id:assignmentId,state:activeStage,generation:'1',leaseGeneration:'1',rider:activeStage==='INCIDENT'?null:{displayName:'SYNTHETIC FIXTURE RIDER'},pickupProof:null}:null};
   }
   else if(path.includes('/food/assignments/'))body={assignmentId,shipmentVersion:'1',case:null};
   if(body===undefined)await route.continue();else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  if(scenario.language==='th')await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
  await page.setViewportSize({width:scenario.width,height:scenario.width>900?1000:844});
  if(postCommandRecoveryStates)await page.locator('.order-row').waitFor();else await page.locator(scenario.width<=600?'.order-mobile-refresh':'.incoming-heading>button').click();
  if(kitchenStates){
   await page.waitForFunction(()=>document.querySelectorAll('.order-row').length===4);
   if(scenario.width<=600)await page.getByRole('button',{name:scenario.language==='th'?'เมนูและบัญชีร้าน':'Workspace navigation and account',exact:true}).click();
   await page.getByRole('button',{name:scenario.language==='th'?'คิวครัว':'Kitchen queue',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.order-row').length===4);
   await page.getByRole('heading',{name:scenario.language==='th'?'คิวครัว':'Kitchen queue',exact:true}).waitFor();
   const active=await page.locator('.workspace-tabs>button[aria-current=page]').allTextContents();
   assert.deepEqual(active,[scenario.language==='th'?'คิวครัว':'Kitchen queue']);
  }
  if(boardStates){
   await page.locator('.order-row').first().waitFor();
   // Font loading changes toolbar/lane heights; measure the same settled layout we capture.
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
   assert.equal(await page.locator('.order-lane').count(),4);
   if(kitchenStates){assert.deepEqual(await page.locator('.order-lane').evaluateAll(lanes=>lanes.map(lane=>({label:lane.getAttribute('aria-label'),orders:lane.querySelectorAll('.order-row').length}))),scenario.language==='th'?[{label:'รับออร์เดอร์แล้ว',orders:1},{label:'กำลังทำ',orders:1},{label:'พร้อมรับ',orders:1},{label:'รับสินค้าแล้ว',orders:1}]:[{label:'Received',orders:1},{label:'Preparing',orders:1},{label:'Ready for pickup',orders:1},{label:'Collected',orders:1}]);assert.equal(await page.getByText(scenario.language==='th'?'ส่งถึงลูกค้าแล้ว':'Delivered to customer',{exact:true}).count(),0);}
   const boardGeometry=await page.evaluate(()=>({
    viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
    toolbar:(()=>{const e=document.querySelector('.order-toolbar'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:r.x,y:r.y,width:r.width,height:r.height,marginBottom:s.marginBottom,rowGap:s.rowGap};})(),
    lanes:[...document.querySelectorAll('.order-lane')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}),
    navigation:[...document.querySelectorAll('.workspace-tabs>button')].map(e=>({text:e.textContent,current:e.getAttribute('aria-current'),hover:e.matches(':hover'),background:getComputedStyle(e).backgroundColor,shadow:getComputedStyle(e).boxShadow})),
   }));
   assert.equal(boardGeometry.overflow,false);
   if(scenario.width===1440){
    for(const lane of boardGeometry.lanes)assert.ok(Math.abs(lane.width-272)<2);
    assert.ok(Math.abs(boardGeometry.lanes[0].x-264)<2);
   }
   if(kitchenStates){
    await page.mouse.move(scenario.width-5,scenario.width>900?950:800);
    await page.evaluate(()=>document.fonts.ready);
    const navigation=await page.locator('.workspace-tabs>button').evaluateAll(nodes=>nodes.map(e=>({text:e.textContent,current:e.getAttribute('aria-current'),hover:e.matches(':hover'),background:getComputedStyle(e).backgroundColor,shadow:getComputedStyle(e).boxShadow})));
    const matchedBackgroundRules=await page.evaluate(()=>{
     const target=document.querySelector('.workspace-tabs>button[aria-current=page]'),rules=[];
     function collect(list){for(const rule of list){if(rule.media&&!matchMedia(rule.media.mediaText).matches)continue;if(rule.selectorText&&target?.matches(rule.selectorText)&&rule.style?.background)rules.push({selector:rule.selectorText,background:rule.style.background});if(rule.cssRules)collect(rule.cssRules);}}
     for(const sheet of document.styleSheets){try{collect(sheet.cssRules);}catch{}}
     return rules;
    });
    receipt.checks.push({scenario,matchedBackgroundRules});
    receipt.checks.push({scenario,navigationBeforePointerClear:boardGeometry.navigation,navigationAfterPointerClear:navigation});
   }
   await page.addStyleTag({content:'body::after{content:"LOCAL PRESENTATION FIXTURE · no payment/delivery performed";position:fixed;bottom:0;left:0;right:0;background:#fff4cb;color:#3b2600;font:10px/14px sans-serif;text-align:center;z-index:10000;pointer-events:none}'});
   const capture='ui-first-pos-'+revision+'-'+scenario.language+'-'+scenario.width+'-20261023.png';
   await page.screenshot({path:join(captureDirectory,capture),animations:'disabled'});
   if(kitchenStates){
    const navigation=await page.locator('.workspace-tabs>button').evaluateAll(nodes=>nodes.map(e=>({text:e.textContent,current:e.getAttribute('aria-current'),background:getComputedStyle(e).backgroundColor})));
    receipt.checks.push({scenario,navigationAfterAnimationsSettled:navigation});
   }
   if(scenario.width<=600){
    const summary=page.locator('.order-mobile-filter-summary');
    assert.equal(await summary.locator('button').count(),2);
    await summary.locator('.payment-summary').click();
    await page.locator('.payment-filters button').filter({hasText:scenario.language==='th'?'ชำระแล้ว':'Paid'}).click();
    await page.locator('.channel-filters button').filter({hasText:scenario.language==='th'?'แอพจัดส่ง':'App delivery'}).click();
    await page.locator('.order-filter-toggle').click();
    assert.equal((await summary.locator('.payment-summary').innerText()).trim(),scenario.language==='th'?'ชำระแล้ว':'Paid');
    assert.equal((await summary.locator('.channel-summary').innerText()).trim(),scenario.language==='th'?'แอพจัดส่ง':'App delivery');
    await page.locator('.order-row').first().waitFor();
    await summary.locator('.channel-summary').focus();await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('searchbox').isVisible(),true);
   }else await page.getByRole('button',{name:scenario.language==='th'?'ตัวกรองและค้นหา':'Filters & search',exact:true}).click();
   await page.getByRole('searchbox').fill('fixture-no-such-order-000');
   await page.getByRole('heading',{name:scenario.language==='th'?'ไม่พบออร์เดอร์':'No matching orders',exact:true}).waitFor();
   await page.locator('.orders-empty').getByRole('button',{name:scenario.language==='th'?'ล้างตัวกรอง':'Clear filters',exact:true}).click();
   await page.locator('.order-row').first().waitFor();
   assert.deepEqual(commandRequests,[]);
   receipt.checks.push({scenario,boardGeometry,searchEmptyAndClearRecovery:true,businessCommands:0});
   receipt.captures.push(capture);
   if(kitchenStates){
    await page.locator('.order-row').first().click();
    await page.locator('.incoming-detail').waitFor();
    assert.equal(await page.locator('.incoming-detail ul.bill').count(),1);
    await page.getByRole('button',{name:scenario.language==='th'?'ปิดรายละเอียด':'Close order details',exact:true}).click();
    if(scenario.width<=600)await page.getByRole('button',{name:scenario.language==='th'?'เมนูและบัญชีร้าน':'Workspace navigation and account',exact:true}).click();
    await page.getByRole('button',{name:scenario.language==='th'?'ศูนย์ออร์เดอร์':'Order center',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.order-row').length===4);
    receipt.checks.push({scenario,kitchenScopeUsesFourFulfillmentRows:true,oneCanonicalDetailController:true,returnToFullOrderCenterRestoresAllKitchenRows:true});
   }
   await page.close();
   continue;
  }
  if(detailRecoveryStates){
   const board=page.locator('.incoming-browser');
   const listRefresh=page.locator(scenario.width<=600?'.order-mobile-refresh':'.incoming-heading>button');
   listReadLoading=true;
   await listRefresh.click();
   await board.getByRole('status').filter({hasText:scenario.language==='th'?'กำลังรีเฟรชออร์เดอร์':'Refreshing orders'}).waitFor();
   assert.equal(await board.getAttribute('aria-busy'),'true');
   listReadLoading=false;listReadEmpty=true;releaseListRead();
   await page.getByRole('heading',{name:scenario.language==='th'?'ยังไม่มีออร์เดอร์':'No orders yet',exact:true}).waitFor();
   for(const failure of [503,403,401]){
    listReadFailure=failure;
    await listRefresh.click();
    const guidance=failure===401||failure===403?(scenario.language==='th'?'ไม่มีสิทธิ์ดูออร์เดอร์ ใช้บัญชีร้านค้าที่ได้รับอนุญาต':'Permission denied. Use an authorized merchant account.'):(scenario.language==='th'?'รีเฟรชออร์เดอร์ไม่สำเร็จ รายการเดิมยังแสดงอยู่ ลองอีกครั้งได้':'Could not refresh orders. The existing list remains visible; try again.');
    await board.getByText(guidance,{exact:true}).waitFor();
    assert.equal(await board.getAttribute('aria-busy'),'false');
    listReadFailure=0;listReadEmpty=false;
    await listRefresh.click();
    await board.getByText(guidance,{exact:true}).waitFor({state:'detached'});
    await page.locator('.order-row').waitFor();
   }
  }
  await page.locator('.order-row').click();
  if(detailRecoveryStates){
   const board=page.locator('.incoming-browser');
   await board.getByRole('status').filter({hasText:scenario.language==='th'?'กำลังโหลดออร์เดอร์':'Loading orders'}).waitFor();
   assert.equal(await board.getAttribute('aria-busy'),'true');
   selectedReadLoading=false;releaseSelectedRead();
  }
  await page.locator('.order-bill-secondary').waitFor();
  await page.locator('.fulfillment-detail>aside').waitFor();
  if(postCommandRecoveryStates){
   await page.evaluate(()=>{window.__bitposUnhandled=[];window.addEventListener('unhandledrejection',event=>window.__bitposUnhandled.push(String(event.reason)));});
   const handoff=page.locator('.fulfillment-detail>aside');
   await handoff.getByRole('button',{name:scenario.language==='th'?'ออกรหัสรับอาหาร':'Issue pickup proof',exact:true}).click();
   const detail=page.locator('.incoming-detail');
   const refresh=detail.getByRole('button',{name:scenario.language==='th'?'รีเฟรชรายละเอียดออร์เดอร์':'Refresh order details',exact:true});
   await detail.getByText(scenario.language==='th'?'รีเฟรชรายละเอียดออร์เดอร์ไม่สำเร็จ ออร์เดอร์ยังเปิดอยู่ ลองอีกครั้งได้':'Could not refresh order details. This order remains open; try again.',{exact:true}).waitFor();
   assert.equal(commandRequests.length,1);
   assert.deepEqual(await page.evaluate(()=>window.__bitposUnhandled),[]);
   postCommandRefreshFailure=false;
   await refresh.click();
   await detail.locator('.order-detail-refresh-error').waitFor({state:'detached'});
   assert.equal(commandRequests.length,1);
   receipt.checks.push({...scenario,validAtPickupWorkProjection:true,postCommandRead503Reported:true,postCommandClearedWithoutReplay:true,noUnhandledRejection:true,successfulReadRetryRecovered:true,businessCommands:1});
   await page.close();continue;
  }
  if(detailRecoveryStates){
   const detail=page.locator('.incoming-detail');
   const refresh=detail.getByRole('button',{name:scenario.language==='th'?'รีเฟรชรายละเอียดออร์เดอร์':'Refresh order details',exact:true});
   await refresh.waitFor();
   for(const failure of [503,403,401]){
    selectedReadFailure=failure;
    await refresh.click();
    const guidance=failure===401||failure===403?(scenario.language==='th'?'ไม่มีสิทธิ์ดูรายละเอียดออร์เดอร์นี้ ใช้บัญชีร้านค้าที่ได้รับอนุญาต':'Permission denied. Use an authorized merchant account.'):(scenario.language==='th'?'รีเฟรชรายละเอียดออร์เดอร์ไม่สำเร็จ ออร์เดอร์ยังเปิดอยู่ ลองอีกครั้งได้':'Could not refresh order details. This order remains open; try again.');
    await detail.getByText(guidance,{exact:true}).waitFor();
    assert.equal(await detail.isVisible(),true);
    assert.equal(await detail.locator('.incoming-detail-read').getAttribute('aria-busy'),'false');
    assert.equal(await refresh.isEnabled(),true);
    await page.addStyleTag({content:'body::after{content:"LOCAL PRESENTATION FIXTURE · no payment/delivery performed";position:fixed;bottom:0;left:0;right:0;background:#fff4cb;color:#3b2600;font:10px/14px sans-serif;text-align:center;z-index:10000;pointer-events:none}'});
    const capture=`ui-first-pos-detail-recovery-${failure}-${scenario.language}-${scenario.width}-${stamp}.png`;
    await page.screenshot({path:join(evidence,capture),fullPage:true});receipt.captures.push(capture);
    selectedReadFailure=0;
    await refresh.click();
    await detail.getByText(guidance,{exact:true}).waitFor({state:'detached'});
    assert.equal(await detail.locator('.order-bill-primary').count(),1);
   }
   selectedRefreshLoading=true;
   await refresh.click();
   await detail.getByRole('status').filter({hasText:scenario.language==='th'?'กำลังรีเฟรชรายละเอียดออร์เดอร์':'Refreshing order details'}).waitFor();
   await page.getByRole('button',{name:scenario.language==='th'?'ปิดรายละเอียด':'Close order details',exact:true}).click();
   await detail.waitFor({state:'detached'});
   selectedRefreshLoading=false;releaseSelectedRefresh();
   await page.locator('.incoming-browser').waitFor();
   assert.equal(await page.locator('.order-row').evaluate(row=>document.activeElement===row),true);
   await page.locator('.order-row').click();
   await detail.waitFor();
   assert.equal(await detail.locator('.order-detail-refresh-error').count(),0);
   assert.deepEqual(commandRequests,[]);
   await page.getByRole('button',{name:scenario.language==='th'?'ปิดรายละเอียด':'Close order details',exact:true}).click();
   await detail.waitFor({state:'detached'});
   assert.equal(await page.locator('.order-row').evaluate(row=>document.activeElement===row),true);
   receipt.checks.push({...scenario,listRefreshLoadingVisible:true,listEmptyVisible:true,listReadRecoveredAfter503And403And401:true,selectionLoadingVisible:true,selectedDetailReadRecoveredAfter503And403And401:true,lateRefreshIgnoredAfterDetailRetirement:true,detailRemainedOpen:true,closeReturnsToOrderList:true,selectedOrderFocusRestored:true,businessCommandsReachedNetwork:0});
   await page.close();continue;
  }
  if(detailReadStates){
   const detail=page.locator('.incoming-detail');
   const refresh=detail.getByRole('button',{name:scenario.language==='th'?'รีเฟรชรายละเอียดออร์เดอร์':'Refresh order details',exact:true});
   await refresh.waitFor();
   readFailureActive=true;
   await refresh.click();
   await detail.locator('.error').waitFor();
   assert.equal(await detail.isVisible(),true);
   assert.equal(await detail.getByRole('button',{name:scenario.language==='th'?'ปิดรายละเอียด':'Close order details',exact:true}).isVisible(),true);
   readFailureActive=false;
   await refresh.click();
   await detail.locator('.error').waitFor({state:'detached'});
   assert.equal(await detail.locator('.order-bill-primary').count(),1);
   assert.deepEqual(commandRequests,[]);
   const capture=`ui-first-pos-detail-read-${scenario.language}-${scenario.width}-${stamp}.png`;
   await page.screenshot({path:join(captureDirectory,capture),fullPage:true});receipt.captures.push(capture);
   receipt.checks.push({...scenario,selectedDetailReadRecovered:true,detailRemainedOpen:true,businessCommandsReachedNetwork:0});
   await page.close();continue;
  }
  if(scenario.pending){
   const handoff=page.locator('.fulfillment-detail>aside');
   await handoff.getByRole('button',{name:'Issue pickup proof',exact:true}).click();
   await handoff.getByRole('button',{name:'Retry exact proof command',exact:true}).waitFor();
   assert.equal(commandRequests.length,1);
   assert.equal(commandRequests[0].path,'/api/orders/'+fixture.id+'/delivery/pickup-proof');
   readFailureActive=true;
   await page.getByRole('button',{name:'Close order details',exact:true}).click();
   await page.locator('.order-row').click();
   await page.locator('.fulfillment-detail>aside').waitFor();
  }
  if(readFailureActive){
   const handoff=page.locator('.fulfillment-detail>aside');
   const guidance=scenario.readStatus===403
    ?(scenario.language==='th'?'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลส่งมอบ เข้าสู่ระบบด้วยบัญชีที่ได้รับอนุญาต':'This account cannot view handoff. Sign in with an authorized account.')
    :scenario.readStatus===404
    ?(scenario.language==='th'?'ข้อมูลส่งมอบยังไม่พร้อมใช้งาน':'Handoff is not available for this order.')
    :(scenario.language==='th'?'โหลดข้อมูลส่งมอบไม่สำเร็จ คำขอเดิมยังคงอยู่':'Could not load handoff. Saved requests are retained.');
   await handoff.getByText(guidance,{exact:true}).waitFor();
   assert.equal(await handoff.getByRole('button',{name:scenario.language==='th'?'ออกรหัสรับอาหาร':'Issue pickup proof',exact:true}).count(),0);
   readFailureActive=false;
   await handoff.getByRole('button',{name:scenario.language==='th'?'โหลดสถานะอีกครั้ง':'Reload handoff',exact:true}).click();
   await handoff.getByText(guidance,{exact:true}).waitFor({state:'detached'});
   await handoff.getByRole('button',{name:scenario.pending?'Retry exact proof command':scenario.language==='th'?'ออกรหัสรับอาหาร':'Issue pickup proof',exact:true}).waitFor();
   receipt.checks.push({scenario,explicitReadGuidance:true,noProofActionOnUnreadableAssignment:true,recoveredByGetReload:true});
  }
  if(scenario.pending){
   await page.getByRole('button',{name:'Retry exact proof command',exact:true}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Retry exact proof command'&&!e.disabled));
   assert.equal(commandRequests.length,2);
   assert.deepEqual(commandRequests[1],commandRequests[0]);
   const retained=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('bitpos.pickupProof.')).map(([,value])=>JSON.parse(value)));
   assert.deepEqual(retained,[commandRequests[0].body]);
   receipt.checks.push({scenario,exactCommandRetainedAcrossRemountAndReadFailure:true,abortedRetries:2,retainedSameIdempotencyKey:true,noCommandReachedNetwork:true});
  }
  if(scenario.state==='PENDING')await page.getByRole('button',{name:scenario.language==='th'?'รับออร์เดอร์':'Accept order',exact:true}).waitFor();
  else if(stageStates){
   const handoff=page.locator('.fulfillment-detail>aside');
   await handoff.locator(':scope>p').filter({hasText:stageLabels[scenario.state][scenario.language==='th'?0:1]}).waitFor();
   assert.equal(await handoff.getByRole('button',{name:/Issue pickup proof|ออกรหัสรับอาหาร|Replace pickup proof|เปลี่ยนรหัสรับอาหาร/}).count(),0,'Pickup proof cannot be issued outside assigned AT_PICKUP');
   assert.equal(await handoff.getByRole('textbox',{name:/Pickup proof secret|รหัสรับอาหาร/}).count(),0,'No fabricated proof secret');
   if(['DELIVERED','CANCELLED','FAILED'].includes(scenario.state))await handoff.getByText(scenario.language==='th'?'งานขนส่งปิดแล้ว ไม่มีไรเดอร์ที่กำลังทำงาน':'Shipment closed; no active rider',{exact:true}).waitFor();
   receipt.checks.push({scenario,distinctDeliveryState:true,noOutOfStageProofAction:true,noInventedSecret:true});
  }else await page.locator('.fulfillment-detail>aside>p').filter({hasText:scenario.state==='ASSIGNED'?'Rider assigned':scenario.language==='th'?'คนส่งถึงร้านแล้ว':'Rider at store'}).waitFor();
  const breakdown=page.locator('.order-bill-primary>.configured-bill-breakdown');
  assert.equal(await page.locator('.bill-channel').innerText(),scenario.language==='th'?'แอพจัดส่ง':'App delivery');
  if(!scenario.readStatus&&!scenario.pending&&['ASSIGNED','AT_PICKUP','PICKED_UP','AT_DROPOFF'].includes(scenario.state))await page.locator('.handoff-rider').filter({hasText:'SYNTHETIC FIXTURE RIDER'}).waitFor();
  assert.equal(await breakdown.isVisible(),true,'Frozen fees and discounts stay visible on every viewport');
  const destination=page.locator('.order-bill-primary>.delivery-summary');
  assert.equal(await destination.isVisible(),true,'Frozen destination must remain visible before merchant actions');
  if(scenario.preparationMinutes)assert.ok((await page.locator('.preparation-estimate').innerText()).includes(String(scenario.preparationMinutes)));
  assert.ok((await destination.innerText()).includes(fixture.delivery.addressText));
  if(fixture.delivery.instructions)assert.ok((await destination.innerText()).includes(fixture.delivery.instructions));
  assert.ok((await breakdown.innerText()).includes(scenario.language==='th'?'ค่าบริการ':'Fees'));
  if(scenario.width<=600){
   await page.setViewportSize({width:1440,height:1000});
   assert.equal(await breakdown.isVisible(),true);
   await page.setViewportSize({width:scenario.width,height:844});
   assert.equal(await breakdown.isVisible(),true);
   assert.equal(await page.locator('.order-bill-primary>.total').isVisible(),true);
  }
  const geometry=await page.evaluate(()=>{
   const primary=document.querySelector('.order-bill-primary'),operations=document.querySelector('.fulfillment-detail'),secondary=document.querySelector('.order-bill-secondary');
   const rect=e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,documentY:e.getBoundingClientRect().y+scrollY,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height});
   const heading=document.querySelector('.incoming-detail-heading');
   const headingStyle=getComputedStyle(heading),detailStyle=getComputedStyle(document.querySelector('.incoming-detail'));
   const ancestors=[];for(let e=heading.parentElement;e;e=e.parentElement)ancestors.push({tag:e.tagName,class:e.className,top:e.getBoundingClientRect().top,scrollTop:e.scrollTop,marginTop:getComputedStyle(e).marginTop,paddingTop:getComputedStyle(e).paddingTop,position:getComputedStyle(e).position});
   const anchors={ancestors,heading:rect(heading),headingMinHeight:headingStyle.minHeight,headingMarginBottom:headingStyle.marginBottom,detailGap:detailStyle.gap,detailDisplay:detailStyle.display,header:rect(document.querySelector('.shell>header'))};
   const headingButton=heading.querySelector('button');anchors.headingButton={...rect(headingButton),background:getComputedStyle(headingButton).backgroundColor};anchors.headingTitle=rect(heading.querySelector('h2'));
   anchors.billHeader=Object.fromEntries(['.bill-reference','.bill-status-row>.status','.bill-column-head'].map(selector=>{const element=document.querySelector(selector);const style=getComputedStyle(element);return [selector,{...rect(element),margin:style.margin,padding:style.padding,font:style.font}];}));
   const handoffAction=document.querySelector('.delivery-handoff>button'),acceptance=document.querySelector('.online-acceptance');
   anchors.handoffAction=handoffAction?{...rect(handoffAction),text:handoffAction.textContent}:null;
   const riderCard=document.querySelector('.handoff-rider');anchors.riderCard=riderCard?{...rect(riderCard),icon:rect(riderCard.querySelector('.handoff-rider-icon')),text:riderCard.textContent}:null;
   anchors.acceptance=acceptance?{open:acceptance.open,summary:acceptance.querySelector('summary')?.textContent}:null;
   return {anchors,primary:rect(primary),operations:rect(operations),secondary:rect(secondary),domOrder:!!(primary.compareDocumentPosition(operations)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(operations.compareDocumentPosition(secondary)&Node.DOCUMENT_POSITION_FOLLOWING),overflow:document.documentElement.scrollWidth>innerWidth,foodLists:document.querySelectorAll('.incoming-detail ul.bill').length,operationsControllers:document.querySelectorAll('.fulfillment-detail').length};
  });
  if(scenario.width<=600){assert.equal(geometry.anchors.headingButton.width,44);assert.equal(geometry.anchors.headingButton.height,44);assert.equal(geometry.anchors.headingButton.documentY,52);if(scenario.width===390){assert.equal(geometry.anchors.headingButton.x,18);assert.equal(geometry.anchors.headingTitle.x,76);}}
  if(scenario.width===1440){
   assert.ok(Math.abs(geometry.primary.y-202)<2,'Opening order details must preserve the designed header/card gap');
   assert.ok(Math.abs(geometry.operations.y-202)<2);
   assert.equal(geometry.anchors.billHeader['.bill-column-head'].y,326,'Approved P40 item header must not inherit paragraph baseline spacing');
   assert.equal(geometry.anchors.ancestors.find(e=>e.tag==='MAIN').scrollTop,0);
  }
  assert.equal(geometry.domOrder,true);
  assert.equal(geometry.overflow,false);
  assert.equal(geometry.foodLists,1);
  assert.equal(geometry.operationsControllers,1);
  if(scenario.width<=900)assert.ok(geometry.operations.y<geometry.secondary.y);
  else{
   assert.ok(Math.abs(geometry.primary.width-730)<1,'Desktop bill column must retain approved730px width');
   assert.ok(Math.abs(geometry.operations.width-386)<1,'Desktop operations must retain approved386px width');
   assert.ok(Math.abs(geometry.operations.x-geometry.primary.x-758)<1,'Desktop columns must retain28px gutter');
  }
  if(scenario.longNotes){assert.ok((await page.locator('.configured-allergy-note').innerText()).includes(allergy));assert.ok(await page.locator('.configured-allergy-note').evaluate(e=>e.scrollWidth<=e.clientWidth));}
  const focusOrder=await page.locator('.order-bill-workspace').evaluate(root=>[...root.querySelectorAll('button,summary,a[href],textarea,input')].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>({text:e.getAttribute('aria-label')||e.textContent,section:e.closest('.order-bill-secondary')?'secondary':e.closest('.fulfillment-detail')?'operations':'primary'})));
  const firstSecondary=focusOrder.findIndex(e=>e.section==='secondary'),lastOperation=focusOrder.findLastIndex(e=>e.section==='operations');
  assert.ok(firstSecondary>lastOperation,'Operational keyboard controls precede secondary disclosures');
  if(scenario.width<=600&&(!stageStates||focusOrder.some(item=>item.section==='operations'))){
   const back=page.getByRole('button',{name:scenario.language==='th'?'ปิดรายละเอียด':'Close order details',exact:true});
   await back.focus();
   const actualTabs=[];
   for(let step=0;step<35;step++){
    await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>{const e=document.activeElement;return {text:e?.getAttribute('aria-label')||e?.textContent,section:e?.closest('.order-bill-secondary')?'secondary':e?.closest('.fulfillment-detail')?'operations':'other'};});
    actualTabs.push(focus);
    if(focus.section==='secondary')break;
   }
   assert.ok(actualTabs.some(f=>f.section==='operations'),'Real Tab reaches operational controls');
   assert.equal(actualTabs.at(-1)?.section,'secondary','Real Tab reaches secondary after operations');
   await page.keyboard.press('Shift+Tab');
   assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.fulfillment-detail')),true);
   receipt.checks.push({scenario,actualKeyboardTraversal:actualTabs,reverseToOperations:true,frozenBreakdownVisibleAcrossResize:true});
  }
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();document.querySelector('.incoming-board').scrollTop=0;window.scrollTo({top:0,behavior:'instant'});});
  await page.waitForFunction(()=>scrollY===0&&document.querySelector('.incoming-board').scrollTop===0);
  await page.addStyleTag({content:'body::after{content:"LOCAL PRESENTATION FIXTURE · no payment/delivery performed";position:fixed;bottom:0;left:0;right:0;background:#fff4cb;color:#3b2600;font:10px/14px sans-serif;text-align:center;z-index:10000;pointer-events:none}'});
  const capture='ui-first-pos-detail-'+revision+'-'+scenario.state.toLowerCase()+'-'+scenario.language+'-'+scenario.width+(scenario.readStatus?'-'+scenario.readStatus:'')+(scenario.longNotes?'-long-notes':'')+'-20261023.png';
  await page.screenshot({path:join(captureDirectory,capture)});
  if(scenario.pending)assert.equal(commandRequests.length,2);else assert.deepEqual(commandRequests,[]);
  receipt.captures.push(capture);receipt.checks.push({...scenario,geometry,focusOrder,businessCommandsReachedNetwork:0,abortedCommandAttempts:commandRequests.length});
  if(scenario.state==='PENDING'){
   const minutes=page.getByRole('spinbutton',{name:scenario.language==='th'?'เวลาเตรียมโดยประมาณ (นาที)':'Estimated preparation (minutes)'});
   const accept=page.getByRole('button',{name:scenario.language==='th'?'รับออร์เดอร์':'Accept order',exact:true});
   assert.equal(await minutes.inputValue(),'');assert.equal(await accept.isDisabled(),true);
   await minutes.fill('1.5');assert.equal(await accept.isDisabled(),true);
   await minutes.fill('37');assert.equal(await accept.isEnabled(),true);
   await accept.scrollIntoViewIfNeeded();
   const decisionCapture=capture.replace('.png','-duration-selected.png');
   await page.screenshot({path:join(captureDirectory,decisionCapture)});
   receipt.captures.push(decisionCapture);
   receipt.checks.push({...scenario,blankEstimateBlocked:true,fractionalEstimateBlocked:true,explicitEstimateEnabled:37,acceptanceCommandSubmitted:false});
   assert.deepEqual(commandRequests,[]);
  }
  await page.getByRole('button',{name:scenario.language==='th'?'ปิดรายละเอียด':'Close order details',exact:true}).click();
  await page.locator('.incoming-detail').waitFor({state:'detached'});await page.locator('.incoming-browser').waitFor({state:'visible'});
  assert.equal(await page.locator('.order-row').evaluate(row=>document.activeElement===row),true);
  receipt.checks.push({...scenario,closeReturnsToOrderList:true,selectedOrderFocusRestored:true});
  await page.close();
 }
 receipt.status='PASS_SCOPED_FULL_SHELL_DETAIL_PRESENTATION';
}catch(error){receipt.status='FAIL';receipt.error=String(error);throw error;}
finally{const path=join(evidence,'ui-first-pos-detail-'+revision+'-'+stamp+'.json');await writeFile(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({evidence:path,scratch}));await browser.close();}
console.log(receipt.status);
