import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=join(root,'docs/diagrams/bitpos-20261024');
const scratch=await mkdtemp(join(tmpdir(),'bitpos-pele-review-'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())});
const cases=[];let success=false;
try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(pathToFileURL(join(folder,'index.html')).href);await page.evaluate(()=>document.fonts.ready);
  for(const id of ['01-system','02-food-order','03-payment-recovery','04-ui-development']){
   await page.locator(`[data-target="${id}"]`).click();
   const actual=await page.locator(`[id="${id}"]`).evaluate(p=>{const svg=p.querySelector('svg');return {width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,text:svg.querySelectorAll('text').length,viewbox:svg.getAttribute('viewBox'),overflow:document.documentElement.scrollWidth>innerWidth,visible:!p.hidden,internalForeground:getComputedStyle(svg).getPropertyValue('--_fg').trim(),firstRectFill:getComputedStyle(svg.querySelector('rect')).fill}});
   assert(actual.visible&&actual.width>0&&actual.height>0&&actual.text>5&&actual.viewbox);assert.equal(actual.overflow,false);
   assert(actual.internalForeground);assert.notEqual(actual.firstRectFill,'rgb(0, 0, 0)');
   await page.getByRole('button',{name:'ซูมเข้า',exact:true}).click();assert.equal(await page.locator('#zoom').textContent(),'125%');
   await page.getByRole('button',{name:'พอดีหน้าจอ',exact:true}).click();
   await page.locator(`[id="${id}"] summary`).click();assert.equal(await page.locator(`[id="${id}"] details`).getAttribute('open'),'');
   await page.locator(`[id="${id}"] summary`).click();cases.push({viewport:width,id,...actual});
  }
 }
 await page.setViewportSize({width:1440,height:1800});
 await page.locator('[data-target="01-system"]').click();await page.screenshot({path:join(scratch,'system-desktop.png'),fullPage:true});
 await page.locator('[data-target="02-food-order"]').click();await page.screenshot({path:join(scratch,'food-sequence-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await writeFile(join(folder,'validation.json'),JSON.stringify({checkedAt:new Date().toISOString(),renderer:'pele1.9.0',cases,checks:['8 visible SVG views desktop/mobile','tab selection','zoom and fit','source disclosure','no horizontal document overflow','zero browser errors','zero HTTP requests: offline'],visualReview:'pending manual screenshot inspection',errors,networkRequests:network},null,2)+'\n');
 success=true;console.log(JSON.stringify({status:'PASS',cases:cases.length,scratch,images:['system-desktop.png','food-sequence-desktop.png']}));
}finally{await browser.close();if(!success)await rm(scratch,{recursive:true,force:true})}
