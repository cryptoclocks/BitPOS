// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Customer payment of an existing BitPOS bill (access token) through the Living Bill contract on NEAR:
// open the on-chain bill from the frozen quote, relay the customer's gasless payment, and settle only from what the
// contract says at final finality. Never holds a database lock across a chain call: each step is
// lock → decide → commit, then the chain, then lock again.
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {pool,tenant} from '../db';
import {RequestError} from '../authority';
import {liveOrder} from '../../../../packages/domain/src/index';
import {assertOnlinePaymentAuthorization} from '../online-acceptance-policy';
import {publishSettlementRow} from '../orders';
import type {OrderRow} from '../types';
import {NearConfigError,nearConfig,type NearConfig} from './config';
import {payMessage,realChain,type NearChain,type TxView} from './chain';
import {toUnits,unitsToDisplay} from './money';
import {computePayouts,MAX_INVOICES,MAX_STAFF,type PlannedPayout} from './recipe';
import {payTxFacts,refuseDelegate,verifyChainBill,type ChainVerdict,type ExpectedBill} from './verify';

export class NearRouteError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
const refuse=(status:number,code:string):never=>{throw new NearRouteError(status,code);};

export interface NearDeps {config:NearConfig;chain:NearChain;now?:()=>number}
let deps:NearDeps|null|undefined;
/** Tests inject a stub chain; production reads the testnet config from the environment once. */
export function setNearDeps(d:NearDeps|null|undefined){deps=d;}
export function nearDeps():NearDeps|null{
 if(deps===undefined){try{const config=nearConfig();deps={config,chain:realChain(config)};}catch(e){if(e instanceof NearConfigError)deps=null;else throw e;}}
 return deps;
}
const MIN_CREATE_MS=120_000;
export const LIVE=['OPENING','OPEN','ESCROW','SETTLING','PAYOUT_FAILED'];
const HELD=['ESCROW','SETTLING','PAYOUT_FAILED'];

export interface BillRow {merchant_id:string;id:string;order_id:string;quote_id:string;order_version:number;chain_bill_id:string;contract:string;merchant_account:string;token_contract:string;
 amount_units:string;witness_device_id:string|null;witness_pk:string|null;witness_timeout_ms:number;status:string;payer:string|null;open_tx:string|null;pay_tx:string|null;ack_tx:string|null;
 settle_tx:string|null;refund_tx:string|null;last_issue:string|null;attempts:number;paid_at:Date|null;created_at:Date;expires_at:Date;}
export interface PayoutRow {seq:number;role:PlannedPayout['role'];label:string;near_account:string;amount_units:string;recipient_id:string|null;invoice_id:string|null;paid:boolean}
export interface SettingsRow {merchant_id:string;enabled:boolean;near_account:string;token_contract:string;token_symbol:string;token_decimals:number;tax_bps:number;tips_bps:number;
 witness_device_id:string|null;witness_timeout_s:number;max_bill_units:string}

export type BillStatus='none'|'opening'|'awaiting_payment'|'escrow'|'settling'|'paid'|'recovery'|'payout_failed'|'refunded'|'void'|'failed'|'mismatch';
export interface BillView {status:BillStatus;billId:string|null;contract:string|null;merchantAccount:string|null;token:string|null;amount:{units:string;display:string}|null;
 witness:boolean;witnessDeadline:string|null;payer:string|null;payMessage:string|null;
 payouts:{role:string;label:string;account:string;amount:string;paid:boolean}[];
 tx:{open:string|null;pay:string|null;witness:string|null;settle:string|null;refund:string|null};issue:string|null}

