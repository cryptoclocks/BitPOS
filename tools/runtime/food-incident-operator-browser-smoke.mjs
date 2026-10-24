// Run from native Eval with an opened dedicated browser tab and the non-secret fixture receipt.
export async function verifyFoodIncidentOperator(tab,fixture){
 return tab.run(async({page,assert},f)=>{
  const client=await page.createCDPSession();await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  assert=(await import('node:assert/strict')).default;
  const text=()=>page.evaluate(()=>document.body.innerText);
  async function fill(selector,value){await page.evaluate((selector,value)=>{const i=document.querySelector(selector);const proto=i.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(i,value);i.dispatchEvent(new Event('input',{bubbles:true}));},selector,value);}
  async function click(label){await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent===label&&!b.disabled),{},label);await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click(),label);}
  await page.waitForSelector('input[type="tel"]');if((await text()).includes('ขอ OTP'))await click('English');
  await fill('input[type="tel"]',f.phone);await click('Request OTP');await page.waitForSelector('input[autocomplete="one-time-code"]');await fill('input[autocomplete="one-time-code"]',f.otp);await click('Verify OTP');await page.waitForSelector('input[pattern="[0-9a-fA-F-]{36}"]');
  assert(!(await text()).includes('Original command unresolved'),'A prior fixture command remains unresolved');
  await fill('input[pattern="[0-9a-fA-F-]{36}"]',f.merchantId);await click('First page / refresh');await page.waitForSelector('button.platform-driver');await page.waitForFunction(()=>!document.querySelector('button.platform-driver').disabled);await page.evaluate(()=>document.querySelector('button.platform-driver').click());await page.waitForSelector('textarea');
  assert((await text()).includes('AT_PICKUP / ACTIVE'));assert((await text()).includes('1 / 1'));assert(!(await text()).includes('Synthetic PRIVATE safety report'));
  await fill('input[maxlength="500"]','Synthetic browser scoped private safety investigation');await click('Inspect private details with access audit');await page.waitForSelector('aside');assert((await text()).includes('Synthetic PRIVATE safety report'));
  const privateStorage=await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('Synthetic PRIVATE safety report')));assert(!privateStorage);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>!document.querySelector('aside')&&!document.querySelector('textarea'));
  await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});await page.evaluate(()=>document.querySelector('button.platform-driver').click());await page.waitForSelector('textarea');
  await fill('textarea','Synthetic browser acknowledgement only');await click('Acknowledge only — do not resume');await page.waitForFunction(()=>document.body.innerText.includes('Acknowledgement recorded — not permission to resume'));await page.waitForSelector('textarea');assert((await text()).includes('1 / 0'));assert((await text()).includes('AT_PICKUP / ACTIVE'));assert(!await page.$('aside'));
  await fill('textarea','Synthetic explicit separate same-custody authorization');await click('Authorize same-custody resume');await page.waitForFunction(()=>document.body.innerText.includes('Same-custody resume recorded at that time'));await page.waitForSelector('textarea');
  const finalText=await text();assert(finalText.includes('0 / 0'));assert(finalText.includes('AT_PICKUP / ACTIVE'));
  const journal=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('bitpos.platform.foodIncident.')));assert.equal(journal.length,0);
  await page.screenshot({path:'.omp/work/flutter-delivery-20261016/evidence/dispatch082-operator-resumed-browser-20261018.png',fullPage:true});
  return {status:'PASS_ACTUAL_COMPILED_OPERATOR_BROWSER',merchantId:f.merchantId,incidentId:f.incidentId,assignmentId:f.assignmentId,privateBodyNotPersisted:true,syntheticHiddenLifecycleClearsPrivateInspection:true,acknowledgementOnlyRetainsBlocker:true,separateResumePreservesActiveCustody:true,pendingJournalCleared:true,fixture:'Compiled narrow browser proxy4382 with only fixed local upstream3001 substituted to fixture API3015; synthetic OTP/payment/report, foreground and visibilitychange fixtures. No emergency services or real contacts.',limits:['This receipt is browser behavior; persisted counterpart checked separately','Physical window background unavailable in automation; explicit synthetic document visibility fixture used','Cross-tab real Web Lock race not covered by this smoke'],physicalTesting:'deferred_by_user_2026-10-16'};
 },{args:[fixture],timeout:60});
}
