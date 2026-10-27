export interface PromotionSalesBucket {
 productId:string;weekday:number;window:'morning'|'afternoon'|'evening'|'night';orderCount:number;quantity:number;
}
export interface DailyPromotionContext {
 kind:'daily';timezone:string;lookbackWeeks:number;from:string;until:string;weekday:number;
 verifiedPaidOrderCount:number;sparseHistory:boolean;basis:'stock_first_sparse_history'|'verified_paid_sales_and_stock';
 buckets:PromotionSalesBucket[];
}
export type PromotionAudience='daily'|'customer'|'from_order';
export interface PersonalPromotionContext {
 kind:'customer'|'from_order';items:{productId:string;quantity:number;lastPurchasedDaysAgo:number|null}[];
 currentOrderItems:{productId:string;quantity:number}[];historyIncluded:boolean;historyBasis:'staff_confirmed_profile'|'verified_wallet_consent'|'current_order_only';
}
export type PromotionAIContext=DailyPromotionContext|PersonalPromotionContext;
