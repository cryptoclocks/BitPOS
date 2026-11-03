import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import '../styles/bill-history.css';

interface Bill { kind: 'order' | 'cash'; id: string; ref: string; state: 'PAID' | 'OPEN' | 'VOIDED' | 'EXPIRED'; source: 'store' | 'online' | 'cash'; createdAt: string; currency: string; decimals: number; totalMinor: string | null; voidReason: string | null }
interface Detail { order: { id: string; status: string; pricing?: { lines: { qty: number; name: string; nameEn?: string }[] } }; void: { reason: string; by: string; at: string } | null; attempts: { status: string; signature: string | null; at: string }[]; timeline: { action: string; actor: string; at: string }[]; canVoid: boolean; voidBlocked: 'PAID' | 'ONLINE' | 'NOT_OPEN' | 'ROLE' | null }
interface CashDetail { sale: { id: string; receiptNo: string; status: 'PAID' | 'VOIDED'; cashier: string; tenderMinor: string; changeMinor: string; currency: { code: string; decimals: number }; void: { reason: string; at: string; restocked: boolean } | null; lines: { name: string; nameEn: string; qty: number }[] } }

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
  async function voidBill(b: Bill) {
    if (reason.trim().length < 3) { setMessage(text('ใส่เหตุผลอย่างน้อย 3 ตัวอักษร', 'Give a reason of at least 3 characters.')); return; }
    if (!window.confirm(b.kind === 'order' ? text('ยกเลิก (void) ออเดอร์นี้? สต็อกที่จองไว้จะถูกคืนหนึ่งครั้ง', 'Void this order? The reserved stock is released once.') : text('ยกเลิกบิลเงินสดนี้?', 'Void this cash sale?'))) return;
    setBusy(true); setMessage('');
    try {
      if (b.kind === 'order') await api(`/bills/orders/${b.id}/void`, { reason: reason.trim() }, token);
      else await api(`/cash/sales/${b.id}/void`, { reason: reason.trim(), restock }, token);
      setMessage(text('ยกเลิกบิลแล้ว', 'Bill voided.')); setOpenKey(''); await load(false);
    } catch (e) {
      if (e instanceof ApiError && ['ORDER_PAID_CANNOT_VOID', 'PAYMENT_PENDING', 'ORDER_NOT_PAYABLE'].includes(e.code)) { setMessage(errorMessage(e)); await load(false); await open({ ...b }); }
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
          {detail.void && <p className="notice" role="status">{text('ยกเลิกแล้ว', 'Voided')} · {when(detail.void.at)} · {detail.void.reason}</p>}
          <ol className="bill-timeline" aria-label={text('ประวัติการดำเนินการ', 'Timeline')}>{detail.timeline.map((t, i) => <li key={i}><time>{when(t.at)}</time> {t.action}</li>)}</ol>
          {detail.canVoid ? <div className="bill-void"><label>{text('เหตุผลที่ยกเลิก (3–120 ตัวอักษร)', 'Reason for voiding (3–120 characters)')}<input value={reason} maxLength={120} onChange={e => setReason(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void voidBill(b)}>{text('ยกเลิกออเดอร์ (void)', 'Void order')}</button></div> : <p className="bill-note">{voidBlockedText(detail)}</p>}
        </>}
        {detail && b.kind === 'cash' && 'sale' in detail && <>
          <dl className="bill-facts"><div><dt>{text('เงินที่รับ', 'Tendered')}</dt><dd>{formatMoney({ currency: detail.sale.currency.code, decimals: detail.sale.currency.decimals, amountMinor: detail.sale.tenderMinor } as never)}</dd></div><div><dt>{text('เงินทอน', 'Change')}</dt><dd>{formatMoney({ currency: detail.sale.currency.code, decimals: detail.sale.currency.decimals, amountMinor: detail.sale.changeMinor } as never)}</dd></div></dl>
          <ul className="bill-lines">{detail.sale.lines.map((l, i) => <li key={i}>{l.qty}× {language === 'en' && l.nameEn ? l.nameEn : l.name}</li>)}</ul>
          {detail.sale.void && <p className="notice" role="status">{text('ยกเลิกแล้ว', 'Voided')} · {when(detail.sale.void.at)} · {detail.sale.void.reason}{detail.sale.void.restocked ? ` · ${text('คืนสต็อกแล้ว', 'stock returned')}` : ''}</p>}
          {detail.sale.status === 'PAID' && (manager ? <div className="bill-void"><label>{text('เหตุผลที่ยกเลิก', 'Reason for voiding')}<input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label><label className="cash-check-row"><input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} />{text('สินค้ายังขายได้ คืนเข้าสต็อก', 'Goods are sellable again; return to stock')}</label><button type="button" disabled={busy} onClick={() => void voidBill(b)}>{text('ยกเลิกบิลเงินสด', 'Void cash sale')}</button></div> : <p className="bill-note">{voidBlockedText({ voidBlocked: 'ROLE' } as Detail)}</p>)}
        </>}
      </div>}
    </li>; })}</ul>}
    {bills && cursor && <div className="toolbar"><button type="button" className="secondary" disabled={loading} onClick={() => void load(true)}>{loading ? text('กำลังโหลด…', 'Loading…') : text('โหลดเพิ่ม', 'Load more')}</button></div>}
  </main>;
}
