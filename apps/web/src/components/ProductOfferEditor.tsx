import MerchantIcon from './MerchantIcon';
import React, { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { decimalAmount, formatMoney } from '../lib/money';
import { discountedMinor, discountFromDraft, offerCommand, type OfferDraft, type OfferView, type Product } from '../lib/menu';

function localExpiry(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}
export default function ProductOfferEditor({ product, token, language, onSaved, onClose }: { product: Product; token: string; language: 'th' | 'en'; onSaved(): void; onClose(): void }) {
  const [view, setView] = useState<OfferView>();
  const [draft, setDraft] = useState<OfferDraft>({ kind: 'amount', value: '', expiresAt: '' });
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(true);
  const [receivedAt, setReceivedAt] = useState(0); const [reload, setReload] = useState(0);
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }); }, []);
  const path = `/products/${encodeURIComponent(product.id)}/offer`;
  function accept(next: OfferView) {
    setView(next); setReceivedAt(performance.now());
    setDraft(next.offer ? { kind: next.offer.discount.kind, value: next.offer.discount.kind === 'amount' && next.effective.basePrice ? decimalAmount({ ...next.effective.basePrice, amountMinor: next.offer.discount.amountMinor }) : String(next.offer.discount.kind === 'percent' ? next.offer.discount.percent : ''), expiresAt: localExpiry(next.offer.expiresAt) } : { kind: 'amount', value: '', expiresAt: '' });
  }
  useEffect(() => {
    let active = true; setBusy(true); setError(''); setMessage('');
    void api<OfferView>(path, undefined, token).then(next => { if (active) accept(next); }).catch(error => { if (active) { setView(undefined); setError(error instanceof Error ? error.message : 'Offer unavailable'); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path, token, reload]);
  let current = ''; let previewError = '';
  if (view && draft.value) {
    try { const base = view.effective.basePrice; if (!base || base.currency === 'THB') throw new Error('USD/USDG setup required.'); current = discountedMinor(base.amountMinor, discountFromDraft(draft, base.currency)); }
    catch (error) { previewError = error instanceof Error ? error.message : 'Invalid discount'; }
  }
  async function save(disable: boolean) {
    if (!view) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const body = disable ? { priceVersion: view.priceVersion, expectedRevision: view.offer!.revision, enabled: false } : offerCommand(view, draft, Date.parse(view.asOf) + performance.now() - receivedAt);
      const next = await api<OfferView>(path, body, token, disable ? 'PATCH' : 'PUT');
      accept(next); setMessage(disable ? text('ปิดข้อเสนอแล้ว', 'Offer disabled.') : text('บันทึกและเปิดข้อเสนอแล้ว', 'Offer saved and enabled.')); onSaved();
    } catch (error) { setError(`${error instanceof Error ? error.message : 'Offer request failed'}. ${text('หากข้อมูลเปลี่ยน โปรดโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง', 'If the offer changed, reload latest before saving again.')}`); }
    finally { setBusy(false); }
  }
  return <section className="offer-editor panel" aria-labelledby="offer-heading">
    <div className="section-heading"><h2 id="offer-heading" ref={heading} tabIndex={-1}>{text('ข้อเสนอสินค้า', 'Product offer')}: {language === 'th' ? product.name : product.nameEn}</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}><MerchantIcon name="close" />{text('ปิด', 'Close offer editor')}</button></div>
    <p>{text('เจ้าของและผู้จัดการตั้งข้อเสนอได้ ราคาฐานไม่เปลี่ยน บิลที่สร้างแล้วคงราคาเดิม', 'Set a discount for new orders. Existing bills keep their prices.')}</p>
    {view && <><p className="offer-state">{view.offer ? view.active ? text('ใช้งาน ณ เวลาที่โหลด', 'Active as of last load') : view.offer.enabled ? text('เปิดไว้แต่ไม่เข้าเงื่อนไข (หมดอายุหรือราคาฐานเปลี่ยน)', 'Enabled but inactive (expired or base price changed)') : text('ปิดไว้', 'Disabled') : text('ยังไม่มีข้อเสนอ', 'No offer configured')} · {text('เวลาของเซิร์ฟเวอร์', 'Server as of')} {new Date(view.asOf).toLocaleString()}</p>
      <form onSubmit={event => { event.preventDefault(); void save(false); }}>
        <div className="offer-fields"><label>{text('ราคาฐาน', 'Base price')}<input aria-label="Base price" readOnly value={view.effective.basePrice ? formatMoney(view.effective.basePrice) : 'Setup required'} /></label><details className="bill-details offer-technical"><summary>Technical details</summary><label>Revision<input aria-label="Expected revision" className="mono" readOnly value={view.offer?.revision ?? '0'} /></label></details>
        <label>{text('ประเภทส่วนลด', 'Discount kind')}<select aria-label="Discount kind" disabled={busy} value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as OfferDraft['kind'], value: '' })}><option value="amount">{text('จำนวนเงิน', 'Amount')} ({view.effective.basePrice?.currency})</option><option value="percent">{text('เปอร์เซ็นต์เต็ม 1–99', 'Whole percent (1–99)')}</option></select></label>
        <label>{draft.kind === 'amount' ? text('จำนวนส่วนลด', 'Discount amount') : text('ส่วนลด (%)', 'Discount percent (%)')}<input aria-label={draft.kind === 'amount' ? 'Discount amount' : 'Discount percent (%)'} inputMode={draft.kind === 'amount' ? 'decimal' : 'numeric'} value={draft.value} disabled={busy} required maxLength={24} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label>
        <label>{text('ราคาปัจจุบัน', 'Current price')}<input aria-label="Current price" readOnly value={current && view.effective.basePrice ? formatMoney({ ...view.effective.basePrice, amountMinor: current }) : ''} /></label>
        <label>{text('หมดอายุ (เวลาท้องถิ่น)', 'Expires at (local time)')}<input aria-label="Expires at (local time)" type="datetime-local" step="1" value={draft.expiresAt} disabled={busy} required onChange={event => setDraft({ ...draft, expiresAt: event.target.value })} /></label></div>
        <small>{text('ส่วนลดเปอร์เซ็นต์จะปัดเศษลง', 'Percentage discounts are rounded down.')}</small>
        {previewError && <p className="error" role="alert">{previewError}</p>}
        <div className="toolbar"><button disabled={busy || !current}><MerchantIcon name="edit" />{text('บันทึกและเปิดข้อเสนอ', 'Save & enable offer')}</button><button type="button" className="secondary" disabled={busy || !view.offer?.enabled} onClick={() => void save(true)}><MerchantIcon name="trash" />{text('ปิดข้อเสนอ', 'Disable offer')}</button></div>
      </form></>}
    <p><button type="button" className="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}><MerchantIcon name="arrow" />{text('โหลดข้อมูลล่าสุด (แทนที่การแก้ไข)', 'Reload offer')}</button></p>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}{busy && <p role="status">{text('กำลังโหลด…', 'Loading offer…')}</p>}
  </section>;
}
