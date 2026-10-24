export * from './promotions';
export * from './table-visits';
export * from './daily-promotions';
export * from './personal-promotions';
import type {PersonalPromotionLine} from './personal-promotions';
import type {DailyPromotionLine} from './daily-promotions';
import type {DevicePromotionPlaylist} from './daily-promotions';
import type {ScopedPromotionLine,PromotionNotice} from './promotions';
import type {MobileConfiguredFoodSnapshot,MobileFoodDeliverySnapshot,FoodPreparationEstimate} from './mobile-v1.generated';
export type OrderStatus='AWAITING_WALLET'|'AWAITING_PAYMENT'|'CONFIRMING'|'PAID'|'EXPIRED'|'RECOVERY';
export type FoodDiscount={kind:'amount';amountMinor:string}|{kind:'percent';percent:number};
export interface ActiveFoodPromotion {revision:string;expiresAt:string;discount:FoodDiscount;}

export type Money =
 | {currency:'USD';decimals:2|4;amountMinor:string}
 | {currency:'THB';decimals:2;amountMinor:string}
 | {currency:'USDG'|'USDC'|'USDT';decimals:6;amountMinor:string};
export type Serving =
 | {kind:'table';tableId:string;label:string}
 | {kind:'counter'|'takeaway'|'legacy_unknown';label:string};
export type OrderSource =
 | {kind:'register';registerId:string;label:string}
 | {kind:'device';deviceId:string;label:string}
 | {kind:'online';accountId:string;branchId:string;channel:'customer_app';label:string}
 | {kind:'legacy_counter';label:string};
