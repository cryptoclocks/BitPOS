import type pg from 'pg';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
import {z} from 'zod';
import {pool,tenant} from './db';
import {config,customerOrigin} from './config';
import {fail,RequestError,routingLock} from './authority';
import {CUSTOMER_CONSENT_VERSION,customerAuthMessage,type CustomerAuthChallenge,type CustomerAuthIdentity,type CustomerAuthSession,type CustomerOrderContext} from '../../../packages/contracts/src/customer-auth';
import {bindOrderCustomer} from './personal-promotions';

const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const addressSchema=z.string().min(32).max(44).refine(value=>{try{return new PublicKey(value).toBase58()===value;}catch{return false;}});
const signatureSchema=z.string().min(64).max(88).refine(value=>{try{return bs58.decode(value).length===64;}catch{return false;}});
const consentSchema=z.object({version:z.literal(CUSTOMER_CONSENT_VERSION),profile:z.literal(true),purchaseHistory:z.literal(true)}).strict();
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const localOrigin=new URL(config.PUBLIC_URL);
const allowedOrigins:Record<string,true>={[customerOrigin]:true,...(['localhost','127.0.0.1','[::1]'].includes(localOrigin.hostname)?{[localOrigin.origin]:true}:{})};
function refuse(reason:string,status=401):never{throw new RequestError(status,'AUTH_REQUIRED','Customer authentication refused',{customerAuthCode:reason});}
/** Strict RFC8032 proof, rejecting noncanonical encodings/scalars and torsion keys/commitments. */
export function verifyCustomerSignature(message:string,signature:Uint8Array,walletAddress:string):boolean {
 try{
  if(signature.length!==64)return false;
  const publicKey=new PublicKey(walletAddress).toBytes();
  const owner=ed25519.Point.fromBytes(publicKey,false),commitment=ed25519.Point.fromBytes(signature.subarray(0,32),false);
  return !owner.isSmallOrder()&&owner.isTorsionFree()&&!commitment.isSmallOrder()&&commitment.isTorsionFree()
   &&ed25519.verify(signature,Buffer.from(message,'utf8'),publicKey,{zip215:false});
 }catch{return false;}
}
interface SessionRow {
 id:string;customer_id:string;wallet_address:string;consent_version:string;
 consent_purchase_history:boolean;origin:string;expires_at:Date;
}
interface ChallengeRow {
 id:string;wallet_address:string;origin:string;order_context:CustomerOrderContext;nonce:string;
 issued_at:Date;expires_at:Date;consent_version:typeof CUSTOMER_CONSENT_VERSION;message:string;
}
function identity(row:SessionRow):CustomerAuthIdentity {
 return {sessionId:row.id,customerId:row.customer_id,walletAddress:row.wallet_address,consentVersion:row.consent_version,consentedPurchaseContext:row.consent_purchase_history};
}
/** Caller must use a tenant transaction; the shared row lock serializes an authorized operation with revocation.
 * This authenticates a wallet only: never creates, joins or reopens an occupancy. */
export async function authenticateCustomerSession(db:pg.PoolClient,merchant:string,token:string):Promise<CustomerAuthIdentity> {
 if(!tokenSchema.safeParse(token).success)refuse('SESSION_INVALID');
 const row=(await db.query<SessionRow>(`SELECT s.id,s.customer_id,s.wallet_address,s.consent_version,s.consent_purchase_history,s.origin,s.expires_at
  FROM customer_auth_sessions s JOIN customer_wallets w
   ON w.merchant_id=s.merchant_id AND w.chain=s.chain AND w.address=s.wallet_address AND w.customer_id=s.customer_id
  WHERE s.merchant_id=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
   AND s.consent_profile AND s.consent_purchase_history AND s.consent_version=$3 FOR SHARE OF s`,[merchant,digest(token),CUSTOMER_CONSENT_VERSION])).rows[0];
 if(!row||!Object.hasOwn(allowedOrigins,row.origin))refuse('SESSION_EXPIRED_OR_REVOKED');
 return identity(row);
}
async function sessionView(db:pg.PoolClient,merchant:string,token:string,origin:string):Promise<CustomerAuthSession> {
 const authenticated=await authenticateCustomerSession(db,merchant,token);
 const row=(await db.query<SessionRow>('SELECT id,customer_id,wallet_address,consent_version,consent_purchase_history,origin,expires_at FROM customer_auth_sessions WHERE merchant_id=$1 AND id=$2',[merchant,authenticated.sessionId])).rows[0];
 if(row.origin!==origin)refuse('SESSION_ORIGIN_MISMATCH');
 return {...authenticated,merchantId:merchant,origin:row.origin,expiresAt:row.expires_at.toISOString()};
}

