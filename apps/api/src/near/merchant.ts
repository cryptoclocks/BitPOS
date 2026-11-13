// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Merchant routes under /api/near/* (signed-in staff). Reads are open to owner, manager and staff; anything that
// changes who gets paid, or moves money back, is owner/manager only and enforced here, not in the page.
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {tenant} from '../db';
import {config} from '../config';
import {isAccountId} from './chain';
import {NearRouteError,advanceBill,billView,billsBy,nearDeps,payoutsOf,record,settingsOf,LIVE,type BillRow,type NearDeps} from './bills';
import {displayToUnits,unitsToDisplay} from './money';
import {MAX_INVOICES,MAX_SHARE_BPS} from './recipe';

type Role='owner'|'manager'|'staff';
const refuse=(status:number,code:string):never=>{throw new NearRouteError(status,code);};
const changeRole=(role:string)=>{if(role!=='owner'&&role!=='manager')refuse(403,'ROLE_REQUIRED');};
const uuid=z.string().uuid();
const account=z.string().refine(v=>isAccountId(v)&&v.endsWith('.testnet'),'NEAR testnet account');
const label=z.string().trim().min(1).max(60);
const recipeBody=z.object({taxBps:z.number().int().min(0).max(3000),tipsBps:z.number().int().min(0).max(3000),witnessDeviceId:uuid.nullable(),witnessTimeoutS:z.number().int().min(30).max(3600)}).strict();
const recipientBody=z.object({label,nearAccount:account,weight:z.number().int().min(1).max(10).optional()}).strict();
const shiftBody=z.object({on:z.boolean()}).strict();
const invoiceBody=z.object({recipientId:uuid,reference:z.string().trim().min(1).max(60),total:z.string(),rateBps:z.number().int().min(1).max(3000),dueOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict();
const deviceBody=z.object({label,kind:z.enum(['mini','browser'])}).strict();
const empty=z.object({}).strict();
const DAY="(date_trunc('day',now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')";

const balances=new Map<string,{at:number;value:Record<string,string|null>}>();
async function chainBalances(d:NearDeps,merchant:string,token:string,accounts:string[]){
 const cached=balances.get(merchant);if(cached&&Date.now()-cached.at<15_000&&accounts.every(a=>a in cached.value))return cached.value;
 const value:Record<string,string|null>={};
 await Promise.all(accounts.map(async a=>{try{value[a]=unitsToDisplay(await d.chain.ftBalance(token,a));}catch{value[a]=null;}}));
 balances.set(merchant,{at:Date.now(),value});return value;
}
const csvCell=(v:unknown)=>{let s=v===null||v===undefined?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};

export async function nearMerchantRequest(merchant:string,userId:string,role:Role|string,url:URL,method:string,input:unknown){
 const d=nearDeps();const path=url.pathname.replace(/^\/api\/near\//,'');const explorer=d?.config.explorerTx??'https://testnet.nearblocks.io/txns/';
 const link=(tx:string|null)=>tx&&/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(tx)?explorer+tx:null;
 const need=()=>d??refuse(503,'NEAR_UNAVAILABLE');
 const shop=async()=>{const s=await tenant(merchant,db=>settingsOf(db,merchant));if(!s?.enabled)refuse(409,'NEAR_NOT_ENABLED');return s!;};

 if(path==='account'&&method==='GET'){
  const s=await tenant(merchant,db=>settingsOf(db,merchant));
  if(!s)return {enabled:false,configured:!!d};
  const data=await tenant(merchant,async db=>({
   name:(await db.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchant])).rows[0]?.name??'',
   recipients:(await db.query<{id:string;kind:string;label:string;near_account:string;on_shift_since:Date|null}>('SELECT id,kind,label,near_account,on_shift_since FROM near_recipients WHERE merchant_id=$1 AND active ORDER BY kind,created_at',[merchant])).rows,
   devices:(await db.query<{id:string;label:string;kind:string;public_key_hex:string|null;last_seen_at:Date|null}>('SELECT id,label,kind,public_key_hex,last_seen_at FROM near_devices WHERE merchant_id=$1 AND active ORDER BY created_at',[merchant])).rows,
   flow:(await db.query<{role:string;units:string}>(`SELECT p.role,sum(p.amount_units)::text AS units FROM near_payouts p JOIN near_bills b ON b.merchant_id=p.merchant_id AND b.id=p.bill_id WHERE p.merchant_id=$1 AND p.paid AND b.updated_at>=${DAY} GROUP BY p.role`,[merchant])).rows,
   counts:(await db.query<{status:string;n:string}>(`SELECT status,count(*)::text AS n FROM near_bills WHERE merchant_id=$1 AND created_at>=${DAY} GROUP BY status`,[merchant])).rows}));
  const accounts=[s.near_account,...data.recipients.map(r=>r.near_account)];
  const held=d?await chainBalances(d,merchant,s.token_contract,[...new Set(accounts)]):{};
  return {enabled:s.enabled,configured:!!d,network:'testnet',shopName:data.name,contract:d?.config.billsContract??null,relayer:d?.config.relayerAccount??null,explorerTx:explorer,explorerAccount:'https://testnet.nearblocks.io/address/',
   account:s.near_account,token:{contract:s.token_contract,symbol:s.token_symbol,decimals:s.token_decimals},
   recipe:{taxBps:s.tax_bps,tipsBps:s.tips_bps,witnessDeviceId:s.witness_device_id,witnessTimeoutS:s.witness_timeout_s},
   balances:held,recipients:data.recipients.map(r=>({id:r.id,kind:r.kind,label:r.label,account:r.near_account,onShift:r.on_shift_since!==null})),
   devices:data.devices.map(v=>({id:v.id,label:v.label,kind:v.kind,registered:v.public_key_hex!==null,publicKey:v.public_key_hex,lastSeenAt:v.last_seen_at?.toISOString()??null})),
   today:{byRole:Object.fromEntries(data.flow.map(f=>[f.role,unitsToDisplay(f.units)])),total:unitsToDisplay(data.flow.reduce((sum,f)=>sum+BigInt(f.units),0n)),bills:Object.fromEntries(data.counts.map(c=>[c.status,Number(c.n)]))}};
 }

 if(path==='recipe'&&method==='POST'){
  changeRole(role);const body=recipeBody.parse(input);await shop();
  return tenant(merchant,async db=>{
   const open=(await db.query<{rate:string}>("SELECT coalesce(sum(rate_bps),0)::text AS rate FROM near_supplier_invoices WHERE merchant_id=$1 AND status='OPEN'",[merchant])).rows[0];
   if(body.taxBps+body.tipsBps+Number(open.rate)>MAX_SHARE_BPS)refuse(409,'NEAR_RECIPE_INVALID');
   if(body.witnessDeviceId){const v=(await db.query<{public_key_hex:string|null}>('SELECT public_key_hex FROM near_devices WHERE merchant_id=$1 AND id=$2 AND active',[merchant,body.witnessDeviceId])).rows[0];if(!v)refuse(404,'RESOURCE_NOT_FOUND');if(!v!.public_key_hex)refuse(409,'NEAR_WITNESS_NOT_READY');}
   await db.query('UPDATE near_merchant_settings SET tax_bps=$2,tips_bps=$3,witness_device_id=$4,witness_timeout_s=$5,updated_by=$6,updated_at=clock_timestamp() WHERE merchant_id=$1',[merchant,body.taxBps,body.tipsBps,body.witnessDeviceId,body.witnessTimeoutS,userId]);
   return {ok:true,recipe:body};
  });
 }

 const recipients=path.match(/^(team|suppliers)$/);
 if(recipients&&method==='GET'){
  const kind=recipients[1]==='team'?'staff':'supplier';
  return tenant(merchant,async db=>{
   const rows=(await db.query<{id:string;label:string;near_account:string;weight:number;on_shift_since:Date|null;today:string;total:string}>(
    `SELECT r.id,r.label,r.near_account,r.weight,r.on_shift_since,
      coalesce((SELECT sum(p.amount_units) FROM near_payouts p JOIN near_bills b ON b.merchant_id=p.merchant_id AND b.id=p.bill_id WHERE p.merchant_id=r.merchant_id AND p.recipient_id=r.id AND p.paid AND b.updated_at>=${DAY}),0)::text AS today,
      coalesce((SELECT sum(p.amount_units) FROM near_payouts p WHERE p.merchant_id=r.merchant_id AND p.recipient_id=r.id AND p.paid),0)::text AS total
     FROM near_recipients r WHERE r.merchant_id=$1 AND r.kind=$2 AND r.active ORDER BY r.created_at`,[merchant,kind])).rows;
   const invoices=kind==='supplier'?(await db.query<{id:string;recipient_id:string;reference:string;total_units:string;funded_units:string;rate_bps:number;status:string;due_on:string|null;created_at:Date}>(
    "SELECT id,recipient_id,reference,total_units::text,funded_units::text,rate_bps,status,due_on::text,created_at FROM near_supplier_invoices WHERE merchant_id=$1 ORDER BY (status='OPEN') DESC,created_at DESC LIMIT 50",[merchant])).rows:[];
   return {items:rows.map(r=>({id:r.id,label:r.label,account:r.near_account,weight:r.weight,onShift:r.on_shift_since!==null,onShiftSince:r.on_shift_since?.toISOString()??null,earnedToday:unitsToDisplay(r.today),earnedTotal:unitsToDisplay(r.total)})),
    invoices:invoices.map(i=>({id:i.id,recipientId:i.recipient_id,reference:i.reference,total:unitsToDisplay(i.total_units),funded:unitsToDisplay(i.funded_units),rateBps:i.rate_bps,status:i.status,dueOn:i.due_on,createdAt:i.created_at.toISOString()}))};
  });
 }
 if(recipients&&method==='POST'){
  changeRole(role);const body=recipientBody.parse(input);const s=await shop();const kind=recipients[1]==='team'?'staff':'supplier';
  // The account must exist, and must be able to hold the token before any bill can pay it.
  if(!await need().chain.accountExists(body.nearAccount))refuse(422,'NEAR_ACCOUNT_NOT_FOUND');
  if(!await need().chain.isRegistered(s.token_contract,body.nearAccount))await need().chain.register(s.token_contract,body.nearAccount);
  return tenant(merchant,async db=>{
   const row=(await db.query<{id:string}>('INSERT INTO near_recipients(merchant_id,kind,label,near_account,weight) VALUES($1,$2,$3,$4,$5) ON CONFLICT(merchant_id,kind,near_account) DO UPDATE SET label=EXCLUDED.label,weight=EXCLUDED.weight,active=true RETURNING id',[merchant,kind,body.label,body.nearAccount,body.weight??1])).rows[0];
   return {id:row.id};
  });
 }
 const shift=path.match(/^team\/([0-9a-f-]{36})\/shift$/);
 if(shift&&method==='POST'){
  const body=shiftBody.parse(input);
  return tenant(merchant,async db=>{
   const row=(await db.query<{on_shift_since:Date|null}>("UPDATE near_recipients SET on_shift_since=CASE WHEN $3 THEN coalesce(on_shift_since,clock_timestamp()) END WHERE merchant_id=$1 AND id=$2 AND kind='staff' AND active RETURNING on_shift_since",[merchant,shift[1],body.on])).rows[0];
   if(!row)refuse(404,'RESOURCE_NOT_FOUND');return {onShift:row!.on_shift_since!==null};
  });
 }
 if(path==='invoices'&&method==='POST'){
  changeRole(role);const body=invoiceBody.parse(input);const s=await shop();const units=displayToUnits(body.total)??refuse(422,'INVALID_REQUEST');
  return tenant(merchant,async db=>{
   if(!(await db.query("SELECT 1 FROM near_recipients WHERE merchant_id=$1 AND id=$2 AND kind='supplier' AND active",[merchant,body.recipientId])).rowCount)refuse(404,'RESOURCE_NOT_FOUND');
   const open=(await db.query<{n:string;rate:string}>("SELECT count(*)::text AS n,coalesce(sum(rate_bps),0)::text AS rate FROM near_supplier_invoices WHERE merchant_id=$1 AND status='OPEN'",[merchant])).rows[0];
   if(Number(open.n)>=MAX_INVOICES)refuse(409,'NEAR_TOO_MANY_OPEN_INVOICES');
   if(s.tax_bps+s.tips_bps+Number(open.rate)+body.rateBps>MAX_SHARE_BPS)refuse(409,'NEAR_RECIPE_INVALID');
   if((await db.query('SELECT 1 FROM near_supplier_invoices WHERE merchant_id=$1 AND reference=$2',[merchant,body.reference])).rowCount)refuse(409,'NEAR_INVOICE_EXISTS');
   const row=(await db.query<{id:string}>('INSERT INTO near_supplier_invoices(merchant_id,recipient_id,reference,total_units,rate_bps,due_on,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[merchant,body.recipientId,body.reference,units.toString(),body.rateBps,body.dueOn??null,userId])).rows[0];
   return {id:row.id};
  });
 }
 const cancel=path.match(/^invoices\/([0-9a-f-]{36})\/cancel$/);
 if(cancel&&method==='POST'){
  changeRole(role);empty.parse(input??{});
  return tenant(merchant,async db=>{
   const row=(await db.query("UPDATE near_supplier_invoices SET status='CANCELLED' WHERE merchant_id=$1 AND id=$2 AND status='OPEN' RETURNING id",[merchant,cancel[1]])).rows[0];
   if(!row)refuse(404,'RESOURCE_NOT_FOUND');return {ok:true};
  });
 }

 if((path==='ledger'||path==='ledger/export')&&method==='GET'){
  const rows=await tenant(merchant,async db=>{
   const bills=(await db.query<BillRow&{serving:string|null;order_status:string;updated_at:Date}>(
    `SELECT b.*,b.amount_units::text AS amount_units,a.serving_label_snapshot AS serving,o.status AS order_status FROM near_bills b JOIN orders o ON o.merchant_id=b.merchant_id AND o.id=b.order_id
      LEFT JOIN order_authority a ON a.merchant_id=b.merchant_id AND a.order_id=b.order_id WHERE b.merchant_id=$1 ORDER BY b.created_at DESC LIMIT $2`,[merchant,path==='ledger'?50:1000])).rows;
   const out=[];for(const k of bills)out.push({k,payouts:await payoutsOf(db,merchant,k.id)});return out;
  });
  const s=await tenant(merchant,db=>settingsOf(db,merchant));
  if(path==='ledger')return {token:s?.token_symbol??'',explorerTx:explorer,bills:rows.map(({k,payouts})=>({id:k.id,orderId:k.order_id,serving:k.serving,createdAt:k.created_at.toISOString(),updatedAt:k.updated_at.toISOString(),...billView(k,{status:k.order_status},payouts)}))};
  const header=['date_utc','bill_id','order_id','serving','status','token','bill_total','role','recipient','recipient_account','amount','paid','payer','payment_tx','witness_tx','refund_tx'];
  const lines=[header.join(',')];
  for(const {k,payouts} of rows)for(const p of payouts)lines.push([k.created_at.toISOString(),k.chain_bill_id,k.order_id,k.serving,k.status,s?.token_symbol,unitsToDisplay(k.amount_units),p.role,p.label,p.near_account,unitsToDisplay(p.amount_units),p.paid?'yes':'no',k.payer,link(k.pay_tx),link(k.ack_tx),link(k.refund_tx)].map(csvCell).join(','));
  return {filename:`bitpos-near-ledger-${new Date().toISOString().slice(0,10)}.csv`,csv:lines.join('\n')+'\n'};
 }
 const evidence=path.match(/^orders\/([0-9a-f-]{36})\/evidence$/);
 if(evidence&&method==='GET'){
  return tenant(merchant,async db=>{
   const order=(await db.query<{status:string;created_at:Date}>('SELECT status,created_at FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,evidence[1]])).rows[0];if(!order)refuse(404,'RESOURCE_NOT_FOUND');
   const bills=(await billsBy(db,'merchant_id=$1 AND order_id=$2 ORDER BY created_at',[merchant,evidence[1]])).rows;
   const out=[];
   for(const k of bills){
    const events=(await db.query<{kind:string;tx_hash:string|null;detail:Record<string,unknown>;created_at:Date}>('SELECT kind,tx_hash,detail,created_at FROM near_bill_events WHERE merchant_id=$1 AND bill_id=$2 ORDER BY created_at,id',[merchant,k.id])).rows;
    out.push({...billView(k,order!,await payoutsOf(db,merchant,k.id)),id:k.id,createdAt:k.created_at.toISOString(),events:events.map(e=>({kind:e.kind,at:e.created_at.toISOString(),tx:e.tx_hash,url:link(e.tx_hash),detail:e.detail}))});
   }
   return {orderId:evidence[1],orderStatus:order!.status,explorerTx:explorer,bills:out};
  });
 }

 if(path==='devices'&&method==='POST'){
  changeRole(role);const body=deviceBody.parse(input);await shop();
  const key=randomBytes(32).toString('base64url');
  const row=await tenant(merchant,async db=>(await db.query<{id:string}>('INSERT INTO near_devices(merchant_id,label,kind,key_hash) VALUES($1,$2,$3,$4) RETURNING id',[merchant,body.label,body.kind,createHash('sha256').update(key).digest('hex')])).rows[0]);
  // The key is shown once. A browser screen gets a link that carries it in the fragment, which is never sent to a server log.
  return {id:row.id,key,terminalUrl:body.kind==='browser'?`${config.PUBLIC_URL}/near-terminal/${row.id}#${key}`:null,provision:body.kind==='mini'?`NEAR_PROVISION ${config.PUBLIC_URL} ${row.id} ${key}`:null};
 }
 const deactivate=path.match(/^devices\/([0-9a-f-]{36})\/deactivate$/);
 if(deactivate&&method==='POST'){
  changeRole(role);empty.parse(input??{});
  return tenant(merchant,async db=>{
   await db.query('UPDATE near_merchant_settings SET witness_device_id=NULL,updated_by=$3,updated_at=clock_timestamp() WHERE merchant_id=$1 AND witness_device_id=$2',[merchant,deactivate[1],userId]);
   const row=(await db.query('UPDATE near_devices SET active=false WHERE merchant_id=$1 AND id=$2 AND active RETURNING id',[merchant,deactivate[1]])).rows[0];
   if(!row)refuse(404,'RESOURCE_NOT_FOUND');return {ok:true};
  });
 }

 const action=path.match(/^bills\/([0-9a-f-]{36})\/(refund|retry|check)$/);
 if(action&&method==='POST'){
  empty.parse(input??{});const chain=need().chain;const [,id,what]=action;
  if(what!=='check')changeRole(role);
  const k=await tenant(merchant,async db=>(await billsBy(db,'merchant_id=$1 AND id=$2',[merchant,id])).rows[0]);if(!k)refuse(404,'RESOURCE_NOT_FOUND');
  if(what==='refund'){
   if(!['ESCROW','PAYOUT_FAILED'].includes(k.status))refuse(409,'NEAR_BILL_NOT_HELD');
   const tx=await chain.merchantRefund(k.merchant_account,k.chain_bill_id).catch(()=>null);
   if(tx?.ok)await tenant(merchant,async db=>{await db.query('UPDATE near_bills SET refund_tx=coalesce(refund_tx,$3) WHERE merchant_id=$1 AND id=$2',[merchant,id,tx.hash]);await record(db,merchant,id,'REFUND_SENT',tx.hash,{by:'merchant',actor:userId});});
  }else if(what==='retry'){
   if(k.status!=='PAYOUT_FAILED')refuse(409,'NEAR_BILL_NOT_FAILED');
   await chain.retryPayout(k.merchant_account,k.chain_bill_id).catch(()=>null);
  }else if(!LIVE.includes(k.status))return billView(k,{status:''},await tenant(merchant,db=>payoutsOf(db,merchant,id)));
  const r=await advanceBill(merchant,id,need());
  return billView(r.k,r.order,r.payouts);
 }
 return refuse(404,'RESOURCE_NOT_FOUND');
}