export type RoutedAuthority = {
 kind:'versioned';source:Extract<OrderSource,{kind:'register'|'device'}>;serving:Serving;
 target:{deviceId:string;assignmentGeneration:string};pairingGeneration:string|null;
};
export type OnlineAuthority = {
 kind:'versioned';source:Extract<OrderSource,{kind:'online'}>;
 serving:{kind:'pickup'|'delivery';label:string};target:null;pairingGeneration:null;
};
export type LegacyAuthority = {
 kind:'legacy';source:{kind:'legacy_counter';label:string};
 serving:{kind:'legacy_unknown';label:string};target:{legacyTerminalId:string};
};
export type OrderAuthority = RoutedAuthority|OnlineAuthority|LegacyAuthority;
export interface PaymentAsset {
 assetId:string;symbol:'USDG'|'USDC'|'USDT';displayLabel:string;cluster:'devnet';
 genesisHash:string;mint:string;tokenProgram:string;decimals:6;
 instructionPolicy:'token2022_zero_fee'|'spl_checked';issuerTestAsset:boolean;
}
export interface DenominationPolicy {id:string;numerator:string;denominator:string;}
export interface Settlement {
 currency:'USDG'|'USDC'|'USDT';decimals:6;amountMinor:string;network:'solana:devnet';
 genesisHash:string;mint:string;tokenProgram:string;testToken:true;recipient:string;
 sponsor:'merchant_funded';
 // Optional only for immutable pre-asset USDG history. New quotes always set these.
 assetId?:string;displayLabel?:string;denominationPolicy?:DenominationPolicy;
}
export interface PaymentAssetsView {
 selectedAssetId:string;canChange:boolean;assets:{asset:PaymentAsset;settlement:Settlement}[];
}
export interface PaymentAssetSelection {assetId:string;expectedVersion:number;idempotencyKey:string;}
export interface PaymentAssetSelectionResult {order:OrderView;replayed:boolean;}
export interface CartItem {productId:string;qty:number;}
export interface CollectionInstruction {kind:'table'|'counter';policyVersion:number;}
export interface RepeatCapView {asset:PaymentAsset;maxAtomic:string;expiresAt:string;}
export interface EffectiveLine {bundle?:import('./bundle-promotions').BundleLine;
 productId:string;name:string;nameEn:string;qty:number;priceVersion:string;
 basePrice:Money;unitPrice:Money;
 promotion:(ActiveFoodPromotion&{priceVersion:string})|null;
 scopedPromotion?:ScopedPromotionLine;
 personalPromotion?:PersonalPromotionLine;
 dailyPromotion?:DailyPromotionLine;
}
export interface Quote {
 id:string;priceVersion:string;pricingRevision:string;cartVersion:string|null;
 lines:EffectiveLine[];total:Money;settlement:Settlement;quotedAt:string;validUntil:string;
 collection?:CollectionInstruction;repeatCap?:RepeatCapView;delegationGrantId?:string;
}
export type FulfillmentStatus='RECEIVED'|'PREPARING'|'READY'|'COLLECTED';
export type PickupNotificationState='PENDING'|'DELIVERED'|'RENDERED'|'ACKNOWLEDGED'|'EXPIRED'|'CANCELED'|'TARGET_CHANGED'|'UNSUPPORTED';
export interface FulfillmentView {
 status:FulfillmentStatus;version:number;
 notification:null|{id:string;state:PickupNotificationState;targetDeviceId:string;assignmentGeneration:string;expiresAt:string};
 target:null|{deviceId:string;label:string;assignmentGeneration:string;tableLabel:string|null};
}
export interface PickupNotice {
 notificationId:string;orderId:string;pickupCode:string;expiresAt:string;
 effectId:string;sound:boolean;state:'READY'|'CANCELED';
}
export interface OrderView {
 id:string;status:OrderStatus;version:number;authority:OrderAuthority;payer:string|null;
 pricing:
  | {kind:'versioned';priceVersion:string;lines:EffectiveLine[];total:Money}
  | {kind:'legacy_thb';lines:EffectiveLine[];total:Money};
 settlement:Settlement;quoteExpiresAt:string;paymentUrl:string;
 paymentSignature?:string;
 closureReason?:'canceled'|'timeout'|null;canCancel?:boolean;
 fulfillment?:FulfillmentView;
 onlineAcceptance?:{status:'PENDING'|'ACCEPTED'|'REJECTED'|'TIMED_OUT';version:number;deadline:string;reason:string|null;eventSequence:string;preparation:FoodPreparationEstimate|null;refunds:{id:string;version:string;money:Money;status:string;cause:'LEGACY_REQUESTED'|'ONLINE_ACCEPTANCE_REJECTED'|'ONLINE_ACCEPTANCE_TIMED_OUT'}[]};
 collection?:CollectionInstruction;repeatCap?:RepeatCapView;delegationGrantId?:string;
 paymentQuoteId?:string;
 configuredFood?:MobileConfiguredFoodSnapshot;
 delivery?:MobileFoodDeliverySnapshot;
 configuredFoodLineCount?:number;
 tableOccupancyGeneration?:string;
}
export type Screen =
 | {kind:'idle';screenGeneration:string}
 | {kind:'cart';screenGeneration:string;sessionId:string;cartVersion:string;
    leaseUntil:string;items:CartItem[];review:Quote|null}
 | {kind:'order';screenGeneration:string;order:OrderView;canDismiss:boolean};
export type TableCommandError =
 | 'DEVICE_BUSY'|'DEVICE_OFFLINE'|'PRICE_VERSION_CHANGED'|'QUOTE_EXPIRED'
 | 'STOCK_UNAVAILABLE'|'ASSIGNMENT_CHANGED'|'PAIRING_CHANGED'|'CART_VERSION_CONFLICT'
 | 'LEASE_EXPIRED'|'IDEMPOTENCY_CONFLICT'|'COMMAND_CONFLICT'|'MENU_CHANGED'
 | 'QUOTE_CHANGED'|'PAIRING_CONFLICT'|'ORDER_NOT_RELEASABLE'|'PAYMENT_PENDING'
 | 'RECOVERY_REQUIRED'|'SETUP_REQUIRED'|'REGISTER_UNPAIRED'
 | 'TABLE_OCCUPANCY_CHANGED'|'TABLE_JOIN_CONFIRMATION_REQUIRED'|'TABLE_CLEAR_BLOCKED';
export type PriceConfiguration = {
 expectedRevision:string;catalogCurrency:'USD'|'USDG';catalogDecimals?:2|4|6;
 provenance:{kind:'owner_configured'}|{kind:'demo_configured';label:string};
 prices:{productId:string;unitMinor:string}[];
 settlement:{
  asset:'USDG';network:'solana:devnet';mint:string;tokenProgram:string;decimals:6;
  quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'|'USD_FIXED4_TO_USDG_1_TO_1'|'USDG_RAW_IDENTITY';
 };
};

