import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { requestId } from '../lib/request-id';
import { formatMoney } from '../lib/money';
import { perDenomination, toMinor } from '../lib/shift-view';
import '../styles/cash-register.css';
import { printDocument, zReportDoc, type DocLang } from '../lib/print-slip';
import { readReceiptLang } from '../lib/receipt-lang';
import ReceiptLangPicker from './ReceiptLangPicker';

interface Group { currency: string; decimals: number; sourceKind: string; orders: number; totalMinor: string }
interface DrawerFigure { currency: string; decimals: number; openingFloatMinor: string; cashSalesMinor: string; cashInMinor?: string; cashOutMinor?: string; expectedMinor: string; countedMinor?: string | null; varianceMinor?: string | null }
interface Snapshot { timeZone: string; groups: Group[]; excludedOrders: number; drawer?: DrawerFigure | null }
interface Close { id: string; periodStart: string; periodEnd: string; closedBy: string; countedCash: { minor: string; currency: string; decimals: number } | null; note: string; snapshot: Snapshot; createdAt: string }
interface ShiftState { open: { periodStart: string; asOf: string; snapshot: Snapshot }; closes: Close[] }

// P05: close the sales round. The server freezes the paid totals of the period since the previous close in one immutable
// row; the counted cash is only what the person declares. Nothing is reconciled against cash and nothing is assumed
// saved until the server answers.
export default function ShiftClose({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [state, setState] = useState<ShiftState>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState<DocLang>(() => readReceiptLang(language)); const [cash, setCash] = useState(''); const [currency, setCurrency] = useState(''); const [note, setNote] = useState(''); const [confirming, setConfirming] = useState(false);
  const [keyRef] = useState({ current: requestId() });
  async function load() {
    try { const next = await api<ShiftState>('/shifts', undefined, token); setState(next); setMessage(''); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  useEffect(() => { void load(); }, [token]);
  if (!state) return <p className={message ? 'error' : 'notice'} role="status">{message || text('กำลังโหลดรอบการขาย…', 'Loading the sales round…')}</p>;
  const totals = perDenomination(state.open.snapshot.groups);
  const choices = totals.length ? totals : [];
  const selected = choices.find(c => c.currency === currency) ?? choices[0];
  const decimals = selected?.decimals ?? 2, code = selected?.currency ?? (currency || 'THB');
  const minor = cash.trim() === '' ? null : toMinor(cash, decimals);
  const cashValid = cash.trim() === '' || minor !== null;
  const when = (iso: string) => new Date(iso).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const money = (amount: bigint | string, c: string, d: number) => formatMoney({ currency: c, decimals: d, amountMinor: String(amount) } as never);
  async function submit() {
    setBusy(true); setMessage('');
    try {
      await api('/shifts/close', { idempotencyKey: keyRef.current, note: note.trim(), countedCash: minor === null ? null : { minor, currency: code, decimals } }, token);
      keyRef.current = requestId(); setCash(''); setNote(''); setConfirming(false); setMessage(text('ปิดรอบแล้ว', 'Round closed')); await load();
    } catch (error) { setMessage(errorMessage(error)); }
    setBusy(false);
  }
  return <section className="shift-close" aria-label={text('ปิดรอบการขาย', 'Close the sales round')}>
    <div className="shift-grid">
      <form className="reports-card" onSubmit={event => { event.preventDefault(); if (cashValid) setConfirming(true); }}>
        <h2>{text('ปิดรอบการขาย', 'Close the sales round')}</h2>
        <label>{text('รอบการขาย', 'Sales round')}<input readOnly value={`${when(state.open.periodStart)} – ${when(state.open.asOf)}`} /></label>
        <label>{text('เงินสดที่นับได้ (ไม่บังคับ)', 'Counted cash (optional)')}<span className="shift-cash"><input inputMode="decimal" value={cash} placeholder="0.00" onChange={event => { setCash(event.target.value); setConfirming(false); }} aria-invalid={!cashValid} />{choices.length > 1 ? <select value={selected?.currency} onChange={event => setCurrency(event.target.value)} aria-label={text('สกุลเงิน', 'Currency')}>{choices.map(c => <option key={`${c.currency}/${c.decimals}`} value={c.currency}>{c.currency}</option>)}</select> : <b>{code}</b>}</span></label>
        {!cashValid && <p className="error" role="alert">{text(`ใส่จำนวนเงินไม่เกิน ${decimals} ตำแหน่งทศนิยม`, `Enter an amount with at most ${decimals} decimal places.`)}</p>}
        <label>{text('หมายเหตุ', 'Note')}<input value={note} maxLength={200} onChange={event => setNote(event.target.value)} /></label>
        {confirming ? <div className="toolbar" role="group" aria-label={text('ยืนยันปิดรอบ', 'Confirm closing')}><p className="notice">{text('ปิดรอบแล้วแก้ไขไม่ได้ ยืนยันหรือไม่?', 'A closed round cannot be edited. Confirm?')}</p><button type="button" disabled={busy} onClick={() => void submit()}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('ยืนยันปิดรอบ', 'Confirm and close')}</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>{text('ยกเลิก', 'Cancel')}</button></div>
          : <div className="toolbar"><button disabled={!cashValid || busy}>{text('ปิดรอบ', 'Close round')}</button></div>}
        {message && <p className="notice" role="status">{message}</p>}
      </form>
      <aside className="reports-card" aria-label={text('พรีวิวและรายละเอียด', 'Preview and details')}>
        <h2>{text('พรีวิวและรายละเอียด', 'Preview and details')}</h2>
        <div className="shift-status"><small>{text('สถานะ', 'Status')}</small><strong>{totals.length ? text('พร้อมปิดรอบ', 'Ready to close') : text('ยังไม่มียอดในรอบนี้', 'No sales in this round yet')}</strong><span>{text('ตรวจข้อมูลก่อนบันทึก', 'Check the figures before closing')}</span></div>
        {totals.map(t => <p key={`${t.currency}/${t.decimals}`} className="shift-total"><span>{text(`${t.orders} ออเดอร์ที่ชำระแล้ว`, `${t.orders} paid orders`)}</span><b>{money(t.totalMinor, t.currency, t.decimals)}</b></p>)}
        {state.open.snapshot.drawer && (() => { const d = state.open.snapshot.drawer!, counted = minor !== null && code === d.currency && decimals === d.decimals ? BigInt(minor) - BigInt(d.expectedMinor) : null;
          return <div className="shift-drawer" role="status"><b>{text('ลิ้นชักเงินสด', 'Cash drawer')}</b>
            <span>{text('เงินทอนตั้งต้น', 'Starting float')}: {money(d.openingFloatMinor, d.currency, d.decimals)}</span><span>{text('ขายเงินสด', 'Cash sales')}: {money(d.cashSalesMinor, d.currency, d.decimals)}</span>{(d.cashInMinor ?? '0') !== '0' && <span>{text('เงินเข้า', 'Cash in')}: +{money(d.cashInMinor!, d.currency, d.decimals)}</span>}{(d.cashOutMinor ?? '0') !== '0' && <span>{text('เงินออก', 'Cash out')}: −{money(d.cashOutMinor!, d.currency, d.decimals)}</span>}<span>{text('ควรมีในลิ้นชัก', 'Should be in the drawer')}: <b>{money(d.expectedMinor, d.currency, d.decimals)}</b></span>
            {counted !== null && <span className={counted === 0n ? 'ok' : 'off'}>{counted === 0n ? text('นับได้ตรงพอดี', 'Counted exactly') : counted > 0n ? text(`เกิน ${money(counted, d.currency, d.decimals)}`, `Over by ${money(counted, d.currency, d.decimals)}`) : text(`ขาด ${money(-counted, d.currency, d.decimals)}`, `Short by ${money(-counted, d.currency, d.decimals)}`)}</span>}</div>; })()}
        {state.open.snapshot.excludedOrders > 0 && <p className="notice" role="status">{text(`ไม่รวม ${state.open.snapshot.excludedOrders} ออเดอร์เดิมที่ไม่มีข้อมูลราคา`, `${state.open.snapshot.excludedOrders} older paid orders without price data are not included.`)}</p>}
        <p className="reports-sub">{text('ยอดชำระแล้วจากเซิร์ฟเวอร์ ก่อนหักคืนเงินและค่าธรรมเนียม ไม่รวมข้ามสกุลเงิน เงินสดที่นับได้เป็นตัวเลขที่ผู้ปิดรอบระบุ ระบบไม่ได้ตรวจสอบ การปิดรอบบันทึกรายการและเวลา เพื่อให้ตรวจสอบย้อนหลังได้', 'Paid totals from the server, before refunds and fees, never added across currencies. Counted cash is the figure the person declared; the system does not verify it. Closing records who and when, so it can be reviewed later.')}</p>
      </aside>
    </div>
    <h2>{text('รอบที่ปิดแล้ว', 'Closed rounds')}</h2>
    <ReceiptLangPicker value={bill} onChange={setBill} language={language} />
    {state.closes.length ? <table className="catalog-table"><thead><tr><th>{text('รอบ', 'Round')}</th><th>{text('ยอดชำระแล้ว', 'Paid sales')}</th><th>{text('เงินสดที่นับได้', 'Counted cash')}</th><th>{text('หมายเหตุ', 'Note')}</th><th><span className="sr-only">{text('พิมพ์', 'Print')}</span></th></tr></thead>
      <tbody>{state.closes.map(c => <tr key={c.id}><td>{when(c.periodStart)} – {when(c.periodEnd)}</td><td>{perDenomination(c.snapshot.groups).map(t => `${money(t.totalMinor, t.currency, t.decimals)} (${t.orders})`).join(' · ') || '—'}</td><td>{c.countedCash ? money(c.countedCash.minor, c.countedCash.currency, c.countedCash.decimals) : '—'}{c.snapshot.drawer && <small className="shift-expected"> {text('ควรมี', 'expected')} {money(c.snapshot.drawer.expectedMinor, c.snapshot.drawer.currency, c.snapshot.drawer.decimals)}{c.countedCash && c.countedCash.currency === c.snapshot.drawer.currency && c.countedCash.decimals === c.snapshot.drawer.decimals ? ` · ${BigInt(c.countedCash.minor) - BigInt(c.snapshot.drawer.expectedMinor) === 0n ? text('ตรง', 'match') : text('ส่วนต่าง', 'diff') + ' ' + money(BigInt(c.countedCash.minor) - BigInt(c.snapshot.drawer.expectedMinor), c.countedCash.currency, c.countedCash.decimals)}` : ''}</small>}</td><td>{c.note || '—'}</td><td><button type="button" className="secondary" onClick={() => void printDocument(zReportDoc({ periodStart: c.periodStart, periodEnd: c.periodEnd, closedBy: c.closedBy, note: c.note, countedCash: c.countedCash, groups: c.snapshot.groups }, bill))}>{text('พิมพ์ Z-Report', 'Print Z-Report')}</button></td></tr>)}</tbody></table>
      : <p className="notice">{text('ยังไม่เคยปิดรอบ', 'No round has been closed yet.')}</p>}
  </section>;
}
