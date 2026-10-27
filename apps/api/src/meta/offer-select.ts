// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Muse Spark picks ONE offer for a consented customer from the shop's already-approved, server-priced
// offers. The model sees an id enum and coarse facts (no identity); it cannot invent an offer, price or
// discount, and its short reasons may not contain digits. Any failure falls back to a deterministic pick.
import {z} from 'zod';
import type {EffectiveMenu} from '../offers';
import type {Money} from '../../../../packages/contracts/src/index';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import {MetaRouterError} from '../../../../packages/meta-ai/src/types';

export interface OfferCandidate {
 offerId:string;productId:string;name:string;nameEn:string;emoji:string;category:string|null;
 basePrice:Money;unitPrice:Money;discountPercent:number;expiresAt:string;available:number;
}
export interface CustomerFacts {visitCount:number;localHour:number;recentlyShown:string[]}
export interface OfferChoice {candidate:OfferCandidate;chosenBy:'model'|'fallback';invocationId:string|null;reasonTh:string;reasonEn:string}

const MAX_CANDIDATES=20;
const NO_DIGITS=/[0-9๐-๙]/,FORBIDDEN=/https?:|www\.|[฿$%€£]/i;

/** Products whose current server price is below base because of an approved product or daily offer. */
export function approvedOffers(menu:EffectiveMenu):OfferCandidate[]{
 const out:OfferCandidate[]=[];
 for(const p of menu.products){
  if(p.available<=0||!p.basePrice||!p.unitPrice||p.basePrice.currency!==p.unitPrice.currency)continue;
  const base=BigInt(p.basePrice.amountMinor),unit=BigInt(p.unitPrice.amountMinor);
  if(base<=0n||unit<=0n||unit>=base)continue;
  let offerId:string,expiresAt:string;
  if(p.dailyPromotion){offerId=`daily:${p.id}:${p.dailyPromotion.campaignId}.${p.dailyPromotion.campaignVersion}`;expiresAt=p.dailyPromotion.expiresAt;}
  else if(p.promotion){offerId=`product:${p.id}:${p.promotion.revision}`;expiresAt=p.promotion.expiresAt;}
  else continue;
  out.push({offerId,productId:p.id,name:p.name,nameEn:p.nameEn,emoji:p.emoji,category:typeof p.category==='string'?p.category:null,
   basePrice:p.basePrice,unitPrice:p.unitPrice,discountPercent:Number((base-unit)*100n/base),expiresAt,available:p.available});
 }
 return out.sort((a,b)=>b.discountPercent-a.discountPercent||a.offerId.localeCompare(b.offerId)).slice(0,MAX_CANDIDATES);
}

export function fallbackChoice(candidates:OfferCandidate[],facts:CustomerFacts):OfferChoice{
 const fresh=candidates.filter(c=>!facts.recentlyShown.includes(c.offerId));
 const candidate=(fresh.length?fresh:candidates)[0];
 return {candidate,chosenBy:'fallback',invocationId:null,reasonTh:'โปรแนะนำของร้านวันนี้',reasonEn:"Today's pick from the shop"};
}

const SYSTEM=`You choose one offer for a cafe customer who tapped their phone at the counter.
Choose exactly one offerId from the provided list. Do not invent offers.
Write one short friendly reason in Thai (reasonTh) and English (reasonEn), each under 100 characters.
Never write numbers, prices, percentages, currency symbols or links in the reasons; the shop shows prices itself.
Prefer offers the customer has not been shown recently, and items that suit the time of day.`;

// Muse Spark 1.3 answered in about 3.4 s live (2026-10-28), so allow 8 s before falling back.
export async function selectOffer(router:MetaRouter|null,merchantId:string,candidates:OfferCandidate[],facts:CustomerFacts,deadlineMs=8000):Promise<OfferChoice|null>{
 if(!candidates.length)return null;
 if(!router)return fallbackChoice(candidates,facts);
 const ids=candidates.map(c=>c.offerId) as [string,...string[]];
 const schema=z.object({offerId:z.enum(ids),reasonTh:z.string().trim().min(1).max(160),reasonEn:z.string().trim().min(1).max(160)}).strict();
 const jsonSchema={type:'object',additionalProperties:false,required:['offerId','reasonTh','reasonEn'],properties:{offerId:{type:'string',enum:ids},reasonTh:{type:'string',maxLength:160},reasonEn:{type:'string',maxLength:160}}};
 const visit=facts.visitCount<=1?'first_visit':facts.visitCount<5?'returning':'regular';
 const daypart=facts.localHour<11?'morning':facts.localHour<15?'midday':facts.localHour<18?'afternoon':'evening';
 const list=candidates.map(c=>({offerId:c.offerId,item:c.nameEn,itemTh:c.name,category:c.category,discountPercent:c.discountPercent,lowStock:c.available<=3,recentlyShown:facts.recentlyShown.includes(c.offerId)}));
 try{
  const r=await router.invoke({task:'offer_selection',merchantId,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({customer:{visit,daypart},offers:list})}],
   output:{name:'offer_choice',schema,jsonSchema},maxOutputTokens:2000,reasoningEffort:'minimal',deadlineMs});
  const v=r.value;
  if(NO_DIGITS.test(v.reasonTh)||NO_DIGITS.test(v.reasonEn)||FORBIDDEN.test(v.reasonTh)||FORBIDDEN.test(v.reasonEn))return fallbackChoice(candidates,facts);
  return {candidate:candidates.find(c=>c.offerId===v.offerId)!,chosenBy:'model',invocationId:r.invocation.id,reasonTh:v.reasonTh,reasonEn:v.reasonEn};
 }catch(e){if(e instanceof MetaRouterError)return fallbackChoice(candidates,facts);throw e;}
}

export function formatMoney(m:Money):string{
 const amount=BigInt(m.amountMinor),scale=10n**BigInt(m.decimals),rest=amount%scale;
 // Whole units drop the decimals; otherwise show at least two digits (฿45.50) and trim extra zeros.
 const frac=rest===0n?'':rest.toString().padStart(m.decimals,'0').replace(/0+$/,'').padEnd(2,'0');
 const n=`${(amount/scale).toLocaleString('en-US')}${frac?'.'+frac:''}`;
 return m.currency==='THB'?`฿${n}`:m.currency==='USD'?`$${n}`:`${n} ${m.currency}`;
}
