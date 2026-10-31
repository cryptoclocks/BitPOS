// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Customer pay page for shops with PayPal enabled. Shops without PayPal get the existing Solana <Payment/> unchanged.
// "Paid" is shown only from the server's answer (capture route or order refresh), never from the PayPal window itself.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {OrderView} from '../../../../../packages/contracts/src/index';
import {api, errorMessage} from '../../lib/api';
import {formatMoney} from '../../lib/money';
import {latestOrder} from '../../lib/fulfillment';
import {paypalSession, inAppBrowser, type PayPalSession} from '../../lib/paypal-sdk';
import OrderBill from '../OrderBill';
import Payment from '../Payment';
import '../../styles/app.css';
import '../../styles/customer-checkout.css';
import '../../styles/paypal.css';

type CheckoutStatus='none'|'creating'|'awaiting_approval'|'confirming'|'checking'|'paid'|'recovery'|'pending'|'declined'|'expired'|'failed'|'mismatch';
interface CheckoutView {status:CheckoutStatus;paypalOrderId:string|null;captureId:string|null;amount:{currency:'USD';value:string}|null;issue:string|null}
interface PayPalStatus {enabled:boolean;environment:'sandbox';clientId:string|null;amount:{currency:'USD';value:string}|null;checkout:CheckoutView}
type Ui='idle'|'opening'|'cancelled'|'error'|'browser';

