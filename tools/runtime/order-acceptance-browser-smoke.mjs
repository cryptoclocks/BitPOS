// Local component fixture only: no API, DB, payment or merchant mutation.
import {build} from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const evidencePath='.omp/work/flutter-delivery-20261016/evidence/order-acceptance-component-browser-'+new Date().toISOString().replaceAll(':','-')+'.json';
const source=`import React from 'react';import{createRoot}from'react-dom/client';import IncomingOrders from './apps/web/src/components/IncomingOrders.tsx';
const money={currency:'USD',decimals:2,amountMinor:'270'};
const params=new URL(location.href).searchParams;
const order={id:'10000000-0000-4000-8000-000000000001',status:params.get('status')||'AWAITING_PAYMENT',quoteExpiresAt:new Date(Date.now()+60000).toISOString(),authority:{kind:'versioned',source:{kind:params.get('source')||'online',label:'Local fixture'},serving:{kind:params.get('serving')||'pickup',label:'Fixture collection'},target:null},pricing:{lines:[],total:money},settlement:{...money,network:'solana:devnet',mint:'fixture',tokenProgram:'fixture',genesisHash:'fixture',recipient:'fixture',testToken:true},fulfillment:params.has('ready')?{status:'READY',version:1}:undefined,onlineAcceptance:{status:params.has('ready')?'ACCEPTED':'PENDING',deadline:params.get('deadline')==='invalid'?'invalid':new Date(Date.now()+3000).toISOString(),refunds:[]}};
window.commandCount=0;const noop=()=>{};createRoot(document.getElementById('root')).render(<div className="shell"><IncomingOrders session={{token:'fixture',merchantId:'fixture',userId:'fixture',role:params.get('role')||'cashier'}} orders={[order]} detail={params.has('list')?undefined:order} error="" busy={params.has('busy')} language={params.get('lang')||'en'} canReview={false} canFulfill={true} devices={[]} pending={params.has('pending')?{orderId:order.id,status:'ACCEPTED',commandId:'fixture'}:undefined} registryError="" select={noop} close={noop} refresh={noop} refreshTargets={noop} review={noop} fulfill={()=>window.commandCount++} resend={noop} retryAction={noop}/></div>);`;
const bundled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},external:['/fonts/*'],bundle:true,write:false,outdir:'/tmp/bitpos-acceptance-component',format:'esm',jsx:'automatic'});
const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const server=createServer((req,res)=>{if(req.url.startsWith('/fixture.js')){res.setHeader('Content-Type','text/javascript');res.end(js);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>'+css+'</style><div id="root"></div><script type="module" src="/fixture.js"></script>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const checks=[];
 for(const scenario of ['status=EXPIRED','status=RECOVERY','deadline=invalid','busy=1','pending=1']){
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
  await page.goto('http://127.0.0.1:'+server.address().port+'/?'+scenario);
  await page.locator('.merchant-order-rejection>summary').click();
  const preparation=page.getByRole('spinbutton',{name:'Estimated preparation (minutes)'});if(await preparation.isEnabled())await preparation.fill('37');
  const reason=page.getByRole('textbox',{name:'Rejection reason (visible to customer)'});await reason.waitFor();
  if(await reason.isEnabled())await reason.fill('Synthetic reason');
  assert.equal(await page.getByRole('button',{name:'Accept order',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Reject order',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Accept order',exact:true}).evaluate(button=>button.click());
  await page.getByRole('button',{name:'Reject order',exact:true}).evaluate(button=>button.click());
  assert.equal(await page.evaluate(()=>window.commandCount),0);checks.push({scenario,bothActionsBlocked:true,commands:0});await page.close();
 }
 for(const [language,width] of [['en',1440],['th',390],['en',320]]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?lang='+language);
  const accept=page.getByRole('button',{name:language==='th'?'รับออร์เดอร์':'Accept order',exact:true});
  await accept.waitFor();assert.equal(await accept.isDisabled(),true);
  const preparation=page.getByRole('spinbutton',{name:language==='th'?'เวลาเตรียมโดยประมาณ (นาที)':'Estimated preparation (minutes)'});
  for(const invalid of ['0','1.5','1441']){await preparation.fill(invalid);assert.equal(await accept.isDisabled(),true);await accept.evaluate(button=>button.click());}
  assert.equal(await page.evaluate(()=>window.commandCount),0);await preparation.fill('37');assert.equal(await accept.isEnabled(),true);
  await page.locator('.merchant-order-rejection>summary').click();
  await page.getByRole('textbox',{name:language==='th'?'เหตุผลที่ปฏิเสธ (ลูกค้ามองเห็น)':'Rejection reason (visible to customer)'}).fill('Synthetic reason');
  const reject=page.getByRole('button',{name:language==='th'?'ปฏิเสธออร์เดอร์':'Reject order',exact:true});
  assert.equal(await reject.isEnabled(),true);
  await page.waitForFunction(button=>button.disabled,await accept.elementHandle(),{timeout:7000});
  assert.equal(await accept.isDisabled(),true);assert.equal(await reject.isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.commandCount),0);assert.deepEqual(errors,[]);
  await page.getByText(language==='th'?'หมดเวลารับออร์เดอร์ โหลดสถานะล่าสุดก่อนดำเนินการต่อ':'Acceptance deadline elapsed. Refresh the latest state before continuing.',{exact:true}).waitFor();
  checks.push({language,width,expiryDisablesBoth:true,commands:0});await page.close();
 }
 for(const [source,serving,channel] of [['online','delivery','App delivery'],['online','pickup','App pickup'],['register','table','Table'],['register','counter','Counter']]){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?list=1&source='+source+'&serving='+serving);
  const channels=page.getByRole('navigation',{name:'Order channel filters'});
  await channels.getByRole('button',{name:new RegExp('^'+channel+'\\s*1$')}).click();
  assert.equal(await page.locator('.order-row').count(),1);
  const other=channel==='Counter'?'Table':'Counter';
  await channels.getByRole('button',{name:new RegExp('^'+other+'\\s*0$')}).click();
  await page.getByRole('heading',{name:'No matching orders'}).waitFor();
  await page.locator('.orders-empty button').click();
  assert.equal(await channels.getByRole('button',{name:/^All\s*1$/}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.order-row').count(),1);
  checks.push({source,serving,channel,optionalDeliveryExpansionAbsent:true,correctChannel:true,emptyAndClearRecovered:true});
  await page.close();
 }
 for(const serving of ['delivery','pickup']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?source=online&serving='+serving+'&status=PAID&ready=1&role=owner');
  await page.locator('.kitchen-progress').waitFor();
  assert.equal(await page.getByRole('button',{name:'Mark collected',exact:true}).count(),serving==='delivery'?0:1);
  assert.equal(await page.locator('aside[aria-label="Rider handoff"]').count(),serving==='delivery'?1:0);
  checks.push({serving,optionalDeliveryExpansionAbsent:true,manualCollectionAllowed:serving==='pickup',handoffMounted:serving==='delivery'});
  await page.close();
 }
 await writeFile(evidencePath,JSON.stringify({status:'PASS_LOCAL_COMPONENT_BROWSER_DEADLINE',checkedAtUtc:new Date().toISOString(),sourceSha256:createHash('sha256').update(await readFile('apps/web/src/components/IncomingOrders.tsx')).digest('hex'),checks,limits:['Synthetic in-memory order, no API/DB/authority integration','Actual component CSS bundled but full shell/fonts absent; not visual fidelity acceptance','No screenshots or real order actions']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'PASS_LOCAL_COMPONENT_BROWSER_DEADLINE',evidence:evidencePath}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
