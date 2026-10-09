import assert from 'node:assert/strict';
import install,{processRequest} from './browser-fixture-install.mjs';
async function until(page,predicate,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await page.evaluate(predicate))return;await new Promise(r=>setTimeout(r,100));}throw Error('Public guest browser state did not converge; retain original request/order, never replace it');}
export async function createGuestOrder(page,{entry,targetDevice,tableId,round}){
 assert.match(entry,/^[A-Za-z0-9_-]{43}$/);assert.ok([1,2,3].includes(round));
 await page.setViewport({width:390,height:844});await page.goto('http://192.168.1.34:4321/table/'+entry);
 await page.waitForSelector('button[aria-label="Increase Latte"]:not([disabled])');
 const phase=await page.evaluate(()=>JSON.parse(localStorage.getItem('bitpos-table-guest-v1:'+location.pathname.split('/').at(-1)))?.phase);
 assert.ok(phase==='draft'||phase==='review','Unknown/pending/previous order must be reconciled, not replaced');
 const empty=await page.evaluate(()=>JSON.parse(localStorage.getItem('bitpos-table-guest-v1:'+location.pathname.split('/').at(-1))).items.length===0);
 if(empty)await page.click('button[aria-label="Increase Latte"]');
 await page.click('.table-cart-trigger');await page.waitForSelector('[role=dialog]');await page.$eval('.table-sheet .table-primary',e=>e.scrollIntoView({block:'center'}));
 await page.click('.table-sheet .table-primary');await page.waitForSelector('[aria-label="Canonical guest review"]');
 await until(page,()=>{const button=document.querySelector('.table-sheet .table-primary');return button&&!button.disabled;});
 const quote=await page.evaluate(()=>JSON.parse(localStorage.getItem('bitpos-table-guest-v1:'+location.pathname.split('/').at(-1))).quote);
 assert.equal(quote.authority.source.kind,'device');assert.equal(quote.authority.target.deviceId,targetDevice);assert.equal(quote.authority.serving.tableId,tableId);assert.equal(quote.total.amountMinor,'10');assert.equal(quote.lines.length,1);assert.equal(quote.lines[0].qty,1);
 await page.$eval('.table-sheet .table-primary',e=>e.scrollIntoView({block:'center'}));
 await page.screenshot({path:`.omp/work/evidence/public-guest-round-${round}-canonical-review.png`,fullPage:false});
 const paymentNavigation=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:25000});
 await page.click('.table-sheet .table-primary');
 await paymentNavigation;
 await page.waitForSelector('.checkout-total',{timeout:25000});
 const order=await page.evaluate(async()=>{const r=await fetch('/api/pay/'+location.pathname.split('/').at(-1));if(!r.ok)throw Error('Original guest order unavailable');return r.json();});
 assert.equal(order.authority.target.deviceId,targetDevice);assert.equal(order.authority.serving.tableId,tableId);assert.equal(order.authority.source.kind,'device');assert.equal(order.pricing.total.amountMinor,'10');assert.ok(BigInt(order.settlement.amountMinor)<=2000000n);
 await page.screenshot({path:`.omp/work/evidence/public-guest-round-${round}-order-payment.png`,fullPage:false});
 return order;
}
export async function payGuestOrder(page,{order,round}){
 assert.ok([1,2,3].includes(round));
 const target=new URL(order.paymentUrl);target.hostname='127.0.0.1';target.searchParams.set('testWallet','1');
 // Explicit host browser fixture on loopback, not Android/Phantom scanning/provider proof.
 await page.goto(target.href);await page.waitForSelector('.checkout-total');await install(page,order.id);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh wallets').click());
 await until(page,()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Connect TEST WALLET FIXTURE')&&!b.disabled));
 const browse=await page.evaluate(()=>document.querySelector('a[href*="phantom.app"]').href);assert.equal(decodeURIComponent(new URL(browse).pathname.slice('/ul/browse/'.length)),target.href);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Connect TEST WALLET FIXTURE')).click());await page.waitForSelector('p.fixture');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Verify wallet')).click());await processRequest(page,order.id);
 await until(page,()=>document.querySelector('.checkout-verified')?.textContent==='Wallet verified ✓');
 await page.evaluate(()=>{const script=document.createElement('script');script.textContent=`(()=>{const states=[];const capture=()=>{const s=document.querySelector('.status')?.textContent;if(s&&!states.includes(s)){states.push(s);document.documentElement.dataset.bitposSeenStates=JSON.stringify(states);}};capture();new MutationObserver(capture).observe(document.body,{childList:true,subtree:true,characterData:true});})();`;document.head.append(script);script.remove();});
 await until(page,()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Pay with USDG')&&!b.disabled));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Pay with USDG')).click());await processRequest(page,order.id);
 await until(page,()=>document.querySelector('.status')?.textContent.toUpperCase()==='PAID',180000);
 const receipt=await page.evaluate(()=>({status:document.querySelector('.status').textContent.toUpperCase(),states:JSON.parse(document.documentElement.dataset.bitposSeenStates),explorer:document.querySelector('a[href*="explorer.solana.com"]')?.href,fixture:document.querySelector('.fixture')?.textContent}));
 assert.equal(receipt.status,'PAID');assert.ok(receipt.states.includes('CONFIRMING'));assert.ok(receipt.explorer);
 await page.screenshot({path:`.omp/work/evidence/public-guest-round-${round}-wallet-paid.png`,fullPage:false});
 return {origin:'actual_Brave_public_LAN_guest_order_then_explicit_loopback_browser_test_wallet_live_devnet',round,orderId:order.id,total:order.pricing.total,settlement:order.settlement,authority:order.authority,browse,...receipt,physical_mobile:false,host_private_keys_exposed:false};
}
export async function releaseGuestOrder(page,{entry,orderId}){
 await page.goto('http://192.168.1.34:4321/table/'+entry);
 await page.waitForSelector('a.table-primary[href*="/pay/"]',{timeout:15000});
 const result=await page.evaluate(async({entry,orderId})=>{
  const key='bitpos-table-guest-v1:'+entry,v=JSON.parse(localStorage.getItem(key));
  if(v.phase!=='order'||v.order.id!==orderId)throw Error('Original guest receipt is required before release');
  const own='/api/table/'+entry+'/visit/'+v.visitToken;
  const current=await fetch(own).then(r=>r.json());if(current.kind!=='order'||current.order.id!==orderId||current.order.status!=='PAID')throw Error('Original order is not paid; preserve its request');
  const r=await fetch(own+'/dismiss',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.status!==200||(await r.json()).dismissed!==true)throw Error('Exact paid physical ACK release refused');
  const after=await fetch('/api/table/'+entry).then(r=>r.json()),retained=await fetch(own).then(r=>r.json());
  if(!after.available||retained.order.id!==orderId||retained.order.status!=='PAID'||JSON.stringify(retained.order.pricing)!==JSON.stringify(current.order.pricing))throw Error('Original bill or target changed');
  return {origin:'actual_public_guest_exact_paid_physical_ACK_guarded_dismiss_and_recovery',orderId,guest_no_merchant_login:true,release_status:r.status,paid_bill_unchanged:true,assigned_table_available:after.available,new_financial_transactions:0};
 },{entry,orderId});
 // Detach the old component/poll before clearing only this completed fixture visitor.
 // CDP managed-tab close alone leaves the actual page alive.
 await page.goto('about:blank');
 await page.evaluateOnNewDocument(({key,id})=>{if(location.origin==='http://192.168.1.34:4321'){const v=JSON.parse(localStorage.getItem(key)||'null');if(v?.phase==='order'&&v.order.id===id)localStorage.removeItem(key);}},{key:'bitpos-table-guest-v1:'+entry,id:orderId});
 return {...result,next_fixture_customer_prepared:true};
}
