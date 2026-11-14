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

/** Characters the BitPOS Mini NEAR font can draw: ASCII, Latin-1, Thai and a few punctuation marks
 *  (device/firmware/main/bitpos_near_font_20.c). Anything else is folded so the screen never shows an empty box. */
/** Offer animations shipped with the site (apps/near-site/assets/anim/<file>), served at /near/anim/. A new picture gets
 *  a new file name, so caches never serve an old one. */
const ANIMATED=new Map([['iced-latte','iced-latte-1.gif']]);
const SCREEN_EXTRA=new Set([0x2013,0x2014,0x2018,0x2019,0x201c,0x201d,0x2022,0x2026,0x2190,0x2192,0x20ac]);
const SCREEN_FOLD:Record<string,string>={'\u2713':'OK','\u2714':'OK','\u2715':'x','\u2717':'x','\u00a0':' ','\u2212':'-','\u2010':'-','\u2011':'-','\u0141':'L','\u0142':'l','\u0110':'D','\u0111':'d'};
export function screenText(text:string):string{
 let out='';
 for(const ch of text){const c=ch.codePointAt(0)!;
  if((c>=0x20&&c<=0x7e)||(c>=0xa1&&c<=0xff)||(c>=0x0e00&&c<=0x0e7f)||SCREEN_EXTRA.has(c)){out+=ch;continue;}
  if(SCREEN_FOLD[ch]!==undefined){out+=SCREEN_FOLD[ch];continue;}
  const base=ch.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  out+=[...base].every(b=>{const x=b.codePointAt(0)!;return x>=0x20&&x<=0x7e;})&&base?base:'';
 }
 return out;
}
function forScreen<T extends Record<string,unknown>>(view:T):T{
 const v:Record<string,unknown>={...view};
 for(const k of ['title','line1','line2','table','big'])if(typeof v[k]==='string')v[k]=screenText(v[k] as string);
 if(Array.isArray(v.splits))v.splits=(v.splits as {label:string;amount:string}[]).map(x=>({...x,label:screenText(x.label)}));
 return v as T;
}

