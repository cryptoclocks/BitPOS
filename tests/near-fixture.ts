// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Shared test fixture: an in-memory stand-in for the bills contract that follows the same rules as the Rust
// contract proven on testnet (near-hackathon/evidence/e2e-chain-*.json), and a BitPOS shop with NEAR enabled on the
// disposable database. No network: model and chain calls are never real in tests.
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519';
import {tableFixture} from './backend-table-fixture';
import {payMessage,witnessMessage,type ChainBill,type NearChain,type TxView} from '../apps/api/src/near/chain';
import type {NearConfig} from '../apps/api/src/near/config';

export const CONTRACT='bills.fake.testnet',TOKEN='tusd.fake.testnet',SHOP_ACCOUNT='orbit.fake.testnet',ALICE='alice.fake.testnet';
export const config:NearConfig={network:'testnet',rpcUrls:['https://rpc.invalid'],billsContract:CONTRACT,relayerAccount:'relayer.fake.testnet',privateDir:'/nonexistent',explorerTx:'https://testnet.nearblocks.io/txns/',demoWallets:[ALICE]};
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const hash=()=>Array.from(randomBytes(44),b=>B58[b%58]).join('');

/** In-memory bills contract. `fail` injects one failure into the next matching call. */
export function fakeNear(clock:{now:number}){
 const bills=new Map<string,ChainBill>(),txs=new Map<string,TxView>(),calls:string[]=[];
 const fail:{open?:'lost'|'network';payout?:boolean;getBill?:boolean}={};
 const key=(m:string,b:string)=>`${m}:${b}`;
 const tx=(ok:boolean,events:[string,Record<string,unknown>][]=[],failure?:string):TxView=>{const t:TxView={hash:hash(),signer:config.relayerAccount,final:true,ok,failures:failure?[failure]:[],events:events.map(([event,data])=>({executor:CONTRACT,standard:'bitpos-near',event,data}))};txs.set(t.hash,t);return t;};
 const panic=(code:string):never=>{throw new Error('Contract panicked: '+code);};
 const settle=(bill:ChainBill)=>{if(fail.payout){fail.payout=false;bill.state='PayoutFailed';return ['payout_failed',{merchant:bill.merchant,bill_id:bill.bill_id}] as [string,Record<string,unknown>];}bill.state='Settled';bill.closed_at_ms=String(clock.now);return ['bill_settled',{merchant:bill.merchant,bill_id:bill.bill_id,total:bill.total}] as [string,Record<string,unknown>];};
 const chain:NearChain={
  settings:config,hasKey:(account:string)=>account!==TOKEN,
  async getBill(m,b){calls.push('getBill');if(fail.getBill){fail.getBill=false;throw new Error('fetch failed');}const bill=bills.get(key(m,b));return bill?structuredClone(bill):null;},
  async openBill(m,input){calls.push('open');
   if(fail.open==='network'){fail.open=undefined;throw new Error('fetch failed');}
   if(bills.has(key(m,input.billId)))return tx(false,[],'Smart contract panicked: BILL_EXISTS');
   bills.set(key(m,input.billId),{merchant:m,bill_id:input.billId,token:input.token,total:input.total.toString(),payouts:input.payouts.map(p=>({account:p.account,amount:p.amount.toString(),role:p.role})),expires_at_ms:String(input.expiresAtMs),witness_pk:input.witnessPk,witness_timeout_ms:String(input.witnessTimeoutMs),state:'Open',payer:null,paid_at_ms:'0',closed_at_ms:'0'});
   if(fail.open==='lost'){fail.open=undefined;throw new Error('fetch failed');}
   return tx(true,[['bill_opened',{merchant:m,bill_id:input.billId}]]);},
  async voidBill(m,b){calls.push('void');const bill=bills.get(key(m,b))!;if(bill.state!=='Open')panic('BILL_NOT_OPEN');bill.state='Void';return tx(true,[['bill_voided',{merchant:m,bill_id:b}]]);},
  async merchantRefund(m,b){calls.push('merchantRefund');const bill=bills.get(key(m,b))!;if(!['Escrow','PayoutFailed'].includes(bill.state))panic('BILL_NOT_HELD');bill.state='Refunded';return tx(true,[['bill_refunded',{merchant:m,bill_id:b,reason:'merchant'}]]);},
  async deviceAck(m,b,signature){calls.push('ack');const bill=bills.get(key(m,b))!;if(bill.state!=='Escrow')panic('BILL_NOT_IN_ESCROW');
   if(!ed25519.verify(Buffer.from(signature,'hex'),Buffer.from(witnessMessage(CONTRACT,m,b)),Buffer.from(bill.witness_pk!,'hex')))panic('SIGNATURE_MISMATCH');
   return tx(true,[['device_ack',{merchant:m,bill_id:b}],settle(bill)]);},
  async reclaim(m,b){calls.push('reclaim');const bill=bills.get(key(m,b))!;if(!['Escrow','PayoutFailed'].includes(bill.state))panic('BILL_NOT_HELD');if(clock.now<=Number(bill.paid_at_ms)+Number(bill.witness_timeout_ms))panic('WITNESS_WINDOW_OPEN');bill.state='Refunded';return tx(true,[['bill_refunded',{merchant:m,bill_id:b,reason:'timeout'}]]);},
  async retryPayout(m,b){calls.push('retry');const bill=bills.get(key(m,b))!;if(bill.state!=='PayoutFailed')panic('BILL_NOT_FAILED');return tx(true,[settle(bill)]);},
  inspectDelegate(base64){const d=JSON.parse(Buffer.from(base64,'base64').toString());return {sender:d.sender,receiver:d.token,calls:[{method:d.method??'ft_transfer_call',args:{receiver_id:d.receiver,amount:d.amount,msg:d.msg},gas:BigInt(d.gas??'250000000000000'),deposit:BigInt(d.deposit??'1')}],otherActions:d.other??0};},
  async relay(base64){calls.push('relay');const d=JSON.parse(Buffer.from(base64,'base64').toString());let m='',b='';try{({m,b}=JSON.parse(d.msg));}catch{/* bounced below */}
   const bill=bills.get(key(m,b));const bounce=(reason:string)=>tx(true,[['payment_bounced',{token:d.token,payer:d.sender,amount:d.amount,reason}]]);
   if(!bill)return bounce('BILL_NOT_FOUND');if(bill.state!=='Open')return bounce('BILL_NOT_OPEN');if(bill.token!==d.token)return bounce('WRONG_TOKEN');
   if(clock.now>Number(bill.expires_at_ms))return bounce('BILL_EXPIRED');if(bill.total!==d.amount)return bounce('WRONG_AMOUNT');
   bill.payer=d.sender;bill.paid_at_ms=String(clock.now);const paid:[string,Record<string,unknown>]=['bill_paid',{merchant:m,bill_id:b,token:d.token,payer:d.sender,amount:d.amount,escrow:bill.witness_pk!==null}];
   if(bill.witness_pk){bill.state='Escrow';return tx(true,[paid]);}
   return tx(true,[paid,settle(bill)]);},
  async tx(h){const t=txs.get(h);if(!t)throw new Error('UNKNOWN_TRANSACTION');return t;},
  async ftBalance(){return 0n;},async isRegistered(){return true;},async register(){calls.push('register');return tx(true);},async accountExists(id){return !id.startsWith('missing');},
  async signDemoPayment(customer,token,amount,msg){return Buffer.from(JSON.stringify({sender:customer,token,receiver:CONTRACT,amount:amount.toString(),msg})).toString('base64');},
  async faucet(){return tx(true);}
 };
 /** A payment the customer's wallet would sign; `over` tampers with it. */
 const delegate=(bill:{token:string;amount:string;msg:string},over:Record<string,unknown>={})=>Buffer.from(JSON.stringify({sender:ALICE,token:bill.token,receiver:CONTRACT,amount:bill.amount,msg:bill.msg,...over})).toString('base64');
 return {chain,bills,calls,fail,delegate,tamper:(m:string,b:string,f:(bill:ChainBill)=>void)=>f(bills.get(key(m,b))!)};
}

