import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Product } from '../lib/menu';

export interface Availability { productId: string; revision: string; paused: boolean; pausedAt: string | null; pausedUntil: string | null; pausedReason: string; sellFrom: string | null; sellTo: string | null; unavailable: 'PAUSED' | 'OUTSIDE_HOURS' | null }
const DURATIONS = [{ id: 'open', th: 'จนกว่าจะเปิดขายต่อ', en: 'Until I resume it', minutes: 0 }, { id: '30', th: '30 นาที', en: '30 minutes', minutes: 30 }, { id: '60', th: '1 ชั่วโมง', en: '1 hour', minutes: 60 }, { id: '120', th: '2 ชั่วโมง', en: '2 hours', minutes: 120 }] as const;

// Pause a product ("out for now") or give it a daily selling window. This changes only whether the product can be offered and accepted right
// now: stock, prices, reserved quantities and paid orders are never touched. Staff may pause/resume; owner and manager also set the window.
export default function ProductAvailabilityPanel({ products, token, language, canEditHours, onChanged }: { products: Product[]; token: string; language: 'th' | 'en'; canEditHours: boolean; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [rows, setRows] = useState<Map<string, Availability>>(); const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(''); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [duration, setDuration] = useState('open'); const [reason, setReason] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const load = useCallback(async () => {
    try { const r = await api<{ availability: Availability[] }>('/products/availability', undefined, token); setRows(new Map(r.availability.map(a => [a.productId, a]))); setLoadError(''); }
    catch (e) { setLoadError(errorMessage(e)); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const name = (p: Product) => language === 'en' && p.nameEn ? p.nameEn : p.name;
  const begin = (a: Availability) => { setOpen(open === a.productId ? '' : a.productId); setDuration('open'); setReason(''); setFrom(a.sellFrom ?? ''); setTo(a.sellTo ?? ''); setMessage(''); };
  async function save(a: Availability, body: Record<string, unknown>, done: string) {
    setBusy(a.productId); setMessage('');
    try { const next = await api<Availability>(`/products/${a.productId}/availability`, { expectedRevision: a.revision, ...body }, token, 'PUT'); setRows(prev => new Map(prev ?? []).set(next.productId, next)); setMessage(done); setOpen(''); onChanged?.(); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'PRODUCT_CHANGED') { setMessage(text('มีคนแก้เมนูนี้ไปแล้ว โหลดค่าล่าสุดให้แล้ว ลองอีกครั้ง', 'Someone changed this item. Latest values are loaded; try again.')); await load(); }
      else setMessage(errorMessage(e));
    }
    setBusy('');
  }
  const pause = (a: Availability) => { const d = DURATIONS.find(x => x.id === duration)!; void save(a, { pause: { until: d.minutes ? new Date(Date.now() + d.minutes * 60000).toISOString() : null, reason: reason.trim() } }, text('พักขายแล้ว', 'Paused.')); };
  const resume = (a: Availability) => void save(a, { pause: null }, text('เปิดขายต่อแล้ว', 'Back on sale.'));
  const saveHours = (a: Availability) => { if (!from || !to || from === to) { setMessage(text('เลือกเวลาเริ่มและสิ้นสุดที่ต่างกัน', 'Choose different start and end times.')); return; } void save(a, { window: { from, to } }, text('บันทึกช่วงเวลาขายแล้ว', 'Selling hours saved.')); };
  const state = (a: Availability) => a.unavailable === 'PAUSED' ? { cls: 'paused', label: text('พักขาย', 'Paused') } : a.unavailable === 'OUTSIDE_HOURS' ? { cls: 'hours', label: text('นอกเวลาขาย', 'Outside hours') } : { cls: 'on', label: text('ขายอยู่', 'On sale') };
  const until = (a: Availability) => a.pausedUntil ? text(`ถึง ${new Date(a.pausedUntil).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}`, `until ${new Date(a.pausedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`) : text('จนกว่าจะเปิดต่อ', 'until resumed');
  return <section className="availability-panel" aria-label={text('ควบคุมการขายรายเมนู', 'Selling controls')}>
    <h2>{text('พักขาย / เวลาขาย', 'Pause & selling hours')}</h2>
    <p className="catalog-sub">{text('พักขายชั่วคราวหรือจำกัดช่วงเวลาขายต่อวัน (เวลาของร้าน) ไม่กระทบสต็อก ราคา หรือออเดอร์ที่จ่ายแล้ว ใบเสนอราคาที่ออกไปก่อนหน้าจะถูกปฏิเสธตอนรับออเดอร์', 'Pause an item for now or limit the hours it is sold each day (shop time). Stock, prices and paid orders are untouched; a quote issued earlier is refused when the order is accepted.')}</p>
    {loadError && <p className="error" role="alert">{loadError} <button type="button" className="secondary" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Retry')}</button></p>}
    {message && <p className="notice" role="status">{message}</p>}
    {!rows && !loadError && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {rows && (products.length ? <ul className="availability-list">{products.map(p => { const a = rows.get(p.id); if (!a) return null; const s = state(a); return <li key={p.id} className={`availability-row ${s.cls}`}>
      <div className="availability-head"><strong>{name(p)}</strong><span className={`availability-chip ${s.cls}`}>{s.label}</span>
        {a.paused && <small>{until(a)}{a.pausedReason ? ` · ${a.pausedReason}` : ''}</small>}{a.sellFrom && a.sellTo && <small>{text('ขายเฉพาะ', 'Sold only')} {a.sellFrom}–{a.sellTo}</small>}
        <span className="availability-actions">{a.paused ? <button type="button" disabled={busy === a.productId} onClick={() => resume(a)}>{text('เปิดขายต่อ', 'Resume')}</button> : <button type="button" className="secondary" disabled={busy === a.productId} onClick={() => begin(a)} aria-expanded={open === a.productId}>{text('พักขาย…', 'Pause…')}</button>}
          {canEditHours && <button type="button" className="secondary" onClick={() => begin({ ...a, paused: true })} aria-expanded={open === a.productId}>{text('ตั้งเวลาขาย', 'Hours')}</button>}</span></div>
      {open === a.productId && <div className="availability-form">
        {!a.paused || !canEditHours ? <fieldset><legend>{text('พักขาย', 'Pause')}</legend><label>{text('นานแค่ไหน', 'For how long')}<select value={duration} onChange={e => setDuration(e.target.value)}>{DURATIONS.map(d => <option key={d.id} value={d.id}>{text(d.th, d.en)}</option>)}</select></label>
          <label>{text('เหตุผล (ไม่บังคับ)', 'Reason (optional)')}<input value={reason} maxLength={120} onChange={e => setReason(e.target.value)} /></label><button type="button" disabled={busy === a.productId} onClick={() => pause(a)}>{text('ยืนยันพักขาย', 'Confirm pause')}</button></fieldset> : null}
        {canEditHours && <fieldset><legend>{text('ช่วงเวลาขายต่อวัน (เวลาร้าน)', 'Daily selling hours (shop time)')}</legend><div className="availability-times"><label>{text('เริ่ม', 'From')}<input type="time" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{text('ถึง', 'To')}<input type="time" value={to} onChange={e => setTo(e.target.value)} /></label></div>
          <p className="catalog-sub">{text('ข้ามเที่ยงคืนได้ เช่น 22:00–02:00', 'May cross midnight, e.g. 22:00–02:00.')}</p>
          <div className="toolbar"><button type="button" disabled={busy === a.productId} onClick={() => saveHours(a)}>{text('บันทึกเวลาขาย', 'Save hours')}</button>{a.sellFrom && <button type="button" className="secondary" disabled={busy === a.productId} onClick={() => void save(a, { window: null }, text('ล้างเวลาขายแล้ว ขายได้ทั้งวัน', 'Hours cleared; sold all day.'))}>{text('ขายทั้งวัน', 'Sell all day')}</button>}</div></fieldset>}
      </div>}</li>; })}</ul> : <p className="notice" role="status">{text('ยังไม่มีสินค้า', 'No products yet.')}</p>)}
  </section>;
}