export interface CounterCreate {
 idempotencyKey:string;quoteId:string;priceVersion:string;items:CartItem[];customerId?:string;
 serving:{kind:'table';tableId:string}|{kind:'counter'|'takeaway'};
}
export interface DeviceQuote {
 quoteId:string;priceVersion:string;cartVersion:string|null;total:Money;
 settlement:Settlement;validUntil:string;lineCount:number;pageCount:number;
}
export interface LinePage {
 quoteId:string;pageIndex:number;pageCount:number;lineCount:number;lines:EffectiveLine[];
}
export interface DeviceOrderView {
 id:string;status:OrderStatus;version:number;authority:RoutedAuthority|LegacyAuthority;total:Money;
 settlement:Settlement;quoteExpiresAt:string;paymentUrl:string;items:string[];
 lineCount:number;pageCount:number;quoteId:string|null;canDismiss:boolean;
 sound:boolean;effectId:string|null;
 canCancel?:boolean;
}
export type DeviceScreen =
 | {kind:'idle';screenGeneration:string}
 | {kind:'cart';screenGeneration:string;sessionId:string;cartVersion:string;
    leaseUntil:string;items:CartItem[];review:DeviceQuote|null}
 | {kind:'order';screenGeneration:string;order:DeviceOrderView;canDismiss:boolean};
