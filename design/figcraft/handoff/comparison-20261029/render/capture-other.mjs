// Pay (customer web) and Platform (operator web) captures. Usage: node capture-other.mjs pay|platform
import { chromium } from '/Users/cryptoclock/Desktop/BitPOS/local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const kind=process.argv[2];const out=new URL(`./${kind}/`,import.meta.url).pathname;mkdirSync(out,{recursive:true});
const TABLE='A'.repeat(43);
const pages=kind==='pay'?[
 ['pay-bill','/pay/tok1'],['pay-wallet','/pay/wallet-1'],['pay-confirming','/pay/conf-1'],['pay-paid','/pay/paid-1'],['pay-expired','/pay/exp-1'],['pay-recovery','/pay/rec-1'],['pay-menu','/pay/tok1/menu'],['table-menu',`/table/${TABLE}`],
 ['table-product',`/table/${TABLE}`,async p=>{await p.locator('.table-product-details').first().click({timeout:2500});await p.waitForTimeout(500);}],
 ['table-cart',`/table/${TABLE}`,async p=>{await p.locator('.table-product-bottom button').first().click({timeout:2500});await p.waitForTimeout(400);await p.locator('.table-cart-trigger').click({timeout:2000});await p.waitForTimeout(600);}],
]:['hub','drivers','food-dispatch','food-incidents','food-cancellation-reviews','reviews','support','driver-earnings','rides'].map(n=>['platform-'+n,n==='hub'?'/platform':'/platform/'+n]);
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
for(const [w,h,tag] of [[1440,900,'1440'],[390,844,'390']]){
 for(const [id,url,act] of pages){
  const ctx=await b.newContext({viewport:{width:w,height:h}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:4482'+url);await p.waitForTimeout(1300);
  if(act)try{await act(p);}catch(e){console.log('ACT-MISS',id);}
  for(const lang of ['default','alt']){
   if(lang==='alt'){const t=p.getByRole('button',{name:/^(English|ไทย|EN|TH)$|language|ภาษา|switch/i}).filter({visible:true}).first();await t.click({timeout:800}).catch(()=>console.log('NO-LANG-TOGGLE',id));await p.waitForTimeout(300);}
   const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   await p.screenshot({path:`${out}${id}-${tag}-${lang}.png`});
   console.log(id,tag,lang,ov?'H-OVERFLOW':'ok');
  }
  if(errs.length)console.log('PAGEERR',id,[...new Set(errs)].join(';').slice(0,200));
  await ctx.close();
 }
}
await b.close();