export const billsBy=(db:pg.PoolClient,where:string,args:unknown[])=>db.query<BillRow>(`SELECT * FROM near_bills WHERE ${where}`,args);
export const payoutsOf=async(db:pg.PoolClient,merchant:string,bill:string)=>(await db.query<PayoutRow>('SELECT seq,role,label,near_account,amount_units::text,recipient_id,invoice_id,paid FROM near_payouts WHERE merchant_id=$1 AND bill_id=$2 ORDER BY seq',[merchant,bill])).rows;
export const lockBill=(db:pg.PoolClient,merchant:string,id:string)=>db.query<BillRow>('SELECT * FROM near_bills WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id]).then(r=>r.rows[0]);
export const settingsOf=async(db:pg.PoolClient,merchant:string)=>(await db.query<SettingsRow>('SELECT merchant_id,enabled,near_account,token_contract,token_symbol,token_decimals,tax_bps,tips_bps,witness_device_id,witness_timeout_s,max_bill_units::text FROM near_merchant_settings WHERE merchant_id=$1',[merchant])).rows[0];
export const expectedOf=(k:BillRow,payouts:PayoutRow[]):ExpectedBill=>({contract:k.contract,merchantAccount:k.merchant_account,chainBillId:k.chain_bill_id,token:k.token_contract,units:BigInt(k.amount_units),witnessPk:k.witness_pk,
 payouts:payouts.map(p=>({account:p.near_account,amount:BigInt(p.amount_units),role:p.role}))});
/** Evidence timeline entry. A transaction is recorded once per bill and kind. */
export async function record(db:pg.PoolClient,merchant:string,bill:string,kind:string,tx:string|null,detail:Record<string,unknown>={}){
 await db.query('INSERT INTO near_bill_events(merchant_id,bill_id,kind,tx_hash,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[merchant,bill,kind,tx,JSON.stringify(detail)]);
}

export function billView(k:BillRow|undefined,order:{status:string},payouts:PayoutRow[]=[]):BillView{
 if(!k)return {status:'none',billId:null,contract:null,merchantAccount:null,token:null,amount:null,witness:false,witnessDeadline:null,payer:null,payMessage:null,payouts:[],tx:{open:null,pay:null,witness:null,settle:null,refund:null},issue:null};
 const map:Record<string,BillStatus>={OPENING:'opening',OPEN:'awaiting_payment',ESCROW:'escrow',SETTLING:'settling',SETTLED:order.status==='PAID'?'paid':'recovery',PAYOUT_FAILED:'payout_failed',REFUNDED:'refunded',VOID:'void',FAILED_OPEN:'failed',MISMATCH:'mismatch'};
 return {status:map[k.status]??'settling',billId:k.chain_bill_id,contract:k.contract,merchantAccount:k.merchant_account,token:k.token_contract,
  amount:{units:k.amount_units,display:unitsToDisplay(k.amount_units)},witness:k.witness_pk!==null,
  witnessDeadline:k.witness_pk&&k.paid_at&&HELD.includes(k.status)?new Date(k.paid_at.getTime()+k.witness_timeout_ms).toISOString():null,
  payer:k.payer,payMessage:k.status==='OPEN'?payMessage(k.merchant_account,k.chain_bill_id):null,
  payouts:payouts.map(p=>({role:p.role,label:p.label,account:p.near_account,amount:unitsToDisplay(p.amount_units),paid:p.paid})),
  tx:{open:k.open_tx,pay:k.pay_tx,witness:k.ack_tx,settle:k.settle_tx,refund:k.refund_tx},
  issue:['FAILED_OPEN','MISMATCH','PAYOUT_FAILED','REFUNDED','VOID'].includes(k.status)?k.last_issue:null};
}

async function merchantFor(token:string){
 const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[token])).rows[0]?.merchant as string|undefined;
 if(!merchant)refuse(404,'RESOURCE_NOT_FOUND');return merchant!;
}
async function lockOrder(db:pg.PoolClient,token:string){
 const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1 FOR UPDATE',[token])).rows[0];
 if(!o)refuse(404,'RESOURCE_NOT_FOUND');return o!;
}
/** The bill a page should show for an order: the live one, else the settled one, else the newest. */
export async function latestBill(db:pg.PoolClient,merchant:string,orderId:string){
 return (await billsBy(db,"merchant_id=$1 AND order_id=$2 ORDER BY (status=ANY($3)) DESC,(status='SETTLED') DESC,created_at DESC LIMIT 1",[merchant,orderId,LIVE])).rows[0];
}
async function currentView(db:pg.PoolClient,merchant:string,order:OrderRow){
 const k=await latestBill(db,merchant,order.id);return billView(k,order,k?await payoutsOf(db,merchant,k.id):[]);
}

