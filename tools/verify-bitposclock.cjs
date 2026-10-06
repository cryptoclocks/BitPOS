const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.BITPOS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'artifacts','team-guide');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BITPOS_CHROME_EXECUTABLE?{executablePath:process.env.BITPOS_CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1050},offline:true,reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[],network=[],failed=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())});
  page.on('requestfailed',r=>failed.push(r.url()));
  const url=pathToFileURL(path.join(root,'team-guide/clock/index.html')).href;
  await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.screen-card').count(),18);
  assert.match(await page.locator('#screen-title').textContent(),/จอพัก/);
  await page.screenshot({path:path.join(output,'clock-gallery-desktop.png')});
  for(let i=0;i<18;i++){
    assert.equal(await page.locator('#stage-id').textContent(),`BPC-${String(i+1).padStart(2,'0')}`);
    await page.locator('#selected-image').evaluate(image=>image.decode());
    assert.deepEqual(await page.locator('#selected-image').evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight})),{width:480,height:320});
    assert.equal(await page.locator('.screen-card[aria-pressed="true"]').count(),1);
    await page.locator('#next').click();
  }
  assert.equal(await page.locator('#stage-id').textContent(),'BPC-01');
  await page.locator('#previous').click();assert.equal(await page.locator('#stage-id').textContent(),'BPC-18');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#stage-id').textContent(),'BPC-01');
  await page.locator('[data-filter="รางวัล"]').click();assert.equal(await page.locator('.screen-card:visible').count(),4);
  await page.locator('.screen-card[data-index="10"]').click();assert.equal(await page.locator('#stage-id').textContent(),'BPC-11');
  await page.goto(`${url}#bpc-16`);assert.equal(await page.locator('#stage-id').textContent(),'BPC-16');
  await page.goto(`${url}#bpc-05`);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    if(width===390)await page.screenshot({path:path.join(output,'clock-gallery-mobile.png')});
  }
  await page.locator('a.back-link').click();assert.match(page.url(),/index.html#hardware/);
  await page.locator('.clock-preview-panel a.button').click();assert.match(page.url(),/clock\/index.html/);
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.deepEqual(failed,[]);
  const result={screens:18,offlineFileURL:true,externalRequests:network.length,failedResources:failed,pageErrors:errors,checks:['all PNGs decode at 480×320','next/previous wrap','arrow key navigation','reward filter','card selection','deep links','390/320 responsive layout','handbook round trip']};
  fs.writeFileSync(path.join(output,'clock-gallery-qa.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
