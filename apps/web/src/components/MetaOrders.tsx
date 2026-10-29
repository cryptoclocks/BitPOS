// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Meta edition order center, built from the POS order center's own markup (IncomingOrders.tsx): orders that come
// through Meta (NFC tap, Messenger, AI agents over MCP, table and web carts, Stripe counter bills) in the same four
// lanes, as cards that open a detail panel and can be dragged forward: New → Preparing → Ready → Handed over.
// Paid comes only from Stripe (webhook or server lookup). Ready tells a Messenger customer once; owners and
// managers can refund a paid cart order before hand-over. Every move is checked again on the server.
import React, { useEffect, useRef, useState } from 'react';
import MerchantIcon from './MerchantIcon';
import { metaApi } from './MetaCounterBill';

type Stage = 'RECEIVED' | 'PREPARING' | 'READY' | 'COLLECTED';
interface MetaOrder {id:string;channel:string;code:string;status:'CREATED'|'PAID'|'EXPIRED'|'FAILED'|'CANCELLED';emoji:string;name:string;nameEn:string;amountMinor:string;currency:string;createdAt:string;paidAt:string|null;stockShort:boolean;handedOverAt:string|null;stage:Stage}
interface MetaDetail extends MetaOrder {lines:{name:string;nameEn:string;emoji:string;quantity:number;unit:string;amount:string;offer:boolean}[]|null;discount:string|null;total:string|null;tableLabel:string|null;canRefund:boolean}
const CH:Record<string,[string,string]>={tap:['แตะ NFC','NFC tap'],chat:['Messenger','Messenger'],agent:['AI agent','AI agent'],table:['สั่งที่โต๊ะ','Table'],counter:['หน้าร้าน','Counter'],web:['เว็บ','Web']};
const STAGES:Stage[]=['RECEIVED','PREPARING','READY','COLLECTED'];
const rank=(s:Stage)=>STAGES.indexOf(s);

