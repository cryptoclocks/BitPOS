import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Hydrated TableMenu controls against a local HTTP fixture. It observes canonical
// quote/review/recovery requests; it does not claim payment, wallet, ACK, or RBAC proof.
export default async function tableCartSurfaceBrowser(page,origin,{evidenceDir}={}){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Fixture origin must stay local');
 const entry='E'.repeat(43),visit='V'.repeat(43),base='/table/'+entry;
 const money={currency:'USD',decimals:2,amountMinor:'300'};
 const authority={kind:'versioned',source:{kind:'device',deviceId:'device-fixture',label:'Fixture display'},serving:{kind:'table',tableId:'table-fixture',label:'Fixture Table 4'},target:{deviceId:'device-fixture',assignmentGeneration:'1'},pairingGeneration:null};
 const settlement={currency:'USDG',decimals:6,amountMinor:'3000000',network:'solana:devnet',mint:'FIXTURE-mint',tokenProgram:'FIXTURE-program',genesisHash:'FIXTURE-genesis',testToken:true,recipient:'FIXTURE-recipient',sponsor:'merchant_funded'};
 const espresso={id:'espresso-fixture',name:'เอสเปรสโซทดสอบ',nameEn:'Fixture espresso',category:'Coffee',description:'Fixture espresso',imageUrl:'/images/menu/espresso.jpg',available:20,basePrice:money,unitPrice:money,promotion:null};
 const latte={id:'latte-fixture',name:'ลาเต้ทดสอบ',nameEn:'Fixture latte',category:'Coffee',description:'Fixture latte',imageUrl:'/images/menu/latte.jpg',available:20,basePrice:money,unitPrice:money,promotion:null};
 const menu={products:[espresso,latte],asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString(),priceVersion:'fixture-price',pricingRevision:'1',currency:'USD',decimals:2,bundles:[]};
 const calls=[];let quoteSequence=0;let expireNextOrder=false;
 const draft=()=>({kind:'draft',expiresAt:new Date(Date.now()+60000).toISOString(),online:true,available:true,occupancy:{generation:'1',active:false},quote:null,menu});
 const quote=items=>({id:`00000000-0000-4000-8000-${String(++quoteSequence).padStart(12,'0')}`,priceVersion:'fixture-price',pricingRevision:'1',cartVersion:null,lines:items.map(item=>{const product=item.productId===espresso.id?espresso:latte;return {productId:product.id,name:product.name,nameEn:product.nameEn,qty:item.qty,priceVersion:'fixture-price',basePrice:money,unitPrice:money,promotion:null};}),total:{...money,amountMinor:(300n*BigInt(items.reduce((sum,item)=>sum+item.qty,0))).toString()},settlement,quotedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),collection:{kind:'table',policyVersion:1},authority});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.slice(4),method=request.method(),body=method==='GET'?undefined:request.postDataJSON();calls.push({path,method,body});
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path===base&&method==='GET')return reply({tableLabel:'FIXTURE Table 4',menu,online:true,available:true,occupancy:{generation:'1',active:false}});
  if(path===base+'/visit'&&method==='POST')return reply({visitToken:visit,state:draft()});
  if(path===base+'/visit/'+visit&&method==='GET')return reply(draft());
  if(path===base+'/visit/'+visit+'/quotes'&&method==='POST'){assert.deepEqual(body.items,[{productId:espresso.id,qty:1}]);assert.equal(body.collection,'table');return reply({quote:quote(body.items)});}
  if(path===base+'/visit/'+visit+'/orders'&&method==='POST'){
   assert.match(body.quoteId,/^[0-9a-f-]{36}$/i);assert.equal(body.priceVersion,'fixture-price');assert.match(body.idempotencyKey,/^[0-9a-f-]{36}$/i);
   if(expireNextOrder)return reply({error:{code:'QUOTE_EXPIRED',message:'Fixture quote expired',retryable:true}},409);
   throw Error('This contract only exercises pre-submit cart states');
  }
  if(path===base+'/visit/'+visit+'/release'&&method==='POST')return reply({});
  throw Error(`Unexpected fixture request ${method} ${path}`);
 });
 const capture=async name=>{if(!evidenceDir)return null;await mkdir(evidenceDir,{recursive:true});const file=join(evidenceDir,name);await page.screenshot({path:file,fullPage:true});return file;};
 const enabled=async name=>page.waitForFunction(name=>[...document.querySelectorAll('button')].some(button=>(button.getAttribute('aria-label')||button.textContent.trim())===name&&!button.disabled),name);
 await page.setViewportSize({width:390,height:844});await page.goto(origin+base);await enabled('Increase Fixture espresso');
 await page.getByRole('button',{name:'Increase Fixture espresso',exact:true}).click();await page.getByRole('button',{name:/View your order/}).click();
 await page.getByRole('dialog',{name:'Your cart',exact:true}).waitFor();const screenshots=[];screenshots.push(await capture('table-cart-390-en.png'));
 await page.getByLabel('Close cart',{exact:true}).click();await page.getByLabel('เปลี่ยนเป็นภาษาไทย',{exact:true}).click();await page.getByRole('button',{name:/ดูออเดอร์/}).click();
 await page.setViewportSize({width:768,height:1024});screenshots.push(await capture('table-cart-768-th.png'));
 await enabled('ตรวจสอบออเดอร์');await page.getByRole('button',{name:'ตรวจสอบออเดอร์',exact:true}).click();await page.getByRole('region',{name:'Canonical guest review',exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:980});assert.equal(await page.getByRole('dialog',{name:'ตรวจสอบออเดอร์ของคุณ',exact:true}).locator('.table-sheet').evaluate(node=>getComputedStyle(node).display),'grid');screenshots.push(await capture('table-review-1440-th.png'));
 await page.getByRole('button',{name:'กลับไปตะกร้า',exact:true}).click();await enabled('ตรวจสอบออเดอร์');assert.equal(await page.getByRole('region',{name:'Canonical guest review',exact:true}).count(),0,'Back to cart must discard the review state, not submit');
 await page.getByLabel('Close cart',{exact:true}).click();await page.getByLabel('Switch to English',{exact:true}).click();await page.getByRole('button',{name:/View your order/}).click();await page.getByRole('button',{name:'Review order',exact:true}).click();await enabled('Confirm order & pay');expireNextOrder=true;await page.getByRole('button',{name:'Confirm order & pay',exact:true}).click();
 await page.getByText('Fixture quote expired',{exact:true}).waitFor();await page.setViewportSize({width:390,height:844});screenshots.push(await capture('table-cart-recovery-390-en.png'));
 const quoteCalls=calls.filter(call=>call.path.endsWith('/quotes'));const orderCalls=calls.filter(call=>call.path.endsWith('/orders'));
 assert.equal(quoteCalls.length,2,'Review and re-review must request fresh canonical quotes');assert.equal(orderCalls.length,1,'Expired confirmation retains the exact saved request without a replacement submit');
 assert.equal(await page.getByRole('button',{name:'Review order',exact:true}).isEnabled(),true,'Definite quote expiry returns the user to draft review');
 return {origin:'local_http_fixture',fixture:true,livePayment:false,provider:false,physicalAck:false,quoteTransitions:quoteCalls.length,expiredSubmitAttempts:orderCalls.length,screenshots:screenshots.filter(Boolean)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const origin=process.argv[2],evidenceDir=process.argv[3]||'.omp/work/flutter-delivery-20261016/evidence/table-cart-surface-browser-20261024';
 assert.ok(origin,'Usage: node apps/web/tests/table-cart-surface-browser.mjs <loopback-web-origin> [evidence-dir]');
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Browser origin must stay loopback');
 const {chromium}=await import('../../../local/toolchains/browser-contract/node_modules/playwright/index.mjs');const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const context=await browser.newContext();let exit=0;
 try{console.log(JSON.stringify(await tableCartSurfaceBrowser(await context.newPage(),origin,{evidenceDir}),null,2));}catch(error){console.error(error);exit=1;}finally{await context.close();await browser.close();process.exit(exit);}
}
