/* Browser QA for the offline handbook. No dependencies are required to read it.
 * QA only: provide Playwright through BITPOS_PLAYWRIGHT_MODULE when not installed.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.BITPOS_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root,'artifacts','team-guide');
fs.mkdirSync(output,{recursive:true});

(async () => {
  const chrome = process.env.BITPOS_CHROME_EXECUTABLE;
  const browser = await chromium.launch({headless:true,...(chrome ? {executablePath:chrome} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000},offline:true,reducedMotion:'reduce',acceptDownloads:true});
  const page = await context.newPage();
  const errors = []; const network = []; const failedResources = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url())) network.push(request.url());});
  page.on('requestfailed',request=>failedResources.push(request.url()));
  const url=pathToFileURL(path.join(root,'team-guide','index.html')).href;
  await page.goto(url);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.section').count(),16);
  assert.equal(await page.locator('.pos-feature').count(),25);
  assert.equal(await page.locator('.phase').count(),8);
  assert.equal(await page.locator('.nft-card').count(),5);
  assert.equal(await page.locator('.map-node').count(),8);
  assert.equal(await page.evaluate(()=>document.fonts.check('16px Sarabun')),true);

  await page.screenshot({path:path.join(output,'desktop-overview.png')});
  await page.locator('#architecture').scrollIntoViewIfNeeded();
  await page.addStyleTag({content:'.topbar{visibility:hidden}'});
  await page.locator('#architecture').screenshot({path:path.join(output,'architecture.png')});
  await page.addStyleTag({content:'.topbar{visibility:visible}'});
  await page.locator('.map-node[data-node="terminal"]').click();
  assert.match(await page.locator('#map-detail').textContent(),/ESP-IDF/);
  await page.locator('.map-node[data-node="ai"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#map-detail').textContent(),/AI Campaign Tools/);
  assert.equal(await page.locator('.map-node[aria-pressed="true"]').count(),1);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-map').click();
  const diagram=await downloadPromise;
  await diagram.saveAs(path.join(output,'BitPOS-architecture.svg'));
  assert.match(fs.readFileSync(path.join(output,'BitPOS-architecture.svg'),'utf8'),/<style/);

  await page.locator('#pos-filters [data-group="2"]').click();
  assert.equal(await page.locator('.pos-feature').count(),7);
  await page.locator('#pos-filters [data-group="all"]').click();
  assert.equal(await page.locator('.pos-feature').count(),25);

  const scenarios=[];
  for(const method of ['usdg','promptpay','cash']) {
    for(const scenario of ['success','failed','duplicate','reward-failed']) {
      await page.locator('#sim-method').selectOption(method);
      await page.locator('#sim-case').selectOption(scenario);
      for(let i=0;i<5;i++) await page.locator('#sim-next').click();
      const order=(await page.locator('#order-state').textContent()).trim();
      const reward=(await page.locator('#reward-state').textContent()).trim();
      assert.equal(order,scenario==='failed'?'AWAITING PAYMENT':'PAID');
      assert.equal(reward,scenario==='failed'?'NOT ELIGIBLE':scenario==='reward-failed'?'FAILED / RETRY':'ISSUED');
      if(scenario==='duplicate') assert.match(await page.locator('#sim-invariant').textContent(),/grant 1/);
      assert.equal(await page.locator('#sim-next').isDisabled(),true);
      scenarios.push({method,scenario,order,reward});
    }
  }
  await page.locator('#sim-case').selectOption('success');
  await page.locator('#sim-method').selectOption('usdg');
  await page.locator('#sim-play').click();
  await page.waitForTimeout(2300);
  assert.match(await page.locator('#step-counter').textContent(),/02/);
  await page.locator('#sim-play').click();
  await page.locator('#sim-reset').click();
  assert.equal(await page.locator('#order-state').textContent(),'DRAFT');

  assert.equal(await page.locator('#calc-per-order').textContent(),'฿4');
  assert.equal(await page.locator('#calc-margin').textContent(),'฿46');
  await page.locator('#calc-reward').fill('300');
  assert.equal(await page.locator('#calc-margin').textContent(),'฿-10');
  assert.equal(await page.locator('.calculator-result.loss').count(),1);
  await page.locator('#calc-every').fill('0');
  assert.equal(await page.locator('#calc-margin').textContent(),'—');
  await page.locator('#calc-every').fill('5');
  await page.locator('#calc-reward').fill('20');

  await page.locator('#search').fill('firmware');
  assert.equal(await page.locator('#search-results a[href="#hardware"]').count(),1);
  await page.locator('#search-results a[href="#hardware"]').click();
  assert.equal(await page.locator('#search-results').isHidden(),true);
  assert.match(page.url(),/#hardware/);
  await page.locator('#search').fill('zzzz-no-such-topic');
  assert.match(await page.locator('#search-results').textContent(),/ไม่พบ/);
  await page.keyboard.press('Escape');

  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(output,'mobile-overview.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('#menu-toggle').click();
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'true');
  await page.locator('#contents a[href="#hardware"]').click();
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
  await page.locator('#rewards').scrollIntoViewIfNeeded();
  await page.locator('#rewards').screenshot({path:path.join(output,'mobile-rewards.png')});
  await page.setViewportSize({width:320,height:760});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({media:'print'});
  await page.screenshot({path:path.join(output,'print-layout.png')});
  assert.deepEqual(errors,[]);
  assert.deepEqual(network,[]);
  assert.deepEqual(failedResources,[]);
  const result={checkedDate:'2026-10-07',offlineFileURL:true,externalRequests:network.length,pageErrors:errors,sections:16,posScreens:25,phases:8,collectibleConcepts:5,architectureNodes:8,scenarios,checks:['local fonts','SVG download','feature filters','keyboard diagram','autoplay/reset','campaign math and invalid input','search and no results','mobile menu','no horizontal body overflow at 390/320','print layout']};
  fs.writeFileSync(path.join(output,'qa-result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
