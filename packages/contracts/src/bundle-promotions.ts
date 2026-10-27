import {z} from 'zod';
import type {Money} from './index';
import type {PromotionProductSnapshot} from '../../domain/src/promotions';
export const bundleGeneration=z.object({unitMinor:z.string().regex(/^[1-9][0-9]*$/).max(18)}).strict();
export interface BundleSnapshot{members:PromotionProductSnapshot[];unitPrice:Money;discountLabel:string;}
export interface BundleOffer{id:string;version:number;name:string;nameEn:string;basePrice:Money;unitPrice:Money;discountLabel:string;members:{productId:string;qty:1;imageUrl:string|null}[];expiresAt:string;}
export interface BundleLine{campaignId:string;campaignVersion:number;pairUnitMinor:string;}
