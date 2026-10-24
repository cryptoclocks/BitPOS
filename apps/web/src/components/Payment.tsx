import React, { useEffect, useRef, useState } from 'react';
import { avatar, pendingPayment, resumePayment, forgetPayment, discoverWallets, phantomBrowseUrl, submitPayment, type ConnectedWallet, type WalletChoice } from '../lib/wallet';
import type { OrderView, PaymentAssetsView, PaymentAssetSelection } from '../../../../packages/contracts/src/index';
import { decimalAmount, formatMoney } from '../lib/money';
import { api, ApiError, errorMessage } from '../lib/api';
import { decodePaymentAssets, settlementLabel, selectedAssetMatches, pendingAssetSelection, saveAssetSelection, forgetAssetSelection } from '../lib/payment-assets';
import OrderBill, { SettlementTrust } from './OrderBill';
import {finishGuestOrder} from '../lib/table-guest';
import {pendingX402,resumeX402,submitX402,forgetX402} from '../lib/x402-payment';
import CustomerConsent from './CustomerConsent';
import {decodePayCustomerContext,type PayCustomerContext} from '../lib/customer-session';
import {latestOrder} from '../lib/fulfillment';
import '../styles/app.css';
import '../styles/customer-checkout.css';

const paymentStagesTh: Readonly<Record<string, string>> = {
  'Checking saved x402 payment…': 'กำลังตรวจสอบการชำระ x402 ที่บันทึกไว้…',
  'Checking your saved payment…': 'กำลังตรวจสอบการชำระที่บันทึกไว้…',
  'Checking your original payment…': 'กำลังตรวจสอบการชำระครั้งเดิม…',
  'Opening your wallet…': 'กำลังเปิดกระเป๋าเงิน…',
  'Preparing your payment…': 'กำลังเตรียมการชำระเงิน…',
  'Approve payment in your wallet…': 'อนุมัติการชำระในกระเป๋าเงินของคุณ…',
  'Sending your payment…': 'กำลังส่งการชำระเงิน…',
  'Approve exact USDC payment in wallet…': 'อนุมัติการชำระ USDC ตามยอดในกระเป๋าเงิน…',
  'Sending SDK x402 payment…': 'กำลังส่งการชำระผ่าน SDK x402…',
};

