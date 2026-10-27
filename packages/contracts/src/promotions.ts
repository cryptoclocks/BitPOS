import type {Money} from './index';
import type {PromotionAIContext,PromotionAudience} from './promotion-context';
import type {PlaylistCampaignTarget,PromotionScopeView} from './daily-promotions';
export type PromotionState='DRAFT'|'APPROVED'|'QUEUED'|'DELIVERED'|'RENDERED'|'EXPIRED'|'REVOKED'|'FAILED';
export type PromotionJobState='QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CONFIGURATION_REQUIRED';
export interface PromotionProvenance {kind:'provider'|'fixture_provider';provider:string;model:string;requestId:string;jobId:string;}
export interface PromotionImage {url:string;sha256:string;bytes:112000;width:280;height:200;format:'rgb565le';}
export interface PromotionTarget {id:string;campaignId:string;state:PromotionState;targetDeviceId:string;assignmentGeneration:string;authGeneration:string;screenGeneration:string;expiresAt:string;menuUrl:string;image:PromotionImage|null;previewUrl:string|null;failure:string|null;}
export interface PromotionCampaign {bundle?:import('./bundle-promotions').BundleSnapshot;id:string;version:number;approvedVersion?:number|null;state:PromotionState;productId:string;headline:string;copy:string;rationale:string;discountPercent:number;maxDiscountPercent:number;basePrice:Money;unitPrice:Money;priceVersion:string;stockSnapshot:number;startsAt:string;expiresAt:string;imageUrl:string|null;previewUrl:string|null;assetBlocker:string|null;provenance:PromotionProvenance;targets:PromotionTarget[];scope?:PromotionScopeView;playlistTargets?:PlaylistCampaignTarget[];}
export interface PromotionJob {id:string;state:PromotionJobState;blocker:string|null;campaignId:string|null;createdAt:string;provenance:PromotionProvenance|null;}
export interface PromotionDevice {deviceId:string;label:string;tableId:string|null;tableLabel:string|null;online:boolean;busy:boolean;capable:boolean;assignmentGeneration:string;authGeneration:string;screenGeneration:string;}
export interface PromotionsView {provider:{configured:boolean;blocker:string|null};jobs:PromotionJob[];campaigns:PromotionCampaign[];devices:PromotionDevice[];}
export interface PromotionGenerate {bundle?:{unitMinor:string};destination?:import('./promotion-destination').PromotionDestination;requestedDiscountPercent?:number;language?:'th'|'en';productIds:string[];goal:string;maxDiscountPercent:number;startsAt:string;expiresAt:string;idempotencyKey:string;audience:PromotionAudience;minimumUnitMinor:string;daily?:{timezone:string;lookbackWeeks:number};personal?:{tableId:string;occupancyGeneration:string;recipientVisitId:string;customerId?:string;sourceOrderId?:string;confirmRecipient:true};}
export interface PromotionMutation {expectedVersion:number;idempotencyKey:string;}
export interface PromotionEdit extends PromotionMutation {headline?:string;copy?:string;discountPercent?:number;startsAt?:string;expiresAt?:string;}
export interface PromotionNotice {targetId:string;campaignId:string;productId:string;headline:string;copy:string;discountPercent:number;unitPrice:Money;basePrice:Money;expiresAt:string;image:PromotionImage|null;menuUrl:string;state:'READY'|'CANCELED';}
/** Separate from global offer revision; immutable quote/order evidence, never a wallet instruction. */
export interface ScopedPromotionLine {targetId:string;campaignId:string;campaignVersion:number;sessionId:string;discountPercent:number;expiresAt:string;}