export default function PayPalPayment({accessToken}:{accessToken:string}){
 const [status,setStatus]=useState<PayPalStatus|null>();const [order,setOrder]=useState<OrderView>();
 const [ui,setUi]=useState<Ui>('idle');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [language,setLanguageState]=useState<'th'|'en'>('th');
 const session=useRef<PayPalSession|null>(null);const currentOrderId=useRef<string|null>(null);const base=`/pay/${encodeURIComponent(accessToken)}`;
 const text=(th:string,en:string)=>language==='th'?th:en;
 const setLanguage=(next:'th'|'en')=>{setLanguageState(next);try{localStorage.setItem('bitpos.pay.language',next);}catch{/* this visit only */}};
 useEffect(()=>{try{if(localStorage.getItem('bitpos.pay.language')==='en')setLanguageState('en');}catch{/* default Thai */}},[]);

 const refresh=useCallback(async()=>{
  const [s,o]=await Promise.all([api<PayPalStatus>(`${base}/paypal`),api<OrderView>(base)]);
  currentOrderId.current=s.checkout.paypalOrderId;setStatus(s);setOrder(current=>latestOrder(current,o));return s;
 },[base]);
 useEffect(()=>{
  let active=true;
  // A failed read never switches a PayPal shop to another payment method: show the error and keep retrying.
  void refresh().catch(e=>{if(active)setError(errorMessage(e));});
  const timer=setInterval(()=>{void refresh().then(()=>{if(active)setError('');}).catch(()=>{/* next tick */});},5000);
  return ()=>{active=false;clearInterval(timer);};
 },[refresh]);

 const capture=useCallback(async(paypalOrderId:string)=>{
  setBusy(true);setError('');
  try{const v=await api<CheckoutView>(`${base}/paypal/capture`,{paypalOrderId});setStatus(s=>s?{...s,checkout:v}:s);await refresh();if(v.status==='declined')setUi('error');}
  catch(e){setError(errorMessage(e));}
  finally{setBusy(false);}
 },[base,refresh]);

 // Full-page redirect fallback: PayPal sends the buyer back with ?paypal=return; capture the order this bill already owns.
 useEffect(()=>{
  const params=new URLSearchParams(location.search);const back=params.get('paypal');
  if(!back||!status?.checkout.paypalOrderId)return;
  history.replaceState(null,'',location.pathname);
  if(back==='return'&&['awaiting_approval','checking','confirming'].includes(status.checkout.status))void capture(status.checkout.paypalOrderId);
  if(back==='cancel')setUi('cancelled');
 },[status?.checkout.paypalOrderId,status?.checkout.status,capture]);

 // Prepare the SDK session ahead of the click so start() runs inside the user's click (popup blockers).
 useEffect(()=>{
  if(!status?.enabled||!status.clientId)return;
  if(inAppBrowser()){setUi('browser');return;}
  let active=true;
  void paypalSession(status.clientId,{
   onApprove:async data=>{await capture(data.orderId);},
   onCancel:()=>{setUi('cancelled');const id=currentOrderId.current;if(id)void api(`${base}/paypal/cancel`,{paypalOrderId:id}).catch(()=>{/* informational */});},
   onError:e=>{setUi('error');setError(e instanceof Error&&e.message?e.message:text('PayPal แจ้งข้อผิดพลาด','PayPal reported an error'));}
  }).then(s=>{if(!active)return;session.current=s;if(!s)setUi('browser');}).catch(()=>{if(active){session.current=null;setUi('error');setError(text('โหลด PayPal ไม่ได้ ลองใหม่อีกครั้ง','PayPal could not load. Try again.'));}});
  return ()=>{active=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[status?.enabled,status?.clientId]);

 if(status===undefined)return <main className="customer-checkout"><div className="checkout-shell">{error?<div className="error" role="alert">{error} <button type="button" className="secondary" onClick={()=>{setError('');void refresh().catch(e=>setError(errorMessage(e)));}}>{text('ลองอีกครั้ง','Try again')}</button></div>:<div className="checkout-loading" role="status">{text('กำลังโหลดบิล…','Loading your bill…')}</div>}</div></main>;
 // Not a PayPal shop (or PayPal not configured on this server): the existing checkout, unchanged.
 if(status===null||!status.enabled)return <Payment accessToken={accessToken}/>;

 const pay=()=>{
  if(!session.current){setUi('error');setError(text('PayPal ยังไม่พร้อม','PayPal is not ready yet'));return;}
  setUi('opening');setError('');
  const created=api<CheckoutView>(`${base}/paypal/orders`,{}).then(v=>{currentOrderId.current=v.paypalOrderId;setStatus(s=>s?{...s,checkout:v}:s);if(!v.paypalOrderId)throw new Error(v.status);return {orderId:v.paypalOrderId};});
  session.current.start({presentationMode:'auto'},created).catch(e=>{setUi('error');setError(errorMessage(e));});
 };

 const c=status.checkout.status;const paid=c==='paid'||order?.status==='PAID';
 const orderClosed=!paid&&order&&!['AWAITING_WALLET','AWAITING_PAYMENT'].includes(order.status);
 const canPay=!paid&&!orderClosed&&['none','awaiting_approval','declined','failed','expired'].includes(c)&&ui!=='browser'&&!busy;
 const state:{mark:string;title:string;body:string;tone:string}|null=
  paid?{mark:'✓',title:text('ชำระด้วย PayPal แล้ว','Paid with PayPal'),body:text('ร้านได้รับออร์เดอร์แล้ว','The café has your order.'),tone:'is-paid'}
  :c==='confirming'||busy?{mark:'↻',title:text('กำลังยืนยันการชำระเงินกับ PayPal…','Confirming your payment with PayPal…'),body:text('อย่าปิดหน้านี้และอย่าจ่ายซ้ำ','Keep this page open and do not pay again.'),tone:''}
  :c==='checking'?{mark:'↻',title:text('ยังไม่ทราบผลจาก PayPal กำลังตรวจอีกครั้ง','Still checking with PayPal'),body:text('ห้ามจ่ายซ้ำ ระบบจะอัปเดตเอง','Please don’t pay again. This page updates by itself.'),tone:''}
  :c==='pending'?{mark:'◷',title:text('PayPal กำลังตรวจสอบการชำระเงิน','PayPal is reviewing this payment'),body:text('ร้านจะเห็นออร์เดอร์เมื่อ PayPal ยืนยันแล้ว','The café will see it once PayPal confirms.'),tone:''}
  :c==='recovery'?{mark:'!',title:text('ได้รับเงินแล้ว แต่ต้องให้ร้านตรวจ','Payment received — the café will review it'),body:text('ห้ามจ่ายซ้ำ แจ้งพนักงาน','Do not pay again. Please tell the staff.'),tone:'is-expired'}
  :c==='mismatch'?{mark:'!',title:text('ข้อมูลจาก PayPal ไม่ตรงกับบิล','PayPal’s answer did not match this bill'),body:text('ยังไม่ถือว่าชำระแล้ว ห้ามจ่ายซ้ำ แจ้งพนักงาน','Not marked as paid. Do not pay again; please tell the staff.'),tone:'is-expired'}
  :orderClosed?{mark:'◷',title:text('บิลนี้ชำระไม่ได้แล้ว','This bill can no longer be paid'),body:text('ราคาหมดอายุหรือบิลถูกปิด กรุณาสั่งใหม่','The price expired or the bill was closed. Please order again.'),tone:'is-expired'}
  :null;
 const notice=ui==='cancelled'?text('ยกเลิกแล้ว กดจ่ายอีกครั้งได้','Payment cancelled. You can try again.')
  :c==='declined'?text('PayPal ปฏิเสธวิธีชำระนี้ ลองบัตรหรือบัญชีอื่น','PayPal declined this method. Try another card or account.')
  :c==='expired'&&!orderClosed?text('ราคาหมดอายุ กรุณาตรวจรายการและสั่งใหม่','This price expired. Please review and order again.')
  :c==='failed'?text('เปิด PayPal ไม่สำเร็จ ลองอีกครั้ง','Could not open PayPal. Please try again.'):'';
 const amount=status.amount?`USD ${status.amount.value}`:'';

 return <main lang={language} className={`customer-checkout paypal-checkout ${paid?'checkout-paid':state?'checkout-pending':'checkout-methods'}`}>
  <div className="checkout-shell">
   <header className="checkout-header">
    <img src="/images/bitpos-logo.png" alt="BitPOS" width="132" height="44"/>
    <div className="checkout-header-controls">
     <div className="checkout-language" role="group" aria-label={text('ภาษา','Language')}>
      <button type="button" lang="th" aria-pressed={language==='th'} onClick={()=>setLanguage('th')}>ไทย</button>
      <button type="button" lang="en" aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>English</button>
     </div>
     {order&&<span className="checkout-serving">{order.authority.serving.label}</span>}
    </div>
   </header>
   <p className="pp-sandbox" role="note">{text('PayPal Sandbox · เงินทดสอบ ไม่มีการตัดเงินจริง','PayPal Sandbox — test money only')}</p>
   <div className="checkout-intro"><div><p className="checkout-caption">{text('ชำระบิลของคุณ','Your checkout')}</p><h1 className="checkout-page-title">{state?state.title:text('ชำระเงิน','Pay')}</h1></div></div>
   <article className="checkout-card">
    <section className="checkout-summary" aria-label={text('รายการของคุณ','Your order')}>
     <h2>{text('รายการของคุณ','Your order')}</h2>
     {!order&&<div className="checkout-loading" role="status">{text('กำลังโหลดบิล…','Loading your bill…')}</div>}
     {order&&<><OrderBill order={order} customer language={language}/>
      <div className="checkout-bill-total"><span>{text('ยอดรวม','Total')}</span><strong>{amount||formatMoney(order.pricing.total)}</strong></div></>}
     <aside className="checkout-safety"><span aria-hidden="true">✓</span><div><strong>{text('ยอดนี้มาจากบิลของร้าน','This amount comes from the café’s bill')}</strong><p>{text('ราคาล็อกไว้ที่เซิร์ฟเวอร์ของร้าน ไม่ได้มาจากเบราว์เซอร์','The price is locked on the café’s server, not set by your browser.')}</p></div></aside>
    </section>
    <div className="checkout-payment-stage"><div className="checkout-content">
     {state&&<section className={`checkout-state ${state.tone}`} aria-label={text('สถานะการชำระเงิน','Payment progress')}>
      <span className="checkout-progress-mark" aria-hidden="true">{state.mark}</span><h2 className="checkout-state-title" role="status">{state.title}</h2><p>{state.body}</p>
      {paid&&status.checkout.captureId&&<p className="pp-capture">{text('ชำระด้วย PayPal','Paid with PayPal')} · {amount} · {text('รหัส','capture')} …{status.checkout.captureId.slice(-6)}</p>}
     </section>}
     {notice&&<p className="checkout-help" role="status">{notice}</p>}
     {error&&!paid&&<div className="error" role="alert">{error}</div>}
     {ui==='browser'&&!paid&&<section className="pp-browser" role="note"><strong>{text('เปิดหน้านี้ใน Safari หรือ Chrome เพื่อจ่ายด้วย PayPal','Open this page in Safari or Chrome to pay with PayPal')}</strong>
      <button type="button" className="secondary" onClick={()=>{void navigator.clipboard?.writeText(location.href);}}>{text('คัดลอกลิงก์','Copy link')}</button></section>}
     {canPay&&<>
      <button type="button" className="pp-button" disabled={ui==='opening'&&c==='creating'} onClick={pay}>{text('ชำระด้วย PayPal','Pay with PayPal')}{amount&&<span> · {amount}</span>}</button>
      <p className="pp-caption">{text('หน้าต่าง PayPal จะเปิดให้คุณเข้าสู่ระบบและอนุมัติ','A PayPal window opens for you to sign in and approve.')}</p>
     </>}
    </div></div>
    <details className="checkout-details"><summary>{text('รายละเอียดการชำระเงิน','Payment details')}</summary>
     <dl>{order&&<><dt>{text('รหัสออเดอร์','Order ID')}</dt><dd>{order.id}</dd></>}
      <dt>{text('วิธีชำระ','Method')}</dt><dd>PayPal (Sandbox)</dd>
      {status.checkout.paypalOrderId&&<><dt>PayPal order</dt><dd>{status.checkout.paypalOrderId}</dd></>}
      {status.checkout.captureId&&<><dt>PayPal capture</dt><dd>{status.checkout.captureId}</dd></>}</dl>
     <p>{text('การอนุมัติในหน้าต่าง PayPal ยังไม่ถือว่าจ่ายแล้ว เซิร์ฟเวอร์ของร้านต้องตรวจยอด สกุลเงิน และผู้รับเงินกับ PayPal ก่อน','Approving in the PayPal window is not proof of payment: the café’s server checks amount, currency and payee with PayPal first.')}</p>
    </details>
   </article>
   <footer className="checkout-footer"><span>Powered by BitPOS</span><small>{text('PayPal เป็นเครื่องหมายการค้าของ PayPal, Inc.','PayPal is a trademark of PayPal, Inc.')}</small></footer>
  </div>
 </main>;
}
