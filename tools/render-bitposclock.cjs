/* Native HTML device mockups → 480×320 PNGs. No payment or hardware connection. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.BITPOS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'team-guide','assets','bitposclock');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.BITPOS_CHROME_EXECUTABLE?{executablePath:process.env.BITPOS_CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:480,height:320},offline:true,reducedMotion:'reduce',deviceScaleFactor:1});
  const page=await context.newPage();
  const errors=[],network=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url())});
  const renderURL=pathToFileURL(path.join(root,'team-guide','clock','render.html')).href;
  await page.goto(renderURL);
  const screens=await page.evaluate(()=>window.BitPosClock.screens.map(({body,...screen})=>screen));
  assert.equal(screens.length,18);
  for(const screen of screens){
    await page.goto(`${renderURL}?screen=${screen.key}`);
    await page.evaluate(async()=>{await Promise.all([document.fonts.load('16px DSEG7','0123456789:.'),document.fonts.load('16px Sarabun','ภาษาไทย'),document.fonts.load('600 16px Sarabun','ภาษาไทย')]);await document.fonts.ready});
    assert.equal(await page.evaluate(()=>document.fonts.check('16px DSEG7','0123456789:.')&&document.fonts.check('16px Sarabun','ภาษาไทย')),true);
    const overflowing=await page.evaluate(()=>{
      const bounds=document.querySelector('.device-content').getBoundingClientRect();
      const walker=document.createTreeWalker(document.querySelector('.device-content'),NodeFilter.SHOW_TEXT);
      const result=[];
      while(walker.nextNode()){
        const node=walker.currentNode;
        if(!node.textContent.trim()||node.parentElement.closest('svg'))continue;
        const range=document.createRange();range.selectNodeContents(node);
        for(const box of range.getClientRects())if(box.width&&box.height&&(box.left<bounds.left-1||box.right>bounds.right+1||box.bottom>bounds.bottom+1||box.top<bounds.top-1))result.push({text:node.textContent,box:{x:box.x,y:box.y,width:box.width,height:box.height}});
      }
      for(const element of document.querySelectorAll('.device-button,.receipt-line,.rows,.qr,.status-icon,.collect-card,.market-strip,.stamp-row,.tier-row,.voucher-code,.offline-order,.wifi-code,.settings-actions')){
        const box=element.getBoundingClientRect();
        if(box.left<bounds.left-1||box.right>bounds.right+1||box.bottom>bounds.bottom+1||box.top<bounds.top-1)result.push({element:element.className,bottom:box.bottom,right:box.right});
      }
      return result;
    });
    if(overflowing.length)failures.push({screen:screen.id,overflowing});
    await page.locator('.device-screen').screenshot({path:path.join(output,`${screen.id.toLowerCase()}-${screen.key}.png`)});
  }
  // Contact sheets are rendered from native local HTML rather than raster image edits.
  await page.setViewportSize({width:1560,height:2400});
  const sheet=screensSubset=>`<!doctype html><html lang="th"><head><meta charset="utf-8"><style>@font-face{font-family:Sarabun;src:url('${pathToFileURL(path.join(root,'team-guide/assets/fonts/Sarabun-SemiBold.ttf')).href}')}*{box-sizing:border-box}body{margin:0;background:#eee7f8;color:#33204b;font-family:Sarabun}.sheet{width:1560px;padding:30px}.heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}.heading h1{margin:0;font-size:28px}.heading span{font-size:13px}.grid{display:grid;grid-template-columns:repeat(3,480px);gap:28px 30px}figure{margin:0}img{width:480px;height:320px;display:block;border-radius:10px}figcaption{font-size:16px;padding-top:9px;line-height:1.8}small{font-size:12px;color:#766982;margin-left:8px}</style></head><body><main class="sheet"><header class="heading"><h1>BitPosClock / Screen concepts</h1><span>480 × 320 · ภาพจำลอง / ข้อมูลสมมติ</span></header><div class="grid">${screensSubset.map(screen=>`<figure><img src="${pathToFileURL(path.join(output,`${screen.id.toLowerCase()}-${screen.key}.png`)).href}"><figcaption>${screen.id}<small>${screen.title}</small></figcaption></figure>`).join('')}</div></main></body></html>`;
  await page.setContent(sheet(screens.filter(screen=>['BPC-01','BPC-03','BPC-05','BPC-09','BPC-11','BPC-12'].includes(screen.id))));
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('.sheet').screenshot({path:path.join(output,'overview.png')});
  await page.setContent(sheet(screens));
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('.sheet').screenshot({path:path.join(output,'all-screens.png')});
  const result={screenCount:screens.length,width:480,height:320,pageErrors:errors,externalRequests:network,overflow:failures};
  fs.mkdirSync(path.join(root,'artifacts/team-guide'),{recursive:true});
  fs.writeFileSync(path.join(root,'artifacts/team-guide/clock-render-qa.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  await browser.close();
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.deepEqual(failures,[]);
})().catch(error=>{console.error(error);process.exit(1)});
