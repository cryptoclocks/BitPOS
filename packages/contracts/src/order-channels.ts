// Order-channel contract: how an order that originates on a delivery platform (GrabFood, LINE MAN) is represented in BitPOS.
// Source of truth for the adapter boundary. NOTHING here is a provider endpoint, header or payload: those come only from
// documentation/credentials the provider issues to BitPOS (none received as of 2026-10-31), see docs/ORDER_CHANNELS_PLAN_TH.md.
// Three axes are kept apart on purpose:
//   orderSource       where the order was placed          (bitpos | grabfood | lineman)
//   paymentCollector  who collected the customer's money  (bitpos_solana | platform | cash_on_pickup)
//   deliveryProvider  who carries the food                (none | platform_rider | merchant_rider)
// A platform order is NEVER charged again through Solana checkout, and "platform collected" is not "merchant settled".

export const ORDER_SOURCES=['bitpos','grabfood','lineman'] as const;
export type OrderSource=typeof ORDER_SOURCES[number];
export type ExternalSource=Exclude<OrderSource,'bitpos'>;
export const isExternalSource=(v:string):v is ExternalSource=>v==='grabfood'||v==='lineman';

export const PAYMENT_COLLECTORS=['bitpos_solana','platform','cash_on_pickup'] as const;
export type PaymentCollector=typeof PAYMENT_COLLECTORS[number];
export const DELIVERY_PROVIDERS=['none','platform_rider','merchant_rider'] as const;
export type DeliveryProvider=typeof DELIVERY_PROVIDERS[number];

/** Link state of one merchant branch to one provider store. awaiting_provider_access = no documented API/credentials yet. */
export const LINK_STATES=['awaiting_provider_access','credentials_saved','credentials_missing','linked','disconnected','revoked'] as const;
export type LinkState=typeof LINK_STATES[number];
export const ENVIRONMENTS=['fixture','sandbox','production'] as const;
export type ChannelEnvironment=typeof ENVIRONMENTS[number];

/** What an adapter may do. Each flag is false until the provider's documentation AND granted scope confirm it. */
export interface ChannelCapabilities{
 receiveOrders:boolean;acceptReject:boolean;markReady:boolean;cancelOrder:boolean;
 listOrders:boolean;menuSync:boolean;itemAvailability:boolean;storeStatus:boolean;storeHours:boolean;
 /** Provider sends signed webhooks (otherwise orders must be polled via listOrders). */
 webhooks:boolean;
}
const NONE:ChannelCapabilities={receiveOrders:false,acceptReject:false,markReady:false,cancelOrder:false,listOrders:false,menuSync:false,itemAvailability:false,storeStatus:false,storeHours:false,webhooks:false};
/** Capabilities BitPOS may rely on today. GrabFood/LINE MAN are all-false until a provider sandbox proves otherwise. */
export function capabilitiesFor(source:ExternalSource,state:LinkState,env:ChannelEnvironment):ChannelCapabilities{
 void source;void env;
 // Deliberately constant: the SDK listing of GrabFood operations is not an entitlement. A future change must cite the
 // provider document and the granted scope before any flag flips, and must be tested against the provider sandbox.
 if(state!=='linked')return {...NONE};
 return {...NONE};
}

/** Raw provider status is stored verbatim; this normalised status is what BitPOS logic and the UI use. */
export const CHANNEL_ORDER_STATUSES=['received','accept_pending','accepted','preparing','ready','handed_over','completed','reject_pending','rejected','cancelled','expired','needs_attention'] as const;
export type ChannelOrderStatus=typeof CHANNEL_ORDER_STATUSES[number];
const RANK:Record<ChannelOrderStatus,number>={received:0,accept_pending:1,accepted:2,preparing:3,ready:4,handed_over:5,completed:6,reject_pending:1,rejected:9,cancelled:9,expired:9,needs_attention:-1};
const TERMINAL=new Set<ChannelOrderStatus>(['completed','rejected','cancelled','expired']);
export const isTerminalChannelStatus=(s:ChannelOrderStatus)=>TERMINAL.has(s);

/**
 * Decide the stored status after an incoming provider event. Out-of-order or duplicate events never move an order backwards,
 * and nothing leaves a terminal state. A pending command (accept_pending/reject_pending) is resolved only by a provider
 * confirmation event or reconciliation, never by the local timer.
 */
export function advanceChannelStatus(current:ChannelOrderStatus,incoming:ChannelOrderStatus):ChannelOrderStatus{
 if(current===incoming||isTerminalChannelStatus(current))return current;
 if(incoming==='needs_attention')return current;
 if(incoming==='cancelled'||incoming==='rejected'||incoming==='expired')return incoming;
 if(current==='needs_attention')return incoming;
 return RANK[incoming]>RANK[current]?incoming:current;
}

/** Money exactly as the provider states it: integer minor units + the provider's currency. Never converted to USD/USDG here. */
export interface ChannelMoney{currency:string;decimals:number;amountMinor:string}
export interface ChannelMoneyBreakdown{
 itemsGross:ChannelMoney;discounts:ChannelMoney;platformFee:ChannelMoney|null;tip:ChannelMoney|null;
 /** What the customer was charged by the platform (or must pay in cash). */
 customerPaid:ChannelMoney;
 /** What the merchant should receive after fees; null while the provider has not stated it. */
 merchantReceivable:ChannelMoney|null;
}
/** Settlement is its own fact: platform-collected money is "receivable" until the provider's settlement report says otherwise. */
export const SETTLEMENT_STATES=['not_applicable','receivable','settled','disputed'] as const;
export type SettlementState=typeof SETTLEMENT_STATES[number];

export interface ChannelOrderLine{
 /** Provider's own item id; the mapping to a BitPOS product is a separate, explicit record. */
 externalItemId:string;name:string;qty:number;unitPrice:ChannelMoney;
 externalModifiers:{externalId:string;name:string;qty:number;unitPrice:ChannelMoney}[];
 mappedProductId:string|null;
}
/** Immutable snapshot taken when the order first arrives; later menu/price edits never rewrite it. */
export interface ChannelOrderSnapshot{
 source:ExternalSource;environment:ChannelEnvironment;externalOrderId:string;externalStoreId:string;
 branchId:string;placedAt:string;lines:ChannelOrderLine[];money:ChannelMoneyBreakdown;
 paymentCollector:Exclude<PaymentCollector,'bitpos_solana'>;deliveryProvider:Exclude<DeliveryProvider,'none'>|'none';
 rawStatus:string;
}
/** A line is stock-eligible only when an owner-confirmed mapping exists. Name matching is never a mapping. */
export const unmappedLines=(lines:readonly ChannelOrderLine[])=>lines.filter(l=>l.mappedProductId===null);

/** Idempotency identity of an incoming event: one effect per (source, environment, store, order, provider event). */
export const channelEventKey=(e:{source:ExternalSource;environment:ChannelEnvironment;externalStoreId:string;externalOrderId:string;externalEventId:string})=>
 [e.source,e.environment,e.externalStoreId,e.externalOrderId,e.externalEventId].map(encodeURIComponent).join('|');
