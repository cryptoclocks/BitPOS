// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Witness devices (BitPOS Mini firmware product "near", or a labelled simulated screen in a browser).
// The device polls for what to show, checks the bill on the chain by itself, and signs "I showed paid" with a key
// that never leaves it. The server only relays that signature: the contract is what verifies it.
import {createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519';
import {pool,tenant} from '../db';
import {customerOrigin} from '../config';
import type {OrderRow} from '../types';
import {witnessMessage,type TxView} from './chain';
import {NearRouteError,advanceBill,billsBy,nearDeps,payoutsOf,record,type BillRow} from './bills';
import {unitsToDisplay} from './money';

const refuse=(status:number,code:string):never=>{throw new NearRouteError(status,code);};
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export type Lang='en'|'th';
const L=(lang:Lang,th:string,en:string)=>lang==='th'?th:en;
const ROLE:Record<string,[string,string]>={owner:['เจ้าของร้าน','Owner'],tax:['กองภาษี','Tax reserve'],tips:['ทิปพนักงาน','Staff tips'],supplier:['ซัพพลายเออร์','Supplier']};
interface DeviceRow {id:string;label:string;kind:'mini'|'browser';public_key_hex:string|null}

async function authenticate(deviceId:string,key:string){
 if(!/^[0-9a-f-]{36}$/.test(deviceId)||!/^[A-Za-z0-9_-]{43}$/.test(key))refuse(401,'DEVICE_AUTH_REQUIRED');
 const merchant=(await pool.query('SELECT bitpos.near_resolve_device($1::uuid,$2) AS merchant',[deviceId,sha(key)])).rows[0]?.merchant as string|undefined;
 if(!merchant)refuse(401,'DEVICE_AUTH_REQUIRED');return merchant!;
}
const deviceRow=async(db:import('pg').PoolClient,merchant:string,id:string)=>(await db.query<DeviceRow>('SELECT id,label,kind,public_key_hex FROM near_devices WHERE merchant_id=$1 AND id=$2 AND active',[merchant,id])).rows[0];

/** GET state: what the screen shows now. The device still checks `checking`/`paid` against the chain itself. */
export async function deviceState(deviceId:string,key:string,lang:Lang){
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const merchant=await authenticate(deviceId,key);
 return tenant(merchant,async db=>{
  const device=await deviceRow(db,merchant,deviceId);if(!device)refuse(401,'DEVICE_AUTH_REQUIRED');
  await db.query('UPDATE near_devices SET last_seen_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,deviceId]);
  const shop=(await db.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchant])).rows[0]?.name??'BitPOS';
  const base={v:1 as const,table:device!.label,rpc:d.config.rpcUrls[0],poll_ms:2000,tone:'none',splits:[] as {label:string;amount:string}[],bill:null as null|{contract:string;merchant:string;id:string},qr:'',big:'',line2:''};
  if(!device!.public_key_hex)return {...base,screen:'setup' as const,register:true,title:shop,line1:L(lang,'รอลงทะเบียนกุญแจของเครื่อง','Waiting for this device to register its key')};
  // This device's bills: the ones it must witness, or every bill when it is the shop's only screen.
  const k=(await billsBy(db,`merchant_id=$1 AND (witness_device_id=$2 OR (witness_device_id IS NULL AND (SELECT count(*) FROM near_devices WHERE merchant_id=$1 AND active)=1))
   AND ((status='OPEN' AND expires_at>clock_timestamp()) OR status IN ('ESCROW','SETTLING','PAYOUT_FAILED') OR (status IN ('SETTLED','REFUNDED') AND updated_at>clock_timestamp()-interval '25 seconds'))
   ORDER BY (status IN ('ESCROW','SETTLING')) DESC,created_at DESC LIMIT 1`,[merchant,deviceId])).rows[0];
  if(!k)return {...base,screen:'idle' as const,title:shop,line1:L(lang,'พร้อมรับออเดอร์','Ready for the next order'),line2:'NEAR testnet'};
  const order=(await db.query<OrderRow&{serving_label_snapshot:string|null}>('SELECT o.*,a.serving_label_snapshot FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE o.merchant_id=$1 AND o.id=$2',[merchant,k.order_id])).rows[0];
  const s=(await db.query<{token_symbol:string}>('SELECT token_symbol FROM near_merchant_settings WHERE merchant_id=$1',[merchant])).rows[0];
  const amount=`${unitsToDisplay(k.amount_units)} ${s?.token_symbol??''}`.trim();
  const bill={contract:k.contract,merchant:k.merchant_account,id:k.chain_bill_id};
  const splits=(await payoutsOf(db,merchant,k.id)).slice(0,6).map(p=>({label:(p.role==='owner'||p.role==='tax'?L(lang,...ROLE[p.role]):p.label).slice(0,38),amount:unitsToDisplay(p.amount_units)}));
  const table=order?.serving_label_snapshot||device!.label;
  if(k.status==='OPEN')return {...base,table,screen:'qr' as const,title:L(lang,'สแกนเพื่อจ่าย','Scan to pay'),line1:L(lang,'ไม่ต้องมี NEAR · ร้านออกค่าธรรมเนียมเครือข่าย','No NEAR needed · the café pays the network fee'),big:amount,qr:`${customerOrigin}/pay/${order.access_token}`,poll_ms:1500};
  if(k.status==='REFUNDED')return {...base,table,screen:'refunded' as const,title:L(lang,'คืนเงินแล้ว','Refunded'),line1:L(lang,'เงินกลับไปที่กระเป๋าผู้จ่าย','The money went back to the payer'),big:amount,bill,tone:'none'};
  if(k.status==='SETTLED')return {...base,table,screen:'paid' as const,title:L(lang,'จ่ายแล้ว','Paid'),line1:L(lang,'แบ่งจ่ายครบทุกคนแล้ว','Everyone has been paid'),big:amount,bill,splits,tone:'paid'};
  return {...base,table,screen:'checking' as const,title:L(lang,'กำลังตรวจบนเชน','Checking the chain'),line1:k.witness_pk?L(lang,'เครื่องนี้เป็นพยานของบิล','This screen is the bill\'s witness'):L(lang,'กำลังแบ่งจ่าย','Splitting the payment'),big:amount,bill,splits,poll_ms:1500};
 });
}

