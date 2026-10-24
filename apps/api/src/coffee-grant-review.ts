import type pg from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PaymentAsset,Settlement} from '../../../packages/contracts/src/index';
import {grantCapacity,type GrantPolicy} from '../../../packages/contracts/src/delegated-payments';
import {assetSettlement,assertAssetDescriptor,policyForPrecision} from '../../../packages/domain/src/payment-assets';
import {DEVNET_GENESIS} from '../../../packages/domain/src/index';
import {USDC_DEVNET_MINT,SPL_TOKEN_PROGRAM} from '../../../packages/domain/src/payment-assets';
import {customerOrigin} from './config';
import {fail} from './authority';
import type {QuoteRow} from './types';
export const grantReviewProof=z.object({sessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),grantId:z.string().uuid()}).strict();
export interface ReviewedPayment {asset:PaymentAsset;grantId:string;sessionId:string;expiresAt:string;}
type GrantRow={id:string;policy:GrantPolicy;spent:string;reserved:string;session_id:string;session_expires:Date};
function assertPolicy(g:GrantRow,merchant:string,settlement:Settlement){
 const p=g.policy;
 if(Date.parse(p.expiresAt)<=Date.now()||g.session_expires.getTime()<=Date.now()||p.merchantId!==merchant||p.domain!==customerOrigin||p.grantId!==g.id||p.mint!==USDC_DEVNET_MINT||p.tokenProgram!==SPL_TOKEN_PROGRAM||p.genesisHash!==DEVNET_GENESIS||p.decimals!==6||settlement.assetId!=='usdc-devnet'||settlement.mint!==p.mint||settlement.tokenProgram!==p.tokenProgram||settlement.genesisHash!==p.genesisHash||settlement.decimals!==p.decimals||settlement.recipient!==p.recipient||!grantCapacity(p.totalMinor,String(g.spent),String(g.reserved),settlement.amountMinor,p.perOrderMinor))fail('PAYMENT_ASSET_UNAVAILABLE',422);
}
export async function reviewedGrantPayment(db:pg.PoolClient,merchant:string,input:z.infer<typeof grantReviewProof>,q:QuoteRow):Promise<ReviewedPayment>{
 const proof=grantReviewProof.parse(input),hash=createHash('sha256').update(proof.sessionToken).digest('hex');
 const g=(await db.query<GrantRow>(`SELECT g.id,g.policy,g.spent::text,g.reserved::text,s.id AS session_id,s.expires_at AS session_expires FROM delegated_grants g JOIN delegated_owner_sessions s ON s.merchant_id=g.merchant_id AND s.owner=g.owner AND s.domain=$4 AND s.token_hash=$3 WHERE g.merchant_id=$1 AND g.id=$2 AND g.status='ACTIVE' AND g.approve_signature IS NOT NULL AND s.expires_at>clock_timestamp()`,[merchant,proof.grantId,hash,customerOrigin])).rows[0];
 if(!g||q.lines[0].unitPrice.currency!=='USD')fail('PAYMENT_ASSET_UNAVAILABLE',422);
 const accepted=(await db.query('SELECT r.descriptor,m.policy FROM merchant_payment_assets m JOIN payment_assets r ON r.asset_id=m.asset_id WHERE m.merchant_id=$1 AND m.asset_id=\'usdc-devnet\' AND m.enabled AND r.enabled AND r.verified_at IS NOT NULL',[merchant])).rows[0];
 if(!accepted)fail('PAYMENT_ASSET_UNAVAILABLE',422);assertAssetDescriptor(accepted.descriptor);
 const settlement=assetSettlement(accepted.descriptor,q.total_minor,policyForPrecision(accepted.policy,q.lines[0].unitPrice.decimals),q.treasury);assertPolicy(g,merchant,settlement);
 return {asset:accepted.descriptor,grantId:g.id,sessionId:g.session_id,expiresAt:new Date(Math.min(Date.parse(g.policy.expiresAt),g.session_expires.getTime())).toISOString()};
}
export async function validateReviewedGrant(db:pg.PoolClient,merchant:string,grantId:string,sessionId:string,settlement:Settlement){
 const g=(await db.query<GrantRow>(`SELECT g.id,g.policy,g.spent::text,g.reserved::text,s.id AS session_id,s.expires_at AS session_expires FROM delegated_grants g JOIN delegated_owner_sessions s ON s.merchant_id=g.merchant_id AND s.owner=g.owner AND s.id=$3 AND s.domain=$4 WHERE g.merchant_id=$1 AND g.id=$2 AND g.status='ACTIVE' AND g.approve_signature IS NOT NULL`,[merchant,grantId,sessionId,customerOrigin])).rows[0];
 if(!g)fail('PAYMENT_ASSET_UNAVAILABLE',422);assertPolicy(g,merchant,settlement);
}