/** GET: everything the pay page needs to show NEAR for this bill. No chain call. */
export async function nearStatus(token:string){
 const d=nearDeps();const merchant=await merchantFor(token);
 return tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1',[token])).rows[0];if(!o)refuse(404,'RESOURCE_NOT_FOUND');
  const s=await settingsOf(db,merchant);
  const a=(await db.query<{total_minor:string;catalog_currency:string;catalog_decimals:number}>('SELECT total_minor::text,catalog_currency,catalog_decimals FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,o!.id])).rows[0];
  const units=a&&a.catalog_currency==='USD'?toUnits(a.total_minor,a.catalog_decimals):null;
  const shop=(await db.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchant])).rows[0]?.name??'';
  // nearShop: the shop takes NEAR only, even when this bill cannot be paid right now. enabled: the rail is configured
  // and this bill's total is exact in token units.
  return {nearShop:!!s?.enabled,enabled:!!(d&&s?.enabled&&units!==null),network:'testnet' as const,shopName:shop,orderStatus:o!.status,quoteExpiresAt:new Date(o!.quote_expires_at).toISOString(),
   contract:d?.config.billsContract??null,relayer:d?.config.relayerAccount??null,explorerTx:d?.config.explorerTx??null,
   merchantAccount:s?.near_account??null,token:s?{contract:s.token_contract,symbol:s.token_symbol,decimals:s.token_decimals}:null,
   amount:units===null?null:{units:units.toString(),display:unitsToDisplay(units)},
   demoWallets:d&&s?.enabled?d.config.demoWallets.filter(w=>d.chain.hasKey(w)):[],
   bill:await currentView(db,merchant,o!)};
 });
}

/** Who the next bill pays. Runs under the order lock; invoices are locked so two bills cannot over-collect one. */
async function planPayouts(db:pg.PoolClient,merchant:string,s:SettingsRow,total:bigint,shopName:string):Promise<PlannedPayout[]>{
 const tax=(await db.query<{id:string;near_account:string;label:string}>("SELECT id,near_account,label FROM near_recipients WHERE merchant_id=$1 AND kind='tax' AND active",[merchant])).rows[0];
 const staff=(await db.query<{id:string;near_account:string;label:string;weight:number}>("SELECT id,near_account,label,weight FROM near_recipients WHERE merchant_id=$1 AND kind='staff' AND active AND on_shift_since IS NOT NULL ORDER BY on_shift_since,id LIMIT $2",[merchant,MAX_STAFF])).rows;
 const invoices=(await db.query<{id:string;recipient_id:string;near_account:string;label:string;reference:string;total_units:string;funded_units:string;rate_bps:number;reserved:string}>(
  `SELECT i.id,i.recipient_id,r.near_account,r.label,i.reference,i.total_units::text,i.funded_units::text,i.rate_bps,
    coalesce((SELECT sum(p.amount_units) FROM near_payouts p JOIN near_bills b ON b.merchant_id=p.merchant_id AND b.id=p.bill_id
      WHERE p.merchant_id=i.merchant_id AND p.invoice_id=i.id AND NOT p.paid AND b.status=ANY($2)),0)::text AS reserved
   FROM near_supplier_invoices i JOIN near_recipients r ON r.merchant_id=i.merchant_id AND r.id=i.recipient_id
   WHERE i.merchant_id=$1 AND i.status='OPEN' AND r.active ORDER BY i.created_at,i.id LIMIT $3 FOR UPDATE OF i`,[merchant,LIVE,MAX_INVOICES])).rows;
 return computePayouts({total,owner:{account:s.near_account,label:shopName.slice(0,60)||'Owner'},taxBps:s.tax_bps,tax:tax?{id:tax.id,account:tax.near_account,label:tax.label}:null,tipsBps:s.tips_bps,
  staff:staff.map(r=>({id:r.id,account:r.near_account,label:r.label,weight:r.weight})),
  invoices:invoices.map(i=>({id:i.id,recipientId:i.recipient_id,account:i.near_account,label:`${i.label} · ${i.reference}`.slice(0,60),remaining:BigInt(i.total_units)-BigInt(i.funded_units)-BigInt(i.reserved),rateBps:i.rate_bps}))});
}

