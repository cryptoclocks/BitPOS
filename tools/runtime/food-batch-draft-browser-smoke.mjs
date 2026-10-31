import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.BITPOS_PLAYWRIGHT_MODULE;if(!modulePath)throw Error('Set BITPOS_PLAYWRIGHT_MODULE to the local Playwright module');
const playwright=await import(pathToFileURL(modulePath).href),chromium=playwright.chromium??playwright.default.chromium;
const origin='http://127.0.0.1:4350',id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const merchant=id(1),branch=id(2),driver=id(3),account=id(4),shipment=id(5),other=id(6),batch=id(7);
const items=[{shipmentId:shipment,version:'1',generation:'0'},{shipmentId:other,version:'2',generation:'0'}],calls=[];
let requests=0,command=null;
const browser=await chromium.launch({executablePath:process.env.BITPOS_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,body=request.postData()?request.postDataJSON():null;
  calls.push({path,method:request.method(),body});const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path.endsWith('/auth/otp'))return reply({});
  if(path.endsWith('/auth/verify'))return reply({accountId:account,sessionId:id(8),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});
  if(path.endsWith('/platform/roles'))return reply({roles:['dispatcher']});
  if(path.endsWith('/food-dispatch-policy'))return reply({revision:'0',policy:null});
  if(path.endsWith('/food-dispatch'))return reply({merchantId:merchant,branchId:branch,items:[{shipmentId:shipment,orderId:id(9),shipmentState:'READY_FOR_DISPATCH',shipmentVersion:'1',generation:'0',createdAt:'2026-10-27T00:00:00Z',search:null,offers:[],assignment:null}],nextAfterId:null,snapshotAt:'2026-10-27T00:00:00Z'});
  if(path.includes('/food-batch-candidates/'))return reply({items,snapshotAt:'2026-10-27T00:00:00Z',assignmentCreated:false});
  if(path.endsWith('/food-batch-drafts')){
   requests++;if(!command)command=body;else assert.deepEqual(body,command,'recovery must replay the exact command');
   if(requests===1)return route.abort('failed');
   return reply({batchId:batch,state:'DRAFT',version:'1',assignmentCreated:false,items});
  }
  throw Error('Unexpected fixture API '+path);
 });
 await page.goto(origin+'/platform/food-dispatch');
 await page.getByLabel('โทรศัพท์').fill('+66900000002');await page.getByRole('button',{name:'ขอ OTP'}).click();
 await page.getByLabel('OTP').fill('123456');await page.getByRole('button',{name:'ยืนยัน OTP'}).click();
 await page.getByLabel('รหัสร้าน').fill(merchant);await page.getByLabel('รหัสสาขา').fill(branch);await page.getByRole('button',{name:'โหลดภาพสถานะล่าสุด'}).click();
 await page.getByRole('button',{name:new RegExp(shipment)}).click();await page.getByRole('button',{name:'ดูงานที่อาจจัดส่งร่วมกัน'}).click();
 await page.getByLabel('รหัสไรเดอร์สำหรับร่างงานรวม').fill(driver);await page.getByRole('button',{name:'บันทึกร่างงานรวม'}).click();
 await page.getByRole('button',{name:'กู้คืนคำสั่งเดิมเท่านั้น'}).waitFor();await page.getByRole('button',{name:'กู้คืนคำสั่งเดิมเท่านั้น'}).click();
 await page.getByText(batch,{exact:false}).waitFor();assert.equal(requests,2);assert.equal(command.driverId,driver);assert.deepEqual(command.items,items);
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByText('Draft saved. No offer or assignment has been made to a driver.').waitFor();
 assert.equal(calls.some(c=>/\/offers$|\/claim$/.test(c.path)),false,'draft must not offer or claim');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 const screenshot=process.env.BITPOS_BATCH_SCREENSHOT;if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
 await page.reload();await page.getByLabel('โทรศัพท์').fill('+66900000002');await page.getByRole('button',{name:'ขอ OTP'}).click();await page.getByLabel('OTP').fill('123456');await page.getByRole('button',{name:'ยืนยัน OTP'}).click();
 await page.getByText(batch,{exact:false}).waitFor();assert.equal(requests,2,'restoring a receipt does not create another draft');
 console.log(JSON.stringify({status:'PASS_BATCH_DRAFT_BROWSER_FIXTURE',requests,overflow,viewport:'390x844',limits:'Mock API; no real order, offer or assignment'}));
}finally{await browser.close();}
