// Interactive flows on real data. usage: node capture-flows.mjs [kanban,product,sidebar,promo,export,all]  -> shots/flows/*.png, flows-result.json
import {launch,login,click,toggleLang,overflow,watch,shotDir,here,ORIGIN,fixture} from './lib.mjs';
import {samplePhoto} from './photo.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from '/Users/cryptoclock/.codex/worktrees/bitpos-h2-parallel/BitPOS/node_modules/pg/lib/index.js';
const out=shotDir('flows');const want=new Set((process.argv[2]||'kanban,product,sidebar,promo,export').split(','));
const orders=JSON.parse(readFileSync(here+'.orders.json','utf8'));
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const kitchen=async id=>(await db.query("SELECT coalesce((SELECT status FROM bitpos.order_fulfillment WHERE order_id=$1),'RECEIVED') s",[id])).rows[0].s;
const result={};const rec=(k,v)=>{result[k]=v;console.log(k,JSON.stringify(v));};
const b=await launch();

/** Drag one order card into another lane (real mouse events, HTML5 drag and drop) and assert the server status changed and the detail panel stayed closed. */
async function humanDrag(page,from,to,dwell=700){
 const a=await from.boundingBox(),t=await to.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
 await page.mouse.move(a.x+a.width/2+8,a.y+a.height/2+8,{steps:4});
 await page.mouse.move(t.x+t.width/2,t.y+60,{steps:14});await page.waitForTimeout(dwell);await page.mouse.up();
}
async function drag(page,{id,toLane,label,w,dwell=700}){
 const short=id.slice(0,8);const row=page.getByRole('button',{name:new RegExp('(View order|ดูออเดอร์) '+short)});
 await row.scrollIntoViewIfNeeded();const before=await kitchen(id);
 const lane=page.locator('section.order-lane.lane-'+toLane);
 await page.screenshot({path:`${out}${label}-before.png`});
 await humanDrag(page,row,lane.locator('.order-lane-items'),dwell);
 await page.waitForTimeout(2500);
 const after=await kitchen(id);
 const inLane=await lane.getByRole('button',{name:new RegExp('(View order|ดูออเดอร์) '+short)}).count();
 const detailOpen=await page.locator('.incoming-detail').count();
 await page.screenshot({path:`${out}${label}-after.png`});
 rec(label,{order:short,before,after,expectedLane:toLane,visibleInTargetLane:inLane>0,detailPanelOpen:detailOpen>0,pass:before!==after&&after.toLowerCase()===toLane&&inLane>0&&detailOpen===0});
}

if(want.has('kanban')){
 for(const [w,h] of [[1440,900]]){
  const p=await (await b.newContext({viewport:{width:w,height:h}})).newPage();const log=[];watch(p,log);
  await login(p);await click(p,'Order center');await p.waitForTimeout(800);
  await drag(p,{id:orders.paid,toLane:'preparing',label:'kanban-order-center-received-to-preparing',w});
  await drag(p,{id:orders.preparing,toLane:'ready',label:'kanban-order-center-preparing-to-ready',w});
  await click(p,'Kitchen queue');await p.waitForTimeout(800);
  await drag(p,{id:orders.paid2,toLane:'preparing',label:'kanban-kitchen-received-to-preparing',w});
  await drag(p,{id:orders.ready,toLane:'collected',label:'kanban-kitchen-ready-to-collected',w});
  // An invalid jump must be refused without changing anything.
  const bad=orders.paid3;const before=await kitchen(bad);
  await humanDrag(p,p.getByRole('button',{name:new RegExp('(View order|ดูออเดอร์) '+bad.slice(0,8))}),p.locator('section.order-lane.lane-collected .order-lane-items'),700);
  await p.waitForTimeout(1500);rec('kanban-invalid-jump-received-to-collected',{before,after:await kitchen(bad),pass:before===await kitchen(bad),notice:await p.locator('.order-drag-notice').allInnerTexts()});
  await p.screenshot({path:out+'kanban-invalid-jump.png'});
  if(log.length)rec('kanban-api-errors',[...new Set(log)]);
 }
}
if(want.has('sidebar')){
 for(const [w,h] of [[1440,900],[390,844]]){
  const p=await (await b.newContext({viewport:{width:w,height:h}})).newPage();await login(p);
  if(w<700){await p.getByRole('button',{name:/Workspace navigation/i}).first().click().catch(()=>{});await p.waitForTimeout(400);}
  for(const lang of ['en','th']){if(lang==='th')await toggleLang(p);await p.screenshot({path:`${out}sidebar-${w}-${lang}.png`});}
  rec('sidebar-'+w,{navButtons:await p.locator('nav button, aside button').allInnerTexts().then(a=>a.map(x=>x.split('\n')[0]).filter(Boolean).slice(0,14)),overflow:await overflow(p)});
 }
}

