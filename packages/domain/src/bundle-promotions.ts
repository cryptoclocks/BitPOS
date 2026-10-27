import type {Money,EffectiveLine} from '../../contracts/src/index';
import type {BundleSnapshot,BundleOffer} from '../../contracts/src/bundle-promotions';
import type {PromotionProductSnapshot} from './promotions';
export function bundleSnapshot(members:PromotionProductSnapshot[],unitMinor:string):BundleSnapshot{
 if(members.length!==2||members[0].productId===members[1].productId||members.some(m=>m.stock<1||m.priceVersion!==members[0].priceVersion||m.basePrice.currency!==members[0].basePrice.currency||m.basePrice.decimals!==members[0].basePrice.decimals))throw Error('PROMOTION_REVIEW_REQUIRED');
 const base=members.reduce((n,m)=>n+BigInt(m.basePrice.amountMinor),0n),final=BigInt(unitMinor);if(final<2n||final>=base||(base-final)*100n>base*99n)throw Error('PROMOTION_REVIEW_REQUIRED');
 const hundredths=(base-final)*10000n/base;const percentage=(Number(hundredths)/100).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
 return {members,unitPrice:{...members[0].basePrice,amountMinor:String(final)},discountLabel:percentage+'% OFF'};
}
export function aggregateBundle(bundle:BundleSnapshot):PromotionProductSnapshot{
 const m=bundle.members;return {...m[0],name:m.map(p=>p.name).join(' + '),nameEn:m.map(p=>p.nameEn).join(' + '),stock:Math.min(...m.map(p=>p.stock)),basePrice:{...m[0].basePrice,amountMinor:String(m.reduce((n,p)=>n+BigInt(p.basePrice.amountMinor),0n))},effectivePrice:{...m[0].effectivePrice,amountMinor:String(m.reduce((n,p)=>n+BigInt(p.effectivePrice.amountMinor),0n))},bundle};
}
/** One pair at a time; identical component quantities form whole sets. Never stack with line offers. */
export function applyBundle(lines:EffectiveLine[],offers:BundleOffer[]):EffectiveLine[]{
 let best:{offer:BundleOffer;indices:number[];qty:number;saving:bigint}|undefined;
 for(const offer of offers){const indices=offer.members.map(m=>lines.findIndex(l=>l.productId===m.productId));if(indices.some(i=>i<0))continue;const [a,b]=indices.map(i=>lines[i]);if(a.qty!==b.qty)continue;const saving=(BigInt(a.unitPrice.amountMinor)+BigInt(b.unitPrice.amountMinor)-BigInt(offer.unitPrice.amountMinor))*BigInt(a.qty);if(saving>0n&&(!best||saving>best.saving))best={offer,indices,qty:a.qty,saving};}
 if(!best)return lines;const [ia,ib]=best.indices,[a,b]=[lines[ia],lines[ib]];const final=BigInt(best.offer.unitPrice.amountMinor),base=BigInt(a.basePrice.amountMinor)+BigInt(b.basePrice.amountMinor);let first=final*BigInt(a.basePrice.amountMinor)/base;first=first<1n?1n:first;const second=final-first;if(second<1n)return lines;
 return lines.map((line,i)=>{if(i!==ia&&i!==ib)return line;const {dailyPromotion,personalPromotion,scopedPromotion,...clean}=line;return {...clean,promotion:null,unitPrice:{...line.unitPrice,amountMinor:String(i===ia?first:second)},bundle:{campaignId:best!.offer.id,campaignVersion:best!.offer.version,pairUnitMinor:best!.offer.unitPrice.amountMinor}};});
}
