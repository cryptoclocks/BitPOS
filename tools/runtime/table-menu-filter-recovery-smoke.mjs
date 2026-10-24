// Actual hydrated TableMenu, local HTTP presentation fixtures only. No API mutations.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
const origin=new URL(process.env.BITPOS_UI_ORIGIN??'');assert.equal(origin.hostname,'127.0.0.1');
const stamp=new Date().toISOString().replaceAll(':','-'),root='.omp/work/flutter-delivery-20261016/evidence/';
const scratch=await mkdtemp(join(tmpdir(),'bitpos-table-filter-recovery-'));
const receipt={status:'RUNNING',fixture:true,scratchDirectory:scratch,scratchCleanup:'pending_parent_visual_analysis',captures:[],checks:[],limits:['Hydrated TableMenu with local HTTP catalog fixtures; no persisted API/SQL or full fidelity acceptance','No visit/quote/order/payment/provider commands'],physicalTesting:'deferred_by_user_2026-10-16'};
let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const {width,thai} of [{width:1440,thai:false},{width:390,thai:true},{width:320,thai:false}]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(6000);
  const entry='F'.repeat(43),path='/table/'+entry,key='bitpos-table-guest-v1:'+entry;
  const money={currency:'USD',decimals:2,amountMinor:'300'},id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const products=[{id:id(1),name:'กาแฟทดสอบ',nameEn:'Fixture coffee',category:'Coffee',description:'Original local fixture',imageUrl:'/images/menu/espresso.jpg',basePrice:money,unitPrice:money,available:20,promotion:null},{id:id(2),name:'ขนมทดสอบ',nameEn:'Fixture bakery',category:'Bakery',description:'Original local fixture',imageUrl:'/images/menu/latte.jpg',basePrice:money,unitPrice:money,available:20,promotion:null}];
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
  const before=await page.evaluate(key=>localStorage.getItem(key),key);assert.equal(JSON.parse(before).items[0].qty,1);
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
  empty=true;await refreshMenu();
  await page.getByText(thai?'ยังไม่มีรายการเมนูในขณะนี้':'No menu items are available yet.',{exact:true}).waitFor();
  assert.equal(await clear.count(),0);await capture('empty');
  unavailable=true;await refreshMenu();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText(thai?'ยังไม่มีรายการเมนูในขณะนี้':'No menu items are available yet.',{exact:true}).count(),0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);
  assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  receipt.checks.push({width,language:thai?'th':'en',searchAndCategoryReset:true,cartJournalUnchanged:true,emptyDistinctFromUnavailable:true,apiMutations:0});await page.close();
 }
 receipt.sourceHashes=Object.fromEntries(await Promise.all(['apps/web/src/components/TableMenu.tsx','tools/runtime/table-menu-filter-recovery-smoke.mjs'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
 receipt.status='PASS_BOUNDED_TABLE_MENU_FILTER_RECOVERY_FIXTURES';
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error);process.exitCode=1;}
finally{await browser?.close();const evidence=root+'table-filter-recovery-'+stamp+'.json';await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,scratch,error:receipt.error}));}