export default function MetaOrders({ token, language }: { token: string; language: 'th' | 'en' }) {
 const text=(th:string,en:string)=>language==='th'?th:en;
 const [orders,setOrders]=useState<MetaOrder[]>([]);const [ch,setCh]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [note,setNote]=useState('');
 const [detail,setDetail]=useState<MetaDetail>();const [dragId,setDragId]=useState('');const [over,setOver]=useState<Stage|''>('');
 const detailRef=useRef<HTMLElement>(null);
 const labels:Record<Stage,string>={RECEIVED:text('ใหม่ / จ่ายแล้ว','New / paid'),PREPARING:text('กำลังทำ','Preparing'),READY:text('พร้อมรับ','Ready for pickup'),COLLECTED:text('ส่งมอบแล้ว','Handed over')};
 const status:Record<string,string>={PAID:text('จ่ายแล้ว','Paid'),CREATED:text('รอจ่าย','Awaiting payment'),EXPIRED:text('หมดเวลา','Expired'),FAILED:text('ไม่สำเร็จ','Failed'),CANCELLED:text('คืนเงินแล้ว','Refunded')};
 const chan=(c:string)=>{const v=CH[c];return v?text(v[0],v[1]):c;};
 const name=(o:{name:string;nameEn:string})=>language==='th'?o.name||o.nameEn:o.nameEn||o.name;
 const money=(o:MetaOrder)=>`${o.currency.toLowerCase()==='usd'?'USD ':o.currency.toUpperCase()+' '}${(Number(o.amountMinor)/100).toFixed(2)}`;
 const at=(iso:string|null)=>iso?new Date(iso).toLocaleTimeString(language==='th'?'th-TH':'en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}):'';
 const load=async()=>{try{const r=await metaApi<{orders:MetaOrder[]}>('/orders',token);setOrders(r.orders);setError('');}catch{setError(text('โหลดออเดอร์ไม่ได้ ลองรีเฟรช','Could not load orders. Try Refresh.'));}};
 const open=async(id:string)=>{try{setDetail(await metaApi<MetaDetail>(`/orders/${id}`,token));setTimeout(()=>detailRef.current?.focus(),0);}catch{setError(text('เปิดรายละเอียดไม่ได้','Could not open the order.'));}};
 useEffect(()=>{void load();const t=setInterval(()=>void load(),10000);return()=>clearInterval(t);},[token]);
 const run=async(o:MetaOrder,to:Stage|'REFUND')=>{
  if(to==='REFUND'&&!confirm(text(`คืนเงินเต็มจำนวน #${o.code} ผ่าน Stripe?`,`Refund #${o.code} in full through Stripe?`)))return;
  setBusy(true);setNote('');
  try{
   if(to==='REFUND')await metaApi(`/orders/${o.id}/refund`,token,{});
   else if(to==='COLLECTED')await metaApi(`/orders/${o.id}/handover`,token,{});
   else{const r=await metaApi<{notified:boolean}>(`/orders/${o.id}/stage`,token,{stage:to});if(to==='READY')setNote(r.notified?text(`แจ้งลูกค้า #${o.code} ใน Messenger แล้ว`,`Told the customer of #${o.code} in Messenger.`):text(`#${o.code} พร้อมรับ (ลูกค้าไม่ได้เชื่อม Messenger)`,`#${o.code} is ready (customer not on Messenger).`));}
   await load();if(detail?.id===o.id)await open(o.id);
  }catch{setError(to==='REFUND'?text('คืนเงินไม่ได้ (เฉพาะออเดอร์ตะกร้าที่จ่ายแล้วและยังไม่ส่งมอบ)','Refund failed (paid cart orders not yet handed over only).'):text('เปลี่ยนสถานะไม่ได้','Could not move the order.'));}
  finally{setBusy(false);}
 };
 const canDrag=(o:MetaOrder)=>o.status==='PAID'&&o.stage!=='COLLECTED';
 const drop=(to:Stage)=>{const o=orders.find(x=>x.id===dragId);setDragId('');setOver('');if(!o)return;
  if(rank(to)<=rank(o.stage)){setNote(text('ย้ายไปข้างหน้าได้เท่านั้น','Orders only move forward.'));return;}void run(o,to);};
 const shown=orders.filter(o=>(!ch||o.channel===ch)&&(o.status==='PAID'||!!o.handedOverAt));
 const other=orders.filter(o=>(!ch||o.channel===ch)&&!o.handedOverAt&&o.status!=='PAID');
 const next=(s:Stage):Stage|null=>s==='RECEIVED'?'PREPARING':s==='PREPARING'?'READY':s==='READY'?'COLLECTED':null;
 const nextLabel:Record<Stage,string>={RECEIVED:'',PREPARING:text('เริ่มทำ','Start preparing'),READY:text('พร้อมรับ · แจ้งลูกค้า','Ready · tell customer'),COLLECTED:text('ส่งมอบแล้ว','Hand over')};
 return <div className={`incoming-board meta-board${detail?' has-detail':''}`}>
  <section className="panel incoming-browser">
   <div className="incoming-heading"><div><p className="eyebrow">MUSE · META</p><h2>{text('ศูนย์ออเดอร์','Order center')}</h2><p>{text('แตะ NFC · Messenger · AI agent · โต๊ะ · เว็บ · หน้าร้าน (Stripe) · 24 ชม. · ลากการ์ดเพื่อเปลี่ยนสถานะ','NFC tap · Messenger · AI agent · table · web · counter (Stripe) · last 24 h · drag a card to move it')}</p></div><button className="secondary" disabled={busy} onClick={()=>void load()}><MerchantIcon name="refresh"/>{text('รีเฟรช','Refresh')}</button></div>
   <div className="order-filters channel-filters" role="group" aria-label={text('ช่องทาง','Channel')}>{[['',text('ทั้งหมด','All')],...Object.keys(CH).map(k=>[k,chan(k)])].map(([k,l])=><button key={k} className={ch===k?'':'secondary'} aria-pressed={ch===k} onClick={()=>setCh(k)}>{l} <span>{orders.filter(o=>!k||o.channel===k).length}</span></button>)}</div>
   {error&&<p className="error" role="alert">{error}</p>}{note&&<p className="notice order-drag-notice" role="status">{note}</p>}
   <div className="incoming-list order-lanes">{STAGES.map(stage=><section key={stage} className={`order-lane lane-${stage.toLowerCase()}${over===stage?' is-drop-target':''}`} aria-label={labels[stage]}
     onDragOver={e=>{if(dragId){e.preventDefault();setOver(stage);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver('');}} onDrop={e=>{e.preventDefault();drop(stage);}}>
    <h2>{labels[stage]} <span>{shown.filter(o=>o.stage===stage).length}</span></h2>
    <div className="order-lane-items" role="region" tabIndex={0} aria-label={labels[stage]}>
     {shown.filter(o=>o.stage===stage).map(o=><button key={o.id} className={`incoming-row order-row${detail?.id===o.id?' is-selected':''}${dragId===o.id?' is-dragging':''}`} disabled={busy} draggable={canDrag(o)}
       onDragStart={e=>{if(!canDrag(o)){e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',o.id);setDragId(o.id);setNote('');}} onDragEnd={()=>{setDragId('');setOver('');}}
       aria-pressed={detail?.id===o.id} aria-label={`${text('ดูออเดอร์','View order')} #${o.code}`} onClick={()=>void open(o.id)}>
      <span className="order-mobile-icon" aria-hidden="true"><MerchantIcon name="receipt"/></span>
      <span className="order-row-main"><strong>#{o.code}<span className="order-mobile-stage"> · {labels[o.stage]}</span></strong><span className="order-origin">{chan(o.channel)}</span><span className="order-items-preview"><span>{o.emoji} {name(o)}</span></span><small>{labels[o.stage]} · <time dateTime={o.paidAt??o.createdAt}>{at(o.handedOverAt??o.paidAt??o.createdAt)}</time>{o.stockShort&&<> · {text('สต็อกไม่พอ','Low stock')}</>}</small></span>
      <span className="order-row-end"><strong>{money(o)}</strong><span className="order-state state-paid">{status[o.status]}</span></span>
      <span className="order-row-open">{text('ดูรายละเอียด','View details')}<MerchantIcon name="arrow"/></span>
     </button>)}
     {!shown.filter(o=>o.stage===stage).length&&<p className="meta-lane-empty">{stage==='RECEIVED'?text('ยังไม่มีออเดอร์ใหม่','No new orders'):text('ลากการ์ดมาที่นี่','Drop a card here')}</p>}
    </div>
   </section>)}</div>
   {other.length>0&&<details className="meta-other"><summary>{text('รอจ่าย / ปิดแล้ว','Awaiting payment / closed')} <span>{other.length}</span></summary><div>{other.map(o=><button key={o.id} className="secondary meta-chip" onClick={()=>void open(o.id)}>#{o.code} · {chan(o.channel)} · {money(o)} · {status[o.status]??o.status}</button>)}</div></details>}
  </section>
  {detail&&<section className="panel incoming-detail" ref={detailRef} tabIndex={-1} aria-label={text('รายละเอียดออเดอร์','Order details')}>
   <div className="incoming-detail-heading"><div><h2>{text('ออเดอร์','Order')} #{detail.code}</h2><p>{chan(detail.channel)}{detail.tableLabel?` · ${detail.tableLabel}`:''} · {status[detail.status]} · {at(detail.paidAt??detail.createdAt)}</p></div><button className="secondary" aria-label={text('ปิดรายละเอียด','Close order details')} onClick={()=>setDetail(undefined)}><MerchantIcon name="close"/></button></div>
   <ul className="bill">{(detail.lines??[{name:detail.name,nameEn:detail.nameEn,emoji:detail.emoji,quantity:1,unit:money(detail),amount:money(detail),offer:false}]).map((l,i)=><li key={i}><span><span className="bill-inline-quantity">{l.quantity} × </span>{l.emoji} {name(l)}<small> · {l.unit} {text('ต่อชิ้น','each')}{l.offer?` · ${text('โปร','offer')}`:''}</small></span><strong>{l.amount}</strong></li>)}</ul>
   {detail.discount&&/[1-9]/.test(detail.discount)&&<div className="total"><span>{text('ส่วนลดที่ร้านอนุมัติ','Approved discount')}</span><strong>−{detail.discount}</strong></div>}
   <div className="total"><span>{detail.status==='PAID'?text('ชำระแล้ว (Stripe)','Paid (Stripe)'):text('ยอดบิล','Bill total')}</span><strong>{detail.total??money(detail)}</strong></div>
   <section className="fulfillment-detail"><h3>{text('สถานะออเดอร์','Order status')}</h3>
    <ol className="meta-steps">{STAGES.map(s=><li key={s} className={rank(s)<=rank(detail.stage)&&detail.status==='PAID'||s==='COLLECTED'&&detail.handedOverAt?'done':''}>{labels[s]}</li>)}</ol>
    {detail.status==='PAID'&&next(detail.stage)&&<button disabled={busy} onClick={()=>void run(detail,next(detail.stage)!)}><MerchantIcon name={next(detail.stage)==='COLLECTED'?'receipt':'check'}/>{nextLabel[next(detail.stage)!]}</button>}
    {detail.status==='PAID'&&detail.stage!=='COLLECTED'&&detail.stage!=='READY'&&<button className="secondary" disabled={busy} onClick={()=>void run(detail,'COLLECTED')}><MerchantIcon name="receipt"/>{text('ส่งมอบเลย','Hand over now')}</button>}
    {detail.canRefund&&detail.status==='PAID'&&!detail.handedOverAt&&<button className="secondary" disabled={busy} onClick={()=>void run(detail,'REFUND')}><MerchantIcon name="back"/>{text('คืนเงินเต็มจำนวนผ่าน Stripe','Refund in full via Stripe')}</button>}
    <p className="notice trust">{text('สถานะ “จ่ายแล้ว” มาจาก Stripe เท่านั้น (webhook ที่ตรวจลายเซ็นหรือการตรวจจากเซิร์ฟเวอร์) · พร้อมรับจะแจ้งลูกค้า Messenger ครั้งเดียว','“Paid” comes only from Stripe (signed webhook or server lookup) · Ready tells a Messenger customer once')}</p>
   </section>
  </section>}
 </div>;
}
