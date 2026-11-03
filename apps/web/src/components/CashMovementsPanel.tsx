import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { toMinor } from '../lib/shift-view';
import { moneyOf, type Drawer } from '../lib/cash-view';

interface Movement { id: string; kind: 'IN' | 'OUT'; amountMinor: string; reason: string; createdBy: string; createdAt: string }

// Cash put into or taken out of the drawer during this round, each with a reason. Entries are history: a mistake is answered by an opposite entry.
// expected cash = starting float + cash sales + cash in - cash out. The server refuses a cash-out larger than what the drawer should hold.
export default function CashMovementsPanel({ token, role, drawer, language, onChanged }: { token: string; role: string; drawer: Drawer; language: 'th' | 'en'; onChanged: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const currency = { code: drawer.currency, decimals: drawer.decimals };
  const [open, setOpen] = useState(false); const [list, setList] = useState<Movement[]>(); const [error, setError] = useState(''); const [note, setNote] = useState('');
  const [kind, setKind] = useState<'IN' | 'OUT'>('IN'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [key, setKey] = useState(() => crypto.randomUUID());
  const canOut = role === 'owner' || role === 'manager';
  const load = useCallback(async () => {
    try { setList((await api<{ movements: Movement[] }>('/cash/movements', undefined, token)).movements); setError(''); } catch (e) { setError(errorMessage(e)); }
  }, [token]);
  useEffect(() => { if (open) void load(); }, [open, load, drawer.expectedMinor]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    const minor = toMinor(amount, currency.decimals);
    if (minor === null || BigInt(minor) <= 0n) { setNote(text('จำนวนเงินไม่ถูกต้อง', 'The amount is not valid.')); return; }
    if (reason.trim().length < 3) { setNote(text('ใส่เหตุผลอย่างน้อย 3 ตัวอักษร', 'Give a reason of at least 3 characters.')); return; }
    setBusy(true); setNote('');
    try { await api('/cash/movements', { idempotencyKey: key, kind, amountMinor: minor, reason: reason.trim() }, token); setAmount(''); setReason(''); setKey(crypto.randomUUID()); setNote(text('บันทึกแล้ว', 'Saved.')); await load(); onChanged(); }
    catch (e) { setNote(e instanceof ApiError ? errorMessage(e) : errorMessage(e)); }
    setBusy(false);
  }
  const when = (iso: string) => new Date(iso).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  return <section className="cash-movements" aria-label={text('เงินเข้า-ออกลิ้นชัก', 'Cash in and out')}>
    <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{text('เงินเข้า / ออกลิ้นชัก', 'Cash in / out')}{(BigInt(drawer.cashInMinor ?? '0') > 0n || BigInt(drawer.cashOutMinor ?? '0') > 0n) && <small> · +{moneyOf(drawer.cashInMinor ?? '0', currency)} / −{moneyOf(drawer.cashOutMinor ?? '0', currency)}</small>}</button>
    {open && <div className="cash-movements-body">
      <dl className="cash-expected"><div><dt>{text('เงินทอนตั้งต้น', 'Starting float')}</dt><dd>{moneyOf(drawer.opening?.floatMinor ?? '0', currency)}</dd></div><div><dt>{text('ขายเงินสด', 'Cash sales')}</dt><dd>{moneyOf(drawer.cashSalesMinor, currency)}</dd></div><div><dt>{text('เงินเข้า', 'Cash in')}</dt><dd>+{moneyOf(drawer.cashInMinor ?? '0', currency)}</dd></div><div><dt>{text('เงินออก', 'Cash out')}</dt><dd>−{moneyOf(drawer.cashOutMinor ?? '0', currency)}</dd></div><div className="total"><dt>{text('ควรมีในลิ้นชัก', 'Should hold')}</dt><dd>{moneyOf(drawer.expectedMinor ?? '0', currency)}</dd></div></dl>
      <form onSubmit={e => void submit(e)} className="cash-movement-form">
        <fieldset><legend>{text('ประเภท', 'Type')}</legend><label><input type="radio" name="mv" checked={kind === 'IN'} onChange={() => setKind('IN')} />{text('เงินเข้า', 'Cash in')}</label><label><input type="radio" name="mv" checked={kind === 'OUT'} disabled={!canOut} onChange={() => setKind('OUT')} />{text('เงินออก', 'Cash out')}{!canOut && <small> · {text('เจ้าของ/ผู้จัดการ', 'owner/manager')}</small>}</label></fieldset>
        <label>{text(`จำนวน (${currency.code})`, `Amount (${currency.code})`)}<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={text('เช่น 200.00', 'e.g. 200.00')} /></label>
        <label>{text('เหตุผล (3–120 ตัวอักษร)', 'Reason (3–120 characters)')}<input value={reason} maxLength={120} onChange={e => setReason(e.target.value)} placeholder={text('เช่น ซื้อน้ำแข็ง / นำฝากธนาคาร', 'e.g. ice / bank deposit')} /></label>
        <button type="submit" disabled={busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button></form>
      {note && <p className="notice" role="status">{note}</p>}{error && <p className="error" role="alert">{error} <button type="button" className="secondary" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Retry')}</button></p>}
      {list && (list.length ? <ul className="cash-movement-list">{list.map(m => <li key={m.id} className={m.kind === 'IN' ? 'in' : 'out'}><b>{m.kind === 'IN' ? '+' : '−'}{moneyOf(m.amountMinor, currency)}</b><span>{m.reason}</span><time>{when(m.createdAt)}</time></li>)}</ul> : <p className="notice" role="status">{text('ยังไม่มีเงินเข้า/ออกในรอบนี้', 'No cash in or out in this round yet.')}</p>)}
    </div>}
  </section>;
}
