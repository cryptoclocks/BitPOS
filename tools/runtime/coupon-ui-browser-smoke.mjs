import {build} from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='.omp/work/flutter-delivery-20261016/evidence/ui-catalog-20261021';await mkdir(out,{recursive:true});
const source=`import React from 'react';import{createRoot}from'react-dom/client';import CouponSelection from './apps/web/src/components/CouponSelection.tsx';const th=new URL(location.href).searchParams.get('lang')!=='en';createRoot(document.getElementById('root')).render(<CouponSelection preview thai={th} coupons={[{id:'one',title:th?'มื้อเช้าคู่โปรด · ลด ฿20':'Breakfast · ฿20 off',terms:th?'ตัวอย่าง · ขั้นต่ำ ฿150':'Example · minimum ฿150',eligible:true},{id:'two',title:th?'ส่งฟรีใกล้บ้าน':'Nearby free delivery',terms:th?'ตัวอย่าง · ดูเงื่อนไขร้านที่ร่วมรายการ':'Example · participating merchant terms',eligible:true}]}/>);`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/bitpos-coupon-ui',format:'esm',jsx:'automatic'});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#f8f5fc}'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script></html>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const checks=[];
try{browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const [width,lang]of [[390,'th'],[1440,'en'],[320,'th']]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?lang='+lang);const button=page.getByRole('button');await button.waitFor();assert.equal(await button.isDisabled(),true);
  await page.getByRole('radio').first().check();assert.equal(await button.isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await button.click();await page.getByRole('status').filter({hasText:lang==='th'?'ยังไม่ได้ใช้สิทธิ์จริง':'no coupon redeemed'}).waitFor();
  assert.deepEqual(errors,[]);if(width!==320)await page.screenshot({path:`${out}/W22-${width}.png`,fullPage:true});
  checks.push({width,lang,selection:true,initiallyDisabled:true,noOverflow:true,noRealRedemption:true});await page.close();
 }
 await writeFile(`${out}/W22-browser.json`,JSON.stringify({status:'PASS_W22_RESPONSIVE_PRESENTATION',checks,limits:['Component fixture only; not canonical coupon API or production checkout integration','Manual screenshot review pending']},null,2)+'\n');console.log('PASS_W22_BROWSER',JSON.stringify(checks));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
