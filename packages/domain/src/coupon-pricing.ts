/** Coupon arithmetic over canonical FOOD line totals AFTER item promotions.
 * Delivery/service fees and tax are deliberately not inputs. Tax is recalculated
 * by the quote policy after this adjustment; this module never marks an order paid.
 */
export const COUPON_MAX_MINOR=999999999999999999n;
export type CouponDiscount={kind:'FIXED';fixedMinor:string}|{kind:'BASIS_POINTS';basisPoints:number};
export interface CouponPricingTerms{minimumFoodMinor:string;maximumDiscountMinor:string;discount:CouponDiscount;merchantFundingBps:number}
export interface CouponFoodLine{lineId:string;amountMinor:string}
export interface CouponAllocation{lineId:string;foodMinor:string;discountMinor:string;payableFoodMinor:string}
export interface CouponPricing{foodMinor:string;discountMinor:string;payableFoodMinor:string;merchantFundingMinor:string;platformFundingMinor:string;lines:CouponAllocation[]}
function minor(value:string){if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(value))throw Error('INVALID_COUPON_MONEY');const n=BigInt(value);if(n>COUPON_MAX_MINOR)throw Error('INVALID_COUPON_MONEY');return n;}
function bps(value:number,minimum:number){if(!Number.isSafeInteger(value)||value<minimum||value>10000)throw Error('INVALID_COUPON_BASIS_POINTS');return BigInt(value);}
export function priceCoupon(terms:CouponPricingTerms,foodLines:readonly CouponFoodLine[]):CouponPricing{
 const minimum=minor(terms.minimumFoodMinor),maximum=minor(terms.maximumDiscountMinor),merchantBps=bps(terms.merchantFundingBps,0);if(maximum===0n)throw Error('INVALID_COUPON_CAP');
 if(foodLines.length<1||foodLines.length>50)throw Error('INVALID_COUPON_LINES');
 const seen=new Set<string>();const lines=foodLines.map(line=>{if(typeof line.lineId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(line.lineId)||seen.has(line.lineId))throw Error('INVALID_COUPON_LINE_ID');seen.add(line.lineId);return{lineId:line.lineId,food:minor(line.amountMinor)};}).sort((a,b)=>a.lineId<b.lineId?-1:a.lineId>b.lineId?1:0);
 const food=lines.reduce((sum,line)=>sum+line.food,0n);if(food>COUPON_MAX_MINOR)throw Error('COUPON_AMOUNT_OVERFLOW');if(food<minimum)throw Error('COUPON_MINIMUM_NOT_MET');if(food===0n)throw Error('COUPON_NO_DISCOUNTABLE_FOOD');
 let requested:bigint;
 if(terms.discount.kind==='FIXED'){requested=minor(terms.discount.fixedMinor);if(requested===0n)throw Error('INVALID_COUPON_FIXED_AMOUNT');}
 else if(terms.discount.kind==='BASIS_POINTS')requested=food*bps(terms.discount.basisPoints,1)/10000n;
 else throw Error('INVALID_COUPON_DISCOUNT_KIND');
 const discount=requested<maximum?requested<food?requested:food:maximum<food?maximum:food;
 if(discount===0n)throw Error('COUPON_DISCOUNT_ROUNDS_TO_ZERO');
 // Largest remainder on line TOTALS, never fractional per-unit prices. The
 // canonical item/quantity/option snapshots remain intact for stock and refunds.
 const allocated=lines.map(line=>({...line,discount:discount*line.food/food,remainder:discount*line.food%food}));
 let left=discount-allocated.reduce((sum,line)=>sum+line.discount,0n);
 const ranked=[...allocated].sort((a,b)=>a.remainder===b.remainder?(a.lineId<b.lineId?-1:a.lineId>b.lineId?1:0):a.remainder>b.remainder?-1:1);
 for(const line of ranked){if(left===0n)break;if(line.food>line.discount){line.discount++;left--;}}
 if(left!==0n)throw Error('COUPON_ALLOCATION_FAILED');
 const merchant=discount*merchantBps/10000n;
 return{foodMinor:String(food),discountMinor:String(discount),payableFoodMinor:String(food-discount),merchantFundingMinor:String(merchant),platformFundingMinor:String(discount-merchant),lines:allocated.map(line=>({lineId:line.lineId,foodMinor:String(line.food),discountMinor:String(line.discount),payableFoodMinor:String(line.food-line.discount)}))};
}
export {minor as canonicalCouponMinor};
