import { chromium } from '/Users/cryptoclock/Desktop/BitPOS/local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const out=new URL('./pos/',import.meta.url).pathname;mkdirSync(out,{recursive:true});
const only=process.argv[2]?new Set(process.argv[2].split(',')):null;
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
// [id, ...steps]; a step is a button-name regex clicked in order (first visible match).
const V=[
 ['P01',['Overview']],['P02',['Sales']],['P03',['Order center']],['P04',['Order center','View details']],
 ['P05',['Reports','Close round']],['P06',['Products','Catalog']],['P07',['Products','Catalog','Details']],
 ['P08',['Products','Stock']],['P09',['Products','Stock','Receive']],['P10',['Reports','Stock received']],['P11',['Products','Stock','Adjust']],
 ['P12',['Products','Stock','Low stock']],['P13',['Products','Stock','Set minimum']],
 ['P14',['Reports','Daily']],['P15',['Reports','By period']],['P17',['Reports','Analytics']],['P19',['Reports','Top products']],['P20',['Reports','Export']],
 ['P21',['Products','Suppliers']],['P22',['Customers']],['P23',['Customers','Customer A']],['P24',['Products','Rename category']],
 ['P25',['Settings','Users']],['P26',['Settings','Activity']],['P27',['Settings','Receipt printer']],['P28',['Settings']],
 ['P29',['Order center']],['P30',['Kitchen queue']],['P31',['Order center','App pickup']],['P32',['Delivery']],
 ['P33',['Promotions']],['P34',['Promotions','Drafts']],['P35',['Settings','Floor']],['P36',['Settings','opening hours']],
 ['P37',['Reports','Returns']],['P38',['Reports','Net']],
];
const vp=[[1440,900,'1440'],[390,844,'390']];
for(const [w,h,tag] of vp){
 const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});const p=await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://127.0.0.1:4482/');
 if(!only||only.has('P39')){await p.waitForTimeout(800);await p.screenshot({path:`${out}P39-${tag}-en.png`});await p.getByRole('button',{name:/^ไทย$/}).click().catch(()=>{});await p.waitForTimeout(300);await p.screenshot({path:`${out}P39-${tag}-th.png`});await p.getByRole('button',{name:'English',exact:true}).click().catch(()=>{});}
 for(const [id,steps] of V){
  if(only&&!only.has(id))continue;
  let ok=true;
  await p.goto('http://127.0.0.1:4482/');await p.getByRole('button',{name:'Owner',exact:true}).click();await p.waitForTimeout(900);
  for(const s of steps){
   try{
    if(s==='#CUST'){await p.locator('main tbody tr, main li').first().click({timeout:1500});}
    else{const mob=w<700?{'Order center':'Orders','Sales':'Menu'}:{};const re=new RegExp(mob[s]?'^'+mob[s]:s.startsWith('#')?'^'+s:s.replace(/&/g,'.'),'i');
     // at 390 the sidebar is hidden; the tab strip is used.
     let loc=p.getByRole('button',{name:re}).filter({visible:true}).first();if(!(await loc.isVisible().catch(()=>false))){await p.getByRole('button',{name:/Workspace navigation/i}).click({timeout:800}).catch(()=>{});await p.waitForTimeout(250);loc=p.getByRole('button',{name:re}).filter({visible:true}).first();}await loc.click({timeout:1500});}
    await p.waitForTimeout(450);
   }catch(e){ok=false;}
  }
  await p.waitForTimeout(400);
  for(const lang of ['en','th']){
   if(lang==='th')await p.locator('button.language-toggle').click().catch(()=>{});
   await p.waitForTimeout(250);
   const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   await p.screenshot({path:`${out}${id}-${tag}-${lang}.png`,fullPage:false});
   console.log(id,tag,lang,ok?'ok':'STEP-MISS',ov?'H-OVERFLOW':'');
  }
  
 }
 if(errs.length)console.log('PAGEERRORS',tag,[...new Set(errs)].join(' ; '));
 await ctx.close();
}
await b.close();
