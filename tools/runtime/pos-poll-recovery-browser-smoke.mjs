// Loopback full-shell GET-response fixtures; no business mutations or payment proof.
import assert from 'node:assert/strict';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
const origin=process.env.BITPOS_UI_ORIGIN;
assert.equal(new URL(origin).hostname,'127.0.0.1');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const receipt={status:'RUNNING',fixture:true,origin,checks:[],limits:['Only GET /orders overridden; no business commands','Synthetic local merchant identity','Not joined payment/custody proof'],physicalTesting:'deferred_by_user_2026-10-16'};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(origin);
 await page.locator('input[name=email]').fill('merchant@bitpos.invalid');
 await page.locator('input[name=password]').fill('local-fixture-only');
 await page.locator('summary').click();
 await page.locator('input[name=merchantId]').fill('32d7d169-28b8-490a-b773-f81db3f447c4');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Orders (0)',exact:true}).click();
 await page.locator('.order-row').waitFor();
 const unexpected=[];
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/orders')&&r.method()!=='GET')unexpected.push(r.method());});
 let state=403,polls=0;
 await page.route('**/api/orders',async route=>{
  assert.equal(route.request().method(),'GET');polls++;
  await route.fulfill({status:state,contentType:'application/json',body:JSON.stringify(state===200?{orders:[]}:{error:{code:'REQUEST_FAILED',message:'Local polling read fixture',retryable:state===503}})});
 });
 for(const failure of [403,503]) {
  state=failure;
  const guidance=failure===403?'Permission denied. Use an authorized merchant account.':'Order data may be stale. Refresh to try again.';
  await page.getByText(guidance,{exact:true}).waitFor({timeout:12000});
  const before=polls;state=200;
  await page.getByRole('heading',{name:'No orders yet',exact:true}).waitFor({timeout:12000});
  assert.equal(await page.getByText(guidance,{exact:true}).count(),0);
  assert.ok(polls>before);
  receipt.checks.push({failure,recoveredAutomatically:true,recoveredEmpty:true,noClickAfterFailure:true});
 }
 assert.deepEqual(unexpected,[]);
 receipt.status='PASS_AUTOMATIC_POLL_READ_RECOVERY';
 await page.close();
} catch(error) {receipt.status='FAIL';receipt.error=String(error);throw error;}
finally {await writeFile('.omp/work/flutter-delivery-20261016/evidence/pos-poll-recovery-20261023.json',JSON.stringify(receipt,null,2)+'\n');await browser.close();console.log(receipt.status);}
