// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// AI spending pass. A customer funds a pass in the bills contract for a fixed time (30 min, 1 hour, 1 day, 1 week,
// 1 month) with a cap, a per-bill limit and this café only. The AI agent pays exact open bills from it with a
// function-call key that can call `pass_pay` and nothing else. Refund rules are the contract's: an unserved
// witness bill or a merchant refund pays the pass owner back (never the agent), and closing the pass, or its
// expiry, returns the unspent balance. Whether a bill is paid is still decided only from the contract's state.
import crypto from 'node:crypto';
import {PASS_TTLS_MS,passMessage,type ChainPass,type PassTtl} from './chain';
import {NearRouteError,applyPayTx,nearDeps,record,settingsOf,latestBill,type BillView} from './bills';
import {pool,tenant} from '../db';
import {displayToUnits,unitsToDisplay} from './money';

const refuse=(status:number,code:string):never=>{throw new NearRouteError(status,code);};
export const PASS_MAX_CAP_UNITS=50_000_000n; // 50 tUSD on testnet
export interface PassView {owner:string;passId:string;agent:string;token:string;cap:string;balance:string;maxBill:string;merchant:string|null;expiresAtMs:number;createdAtMs:number;billsPaid:number;closed:boolean;expired:boolean;state:'ACTIVE'|'EXPIRED'|'CLOSED'}

function passView(p:ChainPass,now:number):PassView{
 const expired=now>Number(p.expires_at_ms);
 return {owner:p.owner,passId:p.pass_id,agent:p.agent,token:p.token,cap:unitsToDisplay(p.cap),balance:unitsToDisplay(p.balance),maxBill:unitsToDisplay(p.max_bill),
  merchant:p.merchant,expiresAtMs:Number(p.expires_at_ms),createdAtMs:Number(p.created_at_ms),billsPaid:p.bills_paid,closed:p.closed,expired,state:p.closed?'CLOSED':expired?'EXPIRED':'ACTIVE'};
}
async function context(token:string){
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');
 if(!d.config.agentAccount||!d.chain.hasKey(d.config.agentAccount,'pass'))refuse(404,'NEAR_AI_PASS_UNAVAILABLE');
 const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[token])).rows[0]?.merchant as string|undefined;
 if(!merchant)refuse(404,'RESOURCE_NOT_FOUND');
 const s=await tenant(merchant!,db=>settingsOf(db,merchant!));
 if(!s?.enabled||!s.near_account)refuse(409,'NEAR_NOT_ENABLED');
 return {d,merchant:merchant!,s:s!,agent:d.config.agentAccount!};
}

export async function passStatus(token:string,owner:string,passId:string):Promise<PassView>{
 const {d,s}=await context(token);
 const p=await d.chain.getPass(owner,passId);if(!p)refuse(404,'NEAR_PASS_NOT_FOUND');
 return passView(p!,(d.now?.()??Date.now()));
}

/** Demo wallets only (their testnet keys are on the server): funds a pass with a gasless payment, like demo-pay. */
export async function createPass(token:string,input:{wallet:string;ttl:PassTtl;cap:string;maxBill:string}):Promise<PassView>{
 const {d,s,agent}=await context(token);
 if(!d.config.demoWallets.includes(input.wallet)||!d.chain.hasKey(input.wallet))refuse(404,'RESOURCE_NOT_FOUND');
 const cap=displayToUnits(input.cap),maxBill=displayToUnits(input.maxBill);
 if(cap===null||maxBill===null||cap<=0n||maxBill<=0n||maxBill>cap||cap>PASS_MAX_CAP_UNITS)refuse(422,'NEAR_PASS_LIMIT_INVALID');
 if(d.chain.hasKey(s.token_contract)&&await d.chain.ftBalance(s.token_contract,input.wallet).catch(()=>cap!)<cap!)await d.chain.faucet(s.token_contract,input.wallet,cap!+20_000_000n).catch(()=>null);
 const passId=`p-${crypto.randomBytes(6).toString('hex')}`;
 const signed=await d.chain.signDemoPayment(input.wallet,s.token_contract,cap!,passMessage({passId,agent,ttlMs:PASS_TTLS_MS[input.ttl],maxBill:maxBill!,merchant:s.near_account}));
 const tx=await d.chain.relay(signed);
 if(!tx.ok||!tx.events.some(e=>e.event==='pass_created'&&e.data.pass_id===passId))refuse(409,'NEAR_PASS_NOT_CREATED');
 return passStatus(token,input.wallet,passId);
}