export async function customerAuthRequest(path:string,method:string,input:unknown,origin:string):Promise<unknown|undefined> {
 const route=path.match(/^\/api\/pay\/([A-Za-z0-9_-]{43})\/customer\/(challenge|verify|session|use|revoke)$/);
 if(!route)return undefined;
 if(method!=='POST')fail('RESOURCE_NOT_FOUND',404);
 if(!Object.hasOwn(allowedOrigins,origin))refuse('ORIGIN_MISMATCH',403);
 const access=route[1],operation=route[2];
 const merchant=(await pool.query<{merchant:string|null}>('SELECT bitpos.resolve_access($1) AS merchant',[access])).rows[0]?.merchant;
 if(!merchant)fail('RESOURCE_NOT_FOUND',404);
 return tenant(merchant,async db=>{
  // Read the private original bill and its immutable occupancy sidecar; do not bind or mutate payment/customer fields.
  const order=(await db.query<{id:string;request_hash:string;created_at:Date;occupancy_id:string|null;generation:string|null}>(`SELECT o.id,o.request_hash,o.created_at,b.occupancy_id,t.generation::text
   FROM orders o LEFT JOIN order_table_occupancies b ON b.merchant_id=o.merchant_id AND b.order_id=o.id
   LEFT JOIN table_occupancies t ON t.merchant_id=b.merchant_id AND t.id=b.occupancy_id
   WHERE o.merchant_id=$1 AND o.access_token=$2`,[merchant,access])).rows[0];
  if(!order)fail('RESOURCE_NOT_FOUND',404);
  if(operation==='challenge'){
   const {walletAddress}=z.object({walletAddress:addressSchema}).strict().parse(input);
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[merchant+':wallet:'+walletAddress]);
   const clock=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now;
   const challenge:Omit<CustomerAuthChallenge,'message'>={challengeId:randomUUID(),origin,merchantId:merchant,walletAddress,
    order:{orderId:order.id,requestHash:order.request_hash,createdAt:order.created_at.toISOString(),occupancyId:order.occupancy_id,occupancyGeneration:order.generation},
    nonce:randomBytes(32).toString('base64url'),issuedAt:clock.toISOString(),expiresAt:new Date(clock.getTime()+300000).toISOString(),consentVersion:CUSTOMER_CONSENT_VERSION};
   const message=customerAuthMessage(challenge);
   await db.query(`INSERT INTO customer_auth_challenges(merchant_id,id,order_id,wallet_address,origin,order_context,nonce,issued_at,expires_at,consent_version,message)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[merchant,challenge.challengeId,order.id,walletAddress,origin,challenge.order,challenge.nonce,challenge.issuedAt,challenge.expiresAt,challenge.consentVersion,message]);
   return {...challenge,message} satisfies CustomerAuthChallenge;
  }
  if(operation==='verify'){
   const body=z.object({challengeId:z.string().uuid(),walletAddress:addressSchema,signature:signatureSchema,consent:consentSchema}).strict().parse(input);
   // Wallet → challenge/session lock order also serializes consent verification with revocation.
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[merchant+':wallet:'+body.walletAddress]);
   const stored=(await db.query<ChallengeRow>(`SELECT id,wallet_address,origin,order_context,nonce,issued_at,expires_at,consent_version,message
    FROM customer_auth_challenges WHERE merchant_id=$1 AND id=$2 AND order_id=$3
     AND consumed_at IS NULL AND invalidated_at IS NULL AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE`,[merchant,body.challengeId,order.id])).rows[0];
   if(!stored)fail('CHALLENGE_EXPIRED',409);
   if(stored.origin!==origin||stored.wallet_address!==body.walletAddress)fail('INVALID_WALLET_PROOF',422);
   const canonical=customerAuthMessage({challengeId:stored.id,origin:stored.origin,merchantId:merchant,walletAddress:stored.wallet_address,
    order:stored.order_context,nonce:stored.nonce,issuedAt:stored.issued_at.toISOString(),expiresAt:stored.expires_at.toISOString(),consentVersion:stored.consent_version});
   if(stored.message!==canonical||!verifyCustomerSignature(canonical,bs58.decode(body.signature),stored.wallet_address))fail('INVALID_WALLET_PROOF',422);
   // Never relink the original order or replace another wallet/customer association.
   const consumed=await db.query(`UPDATE customer_auth_challenges SET consumed_at=clock_timestamp()
    WHERE merchant_id=$1 AND id=$2 AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,[merchant,stored.id]);
   if(!consumed.rowCount)fail('CHALLENGE_EXPIRED',409);
   let customerId=(await db.query<{customer_id:string}>("SELECT customer_id FROM customer_wallets WHERE merchant_id=$1 AND chain='solana:devnet' AND address=$2",[merchant,stored.wallet_address])).rows[0]?.customer_id;
   if(!customerId){
    customerId=(await db.query<{id:string}>('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;
    await db.query('INSERT INTO customer_wallets(merchant_id,customer_id,address) VALUES($1,$2,$3)',[merchant,customerId,stored.wallet_address]);
   }
   const sessionToken=randomBytes(32).toString('base64url');
   const row=(await db.query<SessionRow>(`WITH clock AS (SELECT clock_timestamp() AS now)
    INSERT INTO customer_auth_sessions(merchant_id,challenge_id,customer_id,wallet_address,origin,token_hash,consent_version,consent_profile,consent_purchase_history,consented_at,expires_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,true,true,now,now+interval '7 days' FROM clock
    RETURNING id,customer_id,wallet_address,consent_version,consent_purchase_history,origin,expires_at`,[merchant,stored.id,customerId,stored.wallet_address,origin,digest(sessionToken),body.consent.version])).rows[0];
   await bindOrderCustomer(db,merchant,order.id,sessionToken);
   return {...identity(row),merchantId:merchant,origin,expiresAt:row.expires_at.toISOString(),sessionToken};
  }
  if(operation==='use'){
   const {sessionToken,walletAddress}=z.object({sessionToken:tokenSchema,walletAddress:addressSchema}).strict().parse(input);
   await routingLock(db,merchant);
   const view=await sessionView(db,merchant,sessionToken,origin);
   if(view.walletAddress!==walletAddress)refuse('SESSION_WALLET_MISMATCH');
   // Explicit opt-in uses the original private recipient path; session restore
   // alone never changes identity, payment authority or table membership.
   await bindOrderCustomer(db,merchant,order.id,sessionToken);
   return view;
  }
  const {sessionToken}=z.object({sessionToken:tokenSchema}).strict().parse(input);
  if(operation==='session')return sessionView(db,merchant,sessionToken,origin);
  // Revocation is retryable even after session expiry/revocation. Possession is still checked; no profile/history deletion or SPL revoke.
  const current=(await db.query<{wallet_address:string;origin:string}>('SELECT wallet_address,origin FROM customer_auth_sessions WHERE merchant_id=$1 AND token_hash=$2',[merchant,digest(sessionToken)])).rows[0];
  if(!current||current.origin!==origin)refuse('SESSION_INVALID');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[merchant+':wallet:'+current.wallet_address]);
  const revocation=(await db.query<{revoked_at:Date|null}>('SELECT revoked_at FROM customer_auth_sessions WHERE merchant_id=$1 AND token_hash=$2 FOR UPDATE',[merchant,digest(sessionToken)])).rows[0];
  if(!revocation.revoked_at){
   await db.query('UPDATE customer_auth_sessions SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND wallet_address=$2 AND revoked_at IS NULL',[merchant,current.wallet_address]);
   await db.query('UPDATE customer_auth_challenges SET invalidated_at=clock_timestamp() WHERE merchant_id=$1 AND wallet_address=$2 AND consumed_at IS NULL AND invalidated_at IS NULL',[merchant,current.wallet_address]);
  }
  return {revoked:true,scope:'merchant-wallet'};
 });
}
