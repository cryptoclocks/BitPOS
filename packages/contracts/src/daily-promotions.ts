import type {Money} from './index';
import type {PromotionAIContext,PromotionAudience} from './promotion-context';
import type {PersonalCampaignBinding} from './personal-promotions';
import type {PromotionDevice,PromotionCampaign} from './promotions';
export interface DailyPromotionLine {campaignId:string;campaignVersion:number;discountPercent:number;startsAt:string;expiresAt:string;}
export type PromotionPlacement={sourceCampaignId?:string;sourceVersion?:number;deviceIds:string[]}&({kind:'campaign_devices';tableId?:never;priceAuthority:'public'}|{kind:'table';tableId:string;priceAuthority:'table'|'personal'});
export interface PromotionScopeView {audience:PromotionAudience;context:PromotionAIContext;minimumUnitMinor:string;binding?:PersonalCampaignBinding;placement?:PromotionPlacement;priceAuthority?:'public'|'table'|'personal';pricePresentation?:'inherited_source'|'independent_discount';origin?:'generated'|'manual_derived'|'ai_regenerated';}
export interface PromotionBatchTarget {deviceId:string;assignmentGeneration:string;authGeneration:string;screenGeneration:string;}
export interface PromotionBatchPublish {expectedVersion:number;idempotencyKey:string;confirmTargets:true;targets:PromotionBatchTarget[];}
export interface PromotionDerive {language?:'th'|'en';expectedVersion:number;idempotencyKey:string;scope:'all_campaign_devices'|'this_table';mode:'edit'|'regenerate';device:PromotionBatchTarget;confirmScope:true;}
export interface PromotionDeviceProjection {device:PromotionDevice;playlist:DevicePromotionPlaylist;campaigns:PromotionCampaign[];}
export type PlaylistDeliveryState='QUEUED'|'DEFERRED_BUSY'|'DEFERRED_OFFLINE'|'DELIVERED'|'RENDERED'|'EXPIRED'|'REVOKED'|'TARGET_CHANGED'|'UNSUPPORTED';
export interface PlaylistCampaignTarget {id:string;campaignId:string;campaignVersion:number;deviceId:string;audience:'daily'|'personal';state:PlaylistDeliveryState;failure:string|null;renderedAt:string|null;}
export interface PlaylistPromotion {bundle?:boolean;discountLabel?:string;targetId:string;campaignId:string;campaignVersion:number;audience:'daily'|'personal';productId:string;headline:string;copy:string;unitPrice:Money;basePrice:Money;discountPercent:number;startsAt:string;expiresAt:string;image:{url:string;sha256:string;bytes:112000;width:280;height:200;format:'rgb565le'}|null;menuUrl:string|null;}
/** Extended screens support three shared/table and one personal item; legacy screens retain two plus one. Financial/pickup screens retain priority. */
export interface DevicePromotionPlaylist {generation:string;occupancyGeneration:string|null;tableId:string|null;state:'CURRENT';items:PlaylistPromotion[];}
