// Labelled offline presentation fixtures. No real wallet, API, payment or DB authority.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import esbuild from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import {CUSTOMER_CONSENT_VERSION,customerAuthMessage} from '../../packages/contracts/src/customer-auth.ts';

const root=process.cwd(),port=Number(process.env.BITPOS_CONSENT_PORT??4497);
assert.ok([4497,4498].includes(port),'Only isolated loopback ports4497/4498');
const origin=`http://127.0.0.1:${port}`;
const task=join(root,'.omp/work/h2-parallel-consent-20261025');
const run=join(task,'evidence/consent-surface-ZtrZ1l',`browser-${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`);
const scratch=await mkdtemp(join(tmpdir(),'consent-'));
await mkdir(join(run,'screens'),{recursive:true});
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',W='11111111111111111111111111111111',T='a'.repeat(43),S='b'.repeat(43);
const session={sessionId:'33333333-3333-4333-8333-333333333333',customerId:'44444444-4444-4444-8444-444444444444',walletAddress:W,consentVersion:CUSTOMER_CONSENT_VERSION,consentedPurchaseContext:true,merchantId:A,origin,expiresAt:'2030-01-02T03:04:05.000Z',sessionToken:S};
const sourcePaths=['apps/web/src/components/CustomerConsent.tsx','apps/web/src/styles/customer-consent.css','tools/runtime/pay-consent-surface-browser-smoke.mjs'];
const receipt={status:'RUNNING',fixture:true,sources:{},screens:[],checks:[],limits:['Local HTTP/wallet fixtures only; no backend/payment authority.','Shared Payment.tsx places consent below checkout-content in checkout-supplement. Fixture rails do not prove integrated y210 or full WD15/WD22 parity.']};
for(const p of sourcePaths)receipt.sources[p]=createHash('sha256').update(await readFile(p)).digest('hex');
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import CustomerConsent from ${JSON.stringify(resolve(root,sourcePaths[0]))};
import ${JSON.stringify(resolve(root,'apps/web/src/styles/app.css'))};import ${JSON.stringify(resolve(root,'apps/web/src/styles/customer-checkout.css'))};
const q=new URLSearchParams(location.search),state=q.get('state'),lang=q.get('lang'),merchant=q.get('merchant')==='b'?'${B}':'${A}';
const stats=window.fixtureStats={sign:0,connect:0,busy:false};
const wallet={address:'${W}',name:'LOCAL FIXTURE WALLET',fixture:true,supportsMessageSigning:state!=='unsupported',async signMessage(){stats.sign++;if(state==='refusal')throw Error('LOCAL FIXTURE wallet refused');return new Uint8Array(64)},async signTransaction(){throw Error('Payment forbidden in consent fixture')}};
if(['loading','ready','use','revoke','cross'].includes(state)){const v=${JSON.stringify(session)};sessionStorage.setItem('bitpos-customer-auth:'+location.origin+':${A}','${W}');sessionStorage.setItem('bitpos-customer-auth:'+location.origin+':${A}:${W}',JSON.stringify(v))}
function App(){const[w,setW]=React.useState(state==='unsupported'?wallet:undefined),[busy,setBusy]=React.useState(false);return <main className="customer-checkout"><div className="fixture-page"><header className="fixture-header">BitPOS · LOCAL HTTP/WALLET FIXTURE · no payment authority</header><div className="fixture-rails"><aside>Shared bill rail — outside leased component; no illustrative order or amount</aside><CustomerConsent accessToken="${T}" orderId="55555555-5555-4555-8555-555555555555" merchantId={merchant} wallet={w} choices={state==='anonymous'?[]:[{name:'LOCAL FIXTURE WALLET',async connect(){stats.connect++;return wallet}}]} language={lang==='th'?'th':'en'} disabled={busy||state==='disabled'} onWallet={setW} onBusyChange={v=>{stats.busy=v;setBusy(v)}}/></div></div></main>};createRoot(document.getElementById('root')).render(<App/>);`;
let server,browser,holds=[],counts;
const reset=()=>{counts={session:0,challenge:0,verify:0,use:0,revoke:0};holds=[]};reset();
let currentState='';
try{
 await writeFile(join(scratch,'entry.tsx'),entry);
 await writeFile(join(scratch,'index.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css"><style>.fixture-page{max-width:1248px;margin:auto}.fixture-header{height:126px;padding:16px 0}.fixture-rails{display:grid;grid-template-columns:744px 472px;gap:32px;align-items:start}.fixture-rails>aside{height:680px;padding:28px;border:1px solid #e9e1f1;border-radius:24px;background:white}.customer-consent{margin-top:0}@media(max-width:999px){.fixture-rails{display:block}.fixture-rails>aside{display:none}.fixture-header{height:100px}}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`);
 await esbuild.build({absWorkingDir:root,nodePaths:[join(root,'node_modules/.pnpm/react@19.2.3/node_modules'),join(root,'node_modules/.pnpm/react-dom@19.2.3_react@19.2.3/node_modules')],entryPoints:[join(scratch,'entry.tsx')],bundle:true,format:'esm',platform:'browser',outfile:join(scratch,'bundle.js'),jsx:'automatic',loader:{'.svg':'file','.png':'file','.webp':'file'},external:['/fonts/*'],logLevel:'silent'});
 server=createServer((req,res)=>{
  const url=new URL(req.url,origin),path=url.pathname;
  const send=v=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(v))};
  if(path.startsWith('/api/')){
   const kind=path.split('/').at(-1);assert.ok(Object.hasOwn(counts,kind),'Unexpected API '+path);counts[kind]++;
   const respond=()=>{
    if(kind==='challenge'){
     const issuedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+240000).toISOString();
     const challenge={challengeId:'66666666-6666-4666-8666-666666666666',origin,merchantId:A,walletAddress:W,order:{orderId:'55555555-5555-4555-8555-555555555555',requestHash:'f'.repeat(64),createdAt:issuedAt,occupancyId:null,occupancyGeneration:null},nonce:'c'.repeat(43),issuedAt,expiresAt,consentVersion:CUSTOMER_CONSENT_VERSION};
     return send({...challenge,message:customerAuthMessage(challenge)});
    }
    return send(kind==='revoke'?{revoked:true,scope:'merchant-wallet'}:session);
   };
   if((currentState==='loading'&&kind==='session')||(currentState==='busy'&&kind==='challenge'))holds.push(respond);else respond();
   return;
  }
  const file=path==='/'?join(scratch,'index.html'):path.startsWith('/fonts/')?join(root,'apps/web/public',path):join(scratch,path.slice(1));
  if(!file.startsWith(scratch+'/')&&!file.startsWith(join(root,'apps/web/public/fonts')+'/'))return res.writeHead(403).end();
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
  createReadStream(file).on('error',()=>res.writeHead(404).end()).once('open',()=>res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'})).pipe(res);
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(port,'127.0.0.1',ok)});
 const modulePath=process.env.BITPOS_PLAYWRIGHT_MODULE??join(task,'browser-toolchain/node_modules/playwright/index.mjs');
 const {chromium}=await import(modulePath);
 browser=await chromium.launch({executablePath:process.env.BITPOS_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const scenarios=[];
 for(const lang of ['en','th'])for(const width of [390,1440])for(const state of ['anonymous','unchecked','ready','use'])scenarios.push({state,lang,width});
 for(const state of ['loading','checked','unsupported','busy','refusal','revoke','cross','disabled'])scenarios.push({state,lang:state==='busy'?'th':'en',width:390});
 for(const sc of scenarios){
  currentState=sc.state;reset();
  const context=await browser.newContext({viewport:{width:sc.width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  try{
   await page.goto(`${origin}/?state=${sc.state}&lang=${sc.lang}${sc.state==='cross'?'&merchant=b':''}`);
   await page.locator('.customer-consent>summary').click();
   const confirm=page.locator('.customer-consent-confirm'),checkbox=page.locator('.customer-consent-disclosure input');
   if(sc.state==='loading'){
    await page.getByText('Checking your existing session',{exact:false}).waitFor();
    assert.equal(await confirm.isDisabled(),true);
   }else if(['ready','use','revoke'].includes(sc.state))await page.getByText(/Verified session ready|session ที่ยืนยันแล้วพร้อมใช้/).waitFor();
   else await checkbox.waitFor();
   assert.equal((await page.evaluate(()=>window.fixtureStats.sign)),0,'No auto-sign');
   assert.equal(counts.use,0,'No automatic bill binding');
   assert.equal(counts.verify,0,'No automatic consent');
   if(await checkbox.count())assert.equal(await checkbox.isChecked(),false,'Optional consent starts unchecked');
   if(['anonymous','unchecked','unsupported','cross','disabled'].includes(sc.state))assert.equal(await confirm.isDisabled(),true);
   if(['checked','busy','refusal'].includes(sc.state)){
    await page.locator('.customer-consent-wallet select').selectOption('LOCAL FIXTURE WALLET');
    await checkbox.check();assert.equal(await confirm.isEnabled(),true);await confirm.click();
    if(sc.state==='busy'){
     await page.waitForFunction(()=>window.fixtureStats.busy);
     assert.equal(await confirm.isDisabled(),true);
    }else if(sc.state==='refusal')await page.getByRole('alert').filter({hasText:'LOCAL FIXTURE wallet refused'}).waitFor();
    else await page.getByText(/Verified for this bill/).waitFor();
   }
   if(sc.state==='use'){
    await page.getByRole('button',{name:/Use this session|ใช้ session นี้/}).click();
    await page.getByText(/Verified for this bill|ยืนยันแล้วสำหรับบิลนี้/).waitFor();assert.equal(counts.use,1);assert.equal(counts.challenge,0);
   }
   if(sc.state==='revoke'){
    await page.getByRole('button',{name:/Revoke authentication/}).click();await page.getByText(/Authentication and consent revoked/).waitFor();
    assert.equal(counts.revoke,1);assert.equal(await checkbox.isChecked(),false);assert.equal(await confirm.isDisabled(),true);
   }
   if(sc.state==='cross'){assert.equal(counts.session,0);assert.equal(await page.locator('.customer-consent-verified').count(),0)}
   await page.evaluate(async()=>{await document.fonts.load('14px Inter');await document.fonts.load('14px "Noto Sans Thai"');await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
   const geometry=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const surface=document.querySelector('.customer-consent-surface');
    const colors={};for(const selector of ['.customer-consent-confirm','.customer-consent-revoke']){const e=document.querySelector(selector);if(e){const s=getComputedStyle(e);colors[selector]={color:s.color,background:s.backgroundColor}}}
    const input=document.querySelector('.customer-consent-disclosure input'),inputStyle=input&&getComputedStyle(input);
    return{surface:rect(surface),cta:document.querySelector('.customer-consent-confirm')?rect(document.querySelector('.customer-consent-confirm')):null,
     colors,checkbox:input&&{checked:input.checked,padding:inputStyle.padding,indicator:getComputedStyle(input,'::after').content},
     touch:[...document.querySelectorAll('.customer-consent button,.customer-consent select,.customer-consent>summary,.customer-consent-disclosure')].map(e=>({tag:e.tagName,...rect(e)})),
     font:getComputedStyle(surface).fontFamily,loadedFonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(geometry.overflow,false);assert.ok(geometry.touch.every(r=>r.height>=48),'All interactive targets including checkbox label >=48');
   if(geometry.colors['.customer-consent-confirm'])assert.deepEqual(geometry.colors['.customer-consent-confirm'],{color:'rgb(255, 255, 255)',background:'rgb(100, 24, 138)'});
   if(geometry.colors['.customer-consent-revoke'])assert.deepEqual(geometry.colors['.customer-consent-revoke'],{color:'rgb(100, 24, 138)',background:'rgb(255, 255, 255)'});
   if(geometry.checkbox?.checked){assert.equal(geometry.checkbox.padding,'0px');assert.equal(geometry.checkbox.indicator,'"✓"')}
   assert.ok(geometry.loadedFonts.some(f=>f.family==='Inter'&&f.status==='loaded'));assert.ok(geometry.loadedFonts.some(f=>f.family==='Noto Sans Thai'&&f.status==='loaded'));
   if(sc.width===1440){assert.equal(geometry.surface.x,872);assert.equal(geometry.surface.width,472);assert.ok(geometry.surface.height>=680);if(geometry.cta){assert.equal(geometry.cta.width,416);assert.ok(geometry.cta.height>=52)}}
   const image=join(run,'screens',`${sc.state}-${sc.lang}-${sc.width}.png`);await page.screenshot({path:image,fullPage:true});receipt.screens.push(image);
   assert.deepEqual(errors,[]);
   receipt.checks.push({scenario:sc,geometry,counts:{...counts},wallet:await page.evaluate(()=>window.fixtureStats)});
   // Release held requests only after capturing the actual loading/busy surface.
   for(const release of holds)release();holds=[];
   if(sc.state==='loading')await page.getByText(/Verified session ready/).waitFor();
   if(sc.state==='busy')await page.getByText(/ยืนยันแล้วสำหรับบิลนี้/).waitFor();
   if(sc.state==='checked'){assert.equal(counts.verify,1);assert.equal(await page.evaluate(()=>window.fixtureStats.sign),1)}
   if(sc.state==='refusal'){assert.equal(counts.verify,0);assert.equal(await confirm.isEnabled(),true)}
  }finally{for(const release of holds)release();holds=[];await context.close()}
 }
 receipt.status='PASS_LOCAL_COMPONENT_FIXTURES';
}catch(error){receipt.status='FAIL';receipt.error=String(error);throw error}
finally{
 if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));
 await writeFile(join(run,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await rm(scratch,{recursive:true,force:true});console.log(JSON.stringify({run,status:receipt.status,scenarios:receipt.checks.length}));
}
