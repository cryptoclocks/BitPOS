import React, { useEffect, useRef, useState } from 'react';
import { avatar, pendingPayment, resumePayment, forgetPayment, discoverWallets, phantomBrowseUrl, submitPayment, type ConnectedWallet, type WalletChoice } from '../lib/wallet';
import type { OrderView } from '../../../../packages/contracts/src/index';
import { decimalAmount, formatMoney } from '../lib/money';
import { api, errorMessage } from '../lib/api';
import OrderBill, { SettlementTrust } from './OrderBill';
import {finishGuestOrder} from '../lib/table-guest';
import '../styles/app.css';
import '../styles/customer-checkout.css';

const menuPhotos: Record<string, string> = {
  espresso: 'espresso', americano: 'americano', latte: 'latte', 'iced latte': 'iced-latte',
  cappuccino: 'cappuccino', matcha: 'matcha', 'hot chocolate': 'hot-chocolate',
  croissant: 'croissant', 'blueberry muffin': 'blueberry-muffin',
  'chocolate brownie': 'chocolate-brownie', cheesecake: 'cheesecake', sandwich: 'sandwich',
};
export function WalletAvatar({ address }: { address: string }) {
  const pattern = avatar(address);
  return <svg role="img" aria-label="Wallet avatar" viewBox="0 0 5 5" className="avatar">{pattern.cells.map((on, i) => on && <rect key={i} x={i % 5} y={Math.floor(i / 5)} width="1" height="1" fill={pattern.color} />)}</svg>;
}
export default function Payment({ accessToken, terminal = false }: { accessToken: string; terminal?: boolean }) {
  const [order, setOrder] = useState<OrderView>(); const [error, setError] = useState(''); const [connectionError, setConnectionError] = useState(''); const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<ConnectedWallet>(); const [payStage,setPayStage]=useState(''); const [returnAt,setReturnAt]=useState(0); const [returnUrl,setReturnUrl]=useState<string|null>(null); const [submitted, setSubmitted] = useState(''); const [choices, setChoices] = useState<WalletChoice[]>([]); const [now, setNow] = useState(0); const working = useRef(false);
  useEffect(() => {
    let active = true; let inFlight = false;
    if (!terminal && location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      void fetch('/images/customer-checkout-origin.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(config => {
        if (!active || !config?.origin) return;
        const destination = new URL(config.origin);
        if (destination.protocol !== 'https:' || destination.pathname !== '/' || destination.username || destination.password) return;
        destination.pathname = location.pathname;
        destination.search = location.search;
        location.replace(destination.href);
      }).catch(() => { if (active) setError('Phantom requires HTTPS. Ask the cashier for the secure payment link.'); });
    }
    setOrder(undefined); setWallet(undefined); setSubmitted('');
    const poll = async () => {
      if (inFlight) return; inFlight = true;
      try { const next = await api<OrderView>(`/pay/${encodeURIComponent(accessToken)}`); if (active) { setOrder(current => !current || next.version >= current.version ? next : current); setConnectionError(''); } }
      catch (error) { if (active) setConnectionError(errorMessage(error)); }
      finally { inFlight = false; }
    };
    // Cloudflare Quick Tunnels buffer SSE. Use bounded non-overlapping polling there.
    const quickTunnel=location.hostname.endsWith('.trycloudflare.com');
    void poll(); const timer = setInterval(() => { setNow(Date.now()); void poll(); }, quickTunnel?1000:5000);
    const stream=quickTunnel?undefined:new EventSource(`/api/pay/${encodeURIComponent(accessToken)}/events`);
    if(stream){stream.onmessage=event=>{try{const next=JSON.parse(event.data) as OrderView;if(active){setOrder(current=>!current||next.version>=current.version?next:current);setConnectionError('');}}catch{void poll();}};stream.onerror=()=>void poll();}
    const refreshWallets = () => { if (!terminal) void discoverWallets().then(next => { if (active) setChoices(next); }).catch(() => { if (active) setError('Wallet discovery unavailable. Open this exact order in Phantom.'); }); };
    refreshWallets();
    // Mobile providers can be injected after React mounts or after returning from approval.
    const walletTimer = setInterval(refreshWallets, 1500);
    window.addEventListener('focus', refreshWallets);
    return () => { active = false; stream?.close(); clearInterval(timer); clearInterval(walletTimer); window.removeEventListener('focus', refreshWallets); };
  }, [accessToken, terminal]);
  async function action(run: () => Promise<void>) {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await run(); } catch (error) { setError(errorMessage(error)); }
    finally { working.current = false; setBusy(false); }
  }
  useEffect(()=>{if(order?.status==='PAID')forgetPayment(accessToken);},[order?.status,accessToken]);
  let hasSavedPayment=false;try{hasSavedPayment=!!pendingPayment(accessToken);}catch{/* Corrupt storage is refused by the payment action. */}
  const final = order && ['PAID', 'EXPIRED', 'RECOVERY'].includes(order.status);
  const expired = order ? Date.parse(order.quoteExpiresAt) <= (now || Date.now()) : false;
  const blocked = busy || !order || !!final || expired || !!connectionError;
  if (terminal) return <main className="payment"><header><a className="brand" href="/">◈ BitPOS</a><span className="badge">Solana DEVNET · test USDG</span></header><section className="panel"><p className="eyebrow">Pay this order / <span lang="th">ชำระบิล</span></p><h1>{order ? formatMoney(order.pricing.total) : 'Loading order…'}</h1>{order && <><OrderBill order={order} publicView /><p>Quote expires: {new Date(order.quoteExpiresAt).toLocaleString()}</p></>}{connectionError && <p className="error" role="alert">{connectionError}</p>}</section></main>;

  const primaryChoice = choices.find(choice => choice.name === 'Phantom') ?? choices.find(choice => choice.name.startsWith('TEST WALLET FIXTURE'));
  const fixture = wallet?.fixture || choices.some(choice => choice.name.startsWith('TEST WALLET FIXTURE'));
  const photoLine = order?.pricing.lines.find(line => Object.hasOwn(menuPhotos, line.nameEn.trim().toLowerCase()));
  const photo = photoLine ? menuPhotos[photoLine.nameEn.trim().toLowerCase()] : undefined;
  const [whole, fraction = ''] = order ? decimalAmount(order.settlement).split('.') : [];
  const amount = order ? `${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}` : '';
  const paid = order?.status === 'PAID';
  const confirming = order?.status === 'CONFIRMING';
  const sending = !!submitted && !final && !confirming;
  const unavailable = order?.status === 'EXPIRED' || (!paid && !confirming && !sending && expired);
  const recovery = order?.status === 'RECOVERY';
  const paymentSignature = order?.paymentSignature || submitted;
  const title = paid ? 'Payment received' : recovery ? 'Payment needs review' : confirming ? 'Confirming your payment' : unavailable ? 'This order has expired' : sending ? 'Sending your payment' : 'Your order, ready to pay.';
  const pay = (choice?:WalletChoice) => void action(async()=>{
    if(pendingPayment(accessToken)){setPayStage('Checking your saved payment…');const result=await resumePayment(accessToken,api);setSubmitted(result.signature);return;}
    setPayStage('Opening your wallet…');const connected=wallet??(choice?await choice.connect():undefined);
    if(!connected)throw new Error('Open this bill in Phantom to pay.');setWallet(connected);setPayStage('Preparing your payment…');
    const result=await submitPayment(accessToken,connected,api,phase=>setPayStage(phase==='signing'?'Approve payment in your wallet…':'Sending your payment…'));setSubmitted(result.signature);setPayStage('');
  });
  useEffect(()=>{if(!returnAt||!returnUrl)return;const timer=setTimeout(()=>location.assign(returnUrl),Math.max(0,returnAt-Date.now()));return()=>clearTimeout(timer);},[returnAt,returnUrl]);
  return <main className="customer-checkout">
    <div className="checkout-shell">
      <header className="checkout-header"><img src="/images/bitpos-logo.png" alt="BitPOS" width="132" height="44" /><span className="checkout-network">Devnet · Test USDG</span></header>

      {fixture && <p className="fixture">TEST WALLET FIXTURE — browser automation only, not a real mobile test</p>}
      <article className="checkout-card">
        <div className={`checkout-hero${photo ? '' : ' checkout-hero-neutral'}`}>{photo && <img src={`/images/menu/${photo}.jpg`} alt="From the cafe menu" />}</div>
        <div className="checkout-content">
          <div className="checkout-meta"><span>{order?.authority.serving.label || 'Your bill'}</span>{order && <span title={order.id}>Order #{order.id.slice(0, 8)}</span>}</div>
          <h1>{order ? title : 'Your order'}</h1>
          {!order && <div className="checkout-loading" role="status">{connectionError ? 'Your bill is temporarily unavailable.' : 'Loading your bill…'}</div>}
          {order && <>
            <OrderBill order={order} customer />
            <div className="checkout-total"><span>{paid ? 'Amount paid' : 'Total to pay'}</span><strong>{amount}<span> USDG</span></strong></div>
            <p className="checkout-fee">Network fee covered by the cafe</p>
            {(paid || confirming || sending || unavailable || recovery) && <section className={`checkout-state ${paid ? 'is-paid' : ''}`} aria-label="Payment progress">
              <p className={`status ${order.status.toLowerCase()}`} role="status">{paid?'Paid':confirming?'Confirming':unavailable?'Expired':recovery?'Needs review':sending?'Sending':'Awaiting payment'}</p>
              <p>{paid ? 'Thank you. Enjoy your order!' : recovery ? 'Do not pay again. Ask the merchant to review this payment.' : confirming ? 'Please wait. Do not pay again.' : unavailable ? 'Do not pay this bill. Ask the merchant for a new order.' : 'Sending payment. Please do not pay again.'}</p>
            </section>}
            {!final && !expired && !confirming && !sending && <section className="checkout-wallet" aria-label="Pay with your wallet">
              {wallet&&<div className="checkout-connected"><WalletAvatar address={wallet.address}/><div><small>{wallet.name}</small><span>{wallet.address.slice(0,6)}…{wallet.address.slice(-4)}</span></div></div>}
              {hasSavedPayment||wallet||primaryChoice?<button className="checkout-primary" disabled={blocked} onClick={()=>pay(primaryChoice)}><img className="phantom-logo" src="/images/phantom-logo-purple.png" alt=""/>{busy?payStage||'Please wait…':hasSavedPayment?'Check payment':`Pay ${amount} USDG`}</button>:typeof window!=='undefined'&&<a className="button checkout-primary" aria-disabled={blocked} tabIndex={blocked?-1:0} onClick={e=>{if(blocked)e.preventDefault();}} href={phantomBrowseUrl(location.href)}><img className="phantom-logo" src="/images/phantom-logo-purple.png" alt=""/>Pay with Phantom</a>}
              <p className="checkout-help">Approve the payment in your wallet. No SOL top-up needed.</p>
              <details className="checkout-options"><summary>Other wallet options</summary><div className="stack">{choices.filter(c=>c!==primaryChoice).map((choice,i)=><button className="secondary" key={i} disabled={blocked} onClick={()=>pay(choice)}>Pay with {choice.name}</button>)}<button className="secondary" disabled={busy} onClick={()=>void action(async()=>setChoices(await discoverWallets()))}>Refresh wallets</button></div></details>
            </section>}
            {paid&&<section className="checkout-wallet"><button className="checkout-primary" disabled={busy||!!returnAt} onClick={()=>void action(async()=>{const result=await api<{done:boolean;returnUrl:string|null}>(`/pay/${encodeURIComponent(accessToken)}/dismiss`,{});if(result.returnUrl&&order){const entry=result.returnUrl.match(/^\/table\/([A-Za-z0-9_-]{43})$/)?.[1];if(entry)finishGuestOrder(entry,order.id);}setReturnUrl(result.returnUrl);setReturnAt(Date.now()+10000);})}>{returnAt?'Done · Returning to menu…':'Done'}</button>{returnAt&&<p className="checkout-help">{returnUrl?'The menu will reopen in 10 seconds.':'Thank you. Enjoy your order!'}</p>}</section>}

          </>}
          {(error || connectionError) && <div className="error" role="alert"><strong>{connectionError ? 'Connection interrupted' : 'Wallet request unsuccessful'}</strong><p>{error || connectionError}</p>{connectionError && <small>We will reconnect automatically. Do not pay again if you already submitted.</small>}</div>}
          {order && <details className="checkout-details"><summary>Payment details</summary>
            <dl><dt>Order ID</dt><dd>{order.id}</dd><dt>Bill total</dt><dd>{formatMoney(order.pricing.total)}</dd><dt>Quote expires</dt><dd>{new Date(order.quoteExpiresAt).toLocaleString()}</dd>{(wallet?.address || order.payer) && <><dt>Wallet</dt><dd>{wallet?.address || order.payer}</dd></>}</dl>
            <SettlementTrust settlement={order.settlement} />
            <p>A wallet signature is not payment. Only server-verified finalized settlement marks this order paid.</p>
            {paymentSignature && <a target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${encodeURIComponent(paymentSignature)}?cluster=devnet`}>View devnet transaction</a>}
          </details>}
        </div>
      </article>
      <footer className="checkout-footer">Powered by BitPOS · Pay securely with your wallet.<small>Phantom is a trademark. No affiliation or endorsement.</small></footer>
    </div>
  </main>;
}
