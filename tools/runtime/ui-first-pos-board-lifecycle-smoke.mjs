// Compiled local POS presentation fixtures only; no order/payment mutation or persisted E2E claim.
import assert from 'node:assert/strict';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin=process.env.BITPOS_UI_ORIGIN;
assert.equal(new URL(origin).hostname,'127.0.0.1');
const evidence='.omp/work/flutter-delivery-20261016/evidence/';
const tag=process.env.BITPOS_UI_EVIDENCE_TAG??'current';
assert.match(tag,/^[a-z0-9-]+$/);
const receipt={status:'RUNNING',fixture:true,source_fingerprint:JSON.parse(execFileSync('python3',['.omp/work/flutter-delivery-20261016/gate.py','fingerprint'],{encoding:'utf8'})).source_fingerprint,checks:[],captures:[],limits:['Synthetic GET lifecycle responses in compiled POS shell; local fixture sign-in only','No persisted order/delivery/payment proof','Physical testing deferred_by_user_2026-10-16']};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const scenario of [{language:'en',width:1440},{language:'th',width:1440},{language:'en',width:390},{language:'th',width:320}]){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  let phase='loading',release;
  const gate=new Promise(resolve=>{release=resolve;});
  const commands=[];
  let listReads=0;
  await page.route('**/api/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;
   if(r.method()!=='GET'&&path!=='/api/session'){commands.push({method:r.method(),path});await route.abort();return;}
   if(path!=='/api/orders'||r.method()!=='GET'){await route.continue();return;}
   listReads++;
   if(phase==='loading')await gate;
   const status=phase==='denied'?403:phase==='error'?503:200;
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{orders:[]}:{error:{code:status===403?'FORBIDDEN':'REQUEST_FAILED',message:'LOCAL board lifecycle fixture',retryable:status===503}})});
  });
  try{
   await page.goto(origin);
   await page.locator('input[name=email]').fill('merchant@bitpos.invalid');
   await page.locator('input[name=password]').fill('local-fixture-only');
   await page.locator('summary').click();
   await page.locator('input[name=merchantId]').fill('32d7d169-28b8-490a-b773-f81db3f447c4');
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await page.getByRole('button',{name:'Orders (0)',exact:true}).click();
   if(scenario.language==='th')await page.getByRole('button',{name:'Switch to Thai',exact:true}).click();
   await page.setViewportSize({width:scenario.width,height:scenario.width>900?1000:844});
   const board=page.locator('.incoming-browser');
   const refresh=page.locator(scenario.width<=600?'.order-mobile-refresh':'.incoming-heading>button');
   await board.waitFor();
   assert.equal(await page.locator('.orders-empty').count(),0,'Pending first snapshot must not claim no orders');
   await board.getByRole('status').filter({hasText:scenario.language==='th'?'กำลังโหลดออเดอร์':'Loading orders'}).waitFor();
   assert.equal(await board.getAttribute('aria-busy'),'true');
   phase='empty';release();
   await page.getByRole('heading',{name:scenario.language==='th'?'ยังไม่มีออเดอร์':'No orders yet',exact:true}).waitFor();
   assert.equal(await board.getAttribute('aria-busy'),'false');
   for(const failure of ['denied','error']){
    phase=failure;
    await refresh.click();
    const guidance=failure==='denied'?(scenario.language==='th'?'ไม่มีสิทธิ์ดำเนินการ ใช้บัญชีร้านค้าที่ได้รับอนุญาต':'Permission denied. Use an authorized merchant account.'):(scenario.language==='th'?'ข้อมูลออเดอร์ไม่เป็นปัจจุบัน รีเฟรชเพื่อลองใหม่':'Order data may be stale. Refresh to try again.');
    await board.getByText(guidance,{exact:true}).waitFor();
    assert.equal(await page.locator('.orders-empty').count(),0,'Denied/failed reads must not claim an empty snapshot');
    assert.equal(await refresh.isEnabled(),true,'Failed read must not leave refresh busy');
    await page.addStyleTag({content:'body::after{content:"LOCAL PRESENTATION FIXTURE · no payment/delivery performed";position:fixed;bottom:0;left:0;right:0;background:#fff4cb;color:#3b2600;font:10px/14px sans-serif;text-align:center;z-index:10000;pointer-events:none}'});
    const capture=`ui-first-pos-board-lifecycle-${tag}-${failure}-${scenario.language}-${scenario.width}-20261023.png`;
    await page.screenshot({path:evidence+capture});receipt.captures.push(capture);
    phase='empty';await refresh.click();
    await page.getByRole('heading',{name:scenario.language==='th'?'ยังไม่มีออเดอร์':'No orders yet',exact:true}).waitFor();
    assert.equal(await board.locator('.error').count(),0);
   }
   assert.deepEqual(commands,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   receipt.checks.push({scenario,initialLoadingNotEmpty:true,successfulEmpty:true,deniedAnd503Recovery:true,listReads,businessCommands:0});
  }finally{release();await page.close();}
 }
 receipt.status='PASS';
}catch(error){receipt.status='FAIL';receipt.error=String(error);throw error;}
finally{await writeFile(evidence+`ui-first-pos-board-lifecycle-${tag}-20261023.json`,JSON.stringify(receipt,null,2)+'\n');await browser.close();}
