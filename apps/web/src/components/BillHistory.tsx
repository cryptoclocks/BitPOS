import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import { printDocument, receiptDoc, cashReceiptDoc } from '../lib/print-slip';
import { discoverWallets, type WalletChoice } from '../lib/wallet';
import { signOwnerRefund, cancelOwnerRefund, shortAddress, WalletMismatch } from '../lib/refund-sign';
import { readReceiptLang } from '../lib/receipt-lang';
import { receiptLook } from '../lib/receipt-look';
import '../styles/bill-history.css';

interface Bill { kind: 'order' | 'cash'; id: string; ref: string; state: 'PAID' | 'OPEN' | 'VOIDED' | 'EXPIRED'; source: 'store' | 'online' | 'cash'; createdAt: string; currency: string; decimals: number; totalMinor: string | null; voidReason: string | null }
interface Detail { order: { id: string; status: string; pricing?: { lines: { qty: number; name: string; nameEn?: string }[] } }; void: { reason: string; by: string; at: string } | null; attempts: { status: string; signature: string | null; at: string }[]; timeline: { action: string; actor: string; at: string }[]; refund?: RealRefund | null; refundable?: { available: boolean; blocked: string | null }; demo?: { available: boolean; paidByDemo: boolean; paymentMethod?: 'DEMO' | 'PROMPTPAY' | null; canPay: boolean; canRefund: boolean; refund: { reason: string; by: string; at: string; amount: { currency: string; decimals: number; amountMinor: string } } | null }; canVoid: boolean; voidBlocked: 'PAID' | 'ONLINE' | 'NOT_OPEN' | 'ROLE' | null }
interface RealRefund { id: string; state: 'AWAITING_OWNER' | 'SIGNING' | 'PREPARED' | 'UNKNOWN' | 'FINALIZED' | 'FAILED'; signingMode: 'server' | 'owner'; sourceOwner: string; amountMinor: string; beneficiary: string; reason: string; signature: string | null; finalizedAt: string | null; lastReason: string }
interface CashDemo { available: boolean; canRefund: boolean; refund: { reason: string; at: string; amount: { currency: string; decimals: number; amountMinor: string } } | null }
interface CashDetail { demo?: CashDemo; sale: { id: string; receiptNo: string; status: 'PAID' | 'VOIDED'; cashier: string; tenderMinor: string; changeMinor: string; currency: { code: string; decimals: number }; void: { reason: string; at: string; restocked: boolean } | null; lines: { name: string; nameEn: string; qty: number }[] } }

