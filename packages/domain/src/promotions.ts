import {z} from 'zod';
import type {Money} from '../../contracts/src/index';
// Exact inherited device font repertoire, bounded UTF-8 wire extent.
const displayText=z.string().refine(s=>[...s].every(c=>{const n=c.codePointAt(0)!;return n>=32&&n<=126||n>=0x0e01&&n<=0x0e5b&&!(n>=0x0e3b&&n<=0x0e3e);}));
export const promotionCandidate=z.object({productId:z.string().uuid(),headline:displayText.min(1).max(80).refine(s=>Buffer.byteLength(s)<=160),copy:displayText.min(1).max(180).refine(s=>Buffer.byteLength(s)<=360),discountPercent:z.number().int().min(1).max(99),rationale:z.string().min(1).max(800)}).strict();
export type PromotionCandidate=z.infer<typeof promotionCandidate>;
export const promotionDeriveCommandSchema=z.object({language:z.enum(['th','en']).optional(),expectedVersion:z.number().int().positive(),idempotencyKey:z.string().min(1).max(128),scope:z.enum(['all_campaign_devices','this_table']),mode:z.enum(['edit','regenerate']),device:z.object({deviceId:z.string().uuid(),assignmentGeneration:z.string().regex(/^[1-9][0-9]*$/),authGeneration:z.string().regex(/^[1-9][0-9]*$/),screenGeneration:z.string().regex(/^[1-9][0-9]*$/)}).strict(),confirmScope:z.literal(true)}).strict();
export interface PromotionProductSnapshot {bundle?:import('../../contracts/src/bundle-promotions').BundleSnapshot;productId:string;name:string;nameEn:string;category:string|null;stock:number;basePrice:Money;effectivePrice:Money;priceVersion:string;imageUrl:string|null;}
export function promotionPrice(base:Money,current:Money,percent:number,cap:number):Money{
 if(!Number.isInteger(percent)||percent<1||percent>cap||cap>99||base.currency!==current.currency||base.decimals!==current.decimals)throw Error('PROMOTION_REVIEW_REQUIRED');
 const b=BigInt(base.amountMinor),price=b-b*BigInt(percent)/100n;
 if(price<=0n||price>=BigInt(current.amountMinor))throw Error('PROMOTION_REVIEW_REQUIRED');
 return {...base,amountMinor:price.toString()};
}
/** Only an explicit manual lineage can preserve its exact inherited source price. */
export function derivedPromotionPrice(base:Money,current:Money,percent:number,cap:number,inheritedPercent?:number):Money{
 if(percent!==inheritedPercent)return promotionPrice(base,current,percent,cap);
 const price=promotionPrice(base,base,percent,cap);
 if(BigInt(price.amountMinor)>BigInt(current.amountMinor))throw Error('PROMOTION_REVIEW_REQUIRED');
 return price;
}
export function promotionWindow(startsAt:string,expiresAt:string,now=Date.now()){
 const start=Date.parse(startsAt),end=Date.parse(expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=Math.max(start,now)||end-start>7*86400000)throw Error('PROMOTION_REVIEW_REQUIRED');
}
export function validatePromotionCandidate(raw:unknown,products:PromotionProductSnapshot[],cap:number):PromotionCandidate{
 const candidate=promotionCandidate.parse(raw);const product=products.find(p=>p.productId===candidate.productId);
 if(!product||product.stock<1)throw Error('PROMOTION_REVIEW_REQUIRED');if(product.bundle){if(BigInt(product.bundle.unitPrice.amountMinor)>=BigInt(product.effectivePrice.amountMinor)||BigInt(product.bundle.unitPrice.amountMinor)<2n)throw Error('PROMOTION_REVIEW_REQUIRED');}else promotionPrice(product.basePrice,product.effectivePrice,candidate.discountPercent,cap);return candidate;
}
export function samePromotionSnapshot(a:PromotionProductSnapshot,b:PromotionProductSnapshot){return a.productId===b.productId&&a.stock===b.stock&&a.priceVersion===b.priceVersion&&a.basePrice.currency===b.basePrice.currency&&a.basePrice.decimals===b.basePrice.decimals&&a.basePrice.amountMinor===b.basePrice.amountMinor&&a.effectivePrice.amountMinor===b.effectivePrice.amountMinor&&a.imageUrl===b.imageUrl&&JSON.stringify(a.bundle?.members.map(m=>[m.productId,m.stock,m.priceVersion,m.basePrice.amountMinor,m.effectivePrice.amountMinor,m.imageUrl]))===JSON.stringify(b.bundle?.members.map(m=>[m.productId,m.stock,m.priceVersion,m.basePrice.amountMinor,m.effectivePrice.amountMinor,m.imageUrl]));}
