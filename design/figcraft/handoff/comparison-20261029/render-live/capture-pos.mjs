// POS P01-P38 on real data. usage: node capture-pos.mjs [P01,P02,...]   -> shots/pos/<ID>-<1440|390>-<en|th>.png
import {launch,login,click,toggleLang,overflow,watch,shotDir} from './lib.mjs';
const out=shotDir('pos');const only=process.argv[2]?new Set(process.argv[2].split(',')):null;
const V=[
 ['P01',['Overview']],['P02',['Sales']],['P03',['Order center']],['P04',['Order center','View order']],
 ['P05',['Reports','Close round']],['P06',['Products','Catalog']],['P07',['Products','Catalog','Details']],
 ['P08',['Products','Stock']],['P09',['Products','Stock','Receive']],['P10',['Reports','Stock received']],['P11',['Products','Stock','Adjust']],
 ['P12',['Products','Stock','Low stock']],['P13',['Products','Stock','Set minimum']],
 ['P14',['Reports','Daily']],['P15',['Reports','By period']],['P17',['Reports','Analytics']],['P19',['Reports','Top products']],['P20',['Reports','Export']],
 ['P21',['Products','Suppliers']],['P22',['Customers']],['P24',['Products','Rename category']],
 ['P25',['Settings','Users']],['P26',['Settings','Activity']],['P27',['Settings','Receipt printer']],['P28',['Settings']],
 ['P29',['Order center']],['P30',['Kitchen queue']],['P31',['Order center','Filters & search','App pickup']],['P32',['Delivery']],
 ['P33',['Promotions']],['P34',['Promotions','Drafts']],['P35',['Settings','Floor']],['P36',['Settings','opening hours']],
 ['P37',['Reports','Returns']],['P38',['Reports','Net']],
];
const b=await launch();
for(const [w,h,tag] of [[1440,900,'1440'],[390,844,'390']]){
 const ctx=await b.newContext({viewport:{width:w,height:h}});const p=await ctx.newPage();const log=[];watch(p,log);
 await login(p);
 for(const [id,steps] of V){
  if(only&&!only.has(id))continue;
  let ok=true;
  if(id!=='P01'){try{await click(p,w<700?'^Overview':'Overview');}catch{}} // remount the workspace so tab state from the previous frame cannot leak
  for(const s of steps){const name=w<700?({'Order center':'Orders','Sales':'Menu'}[s]??s):s;try{await click(p,name);}catch{ok=false;}}
  await p.waitForTimeout(500);
  for(const lang of ['en','th']){
   if(lang==='th')await toggleLang(p);
   await p.screenshot({path:`${out}${id}-${tag}-${lang}.png`});
   console.log(id,tag,lang,ok?'ok':'STEP-MISS',(await overflow(p))?'H-OVERFLOW':'');
  }
  await toggleLang(p);
 }
 if(log.length)console.log('LOG',tag,[...new Set(log)].join(' | '));
 await ctx.close();
}
await b.close();