export interface CatalogProduct {
 productId:string;catalogKey:string|null;name:string;nameEn:string;category:string|null;
 available:number;basePrice:Money;unitPrice:Money;
 promotion:(ActiveFoodPromotion&{priceVersion:string})|null;assetId:number|null;
 scopedPromotion?:ScopedPromotionLine;
 dailyPromotion?:DailyPromotionLine;
}
type CatalogPageBase = {
 menuVersion:string;generatedAt:string;validUntil:string;pageIndex:number;
 pageCount:number;productCount:number;assetManifestVersion:'bitpos-menu-v1';
};
export type CatalogPage = CatalogPageBase&(
 | {priceVersion:string;currency:'USD';decimals:2|4;products:CatalogProduct[]}
 | {priceVersion:string;currency:'USDG';decimals:6;products:CatalogProduct[]}
 | {priceVersion:null;currency:null;decimals:null;products:[]}
);
export interface DeviceConfig {
 merchantId:string;deviceId:string;label:string;tableId:string|null;tableLabel:string|null;
 assignmentGeneration:string;authGeneration:string;pairingGeneration:string|null;
 pairing:{registerId:string;pairingGeneration:string}|null;
 priceVersion:string|null;pricingReady:boolean;paymentOrigin:string;tableEntryUrl:string|null;
 limits:{cartLines:50;quantity:100;pageRows:4;inboundBytes:8191;outboundBytes:7168};
 heartbeatSeconds:30;leaseSeconds:120;
 capabilities?:('pickup_ready_v1'|'promotion_v1'|'promotion_playlist_v1'|'promotion_playlist_v2'|'promotion_bundle_v1')[];
 promotionPlaylist?:DevicePromotionPlaylist;
}
export interface RecoverableDraft {sessionId:string;cartVersion:string;items:CartItem[];}
type DeviceCommandEnvelope = {schemaVersion:2;requestId:string;connectionGeneration:string};
export type DeviceCommand = DeviceCommandEnvelope&(
 | {type:'CART_OPEN';sessionId:string;expectedScreenGeneration:string;
    expectedAssignmentGeneration:string;recoverSessionId:string|null;offerToken?:string}
 | {type:'CART_SET';sessionId:string;expectedCartVersion:string;
    expectedScreenGeneration:string;expectedAssignmentGeneration:string;items:CartItem[]}
 | {type:'CART_REVIEW';sessionId:string;cartVersion:string;
    expectedScreenGeneration:string;expectedPriceVersion:string}
 | {type:'ORDER_SUBMIT';sessionId:string;cartVersion:string;quoteId:string;
    priceVersion:string;idempotencyKey:string;expectedScreenGeneration:string}
 | {type:'CART_RELEASE';sessionId:string;cartVersion:string;expectedScreenGeneration:string}
 | {type:'ORDER_DISMISS';orderId:string;orderVersion:number;screenGeneration:string}
 | {type:'ORDER_CANCEL';orderId:string;orderVersion:number;screenGeneration:string}
 | {type:'SESSION_SYNC';pendingRequestId:string|null;pendingSubmissionKey:string|null;sessionId:string|null}
 | {type:'CATALOG_PAGE';menuVersion:string|null;pageIndex:number}
 | {type:'QUOTE_PAGE';quoteId:string;pageIndex:number}
 | {type:'HEARTBEAT';sessionId:string|null}
 | {type:'CAPABILITIES';capabilities:('pickup_ready_v1'|'promotion_v1'|'promotion_playlist_v1'|'promotion_playlist_v2'|'promotion_bundle_v1')[]}
 | {type:'PICKUP_ACK';notificationId:string;screenGeneration:string}
 | {type:'ACK';eventId:string;deviceSeq:string;orderId:string|null;orderVersion:number|null;
    screenGeneration:string;rendered:true}
);
export type BoundaryErrorCode =
 | 'CHAT_IMAGE_IN_USE'
 | 'CHAT_IMAGE_INVALID'|'CHAT_IMAGE_TOO_LARGE'|'CHAT_IMAGE_BUSY'|'CHAT_IMAGE_EXPIRED'|'CHAT_IMAGE_QUOTA'
 | 'CHAT_UNAVAILABLE'|'CHAT_RATE_LIMITED'|'CHAT_RETRY'
 | 'CURRENT_SESSION_REQUIRES_LOGOUT'
 | 'DEVICE_AUTH_INVALID'|'RESOURCE_NOT_FOUND'|'ROLE_REQUIRED'|'INVALID_REQUEST'
 | 'INVALID_ACK'|'FRAME_TOO_LARGE'|'DELIVERY_UNAVAILABLE'|'INVALID_PRICE'
 | 'INVALID_CURRENCY'|'CATALOG_INCOMPLETE'|'INVALID_QUANTITY'
 | 'AUTH_REQUIRED'|'REQUEST_TOO_LARGE'|'INVALID_TREASURY'|'CHALLENGE_EXPIRED'
 | 'INVALID_WALLET_PROOF'|'WALLET_CONFLICT'|'WALLET_PROOF_REQUIRED'|'ORDER_NOT_PAYABLE'
 | 'INVALID_TRANSACTION'|'INVALID_PAYMENT_PARTICIPANT'|'INSUFFICIENT_BALANCE'
 | 'PAYMENT_SIMULATION_FAILED'|'SPONSOR_RATE_LIMIT'|'SPONSOR_BUDGET_EXHAUSTED'
 | 'PAYMENT_UNAVAILABLE'|'INTERNAL_ERROR'|'PAYMENT_ASSET_UNAVAILABLE'|'PAYMENT_ASSET_VERSION_CONFLICT'
 | 'FULFILLMENT_VERSION_CONFLICT'|'FULFILLMENT_TRANSITION_INVALID'|'NOTIFICATION_TARGET_CHANGED'|'DEVICE_UNSUPPORTED'
 | 'NOTIFICATION_NOT_APPLICABLE'|'MERCHANT_ACCEPTANCE_REQUIRED'|'ACCEPTANCE_VERSION_CONFLICT'|'ACCEPTANCE_UNAVAILABLE'|'SERVING_UNAVAILABLE'
 | 'PROMOTION_VERSION_CONFLICT'|'PROMOTION_REVIEW_REQUIRED'|'PROMOTION_STATE_INVALID'|'PROMOTION_TARGET_CHANGED'
 | 'PROMOTION_OFFER_INVALID'|'PROMOTION_LIMIT_EXCEEDED'|'AI_BUDGET_EXHAUSTED'
 | 'COUNTER_COLLECTION_UNAVAILABLE'|'COLLECTION_POLICY_CHANGED'|'REPEAT_CAP_EXPIRED'|'REPEAT_CAP_EXCEEDED'|'REPEAT_SOURCE_UNAVAILABLE'
 | 'CONFIGURATION_REQUIRED'|'PROVIDER_OUTCOME_UNKNOWN'|'PROVIDER_RATE_LIMITED'|'PROVIDER_REJECTED'|'PROVIDER_RESPONSE_INVALID'|'PROVIDER_RESPONSE_TOO_LARGE'
 | 'VERSION_CONFLICT'|'ADDRESS_LIMIT'|'REFUND_PAGE_CHANGED'
 | 'DRIVER_SUSPENDED'|'DRIVER_DOCUMENT_EXPIRED'|'DRIVER_VERIFICATION_REQUIRED'
 | 'DISPATCH_AUTH_RETRY'|'DISPATCH_NOT_READY'|'DISPATCH_TRANSITION_INVALID'|'DRIVER_UNAVAILABLE'|'OFFER_PENDING'|'OFFER_UNAVAILABLE'
 | 'LOCATION_INVALID'|'LOCATION_STALE'|'LOCATION_RATE_LIMITED'|'LOCATION_SEQUENCE_CONFLICT'|'LOCATION_IMPLAUSIBLE'
 | 'PROOF_UNAVAILABLE'|'PROOF_ROTATION_REQUIRED'|'DRIVER_PICKUP_PROOF_REQUIRED'|'CUSTODY_RETAINED'
 | 'INCIDENT'|'INCIDENT_ACK_REQUIRED'|'INCIDENT_NOT_PAUSED'|'INCIDENT_ALREADY_ACKNOWLEDGED'
 | 'CANCELLATION_REVIEW_OPEN'|'CANCELLATION_REVIEW_CLOSED'
 | 'SETTLEMENT_AUTH_RETRY'|'SETTLEMENT_NOT_READY'|'BENEFICIARY_AUTHORITY_STILL_LIVE'
 | 'EMPTY_TRANSCRIPT'|'INVALID_AUDIO'|'AUDIO_DURATION_INVALID'|'COPILOT_STALE'|'AI_FREE_LIMIT';