/** POST bill: one live bill per order; replays return it. The browser never sends an amount or a recipient. */
export async function createNearBill(token:string):Promise<BillView>{
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const now=d.now??Date.now;const merchant=await merchantFor(token);
 const prepared=await tenant(merchant,async db=>{
  const o=await lockOrder(db,token);const s=await settingsOf(db,merchant);
  if(!s?.enabled)refuse(409,'NEAR_NOT_ENABLED');
  const existing=(await billsBy(db,'merchant_id=$1 AND order_id=$2 AND status=ANY($3) FOR UPDATE',[merchant,o.id,LIVE])).rows[0];
  if(existing&&existing.status!=='OPENING')return {done:billView(existing,o,await payoutsOf(db,merchant,existing.id))};
  if(existing)return {k:existing,o,payouts:await payoutsOf(db,merchant,existing.id)};
  if((await db.query("SELECT 1 FROM near_bills WHERE merchant_id=$1 AND order_id=$2 AND status='SETTLED'",[merchant,o.id])).rowCount)return {done:await currentView(db,merchant,o)};
  try{liveOrder(o,now());}catch{refuse(409,'ORDER_NOT_PAYABLE');}
  await assertOnlinePaymentAuthorization(db,o);
  if(new Date(o.quote_expires_at).getTime()-now()<MIN_CREATE_MS)refuse(409,'QUOTE_EXPIRING');
  if((await db.query("SELECT 1 FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 AND status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')",[merchant,o.id])).rowCount)refuse(409,'PAYMENT_PENDING');
  const a=(await db.query<{quote_id:string;total_minor:string;catalog_currency:string;catalog_decimals:number}>('SELECT quote_id,total_minor::text,catalog_currency,catalog_decimals FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,o.id])).rows[0];
  if(!a||a.catalog_currency!=='USD')refuse(409,'NEAR_CURRENCY_UNSUPPORTED');
  const units=toUnits(a!.total_minor,a!.catalog_decimals)??refuse(409,'NEAR_AMOUNT_NOT_EXACT');
  if(units>BigInt(s.max_bill_units))refuse(409,'NEAR_AMOUNT_TOO_LARGE');
  const shop=(await db.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchant])).rows[0]?.name??'Owner';
  let plan:PlannedPayout[];try{plan=await planPayouts(db,merchant,s,units,shop);}catch(e){if(e instanceof RangeError)refuse(409,'NEAR_RECIPE_INVALID');throw e;}
  // With a witness device the money waits in the contract until that device signs; without one it splits at once.
  const witness=s.witness_device_id?(await db.query<{id:string;public_key_hex:string|null}>('SELECT id,public_key_hex FROM near_devices WHERE merchant_id=$1 AND id=$2 AND active',[merchant,s.witness_device_id])).rows[0]:undefined;
  if(s.witness_device_id&&!witness?.public_key_hex)refuse(409,'NEAR_WITNESS_NOT_READY');
  const id=randomUUID();
  // next_check_at: the reconcile worker leaves a freshly inserted row to this request for a few seconds.
  const k=(await db.query<BillRow>(`INSERT INTO near_bills(merchant_id,id,order_id,quote_id,order_version,chain_bill_id,contract,merchant_account,token_contract,amount_units,witness_device_id,witness_pk,witness_timeout_ms,expires_at,next_check_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp()+interval '15 seconds') RETURNING *`,[merchant,id,o.id,a!.quote_id,o.version,'b'+id.replaceAll('-',''),d.config.billsContract,s.near_account,s.token_contract,units.toString(),
   witness?.id??null,witness?.public_key_hex??null,s.witness_timeout_s*1000,o.quote_expires_at])).rows[0];
  for(const [seq,p] of plan!.entries())await db.query('INSERT INTO near_payouts(merchant_id,bill_id,seq,role,label,near_account,amount_units,recipient_id,invoice_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[merchant,id,seq,p.role,p.label,p.account,p.amount.toString(),p.recipientId,p.invoiceId]);
  return {k,o,payouts:await payoutsOf(db,merchant,id)};
 });
 if('done' in prepared)return prepared.done!;
 return openOnChain(merchant,prepared.k,prepared.payouts,d);
}

/** Sends `open_bill` for an OPENING row and records the answer. Safe to repeat: the contract refuses a second bill with the same id. */
export async function openOnChain(merchant:string,k:BillRow,payouts:PayoutRow[],d:NearDeps):Promise<BillView>{
 let tx:TxView|null=null,issue:string|null=null,exists=false;
 try{
  // Every recipient must be able to hold the token, or the whole split would fail later. The relayer pays the storage.
  for(const account of new Set(payouts.map(p=>p.near_account)))if(!await d.chain.isRegistered(k.token_contract,account))await d.chain.register(k.token_contract,account);
  tx=await d.chain.openBill(k.merchant_account,{billId:k.chain_bill_id,token:k.token_contract,total:BigInt(k.amount_units),payouts:payouts.map(p=>({account:p.near_account,amount:BigInt(p.amount_units),role:p.role})),
   expiresAtMs:k.expires_at.getTime(),witnessPk:k.witness_pk,witnessTimeoutMs:k.witness_timeout_ms});
  if(!tx.ok)issue=tx.failures[0]??'OPEN_FAILED';
 }catch(e){issue=String((e as Error)?.message??e).slice(0,160);}
 if(issue&&/BILL_EXISTS/.test(issue)){
  // A lost answer from an earlier attempt: the bill is already there. Trust it only if it is exactly ours.
  const verdict=verifyChainBill(expectedOf(k,payouts),await d.chain.getBill(k.merchant_account,k.chain_bill_id).catch(()=>null));
  exists=verdict.state!=='MISSING'&&verdict.state!=='MISMATCH';
 }
 return tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,k.order_id])).rows[0];
  const cur=await lockBill(db,merchant,k.id);
  if(cur.status!=='OPENING')return billView(cur,o,await payoutsOf(db,merchant,k.id));
  if(tx?.ok&&tx.final||exists){
   const next=(await db.query<BillRow>("UPDATE near_bills SET status='OPEN',open_tx=coalesce($3,open_tx,'unknown-open-tx-recovered-from-chain'),attempts=attempts+1,next_check_at=clock_timestamp()+interval '4 seconds' WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,k.id,tx?.ok?tx.hash:null])).rows[0];
   await record(db,merchant,k.id,'BILL_OPENED',tx?.ok?tx.hash:null,{total:k.amount_units,payouts:payouts.length,witness:k.witness_pk!==null});
   return billView(next,o,await payoutsOf(db,merchant,k.id));
  }
  // An unknown outcome (network error) keeps OPENING for the worker to retry; a refusal by the contract is final.
  const final=tx!==null&&!tx.ok;
  const next=(await db.query<BillRow>(`UPDATE near_bills SET status=$3,last_issue=$4,attempts=attempts+1,next_check_at=clock_timestamp()+interval '10 seconds' WHERE merchant_id=$1 AND id=$2 RETURNING *`,[merchant,k.id,final?'FAILED_OPEN':'OPENING',(issue??'OPEN_FAILED').slice(0,160)])).rows[0];
  if(final)await record(db,merchant,k.id,'OPEN_FAILED',tx!.hash||null,{issue});
  return billView(next,o,await payoutsOf(db,merchant,k.id));
 });
}

