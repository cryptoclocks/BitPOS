export type OrderStatus='AWAITING_WALLET'|'AWAITING_PAYMENT'|'CONFIRMING'|'PAID'|'EXPIRED'|'RECOVERY';
export type FoodDiscount={kind:'amount';amountMinor:string}|{kind:'percent';percent:number};
export interface ActiveFoodPromotion {revision:string;expiresAt:string;discount:FoodDiscount;}

export type Money =
 | {currency:'USD'|'THB';decimals:2;amountMinor:string}
 | {currency:'USDG';decimals:6;amountMinor:string};
export type Serving =
 | {kind:'table';tableId:string;label:string}
 | {kind:'counter'|'takeaway'|'legacy_unknown';label:string};
export type OrderSource =
 | {kind:'register';registerId:string;label:string}
 | {kind:'device';deviceId:string;label:string}
 | {kind:'legacy_counter';label:string};
export type OrderAuthority =
 | {kind:'versioned';source:Exclude<OrderSource,{kind:'legacy_counter'}>;serving:Serving;
    target:{deviceId:string;assignmentGeneration:string};pairingGeneration:string|null}
 | {kind:'legacy';source:{kind:'legacy_counter';label:string};
    serving:{kind:'legacy_unknown';label:string};target:{legacyTerminalId:string}};
export interface Settlement {
 currency:'USDG';decimals:6;amountMinor:string;network:'solana:devnet';
 genesisHash:string;mint:string;tokenProgram:string;testToken:true;recipient:string;
 sponsor:'merchant_funded';
}
export interface CartItem {productId:string;qty:number;}
export interface EffectiveLine {
 productId:string;name:string;nameEn:string;qty:number;priceVersion:string;
 basePrice:Money;unitPrice:Money;
 promotion:(ActiveFoodPromotion&{priceVersion:string})|null;
}
export interface Quote {
 id:string;priceVersion:string;pricingRevision:string;cartVersion:string|null;
 lines:EffectiveLine[];total:Money;settlement:Settlement;quotedAt:string;validUntil:string;
}
export interface OrderView {
 id:string;status:OrderStatus;version:number;authority:OrderAuthority;payer:string|null;
 pricing:
  | {kind:'versioned';priceVersion:string;lines:EffectiveLine[];total:Money}
  | {kind:'legacy_thb';lines:EffectiveLine[];total:Money};
 settlement:Settlement;quoteExpiresAt:string;paymentUrl:string;
 paymentSignature?:string;
 closureReason?:'canceled'|'timeout'|null;canCancel?:boolean;
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
 | 'RECOVERY_REQUIRED'|'SETUP_REQUIRED'|'REGISTER_UNPAIRED';
export type PriceConfiguration = {
 expectedRevision:string;catalogCurrency:'USD'|'USDG';
 provenance:{kind:'owner_configured'}|{kind:'demo_configured';label:string};
 prices:{productId:string;unitMinor:string}[];
 settlement:{
  asset:'USDG';network:'solana:devnet';mint:string;tokenProgram:string;decimals:6;
  quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'|'USDG_RAW_IDENTITY';
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
 id:string;status:OrderStatus;version:number;authority:OrderAuthority;total:Money;
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
}
type CatalogPageBase = {
 menuVersion:string;generatedAt:string;validUntil:string;pageIndex:number;
 pageCount:number;productCount:number;assetManifestVersion:'bitpos-menu-v1';
};
export type CatalogPage = CatalogPageBase&(
 | {priceVersion:string;currency:'USD';decimals:2;products:CatalogProduct[]}
 | {priceVersion:string;currency:'USDG';decimals:6;products:CatalogProduct[]}
 | {priceVersion:null;currency:null;decimals:null;products:[]}
);
export interface DeviceConfig {
 merchantId:string;deviceId:string;label:string;tableId:string|null;tableLabel:string|null;
 assignmentGeneration:string;pairingGeneration:string|null;
 pairing:{registerId:string;pairingGeneration:string}|null;
 priceVersion:string|null;pricingReady:boolean;paymentOrigin:string;tableEntryUrl:string|null;
 limits:{cartLines:50;quantity:100;pageRows:4;inboundBytes:8191;outboundBytes:7168};
 heartbeatSeconds:30;leaseSeconds:120;
}
export interface RecoverableDraft {sessionId:string;cartVersion:string;items:CartItem[];}
type DeviceCommandEnvelope = {schemaVersion:2;requestId:string;connectionGeneration:string};
export type DeviceCommand = DeviceCommandEnvelope&(
 | {type:'CART_OPEN';sessionId:string;expectedScreenGeneration:string;
    expectedAssignmentGeneration:string;recoverSessionId:string|null}
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
 | {type:'ACK';eventId:string;deviceSeq:string;orderId:string|null;orderVersion:number|null;
    screenGeneration:string;rendered:true}
);
export type BoundaryErrorCode =
 | 'DEVICE_AUTH_INVALID'|'RESOURCE_NOT_FOUND'|'ROLE_REQUIRED'|'INVALID_REQUEST'
 | 'INVALID_ACK'|'FRAME_TOO_LARGE'|'DELIVERY_UNAVAILABLE'|'INVALID_PRICE'
 | 'INVALID_CURRENCY'|'CATALOG_INCOMPLETE'|'INVALID_QUANTITY'
 | 'AUTH_REQUIRED'|'REQUEST_TOO_LARGE'|'INVALID_TREASURY'|'CHALLENGE_EXPIRED'
 | 'INVALID_WALLET_PROOF'|'WALLET_CONFLICT'|'WALLET_PROOF_REQUIRED'|'ORDER_NOT_PAYABLE'
 | 'INVALID_TRANSACTION'|'INVALID_PAYMENT_PARTICIPANT'|'INSUFFICIENT_BALANCE'
 | 'PAYMENT_SIMULATION_FAILED'|'SPONSOR_RATE_LIMIT'|'SPONSOR_BUDGET_EXHAUSTED'
 | 'PAYMENT_UNAVAILABLE'|'INTERNAL_ERROR';
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
};
export type DeviceEvent = DeviceEventEnvelope&(
 | {type:'CONFIG';payload:DeviceConfig}
 | {type:'SNAPSHOT';payload:{screen:DeviceScreen;recoverableDraft:RecoverableDraft|null}}
 | {type:'ORDER';payload:DeviceOrderView}
 | {type:'CATALOG';payload:CatalogPage}
 | {type:'CART';payload:DeviceScreen}
);
