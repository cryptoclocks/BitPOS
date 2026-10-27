// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Deterministic leash: vision observes, this code decides what is allowed, the model only chooses within it.
import {z} from 'zod';
import {promotionPrice,type PromotionProductSnapshot} from '../../domain/src/promotions';

export const flashSalePolicy=z.object({
 version:z.number().int().positive(),
 mode:z.enum(['supervised','leashed']),
 maxDiscountPercent:z.number().int().min(1).max(50),
 autoApproveMaxPercent:z.number().int().min(0).max(50),
 minConfidenceBp:z.number().int().min(5000).max(10000),
 minSurplusUnits:z.number().int().min(1).max(500),
 windowMinutes:z.number().int().min(15).max(240),
 dailyAutoLimit:z.number().int().min(0).max(20),
}).strict().refine(p=>p.autoApproveMaxPercent<=p.maxDiscountPercent,{message:'AUTO_CAP_ABOVE_MAX'});
export type FlashSalePolicy=z.infer<typeof flashSalePolicy>;

/** One product's shelf count derived from SAM 3.1 masks (count is computed in code, never by the language model). */
export interface ShelfCount {productId:string;detected:number;confidenceBp:number;observationId:string;}

export interface FlashSaleFacts {
 now:Date;
 closesAt:Date;
 product:PromotionProductSnapshot;
 count:ShelfCount;
 /** Same-weekday sales velocity for the remaining window, in milli-units per hour (integer, from paid orders). */
 soldPerHourMilli:number;
 autoApprovedToday:number;
 /** An open run already exists for this product; never stack flash sales. */
 openRun:boolean;
}

export type FlashSalePlan=
 |{kind:'none';reason:'OPEN_RUN'|'LOW_CONFIDENCE'|'NO_SURPLUS'|'CLOSING_TOO_SOON'|'INVENTORY_MISMATCH'|'NO_VALID_PRICE'|'BUNDLE_UNSUPPORTED'}
 |{kind:'candidate';productId:string;projectedSurplus:number;allowedDiscounts:number[];startsAt:string;expiresAt:string;inventoryMismatch:boolean};

export function planFlashSale(policy:FlashSalePolicy,f:FlashSaleFacts):FlashSalePlan{
 if(f.openRun)return {kind:'none',reason:'OPEN_RUN'};
 if(f.product.bundle)return {kind:'none',reason:'BUNDLE_UNSUPPORTED'};
 if(f.count.confidenceBp<policy.minConfidenceBp)return {kind:'none',reason:'LOW_CONFIDENCE'};
 const minutes=Math.floor((f.closesAt.getTime()-f.now.getTime())/60000);
 if(minutes<15)return {kind:'none',reason:'CLOSING_TOO_SOON'};
 // Camera sees more than the ledger says exists: never trust either side automatically.
 if(f.count.detected>f.product.stock+2)return {kind:'none',reason:'INVENTORY_MISMATCH'};
 const expectedSales=Math.ceil(f.soldPerHourMilli*minutes/60000);
 const surplus=f.count.detected-expectedSales;
 if(surplus<policy.minSurplusUnits)return {kind:'none',reason:'NO_SURPLUS'};
 // Half the cap below 50% projected surplus, full cap at or above it.
 const cap=surplus*2>=f.count.detected?policy.maxDiscountPercent:Math.max(1,Math.floor(policy.maxDiscountPercent/2));
 const allowedDiscounts=Array.from({length:cap},(_,i)=>i+1).filter(percent=>{try{promotionPrice(f.product.basePrice,f.product.effectivePrice,percent,cap);return true;}catch{return false;}});
 if(!allowedDiscounts.length)return {kind:'none',reason:'NO_VALID_PRICE'};
 const end=Math.min(f.now.getTime()+policy.windowMinutes*60000,f.closesAt.getTime());
 return {kind:'candidate',productId:f.product.productId,projectedSurplus:surplus,allowedDiscounts,startsAt:f.now.toISOString(),expiresAt:new Date(end).toISOString(),inventoryMismatch:f.count.detected!==f.product.stock};
}

/** Auto-approval needs an owner-approved leashed policy, a confident and consistent count, and remaining daily budget. */
export function autoApprovable(policy:FlashSalePolicy,plan:Extract<FlashSalePlan,{kind:'candidate'}>,percent:number,count:ShelfCount,autoApprovedToday:number){
 return policy.mode==='leashed'&&plan.allowedDiscounts.includes(percent)&&percent<=policy.autoApproveMaxPercent&&count.confidenceBp>=policy.minConfidenceBp&&!plan.inventoryMismatch&&autoApprovedToday<policy.dailyAutoLimit;
}