async function liveBillFor(token:string,merchant:string){
 return tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1',[token])).rows[0];if(!o)refuse(404,'RESOURCE_NOT_FOUND');
  const k=await latestBill(db,merchant,o!.id);if(!k)refuse(409,'NEAR_BILL_REQUIRED');
  return {o:o!,k:k!,payouts:await payoutsOf(db,merchant,k!.id)};
 });
}

/** POST relay: the customer's signed delegate action. The relayer pays the gas only for exactly this bill. */
export async function relayPayment(token:string,signedDelegate:string):Promise<BillView>{
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const merchant=await merchantFor(token);
 const {o,k,payouts}=await liveBillFor(token,merchant);
 if(k.status!=='OPEN')return billView(k,o,payouts);
 const expected=expectedOf(k,payouts);
 let reason:string|null;
 try{reason=refuseDelegate(expected,d.chain.inspectDelegate(signedDelegate));}catch{reason='DELEGATE_UNREADABLE';}
 if(reason){await tenant(merchant,db=>record(db,merchant,k.id,'PAYMENT_REFUSED',null,{reason}));refuse(422,'NEAR_PAYMENT_NOT_FOR_THIS_BILL');}
 let tx:TxView;
 try{tx=await d.chain.relay(signedDelegate);}
 catch(e){await tenant(merchant,db=>record(db,merchant,k.id,'PAYMENT_REFUSED',null,{reason:'RELAY_FAILED',detail:String((e as Error)?.message??e).slice(0,160)}));return refuse(409,'NEAR_RELAY_FAILED');}
 return applyPayTx(merchant,k.id,tx,d);
}

/** POST submitted: a wallet sent the payment itself; the server looks the transaction up and reads the contract's events. */
export async function submittedPayment(token:string,txHash:string,signerId:string):Promise<BillView>{
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const merchant=await merchantFor(token);
 const {o,k,payouts}=await liveBillFor(token,merchant);
 if(k.status!=='OPEN')return billView(k,o,payouts);
 let tx:TxView;try{tx=await d.chain.tx(txHash,signerId);}catch{return refuse(409,'NEAR_TX_NOT_FOUND');}
 return applyPayTx(merchant,k.id,tx,d);
}

