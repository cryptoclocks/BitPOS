// Meta hackathon work (2026-10-26..11-04).
// Live probe: one real Muse Spark offer selection through the BitPOS router with a sample menu.
// Key file (outside the repo): ~/.bitpos-meta/meta-api.env containing META_AI_META_API_KEY=...
// Prints provider, model, latency and the choice; never prints the key.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createMetaRouter} from '../../packages/meta-ai/src/router';
import type {MetaInvocation} from '../../packages/meta-ai/src/types';
import {approvedOffers,selectOffer} from '../../apps/api/src/meta/offer-select';
import type {EffectiveMenu} from '../../apps/api/src/offers';

const file=process.env.BITPOS_META_API_ENV??join(homedir(),'.bitpos-meta','meta-api.env');
const key=readFileSync(file,'utf8').match(/^META_AI_META_API_KEY=(\S+)$/m)?.[1];
if(!key)throw Error('META_AI_META_API_KEY missing');
const model=process.env.META_AI_META_API_MODEL??'muse-spark-1.3';

const thb=(v:string)=>({currency:'THB' as const,decimals:2 as const,amountMinor:v});
const later=new Date(Date.now()+3600e3).toISOString();
const id=(n:number)=>`00000000-0000-4000-8000-00000000000${n}`;
const promo=(rev:string)=>({revision:rev,expiresAt:later,discount:{kind:'percent' as const,percent:20},priceVersion:id(9)});
const menu={merchant:{id:id(9),name:'demo'},asOf:new Date().toISOString(),priceValidUntil:later,menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,products:[
 {id:id(1),catalogKey:null,name:'ครัวซองต์เนยสด',nameEn:'Butter croissant',emoji:'🥐',available:3,imageUrl:null,category:'bakery',description:null,basePrice:thb('6500'),unitPrice:thb('5200'),promotion:promo('1')},
 {id:id(2),catalogKey:null,name:'ลาเต้เย็น',nameEn:'Iced latte',emoji:'🧋',available:30,imageUrl:null,category:'drink',description:null,basePrice:thb('8000'),unitPrice:thb('7200'),promotion:promo('2')},
 {id:id(3),catalogKey:null,name:'ชาไทย',nameEn:'Thai tea',emoji:'🍵',available:12,imageUrl:null,category:'drink',description:null,basePrice:thb('6000'),unitPrice:thb('4500'),promotion:promo('3')},
]} as EffectiveMenu;

const records:MetaInvocation[]=[];
const router=createMetaRouter({providers:[{id:'meta_api',baseUrl:'https://api.meta.ai/v1',apiKey:key,model,weights:'closed',location:'cloud',timeoutMs:20000,supportsJsonSchema:true,supportsImages:false}],record:async r=>{records.push(r);}});
const choice=await selectOffer(router,id(9),approvedOffers(menu),{visitCount:3,localHour:8,recentlyShown:[]},20000);
for(const r of records)console.log('attempt',JSON.stringify({provider:r.provider,model:r.model,outcome:r.outcome,latencyMs:r.latencyMs,promptTokens:r.promptTokens,completionTokens:r.completionTokens}));
console.log('choice',JSON.stringify(choice&&{chosenBy:choice.chosenBy,item:choice.candidate.nameEn,reasonTh:choice.reasonTh,reasonEn:choice.reasonEn}));
