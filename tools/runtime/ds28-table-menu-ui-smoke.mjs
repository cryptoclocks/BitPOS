// Actual hydrated TableMenu, local HTTP presentation fixtures only. No API mutations.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../.omp/work/h2-parallel-consent-20261025/browser-toolchain/node_modules/playwright/index.mjs';
const origin=new URL(process.env.BITPOS_UI_ORIGIN??'');assert.equal(origin.hostname,'127.0.0.1');
const stamp=new Date().toISOString().replaceAll(':','-'),root='.omp/work/h2-merchant-pricing-20261026/DS28/';
const scratch=await mkdtemp(join(tmpdir(),'bitpos-table-filter-recovery-'));
const receipt={status:'RUNNING',fixture:true,scratchDirectory:scratch,scratchCleanup:'pending_parent_visual_analysis',captures:[],checks:[],limits:['Hydrated TableMenu with local HTTP catalog fixtures; no persisted API/SQL or full fidelity acceptance','No visit/quote/order/payment/provider commands'],physicalTesting:'deferred_by_user_2026-10-16'};
let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const {width,thai} of [{width:1440,thai:false},{width:390,thai:true},{width:320,thai:false}]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(6000);
  const entry='F'.repeat(43),path='/table/'+entry,key='bitpos-table-guest-v1:'+entry;
  const money={currency:'USD',decimals:2,amountMinor:'300'},id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const products=[{id:id(1),name:'กาแฟทดสอบ',nameEn:'Fixture coffee',category:'Coffee',description:'Original local fixture',imageUrl:null,basePrice:money,unitPrice:money,available:20,promotion:null},{id:id(2),name:'ขนมทดสอบ',nameEn:'Fixture bakery',category:'Bakery',description:'Original local fixture',imageUrl:'/missing-local-fixture-photo.jpg',basePrice:money,unitPrice:money,available:20,promotion:null}];
  let empty=false,unavailable=false;const mutations=[],errors=[];
  page.on('pageerror',error=>errors.push(error.name));
  await page.route('**/api/**',async route=>{
   const request=route.request();if(request.method()!=='GET'){mutations.push({method:request.method(),path:new URL(request.url()).pathname});return route.abort();}
   assert.equal(new URL(request.url()).pathname,'/api'+path);
   if(unavailable)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'FIXTURE_UNAVAILABLE',message:'Local presentation failure fixture',retryable:true}})});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tableLabel:'LOCAL FILTER FIXTURE',online:true,available:true,occupancy:{generation:'1',active:false},menu:{merchant:{name:'LOCAL FILTER FIXTURE'},products:empty?[]:products,asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString(),menuVersion:'fixture-menu',priceVersion:id(3),pricingRevision:'1',currency:'USD',decimals:2}})});
  });
  await page.goto(new URL(path,origin).href);await page.getByRole('button',{name:'Increase Fixture coffee',exact:true}).click();
  if(thai)await page.getByRole('button',{name:'เปลี่ยนเป็นภาษาไทย',exact:true}).click();
  if(thai)assert.match(await page.locator('.table-menu').evaluate(el=>getComputedStyle(el).fontFamily),/Noto Sans Thai/);
  const before=await page.evaluate(key=>localStorage.getItem(key),key);assert.equal(JSON.parse(before).items[0].qty,1);
  await page.waitForFunction(()=>[...document.querySelectorAll('.table-product-photo img')].every(img=>img.complete));
  assert.equal(await page.locator('.table-product-photo img[src*="/images/menu/"]').count(),0);
  assert.equal(await page.locator('.table-products').getByRole('img',{name:thai?'ไม่มีรูปสินค้า':'No product photo',exact:true}).count(),2);
  assert.equal(await page.locator('.table-product-photo img:visible').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width>=1100){const menu=await page.locator('.table-catalog-column').boundingBox(),rail=await page.locator('.table-desktop-cart').boundingBox();assert.ok(menu&&rail&&rail.x>=menu.x+menu.width+30);assert.ok(rail.width>=360);}
  await page.locator('.table-product').first().getByRole('button',{name:thai?'รายละเอียด':'Details',exact:true}).click();
  const detail=page.getByRole('dialog',{name:thai?'กาแฟทดสอบ':'Fixture coffee',exact:true});await detail.waitFor();
  await detail.getByText('Original local fixture',{exact:true}).waitFor();
  const detailCapture=`menu-detail-${width}-${stamp}.png`;await page.screenshot({path:join(scratch,detailCapture)});receipt.captures.push(detailCapture);
  const bounds=await detail.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width,'Product dialog must fit viewport');

  await detail.getByRole('button',{name:'Increase Fixture coffee',exact:true}).click();
  await detail.getByRole('button',{name:'Decrease Fixture coffee',exact:true}).click();
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
  assert.equal(await page.locator('.table-product').first().getByRole('button',{name:thai?'รายละเอียด':'Details',exact:true}).evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  const populated=`menu-populated-${width}-${stamp}.png`;await page.screenshot({path:join(scratch,populated),fullPage:true});receipt.captures.push(populated);
  if(width>=1100){
    const rail=page.locator('.table-desktop-cart');
    await rail.getByRole('button',{name:'Increase Fixture coffee',exact:true}).click();
    assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key)).items[0].qty,2);
    await rail.getByRole('button',{name:'Decrease Fixture coffee',exact:true}).click();
    await rail.getByRole('button',{name:'Add something else',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.getAttribute('type')==='search');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  }else{
  await page.locator('.table-cart-trigger').click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await dialog.getByRole('button',{name:'Increase Fixture coffee',exact:true}).click();
  assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key)).items[0].qty,2);
  await dialog.getByRole('button',{name:'Decrease Fixture coffee',exact:true}).click();
  const cartImage=`menu-cart-${width}-${stamp}.png`;await page.screenshot({path:join(scratch,cartImage),fullPage:true});receipt.captures.push(cartImage);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  await page.locator('.table-cart-trigger').click();await dialog.waitFor();
  await dialog.getByRole('button',{name:thai?'ปิดตะกร้า':'Close cart',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  await page.locator('.table-cart-trigger').click();await dialog.waitFor();
  await dialog.getByRole('button',{name:thai?'เลือกเมนูเพิ่ม':'Add something else',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.getAttribute('type')==='search');
  }
  const assistant=page.locator('.table-assistant-options');assert.equal(await assistant.getAttribute('open'),null);await assistant.locator('summary').first().click();assert.notEqual(await assistant.getAttribute('open'),null);await assistant.locator('summary').first().click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  const search=page.getByRole('searchbox');await search.fill('zz-no-local-match');
  const clear=page.getByRole('button',{name:thai?'ล้างตัวกรอง':'Clear filters',exact:true});await clear.waitFor();
  assert.equal(await page.locator('.table-product').count(),0);
  const capture=async state=>{const name=`table-filter-${state}-${thai?'th':'en'}-${width}-${stamp}.png`;await page.screenshot({path:join(scratch,name),fullPage:true});receipt.captures.push(name);};
  await capture('no-match');await clear.click();
  const refreshMenu=async()=>{await page.mouse.move(8,300);await page.mouse.wheel(0,3000);await page.waitForFunction(()=>window.scrollY+innerHeight>=document.documentElement.scrollHeight-2);await page.getByRole('button',{name:thai?'รีเฟรชเมนู':'Refresh menu',exact:true}).click();};
  assert.equal(await search.inputValue(),'');assert.equal(await page.locator('.table-product').count(),2);
  await page.getByRole('navigation',{name:'Menu categories'}).getByRole('button',{name:thai?'เบเกอรี่':'Bakery',exact:true}).click();
  await search.fill(thai?'กาแฟ':'coffee');await clear.waitFor();await clear.click();
  assert.equal(await page.locator('.table-product').count(),2);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  products[0].imageUrl='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="purple"/></svg>');
  await refreshMenu();
  await page.locator('.table-products').getByRole('img',{name:thai?'กาแฟทดสอบ':'Fixture coffee',exact:true}).waitFor();
  assert.equal(await page.locator('.table-products').getByRole('img',{name:thai?'ไม่มีรูปสินค้า':'No product photo',exact:true}).count(),1);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  products[0].available=0;await refreshMenu();
  await page.locator('.table-product').first().getByRole('button',{name:thai?'รายละเอียด':'Details',exact:true}).click();
  await detail.getByText(thai?'หมดชั่วคราว':'Sold out',{exact:true}).waitFor();
  assert.equal(await detail.getByRole('button',{name:'Increase Fixture coffee',exact:true}).count(),0);
  empty=true;
  // Invoke the existing refresh action to model a catalog update while a native modal is open.
  await page.evaluate(()=>document.querySelector('.table-footer button').click());
  await detail.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('searchbox').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  products[0].available=20;empty=false;await refreshMenu();
  assert.equal(await page.locator('.table-product-dialog').count(),0,'Removed product dialog must not reopen when the product returns');
  empty=true;await refreshMenu();
  await page.getByText(thai?'ยังไม่มีรายการเมนูในขณะนี้':'No menu items are available yet.',{exact:true}).waitFor();
  assert.equal(await clear.count(),0);await capture('empty');
  unavailable=true;await refreshMenu();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText(thai?'ยังไม่มีรายการเมนูในขณะนี้':'No menu items are available yet.',{exact:true}).count(),0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  // Controlled quote journey: intercepted only; never forwards a write to a service.
  empty=false;unavailable=false;await refreshMenu();
  let frozenQuote=null,quoteLifetime=1000;const fixtureWrites=[];
  const visit='V'.repeat(43);
  const menu={merchant:{name:'LOCAL QUOTE FIXTURE'},products,asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString(),menuVersion:'fixture-menu',priceVersion:id(3),pricingRevision:'1',currency:'USD',decimals:2};
  const draft=()=>({kind:'draft',expiresAt:new Date(Date.now()+60000).toISOString(),online:true,available:true,occupancy:{generation:'1',active:false},menu,quote:frozenQuote});
  await page.route('**/api/table/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(req.method()==='GET'&&url.pathname==='/api'+path+'/visit/'+visit)return reply(draft());
    if(req.method()==='POST'&&url.pathname==='/api'+path+'/visit'){fixtureWrites.push('visit');return reply({visitToken:visit,state:draft()});}
    if(req.method()==='POST'&&url.pathname==='/api'+path+'/visit/'+visit+'/quotes'){
      fixtureWrites.push('quote');const body=req.postDataJSON();assert.equal(body.items[0].qty,1);
      frozenQuote={id:id(8),priceVersion:id(3),pricingRevision:'1',validUntil:new Date(Date.now()+quoteLifetime).toISOString(),collection:{kind:'table'},lines:[{productId:id(1),name:'กาแฟทดสอบ',nameEn:'Fixture coffee',qty:1,unitPrice:{...money,amountMinor:'325'}}],total:{...money,amountMinor:'325'},settlement:{currency:'USDG',decimals:6,amountMinor:'3250000',network:'solana:devnet',mint:'LOCAL FIXTURE',tokenProgram:'LOCAL FIXTURE',genesisHash:'LOCAL FIXTURE',recipient:'LOCAL FIXTURE'},authority:{kind:'versioned',serving:{label:'LOCAL table'},source:{kind:'online',label:'LOCAL fixture'},target:null}};
      return reply({quote:frozenQuote});
    }
    if(req.method()!=='GET'){fixtureWrites.push('UNEXPECTED:'+url.pathname);return route.abort();}
    return route.fallback();
  });
  if(width<1100)await page.locator('.table-cart-trigger').click();
  const cart=width>=1100?page.locator('.table-desktop-cart'):page.getByRole('dialog');
  await cart.getByRole('button',{name:thai?'ตรวจสอบออเดอร์':'Review order',exact:true}).click();
  await cart.getByRole('button',{name:thai?'ยืนยันออเดอร์และชำระ':'Confirm order & pay',exact:true}).waitFor();
  assert.match(await cart.locator('.table-review').innerText(),/3\.25/);
  assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key)).phase,'review');
  await cart.getByText(thai?'บิลหมดอายุ กรุณาตรวจสอบอีกครั้ง':'This bill has expired. Review your order again.',{exact:true}).waitFor();
  assert.equal(await cart.getByRole('button',{name:thai?'ยืนยันออเดอร์และชำระ':'Confirm order & pay',exact:true}).count(),0);
  assert.deepEqual(fixtureWrites,['visit','quote'], 'expiry never submits an order or re-quotes by itself');
  quoteLifetime=60000;
  await cart.getByRole('button',{name:thai?'ตรวจสอบออเดอร์':'Review order',exact:true}).click();
  await cart.getByRole('button',{name:thai?'ยืนยันออเดอร์และชำระ':'Confirm order & pay',exact:true}).waitFor();
  // A refreshed pricing revision invalidates the previously displayed quote.
  menu.pricingRevision='2';
  if(width<1100)await page.keyboard.press('Escape');
  await refreshMenu();
  if(width<1100)await page.locator('.table-cart-trigger').click();
  await cart.getByText(thai?'ราคาหรือสถานะสินค้าเปลี่ยน กรุณาตรวจยอดอีกครั้ง':'Prices or availability have changed. Review your order again.',{exact:true}).waitFor();
  assert.equal(await cart.getByRole('button',{name:thai?'ยืนยันออเดอร์และชำระ':'Confirm order & pay',exact:true}).count(),0);

  await cart.getByRole('button',{name:thai?'กลับไปตะกร้า':'Back to cart',exact:true}).click();
  await cart.getByRole('button',{name:'Increase Fixture coffee',exact:true}).click();
  const edited=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));assert.equal(edited.phase,'draft');assert.equal(edited.items[0].qty,2);assert.equal(edited.quote,undefined);
  assert.equal(await cart.getByRole('button',{name:thai?'ยืนยันออเดอร์และชำระ':'Confirm order & pay',exact:true}).count(),0);
  assert.deepEqual(fixtureWrites,['visit','quote','quote']);
  assert.deepEqual(errors,[]);
  receipt.checks.push({width,language:thai?'th':'en',searchAndCategoryReset:true,cartJournalUnchanged:true,emptyDistinctFromUnavailable:true,soldOutDetailAndRemovedProductRecovery:true,quoteToEditDropsOldQuote:true,pricingRevisionInvalidatesQuote:true,timeExpiryRequiresExplicitRequote:true,interceptedFixtureWrites:fixtureWrites,forwardedApiMutations:0});await page.close();
 }
 receipt.sourceHashes=Object.fromEntries(await Promise.all(['apps/web/src/components/TableMenu.tsx','tools/runtime/ds28-table-menu-ui-smoke.mjs','apps/web/src/styles/table-menu.css'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
 receipt.status='PASS_BOUNDED_TABLE_MENU_FILTER_RECOVERY_FIXTURES';
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error);process.exitCode=1;}
finally{await browser?.close();const evidence=root+'table-filter-recovery-'+stamp+'.json';await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,scratch,error:receipt.error}));}