/** The AI agent pays this order's open bill from the pass. The contract enforces every limit; we check first to explain refusals. */
export async function passPay(token:string,owner:string,passId:string):Promise<BillView&{pass:PassView}>{
 const {d,merchant,s,agent}=await context(token);
 const p=await d.chain.getPass(owner,passId);if(!p)return refuse(404,'NEAR_PASS_NOT_FOUND');
 const view=passView(p,(d.now?.()??Date.now()));
 if(p.agent!==agent)refuse(403,'NEAR_PASS_OTHER_AGENT');
 if(view.state!=='ACTIVE')refuse(409,view.state==='CLOSED'?'NEAR_PASS_CLOSED':'NEAR_PASS_EXPIRED');
 if(p.merchant&&p.merchant!==s.near_account)refuse(409,'NEAR_PASS_MERCHANT_MISMATCH');
 const k=await tenant(merchant,async db=>{
  const o=(await db.query<{id:string}>('SELECT id FROM orders WHERE access_token=$1',[token])).rows[0];if(!o)refuse(404,'RESOURCE_NOT_FOUND');
  return latestBill(db,merchant,o!.id);
 });
 if(!k)return refuse(409,'NEAR_BILL_REQUIRED');
 if(k.status!=='OPEN')refuse(409,'NEAR_BILL_NOT_OPEN');
 if(k.token_contract!==p.token)refuse(409,'NEAR_PASS_WRONG_TOKEN');
 if(BigInt(k.amount_units)>BigInt(p.max_bill))refuse(409,'NEAR_PASS_BILL_LIMIT');
 if(BigInt(k.amount_units)>BigInt(p.balance))refuse(409,'NEAR_PASS_BALANCE_LOW');
 let tx;
 try{tx=await d.chain.passPay(agent,owner,passId,k.merchant_account,k.chain_bill_id);}
 catch(e){const reason=String((e as Error)?.message??e).match(/PASS_[A-Z_]+|BILL_[A-Z_]+|AGENT_ONLY|WRONG_TOKEN/)?.[0]??'PASS_PAY_FAILED';
  await tenant(merchant,db=>record(db,merchant,k.id,'PAYMENT_REFUSED',null,{reason,via:'ai_pass'}));return refuse(409,'NEAR_'+reason);}
 // The bill's own event trail records the payment (PAYMENT_RELAYED with this hash); the chain event names the pass.
 const bill=await applyPayTx(merchant,k.id,tx,d);
 return {...bill,pass:await passStatus(token,owner,passId)};
}

/** The owner ends the pass early (demo wallets only: the server holds their testnet keys). After expiry the relayer may close it for anyone. */
export async function closePass(token:string,owner:string,passId:string):Promise<PassView>{
 const {d,s,agent}=await context(token);
 const p=await d.chain.getPass(owner,passId);if(!p)return refuse(404,'NEAR_PASS_NOT_FOUND');
 if(p.agent!==agent)refuse(403,'NEAR_PASS_OTHER_AGENT');
 if(p.closed)return passView(p,(d.now?.()??Date.now()));
 const expired=(d.now?.()??Date.now())>Number(p.expires_at_ms);
 const signer=expired?d.config.relayerAccount:owner;
 if(!expired&&(!d.config.demoWallets.includes(owner)||!d.chain.hasKey(owner)))refuse(403,'NEAR_PASS_OWNER_MUST_CLOSE');
 const tx=await d.chain.passClose(signer,owner,passId);
 if(!tx.ok)refuse(409,'NEAR_PASS_CLOSE_FAILED');
 return passStatus(token,owner,passId);
}
