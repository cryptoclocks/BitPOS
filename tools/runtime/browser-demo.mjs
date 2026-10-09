import assert from 'node:assert/strict';
import install, {processRequest} from './browser-fixture-install.mjs';

async function until(page,predicate,timeout=30000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error('Actual browser control did not reach required state');
}

// Caller authenticates the merchant. Only public order data enters this browser;
// fixed-order host policy holds the dedicated devnet signing key outside the repo.
export default async function run(page){
 await page.waitForSelector('select[aria-label="Register"]');
 const registerId=await page.evaluate(()=>{
  const select=document.querySelector('select[aria-label="Register"]');
  const option=[...select.options].find(option=>option.value&&!option.disabled);
  if(!option)throw Error('An authorized registered paired display is required');
  select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));
  return option.value;
 });
 await page.waitForSelector('button.product:not([disabled])');
 await page.evaluate(()=>document.querySelector('button.product:not([disabled])').click());
 await until(page,()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Review canonical order'&&!button.disabled));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Review canonical order').click());
 await page.waitForSelector('section[aria-label="Canonical review"]');
 await until(page,()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Confirm & submit reviewed order'&&!button.disabled));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm & submit reviewed order').click());
 await page.waitForSelector('aside.cart section.order a[href*="/pay/"]');
 const paymentUrl=await page.evaluate(()=>document.querySelector('aside.cart section.order a[href*="/pay/"]').href);
 const target=new URL(paymentUrl);target.hostname='127.0.0.1';target.searchParams.set('testWallet','1');
 await page.screenshot({path:'.omp/work/evidence/browser-current-canonical-qr.png',fullPage:true});
 await page.goto(target.href);
 await page.waitForSelector('.checkout-total');
 const order=await page.evaluate(async()=>{const token=location.pathname.split('/').pop();const response=await fetch('/api/pay/'+token);if(!response.ok)throw Error('Public order unavailable');return response.json();});
 assert.equal(order.pricing.total.amountMinor,order.pricing.lines.reduce((sum,item)=>sum+BigInt(item.unitPrice.amountMinor)*BigInt(item.qty),0n).toString());
 assert.equal(order.settlement.currency,'USDG');assert.equal(order.settlement.decimals,6);
 assert.ok(BigInt(order.settlement.amountMinor)<=2000000n,'Browser validation order exceeds authorized bounded fixture spend');
 assert.equal(order.authority.kind,'versioned');assert.equal(order.authority.source.kind,'register');
 assert.equal(order.authority.source.registerId,registerId);
 await install(page,order.id);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh wallets').click());
 await until(page,()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Connect TEST WALLET FIXTURE')&&!b.disabled));
 const browse=await page.evaluate(()=>document.querySelector('a[href*="phantom.app"]').href);
 assert.equal(decodeURIComponent(new URL(browse).pathname.slice('/ul/browse/'.length)),target.href);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Connect TEST WALLET FIXTURE')).click());
 await page.waitForSelector('p.fixture');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Verify wallet')).click());
 await processRequest(page,order.id);
 await until(page,()=>document.querySelector('.checkout-verified')?.textContent==='Wallet verified ✓');
 await page.screenshot({path:'.omp/work/evidence/browser-current-wallet-bound.png',fullPage:true});
 await page.evaluate(()=>{const script=document.createElement('script');script.textContent=`(()=>{const seen=[];const capture=()=>{const state=document.querySelector('.status')?.textContent.toUpperCase();if(state&&!seen.includes(state)){seen.push(state);document.documentElement.dataset.bitposSeenStates=JSON.stringify(seen);}};capture();new MutationObserver(capture).observe(document.body,{childList:true,subtree:true,characterData:true});})();`;document.head.append(script);script.remove();});
 await until(page,()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Pay with USDG')&&!b.disabled));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Pay with USDG')).click());
 await processRequest(page,order.id);
 await until(page,()=>document.querySelector('.status')?.textContent.toUpperCase()==='PAID',180000);
 const receipt=await page.evaluate(()=>({status:document.querySelector('.status').textContent.toUpperCase(),states:JSON.parse(document.documentElement.dataset.bitposSeenStates),explorer:document.querySelector('a[href*="explorer.solana.com"]')?.href,fixture:document.querySelector('.fixture').textContent}));
 assert.equal(receipt.status,'PAID');assert.ok(receipt.states.includes('CONFIRMING'),'browser must visibly show confirmed but not finalized state');
 await page.screenshot({path:'.omp/work/evidence/browser-current-wallet-paid.png',fullPage:true});
 return {origin:'actual_chromium_live_devnet',orderId:order.id,registerId,total:order.pricing.total,settlement:order.settlement,paymentUrl,browse,...receipt,physical_mobile:false};
}
