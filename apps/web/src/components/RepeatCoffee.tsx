import React,{useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import {priorPaidVisit,type GuestQuote} from '../lib/table-guest';
import {requestId} from '../lib/request-id';
import {decimalAmount,formatMoney} from '../lib/money';
import type {OrderView,TableOccupancyView} from '../../../../packages/contracts/src/index';
import type {DelegatedPermission} from '../../../../packages/contracts/src/delegated-payments';
interface Props {entry:string;language:'th'|'en';disabled:boolean;draftRevision:string;permission:DelegatedPermission|null;visit:()=>Promise<string>;apply:(quote:GuestQuote,draftRevision:string)=>void;}
function atomicCap(input:string){
 if(!/^\d+(?:\.\d{1,6})?$/.test(input))throw Error('Enter an exact amount with at most 6 decimals / จำนวนต้องมีทศนิยมไม่เกิน 6 ตำแหน่ง');
 const [whole,fraction='']=input.split('.');const amount=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
 if(amount<=0n||amount>999999999999999999n)throw Error('Amount outside supported range / จำนวนเกินช่วงที่รองรับ');return amount.toString();
}
export default function RepeatCoffee({entry,language,disabled,draftRevision,permission,visit,apply}:Props){
 const [source,setSource]=useState<OrderView>(),[cap,setCap]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef({draftRevision,permission,disabled});current.current={draftRevision,permission,disabled};
 const [occupancy,setOccupancy]=useState<TableOccupancyView>();
 const th=language==='th',copy=(en:string,thai:string)=>th?thai:en;
 async function load(){setBusy(true);setError('');try{const previous=priorPaidVisit(entry);if(!previous)throw Error(copy('No verified previous bill on this browser','เบราว์เซอร์นี้ไม่มีบิลก่อนหน้าให้ตรวจสอบ'));
  const response=await api<{kind:'draft'|'order';order?:OrderView}>('/table/'+entry+'/visit/'+previous.visitToken);
  if(response.kind!=='order'||!response.order||response.order.id!==previous.orderId||response.order.status!=='PAID'||!response.order.settlement.assetId)throw Error(copy('Previous settled bill unavailable','บิลก่อนหน้าที่ชำระแล้วไม่พร้อมใช้งาน'));
  setOccupancy((await api<{occupancy:TableOccupancyView}>('/table/'+entry)).occupancy);
  setSource(response.order);setCap(decimalAmount(response.order.settlement));
 }catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 async function review(){if(!source)return;const snapshot=current.current;setBusy(true);setError('');try{const previous=priorPaidVisit(entry);if(!previous||previous.orderId!==source.id)throw Error('Previous bill changed / บิลก่อนหน้าเปลี่ยน');const base=await visit();const p=snapshot.permission;
  const result=await api<{quote:GuestQuote}>(base+'/repeat-quotes',{sourceVisitToken:previous.visitToken,requestId:requestId(),assetId:source.settlement.assetId,maxAtomic:atomicCap(cap),expiresAt:new Date(Date.now()+300000).toISOString(),confirmJoin:occupancy?.active===true,...(p&&source.settlement.assetId==='usdc-devnet'?{delegation:{sessionToken:p.sessionToken,grantId:p.grantId}}:{})});if(current.current.disabled||current.current.draftRevision!==snapshot.draftRevision||current.current.permission?.grantId!==p?.grantId)throw Error('Cart or permission changed. Review again / ตะกร้าหรือสิทธิ์เปลี่ยน กรุณาตรวจบิลใหม่');apply(result.quote,snapshot.draftRevision);
 }catch(e){setError(errorMessage(e));if(e instanceof ApiError&&e.code==='TABLE_JOIN_CONFIRMATION_REQUIRED')setOccupancy((await api<{occupancy:TableOccupancyView}>('/table/'+entry)).occupancy);}finally{setBusy(false);}}
 return <section className="coffee-copilot" aria-label="Repeat previous paid order"><button className="coffee-toggle" disabled={disabled||busy} onClick={()=>void load()}>{copy('Order again','สั่งเหมือนครั้งก่อน')}</button>{source&&<div className="coffee-content"><p>{copy('Verified paid bill','บิลที่ตรวจสอบว่าชำระแล้ว')} #{source.id.slice(0,8)} · {formatMoney(source.settlement)}</p><p>{source.pricing.lines.map(l=>`${l.qty} × ${th?l.name:l.nameEn}`).join(', ')}</p><label>{copy('Maximum for this new order','ยอดสูงสุดสำหรับออเดอร์ใหม่')} ({source.settlement.displayLabel??source.settlement.currency})<input inputMode="decimal" value={cap} maxLength={24} disabled={disabled||busy} onChange={e=>setCap(e.target.value)}/></label><small>{copy('Same merchant and asset; cap expires in 5 minutes. Stock and prices are checked again. This only prepares a new bill, never orders or pays.','ร้านและเหรียญเดิม วงเงินหมดอายุใน 5 นาที ตรวจราคาและสต็อกใหม่ ขั้นตอนนี้สร้างบิลให้ตรวจเท่านั้น ไม่สั่งหรือจ่ายเงิน')}</small><div className="coffee-actions"><button disabled={disabled||busy} onClick={()=>void review()}>{occupancy?.active ? copy('Join table & prepare new bill','ร่วมโต๊ะและสร้างบิลใหม่') : copy('Prepare new exact-price bill','สร้างบิลราคาแน่นอนใหม่')}</button><button disabled={busy} onClick={()=>setSource(undefined)}>{copy('Cancel','ยกเลิก')}</button></div></div>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