/** POST demo-pay: a labelled testnet demo wallet held by the server signs the same gasless payment a real wallet would. */
export async function demoPay(token:string,wallet:string):Promise<BillView>{
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const merchant=await merchantFor(token);
 if(!d.config.demoWallets.includes(wallet)||!d.chain.hasKey(wallet))refuse(404,'RESOURCE_NOT_FOUND');
 const {o,k,payouts}=await liveBillFor(token,merchant);
 if(k.status!=='OPEN')return billView(k,o,payouts);
 // Keep the demo wallet funded from the test token's own faucet account when the server holds that key (testnet only).
 if(d.chain.hasKey(k.token_contract)&&await d.chain.ftBalance(k.token_contract,wallet).catch(()=>BigInt(k.amount_units))<BigInt(k.amount_units))await d.chain.faucet(k.token_contract,wallet,BigInt(k.amount_units)+100_000_000n).catch(()=>null);
 const signed=await d.chain.signDemoPayment(wallet,k.token_contract,BigInt(k.amount_units),payMessage(k.merchant_account,k.chain_bill_id));
 return relayPayment(token,signed);
}

export async function applyPayTx(merchant:string,billId:string,tx:TxView,d:NearDeps):Promise<BillView>{
 await tenant(merchant,async db=>{
  const k=await lockBill(db,merchant,billId);const facts=payTxFacts(expectedOf(k,await payoutsOf(db,merchant,billId)),tx);
  await record(db,merchant,billId,'PAYMENT_RELAYED',tx.hash||null,{final:tx.final,ok:tx.ok,result:facts.kind});
  if(facts.kind==='BOUNCED')await record(db,merchant,billId,'PAYMENT_BOUNCED',tx.hash||null,{reason:facts.reason});
  // The hash is evidence. Whether the bill is paid is decided below from the contract's state, not from this.
  if(facts.kind==='PAID'&&k.status==='OPEN'&&!k.pay_tx)await db.query('UPDATE near_bills SET pay_tx=$3 WHERE merchant_id=$1 AND id=$2',[merchant,billId,tx.hash]);
 });
 const r=await advanceBill(merchant,billId,d);
 // Still unpaid after a finalized attempt: tell the page why instead of showing an unchanged bill.
 if(r.k.status==='OPEN'&&tx.final){const facts=payTxFacts(expectedOf(r.k,r.payouts),tx);refuse(409,facts.kind==='BOUNCED'?'NEAR_PAYMENT_BOUNCED':'NEAR_PAYMENT_NOT_CONFIRMED');}
 return billView(r.k,r.order,r.payouts);
}

/**
 * Asks the contract for the truth about one bill (final finality) and applies it. Shared by the pay routes, the
 * device acknowledgement, the merchant actions and the reconcile worker, so effects happen once.
 */