export interface ConsumerError {
 code:TableCommandError|BoundaryErrorCode;message:string;retryable:boolean;details?:Record<string,unknown>;
}
export type DeviceResultValue =
 | {screen:DeviceScreen}
 | {quote:DeviceQuote;page:LinePage}
 | {order:DeviceOrderView;replayed:boolean}
 | {catalog:CatalogPage}
 | {page:LinePage}
 | {screen:DeviceScreen;recoverableDraft:RecoverableDraft|null;
    pendingResult:DeviceResult|null;pendingOrder:DeviceOrderView|null}
 | {acknowledged:true};
export type DeviceResult = {ok:true;value:DeviceResultValue}|{ok:false;error:ConsumerError};
export interface DeviceCommandResult {
 schemaVersion:2;type:'COMMAND_RESULT';requestId:string;connectionGeneration:string;
 screenGeneration:string;assignmentGeneration:string;result:DeviceResult;
}
type DeviceEventEnvelope = {
 schemaVersion:2;eventId:string;deviceId:string;deviceSeq:string;
 connectionGeneration:string;screenGeneration:string;occurredAt:string;
 assignmentGeneration?:string;
};
export type DeviceEvent = DeviceEventEnvelope&(
 | {type:'CONFIG';payload:DeviceConfig}
 | {type:'SNAPSHOT';payload:{screen:DeviceScreen;recoverableDraft:RecoverableDraft|null;promotionPlaylist?:DevicePromotionPlaylist}}
 | {type:'ORDER';payload:DeviceOrderView}
 | {type:'CATALOG';payload:CatalogPage}
 | {type:'CART';payload:DeviceScreen&{promotionPlaylist?:DevicePromotionPlaylist}}
 | {type:'PICKUP_READY';payload:PickupNotice}
 | {type:'PROMOTION';payload:PromotionNotice;assignmentGeneration:string;authGeneration:string}
 | {type:'PROMOTION_PLAYLIST';payload:DevicePromotionPlaylist;assignmentGeneration:string;authGeneration:string}
);
