// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Browser terminal (public bill display at the table) for PayPal shops: total in USD, a QR the customer scans to pay
// with PayPal on their phone, and the status the server has verified. Shops without PayPal keep the existing display.
import React, {useEffect, useState} from 'react';
import QRCode from 'qrcode';
import type {OrderView} from '../../../../../packages/contracts/src/index';
import {api, errorMessage} from '../../lib/api';
import {formatMoney} from '../../lib/money';
import OrderBill from '../OrderBill';
import Payment from '../Payment';
import '../../styles/app.css';
import '../../styles/paypal.css';

interface Status {enabled:boolean;amount:{currency:'USD';value:string}|null;checkout:{status:string;captureId:string|null}}

export default function PayPalTerminal({accessToken}:{accessToken:string}){
 const [status,setStatus]=useState<Status|null>();const [order,setOrder]=useState<OrderView>();const [qr,setQr]=useState('');const [error,setError]=useState('');
 const base=`/pay/${encodeURIComponent(accessToken)}`;
 useEffect(()=>{let live=true;
  const load=()=>Promise.all([api<Status>(`${base}/paypal`),api<OrderView>(base)]).then(([s,o])=>{if(!live)return;setStatus(s);setOrder(o);setError('');}).catch(e=>{if(live){setError(errorMessage(e));setStatus(prev=>prev===undefined?null:prev);}});
  void load();const timer=setInterval(()=>void load(),3000);return ()=>{live=false;clearInterval(timer);};},[base]);
 useEffect(()=>{void QRCode.toDataURL(`${location.origin}/pay/${encodeURIComponent(accessToken)}`,{width:280,margin:2}).then(setQr).catch(()=>setQr(''));},[accessToken]);
 if(status===undefined)return <main className="payment"><p role="status">Loading…</p></main>;
 if(status===null||!status.enabled)return <Payment accessToken={accessToken} terminal/>;
 const c=status.checkout.status,paid=c==='paid'||order?.status==='PAID';
 const label=paid?'Paid with PayPal · ชำระแล้ว':c==='confirming'||c==='checking'?'Confirming with PayPal… · กำลังยืนยัน':c==='pending'?'PayPal is reviewing · PayPal กำลังตรวจ':c==='recovery'||c==='mismatch'?'Staff will check this payment · พนักงานจะตรวจ'
  :order&&!['AWAITING_WALLET','AWAITING_PAYMENT'].includes(order.status)?'This bill is closed · บิลนี้ปิดแล้ว':'Scan to pay with PayPal · สแกนเพื่อจ่ายด้วย PayPal';
 return <main className={`payment pp-terminal ${paid?'is-paid':''}`}>
  <header><a className="brand" href="/">◈ BitPOS</a><span className="badge">PayPal Sandbox · USD</span></header>
  <section className="panel">
   <p className="eyebrow">{label}</p>
   <h1>{status.amount?`USD ${status.amount.value}`:order?formatMoney(order.pricing.total):''}</h1>
   {paid?<p className="pp-terminal-paid" role="status">✓ {status.checkout.captureId?`capture …${status.checkout.captureId.slice(-6)}`:''}</p>
    :qr&&!order?.status.match(/EXPIRED|RECOVERY/)&&<img className="pp-terminal-qr" src={qr} width={280} height={280} alt="QR: pay this bill with PayPal"/>}
   {order&&<OrderBill order={order} publicView/>}
   {error&&<p className="error" role="alert">{error}</p>}
   <p className="pp-caption">Test money only · เงินทดสอบ ไม่มีการตัดเงินจริง</p>
  </section>
 </main>;
}
