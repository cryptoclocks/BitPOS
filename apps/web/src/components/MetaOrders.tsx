// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Meta edition order center: orders that come through Meta (NFC tap, Messenger chat and cart, AI agents over MCP,
// table and web carts, Stripe counter bills) in the POS lane layout. Paid comes only from Stripe (webhook or
// server lookup); here staff hand an order over once, and owners/managers can refund a cart order before hand-over.
import React, { useEffect, useState } from 'react';
import MerchantIcon from './MerchantIcon';
import { metaApi } from './MetaCounterBill';

interface MetaOrder {id:string;channel:string;code:string;status:'CREATED'|'PAID'|'EXPIRED'|'FAILED'|'CANCELLED';emoji:string;name:string;nameEn:string;amountMinor:string;currency:string;createdAt:string;paidAt:string|null;stockShort:boolean;handedOverAt:string|null}
const CH:Record<string,[string,string]>={tap:['แตะ NFC','NFC tap'],chat:['Messenger','Messenger'],agent:['AI agent','AI agent'],table:['สั่งที่โต๊ะ','Table'],counter:['หน้าร้าน','Counter'],web:['เว็บ','Web']};
const CART=new Set(['table','counter','web','chat']);

export default function MetaOrders({ token, language }: { token: string; language: 'th' | 'en' }) {
 const text=(th:string,en:string)=>language==='th'?th:en;
 const [orders,setOrders]=useState<MetaOrder[]>([]);const [canRefund,setCanRefund]=useState(false);
 const [ch,setCh]=useState('');const [busy,setBusy]=useState('');const [error,setError]=useState('');
 const load=async()=>{try{const r=await metaApi<{orders:MetaOrder[];canRefund:boolean}>('/orders',token);setOrders(r.orders);setCanRefund(r.canRefund);setError('');}catch{setError(text('โหลดออเดอร์ Meta ไม่ได้','Could not load Meta orders.'));}};
 useEffect(()=>{void load();const t=setInterval(()=>void load(),10000);return()=>clearInterval(t);},[token]);
 const act=async(o:MetaOrder,kind:'handover'|'refund')=>{
  if(kind==='refund'&&!confirm(text(`คืนเงินเต็มจำนวน #${o.code} ผ่าน Stripe?`,`Refund #${o.code} in full through Stripe?`)))return;
  setBusy(o.id);try{await metaApi(`/orders/${o.id}/${kind}`,token,{});await load();}catch{setError(kind==='refund'?text('คืนเงินไม่ได้ (คืนได้เฉพาะออเดอร์ตะกร้าที่จ่ายแล้วและยังไม่ส่งมอบ)','Refund failed (paid cart orders not yet handed over only).'):text('ส่งมอบไม่ได้','Hand-over failed.'));}finally{setBusy('');}
 };
 const money=(o:MetaOrder)=>`${o.currency.toLowerCase()==='usd'?'$':o.currency.toUpperCase()+' '}${(Number(o.amountMinor)/100).toFixed(2)}`;
 const at=(iso:string|null)=>iso?new Date(iso).toLocaleTimeString(language==='th'?'th-TH':'en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}):'';
 const shown=orders.filter(o=>!ch||o.channel===ch);
 const lanes:[string,string,(o:MetaOrder)=>boolean][]=[[text('จ่ายแล้ว · รอส่งมอบ','Paid · to hand over'),'received',o=>o.status==='PAID'&&!o.handedOverAt],[text('รอจ่าย','Awaiting payment'),'preparing',o=>o.status==='CREATED'],[text('ส่งมอบแล้ว','Handed over'),'collected',o=>!!o.handedOverAt],[text('ปิดแล้ว','Closed'),'ready',o=>!o.handedOverAt&&['EXPIRED','FAILED','CANCELLED'].includes(o.status)]];
 const status:Record<string,string>={PAID:text('จ่ายแล้ว','Paid'),CREATED:text('รอจ่าย','Awaiting payment'),EXPIRED:text('หมดเวลา','Expired'),FAILED:text('ไม่สำเร็จ','Failed'),CANCELLED:text('คืนเงินแล้ว','Refunded')};
 return <div className="incoming-board meta-board"><section className="panel incoming-browser meta-orders">
  <div className="incoming-heading"><div><span className="eyebrow">MUSE · META</span><h2>{text('ออเดอร์จาก Meta','Orders from Meta')}</h2><p>{text('แตะ NFC · Messenger · AI agent · โต๊ะ · เว็บ · หน้าร้าน (Stripe) · 24 ชม.','NFC tap · Messenger · AI agent · table · web · counter (Stripe) · last 24 h')}</p></div><button className="secondary" onClick={()=>void load()}><MerchantIcon name="refresh"/>{text('รีเฟรช','Refresh')}</button></div>
  <div className="order-filters channel-filters">{[['',text('ทั้งหมด','All')],...Object.entries(CH).map(([k,v])=>[k,text(v[0],v[1])])].map(([k,l])=><button key={k} className={ch===k?'':'secondary'} aria-pressed={ch===k} onClick={()=>setCh(k)}>{l} <span>{orders.filter(o=>!k||o.channel===k).length}</span></button>)}</div>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="incoming-list order-lanes">{lanes.map(([label,cls,f])=><section className={`order-lane lane-${cls}`} key={cls} aria-label={label}><h2>{label} <span>{shown.filter(f).length}</span></h2>
   <div className="order-lane-items">{shown.filter(f).map(o=><div className="incoming-row order-row" key={o.id}>
    <div className="order-row-main"><strong>#{o.code}</strong><span className="order-origin">{text(...(CH[o.channel]??[o.channel,o.channel]) as [string,string])}</span><span className="order-items-preview">{o.emoji} {language==='th'?o.name||o.nameEn:o.nameEn||o.name}</span>{o.stockShort&&<span className="error">{text('สต็อกไม่พอ','Low stock')}</span>}</div>
    <div className="order-row-end"><strong>{money(o)}</strong><small>{status[o.status]??o.status} · {at(o.handedOverAt??o.paidAt??o.createdAt)}</small>
     {o.status==='PAID'&&!o.handedOverAt&&<button disabled={busy===o.id} onClick={()=>void act(o,'handover')}><MerchantIcon name="check"/>{text('ส่งมอบ','Hand over')}</button>}
     {canRefund&&o.status==='PAID'&&!o.handedOverAt&&CART.has(o.channel)&&<button className="secondary" disabled={busy===o.id} onClick={()=>void act(o,'refund')}><MerchantIcon name="back"/>{text('คืนเงิน','Refund')}</button>}</div>
   </div>)}{!shown.filter(f).length&&<p className="orders-empty">{text('ไม่มี','None')}</p>}</div></section>)}</div>
 </section></div>;
}
