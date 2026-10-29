import {customerAvatar} from './customer-profile';
import {z} from 'zod';
import type {PersonalPromotionContext} from './promotion-context';
const id=z.string().uuid();
const generation=z.string().regex(/^[1-9][0-9]*$/).max(19).refine(v=>BigInt(v)<=9223372036854775807n);
export const personalTargetInput=z.object({tableId:id,occupancyGeneration:generation,recipientVisitId:id,customerId:id.optional(),sourceOrderId:id.optional(),confirmRecipient:z.literal(true)}).strict();
export type PersonalTargetInput=z.infer<typeof personalTargetInput>;
export interface VisitRecipientProof {sourceVisitToken?:string;customerSessionToken?:string;}
export interface PersonalPromotionLine {
 targetId:string;campaignId:string;campaignVersion:number;recipientId:string;occupancyId:string;occupancyGeneration:string;sessionId:string;discountPercent:number;expiresAt:string;
}
/** Server-private routing/identity evidence. Never send this to a model or public display. */
export interface PersonalCampaignBinding {
 tableId:string;occupancyId:string;occupancyGeneration:string;recipientId:string;recipientVisitId:string;
 targetDeviceId:string;assignmentGeneration:string;authGeneration:string;customerId:string|null;customerAuthSessionId:string|null;
 sourceOrderId:string|null;originBasis:'staff_recognition'|'verified_wallet_consent'|'private_paid_visit';excludedProductIds:string[];
}
export interface PersonalPromotionContextResult {context:PersonalPromotionContext;binding:PersonalCampaignBinding;excludedProductIds:string[];}
export const personalRecipientsView=z.object({
 tables:z.array(z.object({id,label:z.string(),generation,active:z.boolean(),device:z.object({id,assignmentGeneration:generation,authGeneration:generation}).nullable().optional(),guests:z.array(z.object({
  visitId:id,recipientId:id,customerId:id.nullable(),recognition:z.enum(['guest','staff_confirmed_profile','verified_wallet']),orderId:id.nullable(),deviceId:id
 }).strict())}).strict()),
 customers:z.array(z.object({id,name:z.string(),avatar:customerAvatar.optional(),walletLabel:z.string().nullable().optional(),paidOrders:z.number().int().nonnegative().optional(),avatarSeed:z.string().regex(/^[a-f0-9]{12}$/).optional()}).strict()),
 orders:z.array(z.object({id,tableId:id,occupancyGeneration:generation,recipientVisitId:id,targetDeviceId:id,items:z.array(z.object({productId:id,quantity:z.number().int().positive()}).strict())}).strict())
}).strict();
export type PromotionRecipientsView=z.infer<typeof personalRecipientsView>;
export const seatPromotionCustomer=z.object({tableId:id,customerId:id,expectedGeneration:generation,deviceId:id,assignmentGeneration:generation,authGeneration:generation,requestId:id,confirmPresent:z.literal(true)}).strict();
export type SeatPromotionCustomer=z.infer<typeof seatPromotionCustomer>;