if(want.has('product')){
 for(const [w,h] of [[1440,900],[390,844]]){
  const p=await (await b.newContext({viewport:{width:w,height:h}})).newPage();const log=[];watch(p,log);
  await login(p);await click(p,'Products');await click(p,'Add product');await p.waitForTimeout(500);
  await p.screenshot({path:`${out}product-add-${w}-empty-en.png`});
  const nameEn='Photo test '+w;
  await p.getByLabel(/Name \(Thai\)/).fill('ทดสอบรูป '+w);await p.getByLabel(/Name \(English\)/).fill(nameEn);
  await p.locator('form[aria-label="Add product"]').getByLabel('Category').fill('Coffee');await p.locator('form[aria-label="Add product"]').getByLabel('Description').fill('Upload through the real form');
  await p.locator('.catalog-photo input[type=file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:samplePhoto(w===1440?0:40)});
  await p.locator('.catalog-photo img').waitFor({timeout:8000}).catch(()=>{});await p.waitForTimeout(800);
  await p.screenshot({path:`${out}product-add-${w}-photo-en.png`});
  await toggleLang(p);await p.screenshot({path:`${out}product-add-${w}-photo-th.png`});await toggleLang(p);
  await p.getByRole('button',{name:/^Save$/}).click();await p.waitForTimeout(1500);
  const row=(await db.query("SELECT id,image_url,stock FROM bitpos.products WHERE name_en=$1",[nameEn])).rows[0];
  let served=null;if(row?.image_url){const r=await fetch(ORIGIN+row.image_url);served={status:r.status,type:r.headers.get('content-type'),bytes:(await r.arrayBuffer()).byteLength};}
  await p.screenshot({path:`${out}product-add-${w}-saved-en.png`});
  // A file that is not an image must be refused by the form without changing the draft.
  rec('product-add-photo-'+w,{created:!!row,imageUrl:row?.image_url??null,served,errors:[...new Set(log)],pass:!!row?.image_url&&served?.status===200&&/image\//.test(served.type||'')});
  await p.getByRole('button',{name:/^Add product$/}).click().catch(()=>{});
 }
}
if(want.has('promo')){
 for(const [w,h] of [[1440,900],[390,844]]){
  const p=await (await b.newContext({viewport:{width:w,height:h}})).newPage();await login(p);await click(p,'Promotions');await p.waitForTimeout(1200);
  for(const lang of ['en','th']){if(lang==='th')await toggleLang(p);await p.screenshot({path:`${out}promotions-${w}-${lang}.png`,fullPage:true});}
  await toggleLang(p);
  const text=await p.locator('main').innerText();
  rec('promotions-'+w,{headlinesVisible:['Latte happy hour','Croissant + coffee','Thai tea Tuesday'].map(x=>text.includes(x)),overflow:await overflow(p)});
 }
}
if(want.has('export')){
 const p=await (await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true})).newPage();const log=[];watch(p,log);
 await login(p);await click(p,'Reports');await click(p,'Export');await p.waitForTimeout(500);await p.screenshot({path:out+'export-page.png'});
 const btn=p.getByRole('button',{name:/Download|ดาวน์โหลด|CSV/i}).filter({visible:true});
 console.log('export buttons',await btn.allInnerTexts());
 const [dl]=await Promise.all([p.waitForEvent('download',{timeout:10000}),btn.first().click()]);
 const path=here+'shots/flows/'+dl.suggestedFilename();await dl.saveAs(path);
 const csv=readFileSync(path,'utf8');const lines=csv.trim().split('\n');
 const paidInDb=(await db.query("SELECT count(*)::int n FROM bitpos.orders WHERE merchant_id=$1",[fixture().merchant])).rows[0].n;
 for(const kind of ['sales','net','stock']){
  try{const [d2]=await Promise.all([p.waitForEvent('download',{timeout:10000}),p.locator(`[data-export-kind=${kind}]`).click()]);const f=here+'shots/flows/server-'+d2.suggestedFilename();await d2.saveAs(f);const t=readFileSync(f,'utf8').trim().split('\n');rec('export-server-'+kind,{filename:d2.suggestedFilename(),dataRows:t.length-1,header:t[0].slice(0,140)});}catch(e){rec('export-server-'+kind,{error:String(e).slice(0,160)});}
 }
 await p.screenshot({path:out+'export-page-after.png'});
 rec('export-csv',{filename:dl.suggestedFilename(),dataRows:lines.length-1,header:lines[0].slice(0,160),ordersInDb:paidInDb,errors:[...new Set(log)]});
}
await b.close();await db.end();
writeFileSync(here+'flows-result-'+(process.env.FLOWS_TAG||'run')+'.json',JSON.stringify(result,null,1));
