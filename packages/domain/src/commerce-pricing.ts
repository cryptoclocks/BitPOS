import{priceCoupon,canonicalCouponMinor,COUPON_MAX_MINOR,type CouponFoodLine,type CouponPricingTerms}from'./coupon-pricing';
export interface CommercePricingInput{
 currency:'USD'|'USDG'|'THB';decimals:2|4|6;serving:'pickup'|'delivery';
 foodLines:readonly CouponFoodLine[];deliveryFeeMinor:string;serviceFeeMinor:string;
 feeAllocation:{merchantMinor:string;driverMinor:string;platformMinor:string};
 coupon?:{versionId:string;terms:CouponPricingTerms};
 taxPolicy:{id:string;basisPoints:number;taxableDelivery:boolean;taxableService:boolean};
 tipPolicy:{id:string;maximumMinor:string;maximumFoodBps:number;party:'MERCHANT'|'DRIVER'|'PLATFORM'};tipMinor:string;
}
/** Versioned quote calculation, NOT payment/funding/reservation authority.
 * The platform contribution is an additional required funding source, not an
 * assertion that a budget/wallet has supplied those funds.
 */
export function priceCommerce(input:CommercePricingInput){
 if(!(input.currency==='USD'&&[2,4].includes(input.decimals)||input.currency==='THB'&&input.decimals===2||input.currency==='USDG'&&input.decimals===6))throw Error('INVALID_COMMERCE_DENOMINATION');
 if(!['pickup','delivery'].includes(input.serving))throw Error('INVALID_COMMERCE_SERVING');
 const identifier=(value:string)=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw Error('INVALID_COMMERCE_POLICY_ID');return value;};
 const rate=(value:number)=>{if(!Number.isSafeInteger(value)||value<0||value>10000)throw Error('INVALID_COMMERCE_RATE');return BigInt(value);};
 identifier(input.taxPolicy.id);identifier(input.tipPolicy.id);
 if(typeof input.taxPolicy.taxableDelivery!=='boolean'||typeof input.taxPolicy.taxableService!=='boolean')throw Error('INVALID_COMMERCE_TAX_POLICY');
 if(!['MERCHANT','DRIVER','PLATFORM'].includes(input.tipPolicy.party))throw Error('INVALID_COMMERCE_TIP_PARTY');
 if(input.foodLines.length<1||input.foodLines.length>50)throw Error('INVALID_COMMERCE_LINES');
 const seen=new Set<string>();const food=input.foodLines.reduce((sum,line)=>{identifier(line.lineId);if(seen.has(line.lineId))throw Error('INVALID_COMMERCE_LINES');seen.add(line.lineId);return sum+canonicalCouponMinor(line.amountMinor);},0n);
 const delivery=canonicalCouponMinor(input.deliveryFeeMinor),service=canonicalCouponMinor(input.serviceFeeMinor),tip=canonicalCouponMinor(input.tipMinor),maximumTip=canonicalCouponMinor(input.tipPolicy.maximumMinor),tipRate=rate(input.tipPolicy.maximumFoodBps),taxRate=rate(input.taxPolicy.basisPoints);
 const feeMerchant=canonicalCouponMinor(input.feeAllocation.merchantMinor),feeDriver=canonicalCouponMinor(input.feeAllocation.driverMinor),feePlatform=canonicalCouponMinor(input.feeAllocation.platformMinor);
 if(food>COUPON_MAX_MINOR||delivery+service>COUPON_MAX_MINOR)throw Error('COMMERCE_AMOUNT_OVERFLOW');
 if(feeMerchant+feeDriver+feePlatform!==delivery+service)throw Error('COMMERCE_FEE_ALLOCATION_MISMATCH');
 if(input.serving==='pickup'&&(delivery!==0n||feeDriver!==0n||tip!==0n&&input.tipPolicy.party==='DRIVER'))throw Error('COMMERCE_DRIVER_REQUIRES_DELIVERY');
 const coupon=input.coupon?(identifier(input.coupon.versionId),priceCoupon(input.coupon.terms,input.foodLines)):null;
 const discountedFood=coupon?BigInt(coupon.payableFoodMinor):food,merchantDiscount=coupon?BigInt(coupon.merchantFundingMinor):0n,platformContribution=coupon?BigInt(coupon.platformFundingMinor):0n;
 const capByRate=discountedFood*tipRate/10000n,tipCap=capByRate<maximumTip?capByRate:maximumTip;if(tip>tipCap)throw Error('COMMERCE_TIP_LIMIT_EXCEEDED');
 const taxBase=discountedFood+(input.taxPolicy.taxableDelivery?delivery:0n)+(input.taxPolicy.taxableService?service:0n),tax=taxBase*taxRate/10000n;
 const payable=discountedFood+delivery+service+tax+tip;
 const merchant=food-merchantDiscount+feeMerchant+(input.tipPolicy.party==='MERCHANT'?tip:0n),driver=feeDriver+(input.tipPolicy.party==='DRIVER'?tip:0n),platform=feePlatform+(input.tipPolicy.party==='PLATFORM'?tip:0n);
 for(const amount of[taxBase,tax,payable,merchant,driver,platform,payable+platformContribution])if(amount<0n||amount>COUPON_MAX_MINOR)throw Error('COMMERCE_AMOUNT_OVERFLOW');
 if(payable+platformContribution!==merchant+driver+platform+tax)throw Error('COMMERCE_FUNDING_IMBALANCE');
 const money=(amount:bigint)=>({currency:input.currency,decimals:input.decimals,amountMinor:String(amount)});
 return{pricingVersion:'commerce-pricing-v1' as const,couponVersionId:input.coupon?.versionId??null,taxPolicyId:input.taxPolicy.id,tipPolicyId:input.tipPolicy.id,
 food:money(food),couponDiscount:money(coupon?BigInt(coupon.discountMinor):0n),foodAfterDiscount:money(discountedFood),deliveryFee:money(delivery),serviceFee:money(service),taxableBase:money(taxBase),tax:money(tax),tip:money(tip),tipCap:money(tipCap),total:money(payable),requiresPayment:payable>0n,
 platformContribution:money(platformContribution),receivables:{merchant:money(merchant),driver:money(driver),platform:money(platform),tax:money(tax)},coupon};
}