export async function setupNearShop(options:{taxBps?:number;tipsBps?:number}={}){
 const f=await tableFixture(10);const clock={now:Date.now()};
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 await admin.query("INSERT INTO bitpos.near_merchant_settings(merchant_id,enabled,near_account,token_contract,token_symbol,tax_bps,tips_bps,updated_by) VALUES($1,true,$2,$3,'tUSD',$4,$5,'test')",[f.merchant,SHOP_ACCOUNT,TOKEN,options.taxBps??700,options.tipsBps??1000]);
 await admin.end();
 const near=fakeNear(clock);const bills=await import('../apps/api/src/near/bills');bills.setNearDeps({config,chain:near.chain,now:()=>clock.now});
 const merchantApi=await import('../apps/api/src/near/merchant');const device=await import('../apps/api/src/near/device');const reconcile=await import('../apps/api/src/near/reconcile');
 const api=(role:string,path:string,method='GET',input?:unknown)=>merchantApi.nearMerchantRequest(f.merchant,f.actor,role,new URL('http://x/api/near/'+path),method,input);
 async function bill(qty=2){const created=await f.create(await f.quote(qty));return f.tenant(f.merchant,async db=>(await db.query('SELECT id,access_token FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,created.order.id])).rows[0] as {id:string;access_token:string});}
 /** Test shortcut: frees the counter screen for the next order. The real path (the screen renders "paid", then the
  *  cashier dismisses it) belongs to the pre-existing device protocol and is covered by backend-device.test.ts. */
 const dismiss=()=>f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.a.id]));
 const state=(orderId:string)=>f.tenant(f.merchant,async db=>({
  order:(await db.query('SELECT status FROM orders WHERE id=$1',[orderId])).rows[0].status as string,
  stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0] as {stock:number;reserved:number},
  bills:(await db.query('SELECT status FROM near_bills WHERE order_id=$1 ORDER BY created_at',[orderId])).rows.map(r=>r.status as string),
  settlements:Number((await db.query('SELECT count(*) FROM near_settlements WHERE order_id=$1',[orderId])).rows[0].count),
  safe:(await db.query('SELECT bitpos.unpaid_order_safe($1,$2) AS s',[f.merchant,orderId])).rows[0].s as boolean}));
 const events=(orderId:string)=>f.tenant(f.merchant,async db=>(await db.query('SELECT e.kind FROM near_bill_events e JOIN near_bills b ON b.merchant_id=e.merchant_id AND b.id=e.bill_id WHERE b.order_id=$1 ORDER BY e.created_at,e.id',[orderId])).rows.map(r=>r.kind as string));
 /** Registers a witness screen with its own key and makes it the shop's witness. */
 async function witness(){
  const secret=ed25519.utils.randomPrivateKey(),pk=Buffer.from(ed25519.getPublicKey(secret)).toString('hex');
  const made=await api('owner','devices','POST',{label:'Table 4 Mini',kind:'mini'}) as {id:string;key:string};
  await device.deviceRegister(made.id,made.key,pk);
  await api('owner','recipe','POST',{taxBps:options.taxBps??700,tipsBps:options.tipsBps??1000,witnessDeviceId:made.id,witnessTimeoutS:120});
  const sign=(chainBillId:string,key=secret)=>Buffer.from(ed25519.sign(Buffer.from(witnessMessage(CONTRACT,SHOP_ACCOUNT,chainBillId)),key)).toString('hex');
  return {id:made.id,key:made.key,pk,sign};
 }
 return {f,near,clock,bills,device,reconcile,api,bill,dismiss,state,events,witness,payMessage};
}
