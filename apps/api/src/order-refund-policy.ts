import {USDG_ASSET} from '../../../packages/domain/src/payment-assets';

// Limits for a store refund that the shop owner signs in their own wallet. The refund amount itself is bounded by the order's payment; these bound the network cost.
// 20_000 lamports covers the base fee with room; 4_000_000 covers the fee plus rent for creating the payer's token account when it does not exist yet.
export const OWNER_REFUND_MAX_FEE_LAMPORTS=20_000;
export const OWNER_REFUND_MAX_TOTAL_LAMPORTS=4_000_000;
/** A signed transaction is refused unless its blockhash stays valid for at least this many more blocks (about 12 s), so the worker can still broadcast it. */
export const OWNER_REFUND_MIN_VALID_BLOCKS=30;
export const ownerRefundPolicy=(sourceOwner:string,amountMinor:string)=>({allowedAssetIds:[USDG_ASSET.assetId],sourceOwner,feePayerOwner:sourceOwner,maxAmountMinor:amountMinor,maxFeeLamports:OWNER_REFUND_MAX_FEE_LAMPORTS,maxTotalLamports:OWNER_REFUND_MAX_TOTAL_LAMPORTS});