export function WalletAvatar({ address }: { address: string }) {
  const pattern = avatar(address);
  return <svg role="img" aria-label="Wallet avatar" viewBox="0 0 5 5" className="avatar">{pattern.cells.map((on, i) => on && <rect key={i} x={i % 5} y={Math.floor(i / 5)} width="1" height="1" fill={pattern.color} />)}</svg>;
}
export default function Payment({ accessToken, terminal = false }: { accessToken: string; terminal?: boolean }) {
  const [order, setOrder] = useState<OrderView>(); const [error, setError] = useState(''); const [connectionError, setConnectionError] = useState(''); const [busy, setBusy] = useState(false);
  const [readFailureKind,setReadFailureKind]=useState<'denied'|'unavailable'|'transient'>(),[billRefreshing,setBillRefreshing]=useState(false);
  const retryBillRead=useRef<(()=>Promise<void>)|undefined>(undefined);
  const [wallet, setWallet] = useState<ConnectedWallet>(); const [payStage,setPayStage]=useState(''); const [returnAt,setReturnAt]=useState(0); const [returnUrl,setReturnUrl]=useState<string|null>(null); const [submitted, setSubmitted] = useState(''); const [choices, setChoices] = useState<WalletChoice[]>([]); const [now, setNow] = useState(0); const working = useRef(false);
  const [assets, setAssets] = useState<PaymentAssetsView>(); const [assetError, setAssetError] = useState(''); const [selection, setSelection] = useState<PaymentAssetSelection | null>(null); const [journalError, setJournalError] = useState(''); const [assetRefresh, setAssetRefresh] = useState(0);
  const [customerAuthBusy,setCustomerAuthBusy]=useState(false);
  const [customerContext,setCustomerContext]=useState<PayCustomerContext>();
  const [done,setDone]=useState(false);
  const [language, setLanguage] = useState<'en' | 'th'>('en');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const text = (th: string, en: string) => language === 'th' ? th : en;
  useEffect(() => {
    const media = window.matchMedia('(min-width:1000px)');
    const sync = () => setSummaryOpen(media.matches);
    sync(); media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const restore = () => {
      try { setSelection(pendingAssetSelection(accessToken)); pendingPayment(accessToken);pendingX402(accessToken);setJournalError(''); }
      catch { setJournalError('Saved payment data is unavailable or invalid. Do not pay or change assets; ask the cafe team for help.'); }
    };
    restore(); window.addEventListener('storage', restore);
    return () => window.removeEventListener('storage', restore);
  }, [accessToken]);
  useEffect(() => {
    if (terminal || !order) return;
    let active = true; setAssets(undefined);
    void api<unknown>(`/pay/${encodeURIComponent(accessToken)}/assets`).then(decodePaymentAssets).then(next => {
      if (active) { setAssets(next); setAssetError(''); }
    }).catch(error => { if (active) setAssetError(errorMessage(error)); });
    return () => { active = false; };
  }, [accessToken, terminal, order?.version, assetRefresh]);
  useEffect(() => {
    let active = true; let inFlight = false; let readReady = false;
    const emulatorFixture = import.meta.env.PUBLIC_BITPOS_AVD_FIXTURE === '1' && location.origin === 'http://10.0.2.2:4321';
    if (!terminal && !emulatorFixture && location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      void fetch('/images/customer-checkout-origin.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(config => {
        if (!active || !config?.origin) return;
        const destination = new URL(config.origin);
        if (destination.protocol !== 'https:' || destination.pathname !== '/' || destination.username || destination.password) return;
        destination.pathname = location.pathname;
        destination.search = location.search;
        location.replace(destination.href);
      }).catch(() => { if (active) setError('Phantom requires HTTPS. Ask the cashier for the secure payment link.'); });
    }
    setOrder(undefined); setCustomerContext(undefined); setWallet(undefined); setSubmitted('');setConnectionError('');setReadFailureKind(undefined);setBillRefreshing(false);
    const poll = async () => {
      if (!active || inFlight) return; inFlight = true;setBillRefreshing(true);
      try { const next = await api<OrderView&{customerContext:unknown}>(`/pay/${encodeURIComponent(accessToken)}`); const context=decodePayCustomerContext(next.customerContext,accessToken); if (active) { readReady=true;setCustomerContext(context); setOrder(current => latestOrder(current,next)); setConnectionError('');setReadFailureKind(undefined); } }
      catch (error) {
        if (!active) return;
        readReady=false;
        const denied=error instanceof ApiError&&(error.status===401||error.status===403),unavailable=error instanceof ApiError&&error.status===404;
        if(denied||unavailable){setOrder(undefined);setCustomerContext(undefined);setAssets(undefined);}
        setConnectionError(errorMessage(error));setReadFailureKind(denied?'denied':unavailable?'unavailable':'transient');
      }
      finally { inFlight = false;if(active)setBillRefreshing(false); }
    };
    retryBillRead.current=poll;
    // Cloudflare Quick Tunnels buffer SSE. Use bounded non-overlapping polling there.
    const quickTunnel=location.hostname.endsWith('.trycloudflare.com');
    void poll(); const timer = setInterval(() => { setNow(Date.now()); void poll(); }, quickTunnel?1000:5000);
    const stream=quickTunnel?undefined:new EventSource(`/api/pay/${encodeURIComponent(accessToken)}/events`);
    if(stream){stream.onmessage=event=>{if(!active||!readReady)return;try{const next=JSON.parse(event.data) as OrderView;setOrder(current=>latestOrder(current,next));}catch{void poll();}};stream.onerror=()=>void poll();}
    const refreshWallets = () => { if (!terminal) void discoverWallets().then(next => { if (active) setChoices(next); }).catch(() => { if (active) setError('Wallet discovery unavailable. Open this exact order in Phantom.'); }); };
    refreshWallets();
    // Mobile providers can be injected after React mounts or after returning from approval.
    const walletTimer = setInterval(refreshWallets, 1500);
    window.addEventListener('focus', refreshWallets);
    return () => { active = false;if(retryBillRead.current===poll)retryBillRead.current=undefined; stream?.close(); clearInterval(timer); clearInterval(walletTimer); window.removeEventListener('focus', refreshWallets); };
  }, [accessToken, terminal]);
  async function action(run: () => Promise<void>) {
    if (working.current || customerAuthBusy) return; working.current = true; setBusy(true); setError('');
    try { await run(); } catch (error) { setError(errorMessage(error)); }
    finally { working.current = false; setAssets(undefined); setBusy(false); setAssetRefresh(value => value + 1); }
  }
  useEffect(()=>{if(order?.status==='PAID'){forgetPayment(accessToken);forgetX402(accessToken);}},[order?.status,accessToken]);
  let hasSavedPayment=false,hasSavedX402=false;try{hasSavedX402=!!pendingX402(accessToken);hasSavedPayment=hasSavedX402||!!pendingPayment(accessToken);}catch{hasSavedPayment=true;}
  const final = order && ['PAID', 'EXPIRED', 'RECOVERY'].includes(order.status);
  const expired = order ? Date.parse(order.quoteExpiresAt) <= (now || Date.now()) : false;
  const acceptanceEnded=!!order?.onlineAcceptance&&(['REJECTED','TIMED_OUT'].includes(order.onlineAcceptance.status)||(order.onlineAcceptance.status==='PENDING'&&Date.parse(order.onlineAcceptance.deadline)<=(now||Date.now())));
  const assetsReady = !!assets && !!order && selectedAssetMatches(assets, order.settlement);
  const blocked = busy || customerAuthBusy || !order || !!final || expired || acceptanceEnded || !!connectionError || !!journalError || !!selection || (!hasSavedPayment && !assetsReady);
  const replayBlocked=busy||customerAuthBusy||!order||order.status==='PAID'||!!connectionError||!!journalError||!!selection;
  const switchLocked = blocked || hasSavedPayment || !!submitted || order?.status === 'CONFIRMING' || !assets?.canChange;
  const chooseAsset = (assetId?: string) => void action(async () => {
    const saved = pendingAssetSelection(accessToken);
    if (!saved && (!order || switchLocked || !assetId || !assets?.assets.some(option => option.asset.assetId === assetId))) return;
    const request = saved ?? { assetId: assetId!, expectedVersion: order!.version, idempotencyKey: crypto.randomUUID() };
    saveAssetSelection(accessToken, request); setSelection(request);
    try {
      const result = await api<{ order: OrderView; replayed: boolean }>(`/pay/${encodeURIComponent(accessToken)}/asset`, request);
      if (!result.order || result.order.id !== order?.id || !Number.isSafeInteger(result.order.version) || typeof result.replayed !== 'boolean') throw new Error('Asset change response unavailable. Retry the saved selection.');
      forgetAssetSelection(accessToken); setSelection(null);
      setOrder(current => latestOrder(current,result.order));
    } catch (error) {
      if (error instanceof ApiError && error.definiteRefusal && error.code !== 'IDEMPOTENCY_CONFLICT') { forgetAssetSelection(accessToken); setSelection(null); }
      throw error;
    }
  });

  const primaryChoice = choices.find(choice => choice.name === 'Phantom') ?? choices.find(choice => choice.name.startsWith('TEST WALLET FIXTURE'));
  const fixture = wallet?.fixture || choices.some(choice => choice.name.startsWith('TEST WALLET FIXTURE'));
  const [whole, fraction = ''] = order ? decimalAmount(order.settlement).split('.') : [];
  const amount = order ? `${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}` : '';
  const paid = order?.status === 'PAID';
  const confirming = order?.status === 'CONFIRMING';
  const sending = !!submitted && !final && !confirming;
  const savedRecovery=hasSavedPayment&&!paid;
  const unavailable = !savedRecovery&&(order?.status === 'EXPIRED' || (!paid && !confirming && !sending && expired));
  const recovery = order?.status === 'RECOVERY';
  const paymentSignature = order?.paymentSignature || submitted;
  const title = paid ? text('ชำระเงินสำเร็จ', 'Payment received') : recovery ? text('การชำระเงินต้องตรวจสอบ', 'Payment needs review') : confirming ? text('กำลังยืนยันการชำระเงิน', 'Confirming your payment') : savedRecovery ? text('ตรวจสอบการชำระครั้งเดิม', 'Check your original payment') : unavailable ? text('บิลนี้หมดเวลาแล้ว', 'This order has expired') : sending ? text('กำลังส่งการชำระเงิน', 'Sending your payment') : text('ตรวจสอบและชำระเงิน', 'Review and pay');
  const pay = (choice?:WalletChoice) => void action(async()=>{
    if (pendingAssetSelection(accessToken) || journalError) throw new Error('Resolve the saved asset selection before paying.');
    if (blocked) return;
    if(pendingX402(accessToken)){setPayStage('Checking saved x402 payment…');const result=await resumeX402(accessToken);setSubmitted(result.signature);return;}
    if(pendingPayment(accessToken)){setPayStage('Checking your saved payment…');const result=await resumePayment(accessToken,api);setSubmitted(result.signature);return;}
    setPayStage('Opening your wallet…');const connected=wallet??(choice?await choice.connect():undefined);
    if(!connected)throw new Error('Open this bill in Phantom to pay.');setWallet(connected);setPayStage('Preparing your payment…');
    const result=await submitPayment(accessToken,connected,api,phase=>setPayStage(phase==='signing'?'Approve payment in your wallet…':'Sending your payment…'));setSubmitted(result.signature);setPayStage('');
  });
  const checkSaved=()=>void action(async()=>{
    if(replayBlocked)return;
    setPayStage('Checking your original payment…');
    const result=pendingX402(accessToken)?await resumeX402(accessToken):await resumePayment(accessToken,api);
    setSubmitted(result.signature);
  });
  const payX402=()=>void action(async()=>{
    if(pendingAssetSelection(accessToken)||journalError||pendingPayment(accessToken))throw Error('Resolve the existing saved payment before choosing x402');
    if(blocked||!order)return;
    if(pendingX402(accessToken)){const result=await resumeX402(accessToken);setSubmitted(result.signature);return;}
    const connected=wallet??(primaryChoice?await primaryChoice.connect():undefined);if(!connected)throw Error('Connect a sign-only Solana wallet');setWallet(connected);
    const result=await submitX402(accessToken,connected,order,setPayStage);setSubmitted(result.signature);setPayStage('');
  });
  useEffect(()=>{if(!returnAt||!returnUrl)return;const timer=setTimeout(()=>location.assign(returnUrl),Math.max(0,returnAt-Date.now()));return()=>clearTimeout(timer);},[returnAt,returnUrl]);
  if (terminal) return <main className="payment"><header><a className="brand" href="/">◈ BitPOS</a><span className="badge">Solana DEVNET · {order ? settlementLabel(order.settlement) : 'Test assets'}</span></header><section className="panel"><p className="eyebrow">Pay this order / <span lang="th">ชำระบิล</span></p><h1>{order ? formatMoney(order.pricing.total) : 'Loading order…'}</h1>{order && <><OrderBill order={order} publicView /><p>Quote expires: {new Date(order.quoteExpiresAt).toLocaleString()}</p></>}{connectionError && <p className="error" role="alert">{connectionError}</p>}</section></main>;
  const stageText = language === 'th' ? paymentStagesTh[payStage] || 'กำลังดำเนินการ โปรดรอ…' : payStage || 'Please wait…';
  const progress = paid || confirming || sending || unavailable || recovery || savedRecovery;
  return <main lang={language} className={`customer-checkout ${paid ? 'checkout-paid' : progress ? 'checkout-pending' : 'checkout-methods'}`}>
    <div className="checkout-shell">
      <header className="checkout-header">
        <img src="/images/bitpos-logo.png" alt="BitPOS" width="132" height="44" />
        <div className="checkout-header-controls">
          <div className="checkout-language" role="group" aria-label={text('ภาษา', 'Language')}>
            <button type="button" lang="th" aria-pressed={language === 'th'} onClick={() => setLanguage('th')}>ไทย</button>
            <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
          </div>
          {order && <span className="checkout-serving">{order.authority.serving.label}</span>}
        </div>
      </header>
      <div className={`checkout-intro ${customerContext ? 'has-back' : ''}`}>
        {customerContext && <a className="checkout-back" href={customerContext.menuUrl} aria-label={text('กลับไปดูเมนู บิลนี้ไม่เปลี่ยน', 'Back to menu; this bill is unchanged')}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></a>}
        <div><p className="checkout-caption">{text('ชำระบิลของคุณ', 'Your checkout')}</p><h1 className="checkout-page-title">{order ? title : text('ชำระเงินอย่างมั่นใจ', 'Pay with confidence')}</h1></div>
        <span className="checkout-network">Solana devnet · {order ? settlementLabel(order.settlement) : text('สินทรัพย์ทดสอบ', 'Test assets')}</span>
      </div>
      {fixture && <p className="fixture">TEST WALLET FIXTURE — {text('ทดสอบเบราว์เซอร์อัตโนมัติเท่านั้น ไม่ใช่การทดสอบมือถือจริง', 'browser automation only, not a real mobile test')}</p>}
      <article className="checkout-card">
        <details className="checkout-summary" open={summaryOpen} onToggle={event => setSummaryOpen(event.currentTarget.open)}>
          <summary><h2>{text('รายการของคุณ', 'Your order')}</h2>{order && <span title={order.id}>#{order.id.slice(0, 8)} · {order.authority.serving.label}</span>}</summary>
          {!order && !connectionError && <div className="checkout-loading" role="status">{text('กำลังโหลดบิล…', 'Loading your bill…')}</div>}
          {order && <>
            <OrderBill order={order} customer language={language} />
            <div className="checkout-bill-total"><span>{text('ยอดรวมตามบิล', 'Bill total')}</span><strong>{formatMoney(order.pricing.total)}</strong></div>
            <p className="checkout-context">{order.authority.serving.label} · {text('เปิดดูเมนูโดยไม่เปลี่ยนรายการในบิลนี้', 'Viewing the menu does not change this bill.')}</p>
            <div className="checkout-summary-actions">
              {customerContext && <a className="button secondary" href={customerContext.menuUrl}>{text('ดูเมนู', 'View menu')}</a>}
              <a className="button secondary" href="#checkout-payment-details" onClick={() => { const details = document.getElementById('checkout-payment-details'); if (details instanceof HTMLDetailsElement) details.open = true; }}>{text('ดูรายละเอียดบิล', 'View bill details')}</a>
            </div>
            <aside className="checkout-safety"><span aria-hidden="true">✓</span><div><strong>{text('ตรวจสอบยอดก่อนยืนยัน', 'Check the amount before approval')}</strong><p>{text('ข้อมูลในหน้านี้มาจากบิลของร้าน หากส่งธุรกรรมแล้ว ให้ตรวจรายการเดิมแทนการชำระซ้ำ', 'These amounts come from the merchant’s bill. If already submitted, check the original attempt instead of paying again.')}</p></div></aside>
          </>}
        </details>
        <div className="checkout-content">
          {journalError && <div className="error" role="alert"><strong>{text('ข้อมูลการชำระที่บันทึกไว้มีปัญหา ห้ามชำระหรือเปลี่ยนสินทรัพย์ ติดต่อร้านเพื่อช่วยตรวจสอบ', 'Saved payment data needs review. Do not pay or change assets; ask the cafe team for help.')}</strong><p>{journalError}</p></div>}
          {(error || connectionError) && <div className="error" role="alert"><strong>{connectionError ? readFailureKind==='denied'?text('ไม่มีสิทธิ์เปิดบิลนี้', 'Bill access denied'):readFailureKind==='unavailable'?text('บิลนี้ไม่พร้อมใช้งาน', 'This bill is unavailable'):text('ไม่สามารถอัปเดตบิลได้', 'Bill update unavailable') : text('คำขอชำระเงินไม่สำเร็จ', 'Payment request unsuccessful')}</strong><p>{connectionError || error}</p>{connectionError && <><small>{text('จะเชื่อมต่อใหม่อัตโนมัติ หากส่งการชำระแล้ว อย่าชำระซ้ำ', 'We will reconnect automatically. Do not pay again if you already submitted.')}</small><button type="button" className="secondary" disabled={billRefreshing} aria-busy={billRefreshing} onClick={()=>void retryBillRead.current?.()}>{text('ลองอ่านบิลอีกครั้ง', 'Retry bill read')}</button></>}</div>}
          {!order && !connectionError && <div className="checkout-loading" role="status">{text('กำลังโหลดบิลและยอดชำระ…', 'Loading your bill and payment amount…')}</div>}
          {order && <>
            {progress && <section className={`checkout-state ${paid ? 'is-paid' : ''}`} aria-label={text('สถานะการชำระเงิน', 'Payment progress')}>
              <span className="checkout-progress-mark" aria-hidden="true">{paid ? '✓' : recovery || unavailable ? '!' : '↻'}</span>
              <h2 className="checkout-state-title" role="status">{title}</h2>
              <p>{paid ? acceptanceEnded ? text('ได้รับชำระแล้ว แต่ร้านจะไม่เตรียมออร์เดอร์นี้ ติดตามการคืนเงินแยกต่างหาก', 'Payment was received; this order will not be prepared. Any refund is tracked separately.') : text('ร้านได้รับการยืนยันการชำระเงินแล้ว ขอบคุณครับ', 'The server has confirmed payment. Thank you!') : recovery ? text('อย่าชำระซ้ำ ให้ร้านตรวจสอบการชำระนี้', 'Do not pay again. Ask the merchant to review this payment.') : savedRecovery ? text('ตรวจสอบธุรกรรมเดิมเท่านั้น การหมดเวลาของบิลไม่ได้ยืนยันผลการชำระ', 'Check only the original attempt. A quote deadline does not resolve a saved payment.') : confirming ? text('กำลังตรวจสอบ โปรดรอและอย่าชำระซ้ำ', 'Please wait. Do not pay again.') : unavailable ? text('อย่าชำระบิลนี้ ติดต่อร้านเพื่อขอออร์เดอร์ใหม่', 'Do not pay this bill. Ask the merchant for a new order.') : text('กำลังส่งการชำระเงิน โปรดอย่าชำระซ้ำ', 'Sending payment. Please do not pay again.')}</p>
            </section>}
            <div className="checkout-total"><span>{paid ? text('ยอดชำระแล้ว', 'Amount paid') : text('ยอดชำระ', 'Total to pay')}</span><strong>{amount}<span> {order.settlement.currency}</span></strong>{paid && <small>{text('ยอดบิล', 'Bill total')} {formatMoney(order.pricing.total)}</small>}</div>
            <p className="checkout-test-notice">{settlementLabel(order.settlement)} · {text('โทเคนทดสอบ ไม่ใช่เงินจริงที่แลกคืนได้', 'test tokens, not redeemable money')}</p>
            {!progress && <div className="checkout-method" aria-label={text('วิธีชำระเงินที่รองรับ', 'Available payment method')}>
              <span className="checkout-method-icon" aria-hidden="true">▣</span>
              <div><strong>{wallet?.name || primaryChoice?.name || text('กระเป๋า Solana · Phantom', 'Solana wallet · Phantom')}</strong><small>{wallet ? text('เชื่อมต่อแล้ว', 'Connected') : primaryChoice ? text('กระเป๋าที่พบในเบราว์เซอร์นี้', 'Wallet available in this browser') : text('เปิดบิลนี้ในเบราว์เซอร์ Phantom', 'Open this bill in the Phantom browser')}</small></div>
            </div>}
            {(!final || selection) && <section className="checkout-assets" aria-label={text('สินทรัพย์ชำระเงิน', 'Payment asset')}>
              <label htmlFor="payment-asset">{text('สินทรัพย์ที่เลือก', 'Selected payment asset')}</label>
              <select id="payment-asset" value={assetsReady ? assets!.selectedAssetId : ''} aria-describedby="payment-asset-quote" disabled={switchLocked} onChange={event => chooseAsset(event.target.value)}>
                {!assetsReady && <option value="">{text('กำลังตรวจสอบสินทรัพย์…', 'Checking payment assets…')}</option>}
                {assets?.assets.map(({ asset }) => <option key={asset.assetId} value={asset.assetId}>{asset.displayLabel}</option>)}
              </select>
              <p id="payment-asset-quote" className="checkout-asset-quote">{formatMoney(order.settlement)}</p>
              {switchLocked && !selection && <p role="status">{!assets ? text('กำลังตรวจสอบสินทรัพย์ที่เซิร์ฟเวอร์อนุญาต…', 'Checking server-authorized payment assets…') : text('ล็อกการเปลี่ยนสินทรัพย์ระหว่างรอการชำระหรือการตรวจสอบ', 'Asset changes are locked while a payment or reconciliation is pending.')}</p>}
              {selection && <div role="status"><p>{text('ยังไม่ทราบผลการเปลี่ยนสินทรัพย์ ตรวจรายการที่บันทึกไว้ก่อนชำระหรือเลือกใหม่', 'Asset change outcome unknown. Check the saved selection before paying or choosing another asset.')}</p><button className="secondary" disabled={busy || !!journalError} onClick={() => chooseAsset()}>{text('ตรวจการเลือกสินทรัพย์เดิม', 'Retry saved asset selection')}</button></div>}
              {assetError && <p className="error" role="alert">{assetError}</p>}
              {!assetsReady && !busy && <button className="secondary" disabled={busy} onClick={() => setAssetRefresh(value => value + 1)}>{text('โหลดสินทรัพย์อีกครั้ง', 'Refresh payment assets')}</button>}
            </section>}
            {!paid && <div className="checkout-fees"><p>{text('ร้านออกค่าธรรมเนียมเครือข่ายให้', 'Network fee covered by the cafe')}</p><small>{text('ไม่ต้องเติม SOL เพื่อชำระบิลนี้', 'No SOL top-up needed for this bill.')}</small></div>}
            {acceptanceEnded && <section className="checkout-state" aria-label={text('การตัดสินใจของร้าน', 'Merchant decision')}><p role="status">{text('ร้านปฏิเสธหรือหมดเวลารับออร์เดอร์ ห้ามชำระใหม่', 'Merchant declined or acceptance timed out. Do not make a new payment.')}</p>{order.onlineAcceptance?.reason && <p>{order.onlineAcceptance.reason === 'ACCEPTANCE_DEADLINE' ? text('หมดเวลารับออร์เดอร์', 'Acceptance deadline elapsed') : order.onlineAcceptance.reason}</p>}{order.onlineAcceptance?.refunds.map(r => <p key={r.id}>{text('ภาระคืนเงิน', 'Refund obligation')}: {formatMoney(r.money)} · {r.status}. {text('ยังไม่ใช่หลักฐานโอนคืน ผู้ให้บริการคืนเงินยังไม่พร้อม', 'Not proof of a return transfer; provider execution is not configured.')}</p>)}</section>}
            {savedRecovery && <section className="checkout-wallet" aria-label={text('ตรวจการชำระครั้งเดิม', 'Recover original payment')}><p className="checkout-help" role="status">{text('อย่าชำระซ้ำหรือสร้างออร์เดอร์ทดแทน ตรวจธุรกรรมเดิมนี้เท่านั้น ผลชำระยืนยันโดยเซิร์ฟเวอร์', 'Do not pay again or create a replacement order. Check this exact original attempt; only server verification confirms payment.')}</p><button className="checkout-primary" disabled={replayBlocked} onClick={checkSaved}>{busy ? stageText : text('ตรวจสอบการชำระครั้งเดิม', 'Check original payment')}</button></section>}
            {!hasSavedPayment && !final && !expired && !acceptanceEnded && !confirming && !sending && <section className="checkout-wallet" aria-label={text('ชำระด้วยกระเป๋าเงิน', 'Pay with your wallet')}>
              {wallet && <div className="checkout-connected"><WalletAvatar address={wallet.address}/><div><small>{wallet.name}</small><span>{wallet.address.slice(0,6)}…{wallet.address.slice(-4)}</span></div></div>}
              {hasSavedPayment || wallet || primaryChoice ? <button className="checkout-primary" disabled={blocked || confirming || sending} onClick={() => pay(primaryChoice)}>{busy ? stageText : hasSavedPayment ? text('ตรวจสอบการชำระ', 'Check payment') : `${text('ชำระ', 'Pay')} ${amount} ${order.settlement.currency}`}</button> : typeof window !== 'undefined' && <a className="button checkout-primary" aria-disabled={blocked} tabIndex={blocked ? -1 : 0} onClick={e => { if (blocked) e.preventDefault(); }} href={phantomBrowseUrl(location.href)}>{text('เปิดใน Phantom เพื่อชำระ', 'Open in Phantom to pay')}</a>}
              <p className="checkout-help">{text('อนุมัติการชำระในกระเป๋าเงินของคุณ', 'Approve the payment in your wallet.')}</p>
              {order.settlement.assetId === 'usdc-devnet' && !hasSavedPayment && <button className="secondary" disabled={blocked} onClick={payX402}>{text('ชำระ USDC ตามยอดผ่าน x402 V2', 'Pay exact USDC via x402 V2')}</button>}
              {hasSavedX402 && <p role="status">{text('มีการอนุมัติ x402 ที่บันทึกไว้ ตรวจธุรกรรมเดิม ไม่ลงนามใหม่', 'Saved x402 authorization: check the same payment, never sign a replacement')}</p>}
            </section>}
            {busy && <p className="checkout-help" role="status" aria-live="polite" aria-atomic="true">{stageText}</p>}
            {paid && <section className="checkout-wallet"><button className="checkout-primary" disabled={busy || done} onClick={() => void action(async () => { const result = await api<{done:boolean;returnUrl:string|null}>(`/pay/${encodeURIComponent(accessToken)}/dismiss`, {}); if (!result.done) throw new Error('Completion unavailable. Retry Done.'); if (result.returnUrl && order) { const entry = result.returnUrl.match(/^\/table\/([A-Za-z0-9_-]{43})$/)?.[1]; if (entry) finishGuestOrder(entry, order); } setReturnUrl(result.returnUrl); if (result.returnUrl) setReturnAt(Date.now() + 10000); setDone(true); })}>{done ? returnUrl ? text('เสร็จแล้ว · กำลังกลับเมนู…', 'Done · Returning to menu…') : text('เสร็จแล้ว', 'Done') : text('เสร็จแล้ว', 'Done')}</button>{done && <p className="checkout-help">{returnUrl ? text('จะเปิดเมนูในอีก 10 วินาที', 'The menu will reopen in 10 seconds.') : text('ยืนยันการชำระแล้ว กลับแอป BitPOS เพื่อดูออร์เดอร์', 'Payment is confirmed. Return to the BitPOS app to view your order.')}</p>}</section>}
          </>}
        </div>
        <div className="checkout-supplement">
          {order && !hasSavedPayment && !final && !expired && !acceptanceEnded && !confirming && !sending && <details className="checkout-options"><summary>{text('ตัวเลือกกระเป๋าอื่น', 'Other wallet options')}</summary><div className="stack">{choices.filter(c => c !== primaryChoice).map((choice, i) => <button className="secondary" key={i} disabled={blocked} onClick={() => pay(choice)}>{text('ชำระด้วย', 'Pay with')} {choice.name}</button>)}<button className="secondary" disabled={busy} onClick={() => void action(async () => setChoices(await discoverWallets()))}>{text('ค้นหากระเป๋าอีกครั้ง', 'Refresh wallets')}</button></div></details>}
          {order && customerContext && <CustomerConsent key={accessToken} language={language} accessToken={accessToken} orderId={order.id} merchantId={customerContext.merchantId} wallet={wallet} choices={choices} disabled={busy || done} onWallet={setWallet} onBusyChange={setCustomerAuthBusy}/>}
          {order && <details id="checkout-payment-details" className="checkout-details"><summary>{paid ? text('ใบเสร็จและหลักฐานการชำระ', 'Receipt and payment details') : text('รายละเอียดการชำระเงิน', 'Payment details')}</summary>
            <dl><dt>{text('รหัสออร์เดอร์', 'Order ID')}</dt><dd>{order.id}</dd><dt>{text('ยอดบิล', 'Bill total')}</dt><dd>{formatMoney(order.pricing.total)}</dd><dt>{text('ราคาหมดอายุ', 'Quote expires')}</dt><dd><time dateTime={order.quoteExpiresAt}>{new Date(order.quoteExpiresAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</time></dd>{(wallet?.address || order.payer) && <><dt>{text('กระเป๋าเงิน', 'Wallet')}</dt><dd>{wallet?.address || order.payer}</dd></>}</dl>
            <SettlementTrust settlement={order.settlement} language={language} />
            <p>{text('ลายเซ็นกระเป๋าเงินไม่ใช่หลักฐานชำระเงิน เซิร์ฟเวอร์ต้องตรวจสอบธุรกรรมที่ finalized แล้วจึงจะระบุว่าชำระแล้ว', 'A wallet signature is not payment. Only server-verified finalized settlement marks this order paid.')}</p>
            {paymentSignature && <a target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${encodeURIComponent(paymentSignature)}?cluster=devnet`}>{text('ดูธุรกรรม devnet', 'View devnet transaction')}</a>}
          </details>}
        </div>
      </article>
      <footer className="checkout-footer"><span>Powered by BitPOS</span><small>{text('Phantom เป็นเครื่องหมายการค้า ไม่มีความเกี่ยวข้องหรือการรับรอง', 'Phantom is a trademark. No affiliation or endorsement.')}</small></footer>
    </div>
  </main>;
}