// Every bill in one searchable list (counter/table orders and cash sales), newest first. Totals are shown in each bill's own currency and are
// never added together. A void here only closes an UNPAID counter/table order (or voids a cash sale); a paid order can never be voided, money
// goes back through the return/refund workflow. The server decides who may do what; the buttons only follow its answer.
export default function BillHistory({ token, role, language, preset }: { token: string; role: string; language: 'th' | 'en'; preset?: { state: string; source: string; from: string; to: string } }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [state, setState] = useState(preset?.state ?? 'all'); const [source, setSource] = useState(preset?.source ?? 'all'); const [from, setFrom] = useState(preset?.from ?? ''); const [to, setTo] = useState(preset?.to ?? ''); const [query, setQuery] = useState('');
  const [bills, setBills] = useState<Bill[]>(); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [openKey, setOpenKey] = useState(''); const [detail, setDetail] = useState<Detail | CashDetail>(); const [detailError, setDetailError] = useState(''); const [reason, setReason] = useState(''); const [restock, setRestock] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const manager = role === 'owner' || role === 'manager';
  const params = (after?: string | null) => { const p = new URLSearchParams({ state, source, limit: '30' }); if (from) p.set('from', from); if (to) p.set('to', to); if (query.trim()) p.set('q', query.trim()); if (after) p.set('cursor', after); return p.toString(); };
  const load = useCallback(async (more = false) => {
    setLoading(true); setError('');
    try {
      const r = await api<{ bills: Bill[]; nextCursor: string | null }>(`/bills?${params(more ? cursor : null)}`, undefined, token);
      setBills(prev => more ? [...(prev ?? []), ...r.bills.filter(b => !(prev ?? []).some(p => p.id === b.id))] : r.bills); setCursor(r.nextCursor);
    } catch (e) { setError(errorMessage(e)); }
    setLoading(false);
  }, [token, state, source, from, to, query, cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCursor(null); void load(false); }, [token, state, source, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  async function open(b: Bill) {
    const key = `${b.kind}:${b.id}`; if (openKey === key) { setOpenKey(''); return; }
    setOpenKey(key); setDetail(undefined); setDetailError(''); setReason(''); setRestock(false); setMessage('');
    try { setDetail(b.kind === 'order' ? await api<Detail>(`/bills/orders/${b.id}`, undefined, token) : await api<CashDetail>(`/cash/sales/${b.id}`, undefined, token)); }
    catch (e) { setDetailError(errorMessage(e)); }
  }
  // Re-read the open bill after an action. (open() toggles the panel closed when it is already open, so it is not used for refreshing.)
  async function reloadDetail(b: Bill) {
    try { setDetail(b.kind === 'order' ? await api<Detail>(`/bills/orders/${b.id}`, undefined, token) : await api<CashDetail>(`/cash/sales/${b.id}`, undefined, token)); }
    catch (e) { setDetailError(errorMessage(e)); }
  }
  // A reprint is recorded on the server first (who, which bill, which copy); only then does the till print, stamped as a copy.
  async function reprint(b: Bill) {
    setBusy(true); setMessage('');
    try {
      const rec = await api<{ copy: number }>('/receipts/reprint', { kind: b.kind, id: b.id }, token);
      const lang = readReceiptLang(language);
      const html = b.kind === 'order' && detail && 'order' in detail ? receiptDoc(detail.order as never, lang, { ...(receiptLook() ?? { shopName: 'BitPOS', shopNameEn: '', footer: '', footerEn: '', paperMm: 80 as const }), copy: rec.copy })
        : b.kind === 'cash' && detail && 'sale' in detail ? cashReceiptDoc(detail.sale as never, lang, { ...(receiptLook() ?? {}), copy: rec.copy }) : '';
      if (!html) throw new Error('NO_DETAIL');
      setMessage((await printDocument(html)) ? text(`ส่งพิมพ์สำเนาใบเสร็จแล้ว (สำเนาที่ ${rec.copy - 1})`, `Receipt copy sent to print (copy ${rec.copy - 1}).`) : text('เบราว์เซอร์บล็อกการพิมพ์', 'The browser blocked printing'));
    } catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  const [demoReason, setDemoReason] = useState(''); const [refundReason, setRefundReason] = useState('');
  // Demo money: only offered by the server in a demo-catalog shop. Nothing real moves; the label says so everywhere.
  async function realRefundBill(b: Bill) {
    if (refundReason.trim().length < 3) { setMessage(text('ใส่เหตุผลอย่างน้อย 3 ตัวอักษร', 'Give a reason of at least 3 characters.')); return; }
    if (!window.confirm(text('ขอคืนเงินจริงเต็มจำนวนให้กระเป๋าที่ชำระ (Solana devnet)? ยกเลิกคำขอได้จนกว่าจะเซ็นด้วยกระเป๋า เมื่อเซ็นและส่งแล้วย้อนไม่ได้', 'Request a real refund of the full amount to the wallet that paid (Solana devnet)? You can cancel the request until you sign with the wallet; once signed and sent it cannot be undone.'))) return;
    setBusy(true); setMessage('');
    try { const r = await api<{ refund: RealRefund }>(`/bills/orders/${b.id}/refund`, { reason: refundReason.trim() }, token); setRefundReason(''); setMessage(r.refund.signingMode === 'owner' ? text('รับคำขอคืนเงินแล้ว ขั้นต่อไปเจ้าของร้านต้องเซ็นด้วยกระเป๋า treasury ของร้าน', 'Refund requested. Next, the shop owner must sign it with the shop’s treasury wallet.') : text('รับคำขอคืนเงินแล้ว ระบบกำลังส่งเงินคืน', 'Refund requested. The system is sending the money back.')); await reloadDetail(b); }
    catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  async function cashDemoRefund(b: Bill) {
    if (demoReason.trim().length < 3) { setMessage(text('ใส่เหตุผลอย่างน้อย 3 ตัวอักษร', 'Give a reason of at least 3 characters.')); return; }
    if (!window.confirm(text('จำลองการคืนเงินสด? ไม่มีเงินสดเคลื่อนไหว ลิ้นชักไม่เปลี่ยน', 'Simulate a cash refund? No cash moves and the drawer is unchanged.'))) return;
    setBusy(true); setMessage('');
    try { await api(`/cash/sales/${b.id}/demo-refund`, { reason: demoReason.trim() }, token); setDemoReason(''); setMessage(text('บันทึกการคืนเงินสดจำลองแล้ว', 'Simulated cash refund recorded.')); await reloadDetail(b); }
    catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  const [choices, setChoices] = useState<WalletChoice[] | null>(null);
  const refundMessages: Record<string, [string, string]> = {
    REFUND_SIGNATURE_EXPIRED: ['เซ็นช้าเกินไป ธุรกรรมหมดอายุ กดเซ็นใหม่อีกครั้ง (ยังไม่มีเงินเคลื่อนไหว)', 'Signed too late and the transaction expired. Press sign again (no money moved).'],
    REFUND_SIGNATURE_INVALID: ['ธุรกรรมที่เซ็นไม่ตรงกับที่ระบบเตรียมไว้ จึงไม่ถูกรับ (ยังไม่มีเงินเคลื่อนไหว)', 'The signed transaction does not match what was prepared, so it was not accepted (no money moved).'],
    REFUND_FUNDS_INSUFFICIENT: ['กระเป๋า treasury มี USDG หรือ SOL ไม่พอสำหรับการคืนเงินนี้', 'The treasury wallet has too little USDG or SOL for this refund.'],
    REFUND_CHAIN_UNAVAILABLE: ['ติดต่อ Solana devnet ไม่ได้ในขณะนี้ ลองใหม่อีกครั้ง', 'Solana devnet is not reachable right now. Try again.'],
    REFUND_NOT_AWAITING: ['คำขอคืนเงินนี้ไม่ได้รอการเซ็นแล้ว รีเฟรชดูสถานะล่าสุด', 'This refund is no longer waiting for a signature. Refresh to see its latest state.'],
  };
  const refundError = (e: unknown) => e instanceof WalletMismatch ? text(`กระเป๋าที่ต่อไม่ใช่กระเป๋า treasury ของร้าน (${shortAddress(e.expected)}) ให้เปลี่ยนบัญชีในกระเป๋าแล้วลองใหม่`, `The connected wallet is not the shop’s treasury wallet (${shortAddress(e.expected)}). Switch the account in your wallet and try again.`)
    : e instanceof ApiError && refundMessages[e.code] ? text(...refundMessages[e.code]!) : errorMessage(e);
  async function signRefundWith(b: Bill, choice: WalletChoice, expected: string) {
    setChoices(null); setBusy(true); setMessage('');
    try {
      const wallet = await choice.connect();
      await signOwnerRefund(b.id, token, wallet, expected);
      setMessage(text('เซ็นแล้ว ระบบกำลังส่งเข้าเครือข่ายและรอยืนยันบน blockchain', 'Signed. The system is sending it to the network and waiting for on-chain confirmation.'));
    } catch (e) { setMessage(refundError(e)); }
    await reloadDetail(b); setBusy(false);
  }
  async function startRefundSign(b: Bill, expected: string) {
    setBusy(true); setMessage(''); setChoices(null);
    try {
      const found = await discoverWallets();
      if (!found.length) setMessage(text('ไม่พบกระเป๋า Solana ในเบราว์เซอร์นี้ เปิดด้วยเบราว์เซอร์ที่มี Phantom (devnet) ของเจ้าของร้านแล้วลองใหม่', 'No Solana wallet found in this browser. Open this page in a browser with the owner’s Phantom (devnet) and try again.'));
      else if (found.length === 1) { setBusy(false); await signRefundWith(b, found[0]!, expected); return; }
      else setChoices(found);
    } catch (e) { setMessage(refundError(e)); }
    setBusy(false);
  }
  async function cancelRefundRequest(b: Bill) {
    if (!window.confirm(text('ยกเลิกคำขอคืนเงินนี้? ยังไม่มีการเซ็นหรือส่งเงิน', 'Cancel this refund request? Nothing has been signed or sent.'))) return;
    setBusy(true); setMessage('');
    try { await cancelOwnerRefund(b.id, token); setMessage(text('ยกเลิกคำขอคืนเงินแล้ว', 'Refund request cancelled.')); } catch (e) { setMessage(refundError(e)); }
    await reloadDetail(b); setBusy(false);
  }
  // While a signed refund is being sent and verified, keep the bill fresh until it is final.
  const liveRefund = detail && 'order' in detail ? detail.refund : null; const liveState = liveRefund?.state; const liveOrder = detail && 'order' in detail ? detail.order.id : '';
  useEffect(() => {
    if (!liveOrder || !liveState || !['SIGNING', 'PREPARED', 'UNKNOWN'].includes(liveState)) return;
    const timer = window.setTimeout(() => { void api<Detail>(`/bills/orders/${liveOrder}`, undefined, token).then(d => setDetail(prev => prev && 'order' in prev && prev.order.id === d.order.id ? d : prev)).catch(() => undefined); }, 3000);
    return () => window.clearTimeout(timer);
  }, [liveOrder, liveState, token, detail]);
  async function demoPayBill(b: Bill, method: 'DEMO' | 'PROMPTPAY' = 'DEMO') {
    if (!window.confirm(method === 'PROMPTPAY' ? text('ชำระออเดอร์นี้ด้วย PromptPay จำลอง? ไม่มีเงินจริงและไม่เชื่อมธนาคาร ใช้สาธิตเท่านั้น', 'Pay this order with simulated PromptPay? No real money and no bank link. For demonstration only.') : text('ชำระออเดอร์นี้ด้วยเงินเดโม? ไม่มีเงินจริงเคลื่อนไหว ใช้เพื่อสาธิตเท่านั้น', 'Pay this order with demo money? No real money moves. For demonstration only.'))) return;
    setBusy(true); setMessage('');
    try { await api(`/bills/orders/${b.id}/demo-pay`, { method }, token, 'POST'); setMessage(method === 'PROMPTPAY' ? text('ชำระด้วย PromptPay จำลองแล้ว', 'Paid with simulated PromptPay.') : text('ชำระด้วยเงินเดโมแล้ว', 'Paid with demo money.')); await load(false); await reloadDetail(b); }
    catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  async function demoRefundBill(b: Bill) {
    if (demoReason.trim().length < 3) { setMessage(text('ใส่เหตุผลอย่างน้อย 3 ตัวอักษร', 'Give a reason of at least 3 characters.')); return; }
    if (!window.confirm(text('จำลองการคืนเงินเต็มจำนวน? ไม่มีเงินจริงถูกคืน บันทึกเป็นรายการจำลองเท่านั้น', 'Simulate a full refund? No real money is returned; only a simulated record is saved.'))) return;
    setBusy(true); setMessage('');
    try { await api(`/bills/orders/${b.id}/demo-refund`, { reason: demoReason.trim() }, token); setDemoReason(''); setMessage(text('บันทึกการคืนเงินจำลองแล้ว', 'Simulated refund recorded.')); await reloadDetail(b); }
    catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  async function voidBill(b: Bill) {
    if (reason.trim().length < 3) { setMessage(text('ใส่เหตุผลอย่างน้อย 3 ตัวอักษร', 'Give a reason of at least 3 characters.')); return; }
    if (!window.confirm(b.kind === 'order' ? text('ยกเลิก (void) ออเดอร์นี้? สต็อกที่จองไว้จะถูกคืนหนึ่งครั้ง', 'Void this order? The reserved stock is released once.') : text('ยกเลิกบิลเงินสดนี้?', 'Void this cash sale?'))) return;
    setBusy(true); setMessage('');
    try {
      if (b.kind === 'order') await api(`/bills/orders/${b.id}/void`, { reason: reason.trim() }, token);
      else await api(`/cash/sales/${b.id}/void`, { reason: reason.trim(), restock }, token);
      setMessage(text('ยกเลิกบิลแล้ว', 'Bill voided.')); setOpenKey(''); await load(false);
    } catch (e) {
      if (e instanceof ApiError && ['ORDER_PAID_CANNOT_VOID', 'PAYMENT_PENDING', 'ORDER_NOT_PAYABLE'].includes(e.code)) { setMessage(errorMessage(e)); await load(false); await reloadDetail(b); }
      else setMessage(errorMessage(e));
    }
    setBusy(false);
  }
  const stateLabel = { PAID: text('ชำระแล้ว', 'Paid'), OPEN: text('รอชำระ', 'Open'), VOIDED: text('ยกเลิก', 'Voided'), EXPIRED: text('หมดเวลา', 'Expired') };
  const sourceLabel = { store: text('หน้าร้าน', 'Store'), online: text('ออนไลน์', 'Online'), cash: text('เงินสด', 'Cash') };
  const when = (iso: string) => new Date(iso).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  const total = (b: Bill) => b.totalMinor && b.currency ? formatMoney({ currency: b.currency, decimals: b.decimals, amountMinor: b.totalMinor } as never) : '—';
  const voidBlockedText = (d: Detail) => ({ PAID: text('ออเดอร์ที่ชำระแล้ว void ไม่ได้ ใช้การคืนเงินหรือคืนสินค้า', 'A paid order cannot be voided. Use a refund or return.'), ONLINE: text('ออเดอร์ออนไลน์จัดการในหน้าออเดอร์ออนไลน์', 'Online orders are handled in the online order flow.'), NOT_OPEN: text('ออเดอร์นี้ปิดไปแล้ว', 'This order is already closed.'), ROLE: text('เฉพาะเจ้าของร้านหรือผู้จัดการ', 'Owner or manager only.') } as const)[d.voidBlocked ?? 'NOT_OPEN'];
  return <main className="bill-history" aria-label={text('ประวัติบิล', 'Bill history')}>
    <div className="section-heading"><div><p className="eyebrow">{text('จัดการร้าน', 'YOUR SHOP')}</p><h1>{text('ประวัติบิล', 'Bill history')}</h1><p className="catalog-sub">{text('บิลหน้าร้านและเงินสดทั้งหมด ยอดแสดงตามสกุลเงินของแต่ละบิล ไม่รวมข้ามสกุล', 'Every store order and cash sale. Totals stay in each bill’s own currency and are never added across currencies.')}</p></div></div>
    <form className="bill-filters" onSubmit={e => { e.preventDefault(); setCursor(null); void load(false); }}>
      <label>{text('สถานะ', 'Status')}<select value={state} onChange={e => setState(e.target.value)}><option value="all">{text('ทั้งหมด', 'All')}</option><option value="paid">{text('ชำระแล้ว', 'Paid')}</option><option value="open">{text('รอชำระ', 'Open')}</option><option value="voided">{text('ยกเลิก', 'Voided')}</option><option value="expired">{text('หมดเวลา', 'Expired')}</option></select></label>
      <label>{text('ช่องทาง', 'Source')}<select value={source} onChange={e => setSource(e.target.value)}><option value="all">{text('ทั้งหมด', 'All')}</option><option value="store">{text('หน้าร้าน', 'Store')}</option><option value="online">{text('ออนไลน์', 'Online')}</option><option value="cash">{text('เงินสด', 'Cash')}</option></select></label>
      <label>{text('ตั้งแต่', 'From')}<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{text('ถึง', 'To')}<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <label className="bill-search">{text('ค้นหา', 'Search')}<input value={query} maxLength={32} placeholder={text('เลขบิล / รหัสออเดอร์', 'Receipt no. / order id')} onChange={e => setQuery(e.target.value)} /></label>
      <button type="submit" disabled={loading}>{text('ค้นหา', 'Search')}</button>
    </form>
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error} <button type="button" className="secondary" onClick={() => void load(false)}>{text('ลองอีกครั้ง', 'Retry')}</button></p>}
    {!bills && loading && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {bills && !bills.length && !error && <p className="notice" role="status">{text('ไม่พบบิลตามเงื่อนไข', 'No bills match.')}</p>}
    {bills && !!bills.length && <ul className="bill-list">{bills.map(b => { const key = `${b.kind}:${b.id}`; return <li key={key} className={`bill-row ${b.state.toLowerCase()}`}>
      <button type="button" className="bill-line" aria-expanded={openKey === key} onClick={() => void open(b)}><strong>#{b.ref}</strong><span className="bill-when">{when(b.createdAt)}</span><span className="bill-chip src">{sourceLabel[b.source]}</span><span className={`bill-chip ${b.state.toLowerCase()}`}>{stateLabel[b.state]}</span><span className="bill-total">{total(b)}</span></button>
      {b.voidReason && <small className="bill-reason">{text('เหตุผล', 'Reason')}: {b.voidReason}</small>}
      {openKey === key && <div className="bill-detail">
        {!detail && !detailError && <p className="notice" role="status">{text('กำลังโหลดรายละเอียด…', 'Loading detail…')}</p>}
        {detailError && <p className="error" role="alert">{detailError}</p>}
        {detail && b.kind === 'order' && 'order' in detail && <>
          <dl className="bill-facts"><div><dt>{text('สถานะออเดอร์', 'Order status')}</dt><dd>{detail.order.status}</dd></div>{detail.attempts.map((a, i) => <div key={i}><dt>{text('การชำระ', 'Payment')} {i + 1}</dt><dd>{a.status}{a.signature ? ` · ${a.signature.slice(0, 10)}…` : ''}</dd></div>)}</dl>
          {detail.order.pricing?.lines && <ul className="bill-lines">{detail.order.pricing.lines.map((l, i) => <li key={i}>{l.qty}× {language === 'en' && l.nameEn ? l.nameEn : l.name}</li>)}</ul>}
          {detail.void && <p className="notice" role="status">{text('ยกเลิกแล้ว', 'Voided')} · {when(detail.void.at)} · {detail.void.reason}</p>}{b.state === 'PAID' && <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={() => void reprint(b)}>{text('พิมพ์ใบเสร็จซ้ำ (สำเนา)', 'Reprint receipt (copy)')}</button></div>}
          <ol className="bill-timeline" aria-label={text('ประวัติการดำเนินการ', 'Timeline')}>{detail.timeline.map((t, i) => <li key={i}><time>{when(t.at)}</time> {t.action}</li>)}</ol>
          {detail.demo?.available && <div className="bill-demo" role="group" aria-label={text('ปุ่มเดโม', 'Demo buttons')}><p className="bill-demo-tag"><b>DEMO</b> {text('ไม่ใช่เงินจริง ใช้สาธิตในร้านที่ตั้งแค็ตตาล็อกทดสอบเท่านั้น', 'Not real money. Only in a shop with a test catalog.')}</p>
            {detail.demo.canPay && <div className="toolbar"><button type="button" disabled={busy} onClick={() => void demoPayBill(b)}>{text('ชำระด้วยเงินเดโม', 'Pay with demo money')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void demoPayBill(b, 'PROMPTPAY')}>{text('ชำระด้วย PromptPay (จำลอง)', 'Pay with PromptPay (simulated)')}</button></div>}
            {detail.demo.paidByDemo && <p className="bill-note">{detail.demo.paymentMethod === 'PROMPTPAY' ? text('ชำระด้วย PromptPay จำลองแล้ว', 'Paid with simulated PromptPay') : text('ชำระด้วยเงินเดโมแล้ว', 'Paid with demo money')}</p>}
            {detail.demo.canRefund && <><label>{text('เหตุผลที่คืนเงิน (3–120 ตัวอักษร)', 'Reason for the refund (3–120 characters)')}<input value={demoReason} maxLength={120} onChange={e => setDemoReason(e.target.value)} /></label><button type="button" className="secondary" disabled={busy} onClick={() => void demoRefundBill(b)}>{detail.demo.paymentMethod === 'PROMPTPAY' ? text('จำลองคืนเงิน PromptPay (เดโม)', 'Simulate PromptPay refund (demo)') : text('จำลองคืนเงิน (เดโม)', 'Simulate refund (demo)')}</button></>}
            {detail.demo.refund && <p className="notice" role="status">{text('คืนเงินจำลองแล้ว', 'Simulated refund')} · {formatMoney({ ...detail.demo.refund.amount } as never)} · {when(detail.demo.refund.at)} · {detail.demo.refund.reason}</p>}
          </div>}
          {(detail.refund || detail.refundable?.available || (detail.refundable && ['SIGNER', 'ASSET', 'NO_PAYMENT'].includes(detail.refundable.blocked ?? ''))) && <div className="bill-refund" role="group" aria-label={text('คืนเงินจริง', 'Real refund')}>
            <p className="bill-refund-tag"><b>{text('คืนเงินจริง', 'REAL REFUND')}</b> {text('Solana devnet · เต็มจำนวน · คืนให้กระเป๋าที่ชำระ', 'Solana devnet · full amount · to the wallet that paid')}</p>
            {detail.refund && <><p className="notice" role="status" data-refund-state={detail.refund.state}>{({ AWAITING_OWNER: text('รอเจ้าของร้านเซ็นด้วยกระเป๋า treasury — BitPOS ไม่ถือกุญแจ ยังไม่มีเงินเคลื่อนไหว', 'Waiting for the owner to sign with the treasury wallet — BitPOS holds no key; no money has moved'), SIGNING: text('รอระบบเตรียมธุรกรรม', 'Queued: preparing the transfer'), PREPARED: text('เตรียมธุรกรรมแล้ว กำลังส่ง', 'Prepared: sending'), UNKNOWN: text('ส่งแล้วแต่ยังยืนยันผลไม่ได้ ระบบกำลังตรวจกับ blockchain (จะไม่ส่งซ้ำ)', 'Sent but not confirmed yet: checking the blockchain (it will not be sent twice)'), FINALIZED: text('คืนเงินเสร็จสมบูรณ์ (ยืนยันบน blockchain)', 'Refund complete (confirmed on chain)'), FAILED: text('ธุรกรรมล้มเหลวบน blockchain — เงินไม่ถูกตัด ขอคืนใหม่ได้', 'The transaction failed on chain — no money moved; you can request again') } as Record<string, string>)[detail.refund.state]} · {formatMoney({ currency: 'USDG', decimals: 6, amountMinor: detail.refund.amountMinor } as never)}</p>
              <small className="mono">{text('กระเป๋าผู้รับ', 'To')}: {detail.refund.beneficiary}</small>{detail.refund.signature && <small className="mono">{text('ลายเซ็นธุรกรรม', 'Signature')}: <a href={`https://explorer.solana.com/tx/${detail.refund.signature}?cluster=devnet`} target="_blank" rel="noreferrer noopener">{detail.refund.signature.slice(0, 16)}…</a></small>}{detail.refund.lastReason && detail.refund.state !== 'FINALIZED' && <small>{detail.refund.lastReason}</small>}</>}
            {detail.refund?.state === 'AWAITING_OWNER' && <div className="bill-refund-sign"><small className="mono">{text('กระเป๋า treasury ที่ต้องเซ็น', 'Treasury wallet that must sign')}: {detail.refund.sourceOwner}</small>
              <button type="button" disabled={busy} onClick={() => void startRefundSign(b, detail.refund!.sourceOwner)}>{text('เซ็นคืนเงินด้วยกระเป๋าเจ้าของร้าน', 'Sign the refund with the owner’s wallet')}</button>
              {choices && <div role="group" aria-label={text('เลือกกระเป๋า', 'Choose a wallet')}>{choices.map(c => <button key={c.name} type="button" className="secondary" disabled={busy} onClick={() => void signRefundWith(b, c, detail.refund!.sourceOwner)}>{c.name}</button>)}</div>}
              <button type="button" className="secondary" disabled={busy} onClick={() => void cancelRefundRequest(b)}>{text('ยกเลิกคำขอคืนเงิน', 'Cancel the refund request')}</button></div>}
            {!detail.refund && detail.refundable?.available && <><label>{text('เหตุผลที่คืนเงิน (3–120 ตัวอักษร)', 'Reason for the refund (3–120 characters)')}<input value={refundReason} maxLength={120} onChange={e => setRefundReason(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void realRefundBill(b)}>{text('คืนเงินจริง (Solana devnet)', 'Refund for real (Solana devnet)')}</button></>}
            {!detail.refund && detail.refundable && !detail.refundable.available && <p className="bill-note">{detail.refundable.blocked === 'SIGNER' ? text('ร้านนี้ยังไม่ได้ตั้งกระเป๋า treasury (Solana) ที่ใช้เซ็นคืนเงินได้ ตั้งค่ากระเป๋ารับเงินก่อน', 'This shop has no usable treasury (Solana) wallet to sign refunds with. Set the receiving wallet first.') : text('ออเดอร์นี้คืนเงินอัตโนมัติไม่ได้', 'This order cannot be refunded automatically.')}</p>}
          </div>}
          {detail.canVoid ? <div className="bill-void"><label>{text('เหตุผลที่ยกเลิก (3–120 ตัวอักษร)', 'Reason for voiding (3–120 characters)')}<input value={reason} maxLength={120} onChange={e => setReason(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void voidBill(b)}>{text('ยกเลิกออเดอร์ (void)', 'Void order')}</button></div> : <p className="bill-note">{voidBlockedText(detail)}</p>}
        </>}
        {detail && b.kind === 'cash' && 'sale' in detail && <>
          <dl className="bill-facts"><div><dt>{text('เงินที่รับ', 'Tendered')}</dt><dd>{formatMoney({ currency: detail.sale.currency.code, decimals: detail.sale.currency.decimals, amountMinor: detail.sale.tenderMinor } as never)}</dd></div><div><dt>{text('เงินทอน', 'Change')}</dt><dd>{formatMoney({ currency: detail.sale.currency.code, decimals: detail.sale.currency.decimals, amountMinor: detail.sale.changeMinor } as never)}</dd></div></dl>
          <ul className="bill-lines">{detail.sale.lines.map((l, i) => <li key={i}>{l.qty}× {language === 'en' && l.nameEn ? l.nameEn : l.name}</li>)}</ul>
          {detail.demo?.available && <div className="bill-demo" role="group" aria-label={text('ปุ่มเดโม', 'Demo buttons')}><p className="bill-demo-tag"><b>DEMO</b> {text('จำลองการคืนเงินสด ไม่มีเงินสดเคลื่อนไหว ลิ้นชักไม่เปลี่ยน (คืนเงินสดจริงให้ใช้ยกเลิกบิล)', 'Simulated cash refund: no cash moves, the drawer is unchanged (to take a cash sale back for real, void it).')}</p>
            {detail.demo.canRefund && <><label>{text('เหตุผลที่คืนเงิน (3–120 ตัวอักษร)', 'Reason for the refund (3–120 characters)')}<input value={demoReason} maxLength={120} onChange={e => setDemoReason(e.target.value)} /></label><button type="button" className="secondary" disabled={busy} onClick={() => void cashDemoRefund(b)}>{text('จำลองคืนเงินสด (เดโม)', 'Simulate cash refund (demo)')}</button></>}
            {detail.demo.refund && <p className="notice" role="status">{text('คืนเงินสดจำลองแล้ว', 'Simulated cash refund')} · {formatMoney({ ...detail.demo.refund.amount } as never)} · {when(detail.demo.refund.at)} · {detail.demo.refund.reason}</p>}</div>}
          <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={() => void reprint(b)}>{text('พิมพ์ใบเสร็จซ้ำ (สำเนา)', 'Reprint receipt (copy)')}</button></div>{detail.sale.void && <p className="notice" role="status">{text('ยกเลิกแล้ว', 'Voided')} · {when(detail.sale.void.at)} · {detail.sale.void.reason}{detail.sale.void.restocked ? ` · ${text('คืนสต็อกแล้ว', 'stock returned')}` : ''}</p>}
          {detail.sale.status === 'PAID' && (manager ? <div className="bill-void"><label>{text('เหตุผลที่ยกเลิก', 'Reason for voiding')}<input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label><label className="cash-check-row"><input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} />{text('สินค้ายังขายได้ คืนเข้าสต็อก', 'Goods are sellable again; return to stock')}</label><button type="button" disabled={busy} onClick={() => void voidBill(b)}>{text('ยกเลิกบิลเงินสด', 'Void cash sale')}</button></div> : <p className="bill-note">{voidBlockedText({ voidBlocked: 'ROLE' } as Detail)}</p>)}
        </>}
      </div>}
    </li>; })}</ul>}
    {bills && cursor && <div className="toolbar"><button type="button" className="secondary" disabled={loading} onClick={() => void load(true)}>{loading ? text('กำลังโหลด…', 'Loading…') : text('โหลดเพิ่ม', 'Load more')}</button></div>}
  </main>;
}
