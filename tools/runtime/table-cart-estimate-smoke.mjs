// Hydrated local TableMenu fixtures only; never posts visits/quotes/orders/payments.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
const origin=new URL(process.env.BITPOS_UI_ORIGIN??'');assert.equal(origin.hostname,'127.0.0.1');
const root='.omp/work/flutter-delivery-20261016/evidence/',stamp=new Date().toISOString().replaceAll(':','-');
const scratch=await mkdtemp(join(tmpdir(),'bitpos-table-cart-estimate-'));
const receipt={status:'RUNNING',fixture:true,checks:[],captures:[],scratchDirectory:scratch,scratchCleanup:'pending_parent_visual_analysis',limits:['Hydrated HTTP presentation fixtures, not persisted API/SQL/payment or full visual acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};
let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const {width,thai} of [{width:1440,thai:false},{width:390,thai:true},{width:320,thai:false}]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(6000);
  const entry='C'.repeat(43),path='/table/'+entry,key='bitpos-table-guest-v1:'+entry;
  const id='30000000-0000-4000-8000-000000000001',money={currency:'USD',decimals:2,amountMinor:'300'};
  let removed=false;const mutations=[],errors=[];
  page.on('pageerror',error=>errors.push(error.name));
  await page.route('**/api/**',async route=>{
   if(route.request().method()!=='GET'){mutations.push(route.request().method());return route.abort();}
   assert.equal(new URL(route.request().url()).pathname,'/api'+path);
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tableLabel:'LOCAL SAVED CART FIXTURE',online:true,available:true,occupancy:{generation:'1',active:false},menu:{merchant:{name:'LOCAL CART FIXTURE'},products:removed?[]:[{id,name:'กาแฟทดสอบ',nameEn:'Fixture coffee',category:'Coffee',description:'Local fixture',imageUrl:'/images/menu/espresso.jpg',basePrice:money,unitPrice:money,available:20,promotion:null}],asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString(),menuVersion:'fixture-menu',priceVersion:'30000000-0000-4000-8000-000000000003',pricingRevision:'1',currency:'USD',decimals:2}})});
  });
  await page.goto(new URL(path,origin).href);
  await page.getByRole('button',{name:'Increase Fixture coffee',exact:true}).click();
  if(thai)await page.getByRole('button',{name:'เปลี่ยนเป็นภาษาไทย',exact:true}).click();
  const before=await page.evaluate(key=>localStorage.getItem(key),key);
  assert.match(await page.locator('.table-cart-trigger').innerText(),/3\.00/);
  removed=true;
  await page.mouse.move(8,300);await page.mouse.wheel(0,3000);
  await page.getByRole('button',{name:thai?'รีเฟรชเมนู':'Refresh menu',exact:true}).click();
  await page.getByText(thai?'ยังไม่มีรายการเมนูในขณะนี้':'No menu items are available yet.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before,'A refreshed catalog must not rewrite the saved cart');
  const dock=page.locator('.table-cart-trigger');
  const displayed=await dock.innerText();
  receipt.checks.push({width,thai,removedCatalogDock:displayed,cartJournalUnchanged:true});
  assert.ok(!/0\.00/.test(displayed),'A missing saved product must not become a zero-price cart');
  await dock.click();
  const sheet=page.getByRole('dialog');
  await sheet.getByText(thai?'ยังประมาณยอดไม่ได้':'Estimate unavailable',{exact:true}).waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.table-sheet')).opacity==='1');
  const recovery=sheet.getByRole('button',{name:thai?'ลบเมนูที่ไม่พร้อม':'Remove unavailable item',exact:true});
  const itemName=sheet.locator('.table-cart-lines strong');
  const nameBox=await itemName.boundingBox(),recoveryBox=await recovery.boundingBox();
  assert.ok(nameBox&&recoveryBox&&nameBox.width>=120&&recoveryBox.y>=nameBox.y+nameBox.height,'Unavailable item name must remain readable above its recovery action');
  receipt.checks.at(-1).readableUnavailableItem=true;
  const contrasts=[];
  for(const action of await sheet.locator('button.table-text-button').all()){
   await action.hover();
   const contrast=await action.evaluate(async el=>{
    getComputedStyle(el).backgroundColor;
    await Promise.all(el.getAnimations().map(animation=>animation.finished));
    const style=getComputedStyle(el),luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const foreground=luminance(style.color),background=luminance(style.backgroundColor);
    return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
   });
   assert.ok(contrast>=4.5,'Cart text recovery action must retain readable hover contrast');contrasts.push(contrast);
  }
  receipt.checks.at(-1).hoverContrasts=contrasts;
  const capture='table-cart-missing-'+(thai?'th':'en')+'-'+width+'-'+stamp+'.png';
  await page.screenshot({path:join(scratch,capture),fullPage:true});receipt.captures.push(capture);
  await sheet.getByRole('button',{name:thai?'ลบเมนูที่ไม่พร้อม':'Remove unavailable item',exact:true}).click();
  const after=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));
  assert.deepEqual(after.items,[]);assert.equal(after.requestId,JSON.parse(before).requestId);
  assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  receipt.checks.at(-1).removedOnlyUnavailableItem=true;
  await page.close();
 }
 receipt.sourceHashes=Object.fromEntries(await Promise.all(['apps/web/src/components/TableMenu.tsx','apps/web/src/styles/table-menu.css','tools/runtime/table-cart-estimate-smoke.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
 receipt.status='PASS_BOUNDED_SAVED_CART_ESTIMATE_FIXTURES';
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error);process.exitCode=1;}
finally{await browser?.close();const evidence=root+'table-cart-estimate-'+stamp+'.json';await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,scratch,error:receipt.error}));}