export async function advanceBill(merchant:string,billId:string,d:NearDeps):Promise<{k:BillRow;order:OrderRow;payouts:PayoutRow[];verdict:ChainVerdict|null}>{
 const start=await tenant(merchant,async db=>{
  const k=(await billsBy(db,'merchant_id=$1 AND id=$2',[merchant,billId])).rows[0];if(!k)refuse(404,'RESOURCE_NOT_FOUND');
  const order=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,k!.order_id])).rows[0];
  return {k:k!,order,payouts:await payoutsOf(db,merchant,billId)};
 });
 if(!LIVE.includes(start.k.status)||start.k.status==='OPENING')return {...start,verdict:null};
 let verdict:ChainVerdict;
 try{verdict=verifyChainBill(expectedOf(start.k,start.payouts),await d.chain.getBill(start.k.merchant_account,start.k.chain_bill_id));}
 catch{
  // A failed lookup proves nothing about the money: keep the state and look again soon.
  await tenant(merchant,db=>db.query("UPDATE near_bills SET next_check_at=clock_timestamp()+interval '10 seconds' WHERE merchant_id=$1 AND id=$2 AND status=ANY($3)",[merchant,billId,LIVE]));
  return {...start,verdict:null};
 }
 return tenant(merchant,async db=>{
  const order=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,start.k.order_id])).rows[0];
  let k=await lockBill(db,merchant,billId);
  const done=async()=>({k:await lockBill(db,merchant,billId),order:(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,k.order_id])).rows[0],payouts:await payoutsOf(db,merchant,billId),verdict});
  if(!LIVE.includes(k.status)||k.status==='OPENING')return done();
  if(verdict.state==='MISSING'||verdict.state==='MISMATCH'){
   // Never settle and never auto-resolve: keep the evidence and stop the bill for the merchant to review.
   const reasons=verdict.state==='MISMATCH'?verdict.reasons.join(','):'BILL_MISSING_ON_CHAIN';
   await db.query("UPDATE near_bills SET status='MISMATCH',last_issue=$3 WHERE merchant_id=$1 AND id=$2",[merchant,billId,reasons.slice(0,160)]);
   await record(db,merchant,billId,'MISMATCH',null,{reasons});return done();
  }
  const paidAt=verdict.paidAtMs>0?new Date(verdict.paidAtMs):null;
  const set=(status:string,extra='')=>db.query(`UPDATE near_bills SET status=$3,payer=coalesce(payer,$4),paid_at=coalesce(paid_at,$5)${extra} WHERE merchant_id=$1 AND id=$2`,[merchant,billId,status,verdict.payer,paidAt]);
  switch(verdict.state){
   case 'Open':break;
   case 'Escrow':
    if(k.status!=='ESCROW'){await set('ESCROW',",next_check_at=$5::timestamptz+make_interval(secs=>witness_timeout_ms/1000.0)");await record(db,merchant,billId,'PAID_ESCROW',k.pay_tx,{payer:verdict.payer});}
    break;
   case 'Settling':case 'Refunding':
    await set(verdict.state==='Settling'?'SETTLING':k.status==='OPEN'?'ESCROW':k.status,",next_check_at=clock_timestamp()+interval '3 seconds'");break;
   case 'PayoutFailed':
    if(k.status!=='PAYOUT_FAILED'){await set('PAYOUT_FAILED',",last_issue='PAYOUT_FAILED',next_check_at=clock_timestamp()+interval '30 seconds'");await record(db,merchant,billId,'PAYOUT_FAILED',null,{});}
    break;
   case 'Settled':{
    await set('SETTLED',',next_check_at=NULL');
    const row=(await db.query<Record<string,unknown>>('SELECT (r.updated_order).*,r.details AS settlement_details FROM bitpos.near_settle_bill($1::uuid,$2::uuid,$3::uuid) AS r',[merchant,k.order_id,billId])).rows[0];
    if(row){await publishSettlementRow(db,row,new Date().toISOString());await record(db,merchant,billId,'SETTLED',k.settle_tx??k.ack_tx??k.pay_tx,{order:row.status,total:k.amount_units});}
    break;}
   case 'Refunded':
    await set('REFUNDED',",last_issue=coalesce(last_issue,'REFUNDED_TO_PAYER'),next_check_at=NULL");await record(db,merchant,billId,'REFUNDED',k.refund_tx,{payer:verdict.payer,amount:k.amount_units});break;
   case 'Void':
    await set('VOID',",last_issue=coalesce(last_issue,'VOIDED'),next_check_at=NULL");await record(db,merchant,billId,'VOIDED',null,{});break;
  }
  void order;
  return done();
 });
}

/** POST reclaim: after the witness window anyone may send the money back to the payer. The contract enforces the time. */
export async function reclaimBill(token:string):Promise<BillView>{
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const now=d.now??Date.now;const merchant=await merchantFor(token);
 const {o,k,payouts}=await liveBillFor(token,merchant);
 if(!['ESCROW','PAYOUT_FAILED'].includes(k.status))return billView(k,o,payouts);
 if(!k.paid_at||now()<=k.paid_at.getTime()+k.witness_timeout_ms)refuse(409,'NEAR_WITNESS_WINDOW_OPEN');
 return reclaimNow(merchant,k,d);
}
export async function reclaimNow(merchant:string,k:BillRow,d:NearDeps):Promise<BillView>{
 let tx:TxView|null=null;try{tx=await d.chain.reclaim(k.merchant_account,k.chain_bill_id);}catch{/* the contract refused or the network failed: the state check below decides */}
 if(tx?.ok)await tenant(merchant,async db=>{await db.query('UPDATE near_bills SET refund_tx=coalesce(refund_tx,$3) WHERE merchant_id=$1 AND id=$2',[merchant,k.id,tx!.hash]);await record(db,merchant,k.id,'REFUND_SENT',tx!.hash,{by:'timeout'});});
 const r=await advanceBill(merchant,k.id,d);
 return billView(r.k,r.order,r.payouts);
}
export {RequestError};