/** GET state: what the screen shows now. The device still checks `checking`/`paid` against the chain itself. */
export async function deviceState(deviceId:string,key:string,lang:Lang){
 const d=nearDeps()??refuse(503,'NEAR_UNAVAILABLE');const merchant=await authenticate(deviceId,key);
 return forScreen(await tenant(merchant,async db=>{
  const device=await deviceRow(db,merchant,deviceId);if(!device)refuse(401,'DEVICE_AUTH_REQUIRED');
  await db.query('UPDATE near_devices SET last_seen_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,deviceId]);
  const shop=(await db.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchant])).rows[0]?.name??'BitPOS';
  const base={v:1 as const,table:device!.label,rpc:d.config.rpcUrls[0],poll_ms:2000,tone:'none',splits:[] as {label:string;amount:string}[],bill:null as null|{contract:string;merchant:string;id:string},qr:'',big:'',line2:'',anim:''};
  if(!device!.public_key_hex)return {...base,screen:'setup' as const,register:true,title:shop,line1:L(lang,'รอลงทะเบียนกุญแจของเครื่อง','Waiting for this device to register its key')};
  // This device's bills: the ones it must witness, or every bill when it is the shop's only screen.
  const k=(await billsBy(db,`merchant_id=$1 AND (witness_device_id=$2 OR (witness_device_id IS NULL AND (SELECT count(*) FROM near_devices WHERE merchant_id=$1 AND active)=1))
   AND ((status='OPEN' AND expires_at>clock_timestamp()) OR status IN ('ESCROW','SETTLING','PAYOUT_FAILED') OR (status IN ('SETTLED','REFUNDED') AND updated_at>clock_timestamp()-interval '25 seconds'))
   ORDER BY (status IN ('ESCROW','SETTLING')) DESC,created_at DESC LIMIT 1`,[merchant,deviceId])).rows[0];
  if(!k){
   // No bill on chain yet: the shop's witness screen (or its only screen) shows the newest order waiting for payment,
   // so the guest can scan it at the table. The customer page then opens the bill on NEAR; nothing is signed here.
   const waiting=(await db.query<{access_token:string;serving_label_snapshot:string|null}>(`SELECT o.access_token,a.serving_label_snapshot FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
    WHERE o.merchant_id=$1 AND o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') AND o.created_at>clock_timestamp()-interval '10 minutes'
    AND ((SELECT witness_device_id FROM near_merchant_settings WHERE merchant_id=$1)=$2 OR (SELECT count(*) FROM near_devices WHERE merchant_id=$1 AND active)=1)
    AND NOT EXISTS(SELECT 1 FROM near_bills b WHERE b.merchant_id=o.merchant_id AND b.order_id=o.id AND b.status NOT IN ('VOID','FAILED','REFUNDED'))
    ORDER BY o.created_at DESC LIMIT 1`,[merchant,deviceId])).rows[0];
   if(waiting)return {...base,table:waiting.serving_label_snapshot||device!.label,screen:'qr' as const,title:L(lang,'สแกนเพื่อจ่าย','Scan to pay'),line1:L(lang,'ไม่ต้องมี NEAR · ร้านออกค่าธรรมเนียมเครือข่าย','No NEAR needed · the café pays the network fee'),qr:`${customerOrigin}/pay/${waiting.access_token}`,poll_ms:1500};
   const isWitness=(await db.query<{w:boolean}>("SELECT (witness_device_id=$2 OR (SELECT count(*) FROM near_devices WHERE merchant_id=$1 AND active)=1) AS w FROM near_merchant_settings WHERE merchant_id=$1",[merchant,deviceId])).rows[0]?.w;
   if(isWitness){
    // Idle: a scan-to-order QR for the table's menu, and today's offer when the shop has one live. The discount text comes
    // from the live product offer the checkout also prices with; the animation only shows the product (no numbers).
    const entry=(await db.query<{entry_token:string;label:string}>(`SELECT e.entry_token,t.label FROM table_entries e JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id
     WHERE e.merchant_id=$1 ORDER BY e.auth_generation DESC,e.assignment_generation DESC,e.created_at DESC LIMIT 1`,[merchant])).rows[0];
    if(entry){
     const offer=(await db.query<{name_en:string;percent:number|null;base_minor:string;current_minor:string;currency:string;decimals:number}>(`SELECT p.name_en,o.percent,o.base_minor::text,o.current_minor::text,v.currency,v.decimals FROM (
       SELECT DISTINCT ON(product_id) * FROM versioned_product_offers WHERE merchant_id=$1 AND price_version_id=(SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1) ORDER BY product_id,revision DESC) o
      JOIN products p ON p.merchant_id=o.merchant_id AND p.id=o.product_id JOIN catalog_price_versions v ON v.merchant_id=o.merchant_id AND v.id=o.price_version_id
      WHERE o.enabled AND o.expires_at>clock_timestamp() ORDER BY o.expires_at LIMIT 1`,[merchant])).rows[0];
     const money=(minor:string,dec:number)=>{const n=BigInt(minor),u=10n**BigInt(dec);return `${n/u}.${(n%u).toString().padStart(dec,'0')}`;};
     const slug=offer?offer.name_en.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):'';
     const anim=offer&&ANIMATED.has(slug)?`/near/anim/${ANIMATED.get(slug)}`:'';
     return {...base,table:entry.label,screen:'idle' as const,qr:`${customerOrigin}/table/${entry.entry_token}`,anim,poll_ms:3000,
      title:offer?(offer.percent?`${offer.name_en} -${offer.percent}%`:`${offer.name_en} offer`):L(lang,'สแกนเพื่อสั่ง','Scan to order'),
      line1:offer?`${offer.currency} ${money(offer.current_minor,offer.decimals)} ${L(lang,'จากปกติ','instead of')} ${money(offer.base_minor,offer.decimals)}`:L(lang,'สั่งจากมือถือของคุณ จ่ายบน NEAR','Order on your phone, pay on NEAR'),
      line2:L(lang,`สแกนเพื่อสั่ง · ${entry.label}`,`Scan to order · ${entry.label}`)};
    }
   }
   return {...base,screen:'idle' as const,title:shop,line1:L(lang,'พร้อมรับออเดอร์','Ready for the next order'),line2:'NEAR testnet'};
  }
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
 }));
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
