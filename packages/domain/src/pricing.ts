import type {ActiveFoodPromotion,FoodDiscount} from '../../contracts/src/index';

export interface ProductOffer {
 revision:string;
 enabled:boolean;
 baseMinor:bigint;
 currentMinor:bigint;
 expiresAt:string;
 discount:FoodDiscount;
}
export function discountedMinor(baseMinor:bigint,discount:FoodDiscount):bigint {
 return baseMinor-(discount.kind==='amount'?BigInt(discount.amountMinor):baseMinor*BigInt(discount.percent)/100n);
}
export function effectivePrice(baseMinor:bigint,offer:ProductOffer|null,asOf:Date):{basePriceMinor:string;priceMinor:string;promotion:ActiveFoodPromotion|null} {
 const active=offer!==null&&offer.enabled&&Date.parse(offer.expiresAt)>asOf.getTime()&&offer.baseMinor===baseMinor;
 return {basePriceMinor:baseMinor.toString(),priceMinor:(active?offer.currentMinor:baseMinor).toString(),promotion:active?{revision:offer.revision,expiresAt:offer.expiresAt,discount:offer.discount}:null};
}
export function priceLease(asOf:Date,promotions:(ActiveFoodPromotion|null)[]):string {
 return new Date(promotions.reduce((end,promotion)=>promotion?Math.min(end,Date.parse(promotion.expiresAt)):end,asOf.getTime()+60000)).toISOString();
}