/** POST register: the device announces the public half of the key it generated. First registration wins. */
export async function deviceRegister(deviceId:string,key:string,pk:string){
 const merchant=await authenticate(deviceId,key);
 return tenant(merchant,async db=>{
  const device=(await db.query<DeviceRow>('SELECT id,label,kind,public_key_hex FROM near_devices WHERE merchant_id=$1 AND id=$2 AND active FOR UPDATE',[merchant,deviceId])).rows[0];if(!device)refuse(401,'DEVICE_AUTH_REQUIRED');
  if(device!.public_key_hex)return device!.public_key_hex===pk?{ok:true,registered:true}:refuse(409,'DEVICE_KEY_ALREADY_REGISTERED');
  await db.query('UPDATE near_devices SET public_key_hex=$3,registered_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,deviceId,pk]);
  return {ok:true,registered:true};
 });
}

/**
 * POST ack: the device's signature over the bill's witness message. Checked here first (to refuse garbage without
 * spending gas), then sent to the contract, which verifies it again and releases the split.
 */
export async function deviceAck(deviceId:string,key:string,input:{bill:string;sig:string;pk:string}){
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const merchant=await authenticate(deviceId,key);
 const load=()=>tenant(merchant,async db=>({device:await deviceRow(db,merchant,deviceId),k:(await billsBy(db,'merchant_id=$1 AND chain_bill_id=$2',[merchant,input.bill])).rows[0] as BillRow|undefined}));
 let {device,k}=await load();
 if(!device||!k||k.witness_device_id!==deviceId)refuse(404,'RESOURCE_NOT_FOUND');
 if(input.pk!==device!.public_key_hex||input.pk!==k!.witness_pk)refuse(409,'WITNESS_KEY_MISMATCH');
 const message=Buffer.from(witnessMessage(k!.contract,k!.merchant_account,k!.chain_bill_id));
 let valid=false;try{valid=ed25519.verify(Buffer.from(input.sig,'hex'),message,Buffer.from(input.pk,'hex'));}catch{valid=false;}
 if(!valid){await tenant(merchant,db=>record(db,merchant,k!.id,'WITNESS_REFUSED',null,{reason:'SIGNATURE_MISMATCH'}));refuse(422,'WITNESS_SIGNATURE_INVALID');}
 const answer=(row:BillRow)=>({ok:['SETTLING','SETTLED'].includes(row.status),state:row.status});
 // The server may not have seen the payment yet (the device reads the chain directly): catch up first.
 if(k!.status==='OPEN')k=(await advanceBill(merchant,k!.id,d)).k;
 if(k!.status!=='ESCROW')return answer(k!);
 let tx:TxView|null=null,issue:string|null=null;
 try{tx=await d.chain.deviceAck(k!.merchant_account,k!.chain_bill_id,input.sig);if(!tx.ok)issue=tx.failures[0]??'ACK_FAILED';}catch(e){issue=String((e as Error)?.message??e).slice(0,160);}
 await tenant(merchant,async db=>{
  if(tx?.ok){await db.query('UPDATE near_bills SET ack_tx=coalesce(ack_tx,$3) WHERE merchant_id=$1 AND id=$2',[merchant,k!.id,tx.hash]);await record(db,merchant,k!.id,'WITNESS_ACK',tx.hash,{device:deviceId,witness_pk:input.pk});}
  else if(!/BILL_NOT_IN_ESCROW/.test(issue??''))await record(db,merchant,k!.id,'WITNESS_REFUSED',tx?.hash||null,{reason:issue});
 });
 const after=(await advanceBill(merchant,k!.id,d)).k;
 if(!['SETTLING','SETTLED'].includes(after.status)&&after.status==='ESCROW')refuse(409,'WITNESS_RETRY');
 return answer(after);
}
