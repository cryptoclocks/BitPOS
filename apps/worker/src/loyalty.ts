import {Connection} from '@solana/web3.js';
import {pool,tenant} from '../../api/src/db';
import {badgeBalance,issueBadge,revokeBadge,type LoyaltySigners} from '../../api/src/loyalty-chain';

// "Regulars" badge lane (migration 180). The database row is the durable intent; the chain is the source of truth for "does the wallet hold it".
// Rule that makes retries and restarts safe: before ANY send, read the chain. A send whose outcome is unknown is settled by reading the chain, never by sending again.
export interface LoyaltyChainPort{
 balance(mint:string,wallet:string):Promise<bigint>;
 issue(mint:string,wallet:string):Promise<string|null>;   // signature, or null when the wallet already held it
 revoke(mint:string,wallet:string):Promise<string|null>;
}
export function createLoyaltyChain(s:LoyaltySigners):LoyaltyChainPort{
 return {
  balance:(mint,wallet)=>badgeBalance(s.connection,mint,wallet),
  issue:async(mint,wallet)=>{const r=await issueBadge(s,mint,wallet);return r.kind==='issued'?r.signature:null;},
  revoke:async(mint,wallet)=>{const r=await revokeBadge(s,mint,wallet);return r.kind==='revoked'?r.signature:null;}
 };
}
const code=(error:unknown)=>{const m=error instanceof Error?error.message:'';return /^LOYALTY_[A-Z_]+$/.test(m)?m:'LOYALTY_CHAIN_ERROR';};
interface Claimed{id:string;wallet_address:string;mint_address:string;previous_status:string;tier_slot:number}

export async function tickLoyaltyMerchant(merchant:string,chain:LoyaltyChainPort){
 const claimed=await tenant(merchant,async db=>{
  await db.query('SELECT bitpos.loyalty180_enqueue()');
  return (await db.query<Claimed>('SELECT * FROM bitpos.loyalty180_claim(10)')).rows;
 });
 const result={issued:0,confirmed:0,retry:0,revoked:0};
 for(const row of claimed){
  let signature:string|null=null,ok=false,error='';
  try{
   if(await chain.balance(row.mint_address,row.wallet_address)<1n)signature=await chain.issue(row.mint_address,row.wallet_address);
   ok=true;if(signature)result.issued++;
  }catch(e){
   error=code(e);
   // Unknown outcome: the send may have landed. Read the chain before deciding it failed.
   try{if(await chain.balance(row.mint_address,row.wallet_address)>=1n){ok=true;error='';}}catch{/* stays failed; retried later */}
  }
  await tenant(merchant,async db=>{const status=(await db.query<{s:string}>('SELECT bitpos.loyalty180_finish($1,$2,$3,$4) AS s',[row.id,ok,signature,error])).rows[0].s;if(status==='CONFIRMED')result.confirmed++;else result.retry++;});
 }
 const due=await tenant(merchant,async db=>(await db.query<Claimed>('SELECT * FROM bitpos.loyalty180_revoke_claim(10)')).rows);
 for(const row of due){
  let ok=false,error='';
  try{await chain.revoke(row.mint_address,row.wallet_address);ok=true;}
  catch(e){error=code(e);try{if(await chain.balance(row.mint_address,row.wallet_address)<1n){ok=true;error='';}}catch{/* retried later */}}
  await tenant(merchant,async db=>{await db.query('SELECT bitpos.loyalty180_revoke_finish($1,$2,$3)',[row.id,ok,error]);if(ok)result.revoked++;});
 }
 return result;
}
export async function tickLoyalty(chain:LoyaltyChainPort){
 const merchants=(await pool.query<{merchant_id:string}>('SELECT merchant_id FROM bitpos.loyalty180_merchants()')).rows;
 for(const m of merchants){try{await tickLoyaltyMerchant(m.merchant_id,chain);}catch{console.error('Loyalty badges unavailable for a merchant; durable state retained');}}
}
/** Configured only when the private key directory is set; otherwise the lane is simply absent (no signing capability exists). */
export async function createLoyaltyRuntime(){
 const dir=process.env.BITPOS_LOYALTY_KEY_DIR;if(!dir)return null;
 const {loadRoleKeypair,assertDevnet}=await import('../../api/src/loyalty-chain');
 const connection=new Connection('https://api.devnet.solana.com','confirmed');await assertDevnet(connection);
 return createLoyaltyChain({connection,payer:loadRoleKeypair(dir,'fee-sponsor'),issuer:loadRoleKeypair(dir,'reward-issuer')});
}
