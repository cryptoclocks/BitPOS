import type pg from 'pg';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import bs58 from 'bs58';
import {z} from 'zod';
import {audit,pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {customerOrigin} from './config';
import {MobileLoyaltyOverviewSchema,MobileLoyaltyConsentSchema,MobileLoyaltyBindCodeSchema,MobileLoyaltyConsentRequestSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {fail,requireRole,RequestError} from './authority';
import {verifyCustomerSignature} from './customer-auth';

// "Regulars" membership badges, step 1 (migration 180): tiers, consent and proven-wallet binding. Nothing in this file touches the chain.
const LOYALTY_REFUSALS=new Set(['LOYALTY_THRESHOLD_ORDER','LOYALTY_TIER_LOCKED','LOYALTY_PRICING_REQUIRED','LOYALTY_CURRENCY_MISMATCH','LOYALTY_WALLET_IN_USE']);
function boundary(error:unknown):never{
 if(error instanceof Error){
  if(LOYALTY_REFUSALS.has(error.message))throw new RequestError(409,'INVALID_REQUEST','Loyalty request refused',{loyaltyCode:error.message});
  if(error.message==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');
  if(error.message==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(error.message==='INVALID_REQUEST')throw new RequestError(422,'INVALID_REQUEST');
 }
 throw error;
}
const name=z.string().trim().min(1).max(40).refine(v=>![...v].some(c=>c.codePointAt(0)!<32||c.codePointAt(0)===127));
const tierBody=z.object({slot:z.number().int().min(1).max(3),nameTh:name,nameEn:name,minPoints:z.number().int().min(1).max(100000000),enabled:z.boolean()}).strict();

/** GET and PUT /api/settings/loyalty. Owner/manager only. Thresholds must rise with the slot; a tier that has issued a badge keeps its threshold. */
export async function loyaltySettings(db:pg.PoolClient,merchant:string,actor:string,role:string,method:string,input:unknown){
 requireRole(role);
 const view=async()=>({tiers:(await db.query('SELECT bitpos.loyalty180_tier_list() AS value')).rows[0].value as unknown[],stats:(await db.query('SELECT bitpos.loyalty180_repeat_stats() AS value')).rows[0].value as Record<string,number>});
 if(method==='GET')return view();
 if(method!=='PUT')fail('RESOURCE_NOT_FOUND',404);
 const data=tierBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 try{
  await db.query('SELECT bitpos.loyalty180_tier_save($1,$2,$3,$4,$5)',[data.data.slot,data.data.nameTh,data.data.nameEn,data.data.minPoints,data.data.enabled]);
 }catch(error){boundary(error);}
 await audit(db,merchant,actor,'loyalty.tier.configure',merchant);
 return view();
}

// ---- wallet binding challenge (stateless: the nonce is an HMAC, the message carries its own issue time) ----
export const LOYALTY_CHALLENGE_TTL_MS=10*60*1000;
export const LOYALTY_CONSENT_VERSION='loyalty-badge-2026-10';
const secret=()=>process.env.APP_SECRET??fail('INTERNAL_ERROR',500);
const nonceFor=(account:string,wallet:string,issuedAt:string)=>createHmac('sha256',secret()).update(`loyalty-bind|${account}|${wallet}|${issuedAt}`).digest('base64url').slice(0,43);
/** The exact text the wallet signs. It authorizes no payment or transfer and says so. */
export function loyaltyChallengeMessage(account:string,wallet:string,issuedAt:string){
 const expires=new Date(Date.parse(issuedAt)+LOYALTY_CHALLENGE_TTL_MS).toISOString();
 return ['BitPOS membership badge','Chain: solana:devnet',`Account: ${account}`,`Wallet: ${wallet}`,`Nonce: ${nonceFor(account,wallet,issuedAt)}`,`Issued: ${issuedAt}`,`Expires: ${expires}`,
  'Signing links this wallet to your BitPOS account so a membership badge can be sent to it. It does not authorize any payment, transfer or approval.'].join('\n');
}
const walletSchema=z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const isoSchema=z.string().datetime({offset:false});
const sigSchema=z.string().min(64).max(88).refine(v=>{try{return bs58.decode(v).length===64;}catch{return false;}});
const bindBody=z.object({wallet:walletSchema,issuedAt:isoSchema,signature:sigSchema}).strict();
/** Freshness + exact-challenge + strict ed25519 proof. Returns the hash that is stored; a refused proof never reaches SQL. */
function proveChallenge(account:string,wallet:string,issuedAt:string,signature:string,now:Date){
 const issued=Date.parse(issuedAt);
 if(!Number.isFinite(issued)||issued>now.getTime()+30_000||now.getTime()-issued>LOYALTY_CHALLENGE_TTL_MS)throw new RequestError(401,'AUTH_REQUIRED','Challenge expired');
 const message=loyaltyChallengeMessage(account,wallet,issuedAt);
 if(!verifyCustomerSignature(message,bs58.decode(signature),wallet))throw new RequestError(401,'AUTH_REQUIRED','Wallet proof refused');
 return createHash('sha256').update(message).digest('hex');
}
/** Verifies the wallet signature over the challenge, then stores the binding. */
export async function bindLoyaltyWallet(db:pg.PoolClient,account:string,session:string,input:unknown,now=new Date()){
 const data=bindBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const {wallet,issuedAt,signature}=data.data,hash=proveChallenge(account,wallet,issuedAt,signature,now);
 try{return (await db.query('SELECT bitpos.mobile_loyalty_bind_wallet($1,$2,$3,$4) AS value',[account,session,wallet,hash])).rows[0].value as {wallet:string;replayed:boolean};}
 catch(error){boundary(error);}
}
const consentBody=z.object({merchantId:z.string().uuid(),granted:z.boolean()}).strict();
export async function setLoyaltyConsent(db:pg.PoolClient,account:string,session:string,input:unknown){
 const data=consentBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 try{return (await db.query('SELECT bitpos.mobile_loyalty_consent($1,$2,$3,$4,$5) AS value',[account,session,data.data.merchantId,data.data.granted,LOYALTY_CONSENT_VERSION])).rows[0].value as {granted:boolean};}
 catch(error){boundary(error);}
}
export async function loyaltyProgress(db:pg.PoolClient,account:string,session:string,merchantId:string){
 if(!z.string().uuid().safeParse(merchantId).success)fail('INVALID_REQUEST',422);
 try{return (await db.query('SELECT bitpos.mobile_loyalty_progress($1,$2,$3) AS value',[account,session,merchantId])).rows[0].value as Record<string,unknown>;}
 catch(error){boundary(error);}
}

/**
 * GET /api/loyalty/verify?wallet=... (any staff role). Reads the CHAIN, not our tables, to answer "which Regulars badge does this wallet hold?".
 * `holds` is injectable so tests need no network; production passes finalized devnet reads.
 */
export async function verifyLoyaltyWallet(db:pg.PoolClient,role:string,url:URL,holds:(mint:string,wallet:string)=>Promise<boolean>){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const keys=[...url.searchParams.keys()];if(keys.length!==1||keys[0]!=='wallet')fail('INVALID_REQUEST',422);
 const wallet=walletSchema.safeParse(url.searchParams.get('wallet'));if(!wallet.success)fail('INVALID_REQUEST',422);
 const tiers=(await db.query('SELECT bitpos.loyalty180_tier_list() AS value')).rows[0].value as {slot:number;nameTh:string;nameEn:string;mintAddress:string|null;enabled:boolean}[];
 const held:{slot:number;nameTh:string;nameEn:string;mintAddress:string}[]=[];
 for(const t of tiers){if(!t.enabled||!t.mintAddress)continue;if(await holds(t.mintAddress,wallet.data))held.push({slot:t.slot,nameTh:t.nameTh,nameEn:t.nameEn,mintAddress:t.mintAddress});}
 return {wallet:wallet.data,source:'solana:devnet finalized',highest:held.length?held[held.length-1]:null,held};
}

// ---- one-time bind codes: the app shows a code, the customer proves the wallet on the web page ----
const ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const generateBindCode=()=>{const b=randomBytes(8);let c='';for(const x of b)c+=ALPHABET[x%32];return c.slice(0,4)+'-'+c.slice(4);};
const normalizeCode=(code:string)=>code.replace(/-/g,'').toUpperCase();
const codeHash=(code:string)=>createHash('sha256').update('loyalty-bind-code|'+normalizeCode(code)).digest('hex');
const codeSchema=z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{4}-?[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{4}$/);
export const LOYALTY_CODE_TTL_SECONDS=600;
export async function createLoyaltyBindCode(db:pg.PoolClient,account:string,session:string,origin:string){
 const code=generateBindCode();
 try{const expires=(await db.query('SELECT bitpos.mobile_loyalty_bind_code($1,$2,$3,$4) AS value',[account,session,codeHash(code),LOYALTY_CODE_TTL_SECONDS])).rows[0].value as Date;
  return {code,expiresAt:new Date(expires).toISOString(),bindUrl:`${origin}/loyalty?code=${code}`};}
 catch(error){boundary(error);}
}
const challengeBody=z.object({code:codeSchema,wallet:walletSchema}).strict();
const publicBindBody=z.object({code:codeSchema,wallet:walletSchema,issuedAt:isoSchema,signature:sigSchema}).strict();
async function codeAccount(db:pg.PoolClient,code:string){
 const row=(await db.query<{a:string|null}>('SELECT bitpos.loyalty180_code_account($1) AS a',[codeHash(code)])).rows[0].a;
 if(!row)throw new RequestError(401,'AUTH_REQUIRED','Code refused');
 return row;
}
/** Public (no session): POST /api/loyalty/bind/challenge returns the exact text to sign for the account that owns the code. */
export async function loyaltyBindChallenge(db:pg.PoolClient,input:unknown,now=new Date()){
 const data=challengeBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const account=await codeAccount(db,data.data.code),issuedAt=now.toISOString().replace(/\.\d+Z$/,'.000Z');
 return {issuedAt,message:loyaltyChallengeMessage(account,data.data.wallet,issuedAt)};
}
/** Public (no session): POST /api/loyalty/bind. The code selects the account; the wallet signature is what proves the wallet. Wrong proofs count against the code. */
export async function loyaltyBindWithCode(db:pg.PoolClient,input:unknown,now=new Date()){
 const data=publicBindBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const {code,wallet,issuedAt,signature}=data.data,account=await codeAccount(db,code);
 let hash:string;
 try{hash=proveChallenge(account,wallet,issuedAt,signature,now);}
 catch(error){await db.query('SELECT bitpos.loyalty180_code_failed($1)',[codeHash(code)]);throw error;}
 try{const r=(await db.query('SELECT bitpos.loyalty180_bind_with_code($1,$2,$3) AS value',[codeHash(code),wallet,hash])).rows[0].value as {wallet:string;replayed:boolean};return {wallet:r.wallet,replayed:r.replayed};}
 catch(error){boundary(error);}
}

// ---- mobile_v1 routes: GET /account/loyalty, POST /account/loyalty/consent, POST /account/loyalty/bind-code ----
async function inTransaction<T>(run:(db:pg.PoolClient)=>Promise<T>){
 const db=await pool.connect();
 try{await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}
 finally{db.release();}
}
export async function mobileLoyaltyRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname;
 if(path!=='/api/mobile/v1/account/loyalty'&&path!=='/api/mobile/v1/account/loyalty/consent'&&path!=='/api/mobile/v1/account/loyalty/bind-code')return undefined;
 const actor=await mobilePrincipal(bearer);
 if(url.search)fail('INVALID_REQUEST',422);
 if(path.endsWith('/consent')){
  if(method!=='POST')fail('INVALID_REQUEST',422);
  const data=MobileLoyaltyConsentRequestSchema.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
  return MobileLoyaltyConsentSchema.parse(await inTransaction(db=>setLoyaltyConsent(db,actor.accountId,actor.sessionId,data.data)));
 }
 if(path.endsWith('/bind-code')){
  if(method!=='POST')fail('INVALID_REQUEST',422);
  return MobileLoyaltyBindCodeSchema.parse(await inTransaction(db=>createLoyaltyBindCode(db,actor.accountId,actor.sessionId,customerOrigin)));
 }
 if(method!=='GET')fail('INVALID_REQUEST',422);
 try{const shops=(await pool.query('SELECT bitpos.mobile_loyalty_overview($1,$2) AS value',[actor.accountId,actor.sessionId])).rows[0].value as unknown[];
  return MobileLoyaltyOverviewSchema.parse({generatedAt:new Date().toISOString(),shops});}
 catch(error){boundary(error);}
}

/** Public routes (no session; the one-time code is the credential): POST /api/loyalty/bind/challenge and POST /api/loyalty/bind. */
export async function loyaltyPublicRequest(path:string,method:string,input:unknown){
 if(method!=='POST')fail('RESOURCE_NOT_FOUND',404);
 if(path==='/api/loyalty/bind/challenge')return inTransaction(db=>loyaltyBindChallenge(db,input));
 if(path==='/api/loyalty/bind'){
  // A refused proof must still persist its failure count, so the failure path commits instead of rolling back.
  const db=await pool.connect();
  try{await db.query('BEGIN');
   try{const r=await loyaltyBindWithCode(db,input);await db.query('COMMIT');return r;}
   catch(error){await db.query('COMMIT').catch(()=>undefined);throw error;}
  }finally{db.release();}
 }
 return undefined;
}
