// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Meta edition counter sale: the cart becomes a Stripe Checkout bill made by the Meta server (/meta/staff/api/counter,
// same POS session token). The customer scans the QR; the bill turns PAID only after the signed Stripe webhook or a
// server-side lookup, which this panel polls for. Nothing here marks a bill paid.
import React, { useEffect, useState } from 'react';
import MerchantIcon from './MerchantIcon';

export interface MetaBill {orderId:string;code:string;status:'PENDING'|'PAID'|'CANCELLED'|'EXPIRED';total:string;discount:string;payUrl:string;qrSvg:string|null;
 lines:{name:string;nameEn:string;emoji:string;quantity:number;amount:string;offer:boolean}[]}
const ERR:Record<string,[string,string]>={EMPTY:['ยังไม่ได้เลือกเมนู','Add items first.'],BELOW_MINIMUM:['ยอดต่ำกว่าขั้นต่ำของ Stripe ($0.50)','Below the Stripe minimum ($0.50).'],
 OUT_OF_STOCK:['บางเมนูของไม่พอ','Some items are out of stock.'],NOT_FOUND:['มีเมนูที่ร้านนำออกแล้ว','An item is no longer on the menu.'],PAYMENTS_UNAVAILABLE:['ยังรับชำระไม่ได้','Payments are not available.'],AUTH_REQUIRED:['กรุณาเข้าสู่ระบบอีกครั้ง','Please sign in again.']};

export async function metaApi<T>(path:string,token:string,body?:unknown):Promise<T>{
 const r=await fetch(`/meta/staff/api${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(new Error(j?.error??'FAILED'),{code:j?.error??'FAILED'});
 return j as T;
}
export const metaError=(e:unknown,th:boolean)=>{const c=(e as {code?:string})?.code??'';const m=ERR[c];return m?m[th?0:1]:th?'สร้างบิลไม่สำเร็จ ลองอีกครั้ง':'Could not create the bill. Try again.';};

export default function MetaCounterBill({bill,token,language,onClose,onPaid}:{bill:MetaBill;token:string;language:'th'|'en';onClose:()=>void;onPaid:()=>void}){
 const text=(th:string,en:string)=>language==='th'?th:en;
 const [b,setB]=useState(bill);
 useEffect(()=>{setB(bill);},[bill]);
 useEffect(()=>{
  if(b.status!=='PENDING')return;
  const t=setInterval(()=>{void metaApi<MetaBill>(`/counter/${b.orderId}`,token).then(next=>{setB(next);if(next.status==='PAID')onPaid();}).catch(()=>{});},2500);
  return()=>clearInterval(t);
 },[b.orderId,b.status,token]);
 return <div className="meta-bill-backdrop" role="dialog" aria-modal="true" aria-label={text('บิล Stripe','Stripe bill')}>
  <section className="panel meta-bill">
   <header><div><span className="floor-eyebrow">{text('บิลหน้าร้าน','COUNTER BILL')}</span><h2>#{b.code} · {b.total}</h2></div><button className="secondary" onClick={onClose} aria-label={text('ปิด','Close')}><MerchantIcon name="close" /></button></header>
   {b.status==='PENDING'&&b.qrSvg?<><div className="meta-qr" dangerouslySetInnerHTML={{__html:b.qrSvg}} /><p className="notice">{text('ให้ลูกค้าสแกนเพื่อจ่ายบน Stripe Checkout · Stripe sandbox ไม่ใช่เงินจริง · บัตรทดสอบ 4242 4242 4242 4242','Customer scans to pay on Stripe Checkout · Stripe sandbox, not real money · test card 4242 4242 4242 4242')}</p><a className="button secondary" href={b.payUrl} target="_blank" rel="noreferrer">{text('เปิดหน้าชำระเงิน','Open payment page')}</a></>
    :b.status==='PAID'?<div className="meta-paid"><strong>✓ {text('จ่ายแล้ว','Paid')}</strong><span>{text('ยืนยันโดย Stripe webhook · รหัสรับสินค้า','Confirmed by Stripe · pickup code')} #{b.code}</span></div>
    :<p className="notice">{b.status==='EXPIRED'?text('บิลหมดเวลา ไม่มีการตัดเงิน','Bill expired. Nothing was charged.'):text('ยกเลิกหรือคืนเงินแล้ว','Cancelled or refunded.')}</p>}
   <ul className="meta-lines">{b.lines.map((l,i)=><li key={i}><span>{l.emoji} {language==='th'?l.name:l.nameEn} × {l.quantity}</span><strong>{l.amount}</strong></li>)}</ul>
   {b.status!=='PENDING'&&<button onClick={onClose}><MerchantIcon name="receipt" />{text('เริ่มบิลใหม่','New sale')}</button>}
  </section>
 </div>;
}
