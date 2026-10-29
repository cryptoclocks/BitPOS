// Local customer presentation/interaction matrix. Fixture traffic is not persisted proof.
import assert from 'node:assert/strict';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const origin=process.env.BITPOS_UI_ORIGIN;assert.ok(origin);assert.equal(new URL(origin).hostname,'127.0.0.1');
const evidence=process.env.BITPOS_UI_EVIDENCE_DIR;assert.ok(evidence,'BITPOS_UI_EVIDENCE_DIR is required');
const stamp=new Date().toISOString().replaceAll(':','-'),scratch=await mkdtemp(join(tmpdir(),'bitpos-customers-')),capture=process.env.BITPOS_UI_CAPTURE_DIR??scratch;
const receipt={status:'RUNNING',fixture:true,origin,checks:[],captures:[],limits:['Local GET/POST/PATCH fixtures only; no persistent customer data or authority changes','Not payment, custody, tenant-RLS, or joined E2E evidence']};
const customer={id:'10000000-0000-4000-8000-000000000011',name:'Mali',phone:'0800000000',email:'mali@example.invalid',notes:'Synthetic local customer',wallets:[],avatar:{preset:'flower',photo:''}};
const recipients={tables:[],orders:[],customers:[{id:customer.id,name:customer.name,walletLabel:null,paidOrders:3,avatar:customer.avatar,avatarSeed:'abcdef123456'}]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{for(const scenario of ['en','th'].flatMap(language=>['profile','empty','recovery','create','denied','retired','write-denied','reconcile','unknown','unknown-inflight','storage-failed'].map(state=>({language,width:language==='en'?1440:390,state})))){const page=await browser.newPage({viewport:{width:scenario.width,height:1000}});let failed=scenario.state==='recovery',hold=scenario.state==='profile',resolveHold;const gate=new Promise(resolve=>resolveHold=resolve);let current={...customer},writes=[];
let denied=false;
await page.goto(origin);await page.locator('input[name=email]').fill('merchant@bitpos.invalid');await page.locator('input[name=password]').fill('local-fixture-only');await page.locator('summary').click();await page.locator('input[name=merchantId]').fill('32d7d169-28b8-490a-b773-f81db3f447c4');await page.getByRole('button',{name:'Sign in',exact:true}).click();
let historyOrder;
if(scenario.state==='profile'){
 await page.setViewportSize({width:1440,height:1000});
 const ordersResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/orders'&&response.request().method()==='GET'&&response.ok());
 await page.getByRole('button',{name:/^(Orders|ออเดอร์) \(/}).click();
 const orders=await (await ordersResponse).json();assert.ok(orders.orders?.length,'Local persisted order fixture required');
 const detailResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/orders/'+orders.orders[0].id&&response.request().method()==='GET'&&response.ok());
 await page.locator('.order-row').first().click();historyOrder=await (await detailResponse).json();
 await page.getByRole('button',{name:'Close order details',exact:true}).click();
 await page.getByRole('button',{name:'Sales',exact:true}).click();
 await page.setViewportSize({width:scenario.width,height:1000});
}
if(scenario.language==='th')await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
await page.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;if(path==='/api/customers'&&request.method()==='GET'){if(failed)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'REQUEST_FAILED',message:'Local recovery fixture',retryable:true}})});if(hold)await gate;return route.fulfill({contentType:'application/json',body:JSON.stringify({customers:scenario.state==='empty'?[]:[current]})});}if(path==='/api/promotions/recipients'&&request.method()==='GET')return route.fulfill({contentType:'application/json',body:JSON.stringify({...recipients,customers:scenario.state==='empty'?[]:recipients.customers})});if(path==='/api/customers/'+customer.id&&request.method()==='PATCH'){const body=request.postDataJSON();writes.push(body);if(body.name==='Reject')return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_REQUEST',message:'Local refusal',retryable:false}})});current={...current,...body};return route.fulfill({contentType:'application/json',body:JSON.stringify(current)});}if(['POST','PATCH','PUT','DELETE'].includes(request.method()))return route.abort();return route.continue();});
let releaseSave,notifySave;
const saveGate=new Promise(resolve=>releaseSave=resolve),saveStarted=new Promise(resolve=>notifySave=resolve);
await page.route('**/api/session',route=>route.request().method()==='DELETE'?route.fulfill({contentType:'application/json',body:'{}'}):route.fallback());
await page.route('**/api/customers',async route=>{
 const request=route.request();
 if(denied&&request.method()==='GET')return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'AUTH_REQUIRED',message:'Local session refusal',retryable:false}})});
 if(scenario.state==='denied'&&request.method()==='GET')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'ROLE_REQUIRED',message:'Local denied fixture',retryable:false}})});
 if(request.method()!=='POST')return route.fallback();
 if(['write-denied','reconcile','unknown','unknown-inflight','storage-failed'].includes(scenario.state)){
  const body=request.postDataJSON();writes.push(body);
  if(scenario.state==='write-denied')return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'AUTH_REQUIRED',message:'Mutation refused',retryable:false}})});
  current={...customer,...body,id:'10000000-0000-4000-8000-000000000099'};
  if(scenario.state==='unknown'||scenario.state==='unknown-inflight'){if(scenario.state==='unknown-inflight'){notifySave();await saveGate;}return route.abort('failed');}
  failed=true;
  return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(current)});
 }
 const body=request.postDataJSON();writes.push(body);
 current={...customer,...body,id:'10000000-0000-4000-8000-000000000099'};
 if(scenario.state==='retired'){notifySave();await saveGate;}
 return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(current)});
});
const th=scenario.language==='th',label=(thai,english)=>th?thai:english;
const list=page.getByRole('region',{name:label('รายชื่อลูกค้า','Customer list')});
await page.getByRole('button',{name:label('ลูกค้า','Customers'),exact:true}).click();
const profile=page.getByRole('region',{name:label('แก้ไขโปรไฟล์','Edit profile')});
if(['write-denied','reconcile','unknown','unknown-inflight','storage-failed'].includes(scenario.state)){
 await list.getByRole('button',{name:/Mali/}).waitFor();
 await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).click();
 await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).fill('Boundary customer');
 if(scenario.state==='storage-failed')await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Fixture storage full','QuotaExceededError');};});
 await profile.getByRole('button',{name:label('บันทึก','Save'),exact:true}).click();
 if(scenario.state==='unknown-inflight'){
  await saveStarted;
  await page.getByRole('button',{name:label('เมนู','Menu'),exact:true}).click();
  releaseSave();
  await page.getByRole('button',{name:label('ลูกค้า','Customers'),exact:true}).click();
  await page.getByRole('status').filter({hasText:label('ยังไม่ทราบผล','Customer creation outcome')}).waitFor();
  assert.equal(await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).isDisabled(),true);
 }else if(scenario.state==='storage-failed'){
  await page.getByRole('alert').filter({hasText:label('ยังไม่ได้ส่งข้อมูล','Nothing was submitted')}).waitFor();
 }else{
 await page.getByRole('alert').waitFor();
 if(scenario.state==='write-denied'){
  assert.equal(await profile.count(),0);
  assert.equal(await list.getByRole('button',{name:/Mali/}).count(),0);
  assert.equal(await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).isDisabled(),true);
  assert.equal(await profile.count(),0);
 }else if(scenario.state==='reconcile'){
  assert.equal(await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).inputValue(),'Boundary customer');
  failed=false;
  await page.getByRole('button',{name:label('ลองอีกครั้ง','Retry'),exact:true}).click();
  await page.getByRole('button',{name:label('แสดงลูกค้าทั่วไป','Show walk-in customers'),exact:true}).click();
  await list.getByRole('button',{name:/Boundary customer/}).waitFor();
 }else{
  await page.getByRole('status').filter({hasText:label('ยังไม่ทราบผล','Customer creation outcome')}).waitFor();
  await profile.getByRole('button',{name:label('บันทึก','Save'),exact:true}).click();
  await page.getByRole('button',{name:label('เมนู','Menu'),exact:true}).click();
  await page.getByRole('button',{name:label('ลูกค้า','Customers'),exact:true}).click();
  await page.getByRole('button',{name:label('แสดงลูกค้าทั่วไป','Show walk-in customers'),exact:true}).click();
  await list.getByRole('button',{name:/Boundary customer/}).waitFor();
  assert.equal(await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).isDisabled(),true);
  await list.getByRole('button',{name:/Boundary customer/}).click();
  await profile.getByRole('button',{name:label('ปิด','Close'),exact:true}).click();
  assert.equal(await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).isDisabled(),true);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:label('ตรวจรายชื่อแล้ว เริ่มรายการใหม่','Directory checked — start distinct profile'),exact:true}).click();
  assert.equal(await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).isEnabled(),true);
 }
 }
 assert.equal(writes.length,scenario.state==='storage-failed'?0:1);
}else
if(scenario.state==='profile'){
 await list.getByText(label('กำลังโหลดลูกค้า…','Loading customers…'),{exact:true}).waitFor();
 hold=false;resolveHold();
 await list.getByRole('button',{name:/Mali/}).waitFor();const directoryImage=join(capture,`pos-customers-directory-${scenario.language}-${scenario.width}-${stamp}.png`);await page.screenshot({path:directoryImage,fullPage:true});receipt.captures.push(directoryImage);const directoryGeometry=await page.evaluate(()=>Object.fromEntries(['.customers-columns','.customer-directory-search-row','.customer-directory-actions','.customer-directory-head','.customer-profile-row'].map(selector=>{const box=document.querySelector(selector)?.getBoundingClientRect();return [selector,box&&{x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width),height:Math.round(box.height)}]})));receipt.checks.push({scenario,directoryGeometry});await list.getByRole('button',{name:/Mali/}).click();
 const nickname=profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')});await nickname.focus();const tabStops=[await nickname.getAttribute('name')];for(let index=0;index<6;index++){await page.keyboard.press('Tab');tabStops.push(await page.evaluate(()=>{const active=document.activeElement;if(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement)return active.getAttribute('type')==='tel'?'phone':active.tagName.toLowerCase();return active?.textContent?.trim()??active?.tagName??'';}));}assert.deepEqual(tabStops,[null,'phone','textarea','select',label('บันทึก','Save'),label('ปิด','Close'),label('ช่องทางติดต่อเพิ่มเติม','Additional contact')]);receipt.checks.push({scenario,profileCoreTabSequence:tabStops});
 await profile.getByRole('button',{name:label('ปิด','Close'),exact:true}).click();
 const directoryAnchors=await page.evaluate(()=>{const box=selector=>{const value=document.querySelector(selector)?.getBoundingClientRect();return value&&{x:Math.round(value.x),y:Math.round(value.y),width:Math.round(value.width),height:Math.round(value.height)}};return {search:box('.customer-directory-search-row'),header:box('.customer-directory-head'),row:box('.customer-profile-row'),searchFontSize:getComputedStyle(document.querySelector('.customer-directory-search-row input')).fontSize};});if(scenario.width===1440)assert.deepEqual(directoryAnchors,{search:{x:264,y:228,width:1144,height:52},header:{x:264,y:379,width:1144,height:48},row:{x:264,y:427,width:1144,height:65},searchFontSize:'14px'});receipt.checks.push({scenario,directoryAnchors,approvedAnchors:{search:{x:264,y:228,width:760,height:52},add:{x:1056,y:227,width:352,height:52},header:{x:264,y:379,width:1144,height:48},row:{x:264,y:427,width:1144,height:65},searchFontSize:'14px'}});
 const verifiedDirectoryImage=join(capture,`pos-customers-directory-verified-${scenario.language}-${scenario.width}-${stamp}.png`);await page.screenshot({path:verifiedDirectoryImage,fullPage:true});receipt.captures.push(verifiedDirectoryImage);
 await list.getByRole('button',{name:/Mali/}).click();
 await page.evaluate(()=>{for(let node=document.querySelector('.customer-profile-editor');node;node=node.parentElement)node.scrollTop=0;document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,0);});const geometry=await page.evaluate(()=>Object.fromEntries(['.customers-workspace','.customers-columns','.customer-profile-editor','.customer-profile-preview','.customers-list-panel'].map(selector=>{const box=document.querySelector(selector)?.getBoundingClientRect();return [selector,box&&{x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width),height:Math.round(box.height)}]})));receipt.checks.push({scenario,geometry});const coreProfileImage=join(capture,`pos-customers-core-profile-${scenario.language}-${scenario.width}-${stamp}.png`);await page.screenshot({path:coreProfileImage,fullPage:true});receipt.captures.push(coreProfileImage);
 const profileAnchors={editor:geometry['.customer-profile-editor']&&{x:Math.round(geometry['.customer-profile-editor'].x),y:Math.round(geometry['.customer-profile-editor'].y),width:Math.round(geometry['.customer-profile-editor'].width),height:Math.round(geometry['.customer-profile-editor'].height)},preview:geometry['.customer-profile-preview']&&{x:Math.round(geometry['.customer-profile-preview'].x),y:Math.round(geometry['.customer-profile-preview'].y),width:Math.round(geometry['.customer-profile-preview'].width),height:Math.round(geometry['.customer-profile-preview'].height)}};if(scenario.width===1440){assert.deepEqual(profileAnchors.editor&&{x:profileAnchors.editor.x,y:profileAnchors.editor.y,width:profileAnchors.editor.width},{x:264,y:202,width:744});assert.deepEqual(profileAnchors.preview,{x:1036,y:202,width:372,height:719});}receipt.checks.push({scenario,profileAnchors,approvedAnchors:{editor:{x:264,y:202,width:744,height:719},preview:{x:1036,y:202,width:372,height:719}},remainingProfileGeometry:{editorHeight:profileAnchors.editor?.height}});
 let historyCalls=0;
 await page.route(`**/api/customers/${customer.id}/history`,async route=>{
  historyCalls++;
  const orders=historyCalls<3?[]:[{...historyOrder,status:'AWAITING_PAYMENT',closureReason:null},{...historyOrder,id:'20000000-0000-4000-8000-000000000022',status:'EXPIRED',closureReason:'canceled'}];
  return route.fulfill({status:historyCalls===1?503:200,contentType:'application/json',body:JSON.stringify(historyCalls===1?{error:{code:'REQUEST_FAILED',message:'History fixture unavailable',retryable:true}}:{orders})});
 });
 const history=page.getByRole('region',{name:label('ประวัติคำสั่งซื้อ','Order history')});
 await history.getByRole('button',{name:label('โหลดประวัติ','Load history'),exact:true}).click();
 await history.getByRole('alert').waitFor();
 await history.getByRole('button',{name:label('ลองอีกครั้ง','Retry'),exact:true}).click();
 await history.getByText(label('ยังไม่มีคำสั่งซื้อ','No orders yet'),{exact:true}).waitFor();
 assert.equal(historyCalls,2);
 await history.getByRole('button',{name:label('โหลดประวัติ','Load history'),exact:true}).click();
 const savedBills=history.locator(':scope > details');
 await savedBills.first().waitFor();assert.equal(await savedBills.count(),2);
 await savedBills.first().locator(':scope > summary').click();
 await savedBills.first().getByRole('status').filter({hasText:label('รอชำระ','Awaiting payment')}).waitFor();
 await savedBills.nth(1).locator(':scope > summary').click();
 await savedBills.nth(1).getByRole('status').filter({hasText:label('ยกเลิกแล้ว','Canceled')}).waitFor();
 assert.equal(await history.getByText('EXPIRED',{exact:true}).count(),0);
 const historyImage=join(capture,`pos-customers-history-${scenario.language}-${scenario.width}-${stamp}.png`);
 await history.screenshot({path:historyImage});receipt.captures.push(historyImage);
 receipt.checks.push({scenario,history:'503-retry-empty-populated-canonical-awaiting-and-canceled',source:'GET local order detail cloned into labelled history fixtures; not persisted customer attribution'});
 await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).fill('Mali updated');
 await profile.getByRole('button',{name:label('บันทึก','Save'),exact:true}).click();
 await profile.getByText(label('บันทึกแล้ว','Saved'),{exact:true}).waitFor();
 assert.equal(writes[0].name,'Mali updated');
 await profile.locator('.customer-avatar-details > summary').click();
 await profile.getByRole('button',{name:label('แมว','Cat'),exact:true}).click();
 assert.equal(await profile.getByText(label('บันทึกแล้ว','Saved'),{exact:true}).count(),0);
 assert.equal(await profile.getByRole('button',{name:label('แมว','Cat'),exact:true}).getAttribute('aria-pressed'),'true');
 await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).fill('Reject');
 await profile.getByRole('button',{name:label('บันทึก','Save'),exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).inputValue(),'Reject');
 let releaseRefresh,refreshEntered;
 const refreshGate=new Promise(resolve=>releaseRefresh=resolve),refreshStarted=new Promise(resolve=>refreshEntered=resolve);
 await page.route('**/api/customers',async route=>{refreshEntered();await refreshGate;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({customers:[customer]})});});
 await page.getByRole('button',{name:label('รีเฟรช','Refresh'),exact:true}).click();
 await refreshStarted;
 await page.route(`**/api/customers/${customer.id}/history`,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'History refused'}})}));
 await history.getByRole('button',{name:label('โหลดประวัติ','Load history'),exact:true}).click();
 await profile.waitFor({state:'detached'});
 const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/customers')&&response.status()===200);
 releaseRefresh();await refreshed;
 await page.waitForTimeout(150);
 assert.equal(await profile.count(),0);
 assert.equal(await list.getByRole('button',{name:/Mali/}).count(),0);
}else if(scenario.state==='create'){
 await list.getByRole('button',{name:/Mali/}).waitFor();
 await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).click();
 await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).fill('New fixture customer');
 await profile.getByRole('button',{name:label('บันทึก','Save'),exact:true}).click();
 await profile.getByText(label('บันทึกแล้ว','Saved'),{exact:true}).waitFor();
 // The refreshed directory hides customers without paid-order summaries by default.
 await page.getByRole('button',{name:label('แสดงลูกค้าทั่วไป','Show walk-in customers'),exact:true}).click();
 await list.getByRole('button',{name:/New fixture customer/}).waitFor();
 assert.equal(await list.getByRole('button',{name:/New fixture customer/}).getAttribute('aria-pressed'),'true');
 assert.equal(writes.length,1);
 await profile.getByRole('button',{name:label('ปิด','Close'),exact:true}).click();
 await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).click();
 assert.equal(await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).inputValue(),'');
}else if(scenario.state==='retired'){
 await list.getByRole('button',{name:/Mali/}).waitFor();
 await page.getByRole('button',{name:label('เพิ่มลูกค้า','Add customer'),exact:true}).click();
 await profile.getByRole('textbox',{name:label('ชื่อเล่น','Nickname')}).fill('Private retired draft');
 await profile.getByRole('button',{name:label('บันทึก','Save'),exact:true}).click();
 await saveStarted;
 await page.getByRole('button',{name:label('ออกจากระบบ','Log out'),exact:true}).click();
 await page.locator('input[name=email]').waitFor();
 const response=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/customers'&&res.request().method()==='POST');
 releaseSave();await response;
 await page.locator('input[name=email]').waitFor();
 assert.equal(await page.getByText('Private retired draft',{exact:true}).count(),0);
 assert.equal(await profile.count(),0);
 assert.equal(writes.length,1);
}else if(scenario.state==='denied'){
 await page.getByRole('alert').waitFor();
 assert.equal(await list.getByRole('button',{name:/Mali/}).count(),0);
 assert.equal(await profile.count(),0);
 assert.equal(writes.length,0);
}else if(scenario.state==='empty'){
 await list.getByText(label('ไม่พบลูกค้า','No customers found'),{exact:true}).waitFor();
}else{
 await page.getByRole('alert').waitFor();failed=false;
 await page.getByRole('button',{name:label('ลองอีกครั้ง','Retry'),exact:true}).click();
 await list.getByRole('button',{name:/Mali/}).waitFor();
 await list.getByRole('button',{name:/Mali/}).click();
 denied=true;
 await page.getByRole('button',{name:label('รีเฟรช','Refresh'),exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await profile.count(),0);
 assert.equal(await list.getByRole('button',{name:/Mali/}).count(),0);
 denied=false;
 await page.getByRole('button',{name:label('ลองอีกครั้ง','Retry'),exact:true}).click();
 await list.getByRole('button',{name:/Mali/}).waitFor();
}
await page.evaluate(()=>window.scrollTo(0,0));
const geometry=await page.evaluate(()=>Object.fromEntries(['.customers-workspace','.customers-heading h1','.customers-columns','.customers-list-panel','.customer-profile-editor','.customer-profile-preview','.workspace-tabs'].map(selector=>{
 const node=document.querySelector(selector);
 if(!node)return [selector,null];
 const box=node.getBoundingClientRect(),style=getComputedStyle(node);
 return [selector,{x:box.x,y:box.y,width:box.width,height:box.height,fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,gap:style.gap,display:style.display}];
})));
receipt.checks.push({scenario,geometry,kind:'measured-layout-not-fidelity-acceptance'});
const image=join(capture,`pos-customers-${scenario.state}-${scenario.language}-${scenario.width}-${stamp}.png`);await page.screenshot({path:image,fullPage:true});receipt.captures.push(image);receipt.checks.push({scenario,writes});await page.close();}receipt.status='PASS_SCOPED_CUSTOMER_SURFACE';}catch(error){receipt.status='FAIL';receipt.error=String(error);throw error;}finally{const path=join(evidence,`pos-customers-surface-${stamp}.json`);await writeFile(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});await browser.close();if(capture!==scratch)await rm(scratch,{recursive:true,force:true});console.log(JSON.stringify({path,status:receipt.status}));}
