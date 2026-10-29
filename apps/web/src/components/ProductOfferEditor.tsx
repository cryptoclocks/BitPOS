import MerchantIcon from './MerchantIcon';
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { decimalAmount, formatMoney } from '../lib/money';
import { discountedMinor, discountFromDraft, offerCommand, type OfferDraft, type OfferView, type Product } from '../lib/menu';
import '../styles/merchant-pricing-offer.css';

function localExpiry(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}
type Props = { product: Product; token: string; language: 'th' | 'en'; onSaved(): void; onClose(): void };
export default function ProductOfferEditor(props: Props) {
  // A new credential/product retires the previous editor before private state can render.
  return <OfferWorkspace key={`${props.product.id}:${props.token}`} {...props}/>;
}
function OfferWorkspace({ product, token, language, onSaved, onClose }: Props) {
  const [view, setView] = useState<OfferView>();
  const [draft, setDraft] = useState<OfferDraft>({ kind: 'amount', value: '', expiresAt: '' });
  const [error, setError] = useState(''); const [rawError, setRawError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(true);
  const [receivedAt, setReceivedAt] = useState(0); const [reload, setReload] = useState(0);
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const heading = useRef<HTMLHeadingElement>(null);
  function readableError(caught: unknown) {
    if (caught instanceof ApiError) {
      if (caught.status === 401) return text('เซสชันหมดอายุ โปรดเข้าสู่ระบบใหม่', 'Your session expired. Sign in again.');
      if (caught.status === 403) return text('บัญชีนี้ไม่มีสิทธิ์แก้ไขข้อเสนอ', 'This account cannot edit offers.');
      if (caught.status === 409) return text('ข้อเสนอหรือราคาเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนบันทึก', 'The offer or price changed. Reload the latest version before saving.');
      if (caught.status >= 500) return text('เชื่อมต่อไม่ได้ เก็บฉบับร่างไว้แล้ว โปรดตรวจสถานะก่อนลองอีกครั้ง', 'Connection interrupted. Your draft is retained; check the saved offer before retrying.');
    }
    const message = errorMessage(caught);
    if (message.includes('future offer expiry')) return text('เลือกเวลาหมดอายุในอนาคต', 'Choose a future offer expiry.');
    if (message.includes('whole percent')) return text('ใช้ส่วนลดเปอร์เซ็นต์เต็ม 1–99', 'Use a whole percent from 1 to 99.');
    if (message.includes('positive current price')) return text('ส่วนลดต้องมากกว่าศูนย์และเหลือราคาหลังลดมากกว่าศูนย์', 'The discount must leave a positive price.');
    return text('ตรวจข้อมูลข้อเสนอแล้วลองอีกครั้ง ดูรายละเอียดเพิ่มเติมได้ด้านล่าง', message);
  }
  function changeDraft(next: OfferDraft) { setDraft(next); setMessage(''); setError(''); setRawError(''); }
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }); }, []);
  const path = `/products/${encodeURIComponent(product.id)}/offer`;
  function accept(next: OfferView) {
    setView(next); setReceivedAt(performance.now());
    setDraft(next.offer ? { kind: next.offer.discount.kind, value: next.offer.discount.kind === 'amount' && next.effective.basePrice ? decimalAmount({ ...next.effective.basePrice, amountMinor: next.offer.discount.amountMinor }) : String(next.offer.discount.kind === 'percent' ? next.offer.discount.percent : ''), expiresAt: localExpiry(next.offer.expiresAt) } : { kind: 'amount', value: '', expiresAt: '' });
  }
  useEffect(() => {
    let active = true; setBusy(true); setError(''); setRawError(''); setMessage('');
    void api<OfferView>(path, undefined, token).then(next => { if (active) accept(next); }).catch(caught => { if (active) { setView(undefined); setRawError(caught instanceof Error ? caught.message : String(caught)); setError(`${text('เปิดข้อเสนอไม่ได้: ', 'Offer unavailable: ')}${readableError(caught)}`); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path, token, reload]);
  let current = ''; let previewError = '';
  if (view && draft.value) {
    try { const base = view.effective.basePrice; if (!base || (base.currency !== 'USD' && base.currency !== 'USDG')) throw new Error('USD/USDG setup required.'); current = discountedMinor(base.amountMinor, discountFromDraft(draft, base.currency, base.decimals)); }
    catch (caught) { previewError = readableError(caught); }
  }
  async function save(disable: boolean) {
    if (!view || busy || working.current || (disable && !view.offer?.enabled)) return;
    working.current = true;
    setBusy(true); setError(''); setRawError(''); setMessage('');
    try {
      const body = disable ? { priceVersion: view.priceVersion, expectedRevision: view.offer!.revision, enabled: false } : offerCommand(view, draft, Date.parse(view.asOf) + performance.now() - receivedAt);
      const next = await api<OfferView>(path, body, token, disable ? 'PATCH' : 'PUT');
      if (!mounted.current) return;
      accept(next); setMessage(disable ? text('ปิดข้อเสนอแล้ว', 'Offer disabled.') : text('บันทึกและเปิดข้อเสนอแล้ว', 'Offer saved and enabled.')); onSaved();
    } catch (caught) { if (mounted.current) { setRawError(caught instanceof Error ? caught.message : String(caught)); setError(readableError(caught)); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  const reloadLatest = () => setReload(value => value + 1);
  return <section className="offer-editor panel" lang={language} aria-labelledby="offer-heading">
    <header className="offer-hero"><div><p className="offer-kicker">{text('ข้อเสนอสินค้า', 'PRODUCT OFFER')}</p><div className="section-heading"><h2 id="offer-heading" ref={heading} tabIndex={-1}>{text('ข้อเสนอสินค้า', 'Product offer')}: {language === 'th' ? product.name : product.nameEn}</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}><MerchantIcon name="close"/>{text('ปิด', 'Close offer editor')}</button></div><p className="offer-hero-copy">{text('เจ้าของและผู้จัดการตั้งข้อเสนอได้ ราคาฐานไม่เปลี่ยน บิลที่สร้างแล้วคงราคาเดิม', 'Set a discount for new orders. Existing bills keep their prices.')}</p></div></header>
    {busy && !view && <div className="offer-card pricing-state" role="status"><h3>{text('กำลังโหลดข้อเสนอ…', 'Loading offer…')}</h3><p>{text('ยังไม่มีการบันทึกหรือเผยแพร่ข้อเสนอ', 'No offer is saved or published while this loads.')}</p></div>}
    {!busy && !view && error && <div className="offer-card pricing-state"><h3>{text('เปิดข้อเสนอไม่ได้', 'Offer unavailable')}</h3><p className="error" role="alert">{error}</p>{rawError && <details><summary>{text('รายละเอียดทางเทคนิค', 'Technical details')}</summary><p className="pricing-error-detail">{rawError}</p></details>}<button type="button" onClick={reloadLatest}><MerchantIcon name="arrow"/>{text('โหลดข้อมูลล่าสุด', 'Reload latest offer')}</button></div>}
    {view && <div className="offer-layout"><form className="offer-card" onSubmit={event => { event.preventDefault(); void save(false); }}>
      <p className="offer-state">{view.offer ? view.active ? text('ใช้งาน ณ เวลาที่โหลด', 'Active as of last load') : view.offer.enabled ? text('เปิดไว้แต่ไม่เข้าเงื่อนไข (หมดอายุหรือราคาฐานเปลี่ยน)', 'Enabled but inactive (expired or base price changed)') : text('ปิดไว้', 'Disabled') : text('ยังไม่มีข้อเสนอ', 'No offer configured')} · {text('เวลาของเซิร์ฟเวอร์', 'Server as of')} {new Date(view.asOf).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</p>
      <h3>{text('รายละเอียดข้อเสนอ', 'Offer details')}</h3><div className="offer-fields"><label>{text('ราคาฐาน', 'Base price')}<input aria-label={text('ราคาฐาน', 'Base price')} readOnly value={view.effective.basePrice ? formatMoney(view.effective.basePrice) : text('ต้องตั้งราคาก่อน', 'Setup required')}/></label><details className="bill-details offer-technical"><summary>{text('รายละเอียดทางเทคนิค', 'Technical details')}</summary><label>Revision<input aria-label="Expected revision" className="mono" readOnly value={view.offer?.revision ?? '0'}/></label></details>
        <label>{text('ประเภทส่วนลด', 'Discount kind')}<select aria-label={text('ประเภทส่วนลด', 'Discount kind')} disabled={busy} value={draft.kind} onChange={event => changeDraft({ ...draft, kind: event.target.value as OfferDraft['kind'], value: '' })}><option value="amount">{text('จำนวนเงิน', 'Amount')} ({view.effective.basePrice?.currency})</option><option value="percent">{text('เปอร์เซ็นต์เต็ม 1–99', 'Whole percent (1–99)')}</option></select></label>
        <label>{draft.kind === 'amount' ? text('จำนวนส่วนลด', 'Discount amount') : text('ส่วนลด (%)', 'Discount percent (%)')}<input aria-label={draft.kind === 'amount' ? text('จำนวนส่วนลด', 'Discount amount') : text('ส่วนลดเปอร์เซ็นต์', 'Discount percent (%)')} inputMode={draft.kind === 'amount' ? 'decimal' : 'numeric'} value={draft.value} disabled={busy} required maxLength={24} onChange={event => changeDraft({ ...draft, value: event.target.value })}/></label>
        <label>{text('ราคาปัจจุบัน', 'Current price')}<input aria-label={text('ราคาปัจจุบัน', 'Current price')} readOnly value={current && view.effective.basePrice ? formatMoney({ ...view.effective.basePrice, amountMinor: current }) : ''}/></label>
        <label>{text('หมดอายุ (เวลาท้องถิ่น)', 'Expires at (local time)')}<input aria-label={text('หมดอายุ (เวลาท้องถิ่น)', 'Expires at (local time)')} type="datetime-local" step="1" value={draft.expiresAt} disabled={busy} required onChange={event => changeDraft({ ...draft, expiresAt: event.target.value })}/></label></div>
      <small>{text('ส่วนลดเปอร์เซ็นต์จะปัดเศษลง', 'Percentage discounts are rounded down.')}</small>{previewError && <p className="error" role="alert">{previewError}</p>}
      <div className="toolbar"><button disabled={busy || !current}><MerchantIcon name="edit"/>{text('บันทึกและเปิดข้อเสนอ', 'Save & enable offer')}</button><button type="button" className="secondary" disabled={busy || !view.offer?.enabled} onClick={() => void save(true)}><MerchantIcon name="trash"/>{text('ปิดข้อเสนอ', 'Disable offer')}</button></div>
      {error && <><p className="error" role="alert">{error}</p>{rawError && <details><summary>{text('รายละเอียดทางเทคนิค', 'Technical details')}</summary><p className="pricing-error-detail">{rawError}</p></details>}</>}{message && <p role="status">{message}</p>}
    </form><aside className="offer-aside" aria-label={text('ขอบเขตข้อเสนอ', 'Offer boundary')}><span className="badge">{text('ผูกกับรุ่นราคา', 'Price-version bound')}</span><h3>{text('ไม่แก้ไขราคาฐาน', 'Base price is unchanged')}</h3><p>{text('ข้อเสนอมีผลกับออเดอร์ใหม่ที่มีสิทธิ์เท่านั้น และต้องมีเวลาหมดอายุในอนาคต', 'Offers apply only to eligible new orders and require a future expiry.')}</p><p><strong>{text('เกิดความขัดแย้ง?', 'Conflict?')}</strong> {text('โหลดข้อมูลล่าสุดเพื่อตั้งใจแทนที่ฉบับร่าง', 'Reload latest to intentionally replace this draft.')}</p><button type="button" className="secondary" disabled={busy} onClick={reloadLatest}><MerchantIcon name="arrow"/>{text('โหลดข้อมูลล่าสุด', 'Reload offer')}</button></aside></div>}
    {busy && view && <p role="status">{text('กำลังบันทึกหรือโหลดข้อเสนอ…', 'Saving or loading offer…')}</p>}
  </section>;
}
