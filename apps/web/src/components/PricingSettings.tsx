import { META } from '../lib/edition';
import MerchantIcon from './MerchantIcon';
import React, { useEffect, useRef, useState } from 'react';
import type { PriceConfiguration } from '../../../../packages/contracts/src/index';
import { api, ApiError, errorMessage } from '../lib/api';
import { decimalAmount, parsePrice } from '../lib/money';
import type { Product } from '../lib/menu';
import type { PricingView, Session } from '../lib/table';
import '../styles/merchant-pricing-offer.css';

type Language = 'th' | 'en';
type Props = { session: Session; products: Product[]; saved(): void; language?: Language };

export default function PricingSettings(props: Props) {
  // Logical ownership changes retire all private prices and unsaved drafts immediately.
  return <PricingWorkspace key={JSON.stringify([props.session.merchantId, props.session.userId, props.session.role])} {...props}/>;
}

function PricingWorkspace({ session, products, saved, language = 'en' }: Props) {
  const [view, setView] = useState<PricingView>();
  const [currency, setCurrency] = useState<'USD' | 'USDG'>('USD');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [demo, setDemo] = useState(false), [label, setLabel] = useState('');
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [rawError, setRawError] = useState(''), [message, setMessage] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const working = useRef(false), dirty = useRef(false), mounted = useRef(false), readSerial = useRef(0);
  const context = useRef({ token: session.token });
  if (context.current.token !== session.token) context.current = { token: session.token };
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const canEdit = session.role === 'owner';
  const current = (request: { token: string }) => mounted.current && context.current === request;
  const changed = () => { dirty.current = true; setMessage(''); };
  function showError(caught: unknown, fallback: string) {
    setRawError(caught instanceof Error ? caught.message : String(caught));
    const description = caught instanceof ApiError
      ? caught.status === 401 || caught.status === 403
        ? text('โปรดเข้าสู่ระบบใหม่หรือขอสิทธิ์จากเจ้าของร้าน', 'Sign in again or ask the owner for access.')
        : caught.status === 409
          ? text('ข้อมูลราคามีการเปลี่ยนแปลง โหลดราคาล่าสุดก่อนบันทึกอีกครั้ง', 'Prices changed. Reload saved prices before saving again.')
          : fallback
      : caught instanceof Error && caught.name !== 'TypeError' && caught.name !== 'TimeoutError'
        ? errorMessage(caught) || fallback
        : fallback;
    setError(description);
  }
  async function load(replaceDraft = true, request = context.current) {
    const serial = ++readSerial.current;
    let next: PricingView;
    try { next = await api<PricingView>('/settings/pricing', undefined, request.token); }
    catch (caught) {
      if (!current(request) || serial !== readSerial.current) return;
      throw caught;
    }
    if (!current(request) || serial !== readSerial.current) return;
    if (!replaceDraft && dirty.current) return;
    setView(next); setCurrency(next.catalogCurrency ?? 'USD'); setAccepted(false);
    setDemo(next.provenance?.kind === 'demo_configured');
    setLabel(next.provenance?.kind === 'demo_configured' ? next.provenance.label : '');
    setPrices(Object.fromEntries(next.prices.map(price => [price.productId, decimalAmount(next.catalogCurrency === 'USDG'
      ? { currency: 'USDG', decimals: 6, amountMinor: price.unitMinor }
      : { currency: 'USD', decimals: next.decimals === 4 ? 4 : 2, amountMinor: price.unitMinor })])));
    dirty.current = false; setRefreshRequired(false);
  }
  useEffect(() => {
    mounted.current = true;
    const request = { token: session.token };
    context.current = request;
    if (canEdit) {
      setBusy(true); setError(''); setRawError(''); setMessage('');
      if (working.current) {
        // A refreshed token must not unlock another PUT while the original result is unresolved.
        setRefreshRequired(true); setAccepted(false);
      } else {
        void load(false, request).catch(caught => {
          if (!current(request)) return;
          if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
            setView(undefined); setPrices({}); setAccepted(false); dirty.current = false;
          }
          showError(caught, text('โหลดการตั้งราคาไม่สำเร็จ โปรดลองอีกครั้ง', 'Could not load pricing. Try again.'));
        }).finally(() => { if (current(request)) setBusy(false); });
      }
    }
    return () => { mounted.current = false; ++readSerial.current; };
  }, [session.token, canEdit]);
  const policy = currency === 'USD' ? 'USD_FIXED4_TO_USDG_1_TO_1' : 'USDG_RAW_IDENTITY';
  const reload = () => {
    if (busy || working.current) return;
    const request = context.current;
    setBusy(true); setError(''); setRawError(''); setMessage('');
    void load(true, request).catch(caught => {
      if (!current(request)) return;
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        setView(undefined); setPrices({}); setAccepted(false); dirty.current = false;
      }
      showError(caught, text('โหลดราคาที่บันทึกไม่สำเร็จ โปรดลองอีกครั้ง', 'Could not reload saved prices. Try again.'));
    }).finally(() => { if (current(request)) setBusy(false); });
  };
  async function publish() {
    if (!view || !canEdit || busy || working.current || !accepted || refreshRequired || !products.length) return;
    const request = context.current;
    working.current = true; setBusy(true); setError(''); setRawError(''); setMessage('');
    let committed = false;
    try {
      const body: PriceConfiguration = {
        expectedRevision: view.revision, catalogCurrency: currency, catalogDecimals: currency === 'USD' ? 4 : 6,
        provenance: demo ? { kind: 'demo_configured', label: label.trim() } : { kind: 'owner_configured' },
        prices: products.map(product => {
          try { return { productId: product.id, unitMinor: parsePrice(prices[product.id] ?? '', currency, currency === 'USD' ? 4 : 6) }; }
          catch { throw new Error(text(`ตรวจราคาของ ${product.name}: ใช้ทศนิยมไม่เกิน ${currency === 'USD' ? 4 : 6} ตำแหน่ง`, `Check the price for ${product.nameEn}: use at most ${currency === 'USD' ? 4 : 6} decimal places.`)); }
        }),
        settlement: { asset: 'USDG', network: view.settlement.network, mint: view.settlement.mint, tokenProgram: view.settlement.tokenProgram, decimals: 6, quotePolicy: policy },
      };
      if (demo && !label.trim()) throw new Error(text('โปรดระบุชื่อแค็ตตาล็อกทดสอบ', 'Label this explicitly configured demo catalog.'));
      await api('/settings/pricing', body, request.token, 'PUT');
      committed = true;
      if (!current(request)) return;
      setRefreshRequired(true); setAccepted(false);
      setMessage(text('บันทึกราคาแล้ว โปรดตรวจสอบตะกร้าที่เปิดอยู่', 'Prices saved. Review any open carts again.'));
      saved();
      if (current(request)) await load(true, request);
    } catch (caught) {
      if (!current(request)) return;
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        setView(undefined); setPrices({}); setAccepted(false); dirty.current = false;
      }
      showError(caught, committed
        ? text('บันทึกราคาแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ โปรดโหลดราคาที่บันทึกก่อนทำรายการต่อ', 'Prices were saved, but refreshing failed. Reload saved prices before making another change.')
        : text('บันทึกราคาไม่สำเร็จ โปรดตรวจฉบับร่างก่อนลองอีกครั้ง', 'Could not save prices. Review your draft before trying again.'));
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        if (!current(request)) {
          setRefreshRequired(true); setAccepted(false); setRawError('');
          setError(text('เซสชันเปลี่ยนระหว่างบันทึก โหลดราคาที่บันทึกเพื่อตรวจผลก่อนทำรายการต่อ', 'Your session changed during saving. Reload saved prices to check the result before making another change.'));
        }
      }
    }
  }
  const state = !canEdit ? 'denied' : !view ? error ? 'error' : 'loading' : !products.length ? 'empty' : 'ready';
  return <section className="panel pricing-settings" lang={language} aria-label={text('ตั้งค่าราคาเมนู', 'Owner pricing setup')}>
    <header className="pricing-hero"><div><p className="pricing-kicker">{text('ราคาและสกุลเงิน', 'CATALOG PRICING')}</p><h2>{text('ราคาเมนู', 'Menu prices')}</h2><p>{text('กำหนดสกุลเงินและราคาสินค้าสำหรับออเดอร์ใหม่เท่านั้น', 'Set currency and item prices for new orders only.')}</p></div>{view && <span className="badge">{view.configured ? text(`กำหนดราคาเป็น ${view.catalogCurrency}`, `Prices in ${view.catalogCurrency}`) : text('ต้องตั้งค่าก่อนรับออเดอร์ใหม่', 'Setup required: new checkout disabled')}</span>}</header>
    {state === 'denied' && <div className="pricing-card pricing-state" role="alert"><h3>{text('สำหรับเจ้าของร้าน', 'Owner access required')}</h3><p>{text('โปรดเข้าสู่ระบบด้วยบัญชีเจ้าของร้านเพื่อจัดการราคา', 'Sign in with the shop owner account to manage prices.')}</p></div>}
    {state === 'loading' && <div className="pricing-card pricing-state" role="status"><h3>{text('กำลังโหลดการตั้งราคา…', 'Loading pricing setup…')}</h3><p>{text('ยังไม่มีการเปลี่ยนแปลงหรือเผยแพร่ราคา', 'No prices are changed or published while this loads.')}</p></div>}
    {state === 'error' && <div className="pricing-card pricing-state"><h3>{text('เปิดการตั้งราคาไม่ได้', 'Pricing setup unavailable')}</h3><p className="error" role="alert">{error}</p>{rawError && <details><summary>{text('รายละเอียดทางเทคนิค', 'Technical details')}</summary><p className="pricing-error-detail">{rawError}</p></details>}<button type="button" disabled={busy} onClick={reload}><MerchantIcon name="arrow"/>{text('ลองโหลดอีกครั้ง', 'Reload saved prices')}</button></div>}
    {state === 'empty' && <div className="pricing-card pricing-state"><h3>{text('ยังไม่มีสินค้าให้ตั้งราคา', 'No menu items to price')}</h3><p>{text('ไม่มีสินค้าจากเมนูปัจจุบัน จึงไม่ส่งการตั้งราคาเปล่า', 'The current menu has no products, so an empty price configuration is not sent.')}</p><button type="button" className="secondary" disabled={busy} onClick={reload}><MerchantIcon name="arrow"/>{text('โหลดเมนูและราคาที่บันทึก', 'Reload saved prices')}</button></div>}
    {state === 'ready' && view && <div className="pricing-layout"><form className="pricing-card" onSubmit={event => { event.preventDefault(); void publish(); }}>
      <h3>{text('ตั้งค่าราคา', 'Price configuration')}</h3><p>{text('ตรวจทานทุกช่องและยืนยันนโยบายสกุลเงินก่อนบันทึก', 'Review every field and acknowledge the denomination policy before saving.')}</p>
      <label>{text('สกุลเงินแค็ตตาล็อก', 'Catalog currency')}<select aria-label={text('สกุลเงินแค็ตตาล็อก', 'Catalog currency')} value={currency} disabled={busy} onChange={event => { changed(); setCurrency(event.target.value as 'USD' | 'USDG'); setPrices({}); setAccepted(false); }}><option value="USD">USD · {text('ทศนิยมไม่เกิน 4 ตำแหน่ง', 'up to 4 decimal places')}</option>{!META && <option value="USDG">USDG · 6 {text('ตำแหน่งทศนิยม', 'decimal places')}</option>}</select></label>
      <div className="pricing-grid">{products.map(product => <label key={product.id}>{product.nameEn}<small lang="th">{product.name}</small><input aria-label={text(`ราคาสำหรับ ${product.name}`, `Price for ${product.nameEn}`)} inputMode="decimal" value={prices[product.id] ?? ''} required disabled={busy} onChange={event => { changed(); setPrices(current => ({ ...current, [product.id]: event.target.value })); }}/></label>)}</div>
      <label className="check-label"><input type="checkbox" checked={demo} disabled={busy} onChange={event => { changed(); setDemo(event.target.checked); }}/>{text('แค็ตตาล็อกทดสอบ', 'Test catalog')}</label>{demo && <label>{text('ชื่อแค็ตตาล็อกทดสอบ', 'Test catalog name')}<input required value={label} disabled={busy} onChange={event => { changed(); setLabel(event.target.value); }}/></label>}
      {!META && <section className="notice"><strong>{text('การชำระด้วย USDG ทดสอบ', 'Payment in test USDG')}</strong><p>{currency === 'USD' ? text('USD 1 กำหนดหน่วยเป็น USDG ทดสอบ 1 โทเค็น ไม่ใช่อัตราแลกเปลี่ยนหรือการรับประกันการไถ่ถอน', 'USD 1 is denominated as 1 test USDG token. This is not a market FX rate or redemption guarantee.') : text('จำนวน USDG ในแค็ตตาล็อกชำระเป็นหน่วยดิบ USDG เดียวกันทุกประการ ไม่มีการแปลง', 'USDG catalog amounts settle as exactly the same raw USDG units; no conversion.')}</p><p>{view.settlement.network} · {text('USDG ทดสอบ · ค่าธรรมเนียมเครือข่ายโดยร้านค้า', 'test USDG · Merchant-funded network fees')}</p><details className="bill-details"><summary>{text('รายละเอียดทางเทคนิค', 'Technical details')}</summary><p>{currency === 'USD' ? text('ทุก 0.0001 USD เท่ากับ 100 หน่วยดิบ USDG อย่างแม่นยำ', 'Each 0.0001 USD becomes exactly 100 USDG raw units.') : text('จำนวน USDG ชำระด้วยหน่วยดิบเดียวกัน โดยไม่มีการแปลง', 'USDG settles in the same raw units, without conversion.')}</p><p className="mono">Mint: {view.settlement.mint}<br/>Program: {view.settlement.tokenProgram}<br/>Genesis: {view.settlement.genesisHash}</p></details><label className="check-label"><input type="checkbox" checked={accepted} required disabled={busy} onChange={event => { changed(); setAccepted(event.target.checked); }}/>{text('ฉันตรวจสอบนโยบายหน่วยเงินและต้องการบันทึกการตั้งค่านี้', 'I reviewed the denomination policy and want to save this configuration.')}</label></section>}
      <div className="toolbar"><button disabled={busy || !accepted || refreshRequired}><MerchantIcon name="save"/>{text('บันทึกราคาเมนู', 'Save menu prices')}</button><button type="button" className="secondary" disabled={busy} onClick={reload}><MerchantIcon name="arrow"/>{text('โหลดราคาที่บันทึก', 'Reload saved prices')}</button></div>
      {error && <><p className="error" role="alert">{error} {!refreshRequired && text('ฉบับร่างยังอยู่ ระบบจะไม่บันทึกซ้ำอัตโนมัติ', 'Your draft is retained. Saving never retries automatically.')}</p>{rawError && <details><summary>{text('รายละเอียดทางเทคนิค', 'Technical details')}</summary><p className="pricing-error-detail">{rawError}</p></details>}</>}{message && <p role="status">{message}</p>}
    </form><aside className="pricing-aside" aria-label={text('ขอบเขตราคา', 'Pricing boundary')}><span className="badge">{text('บันทึกด้วยรุ่นข้อมูล', 'Revision-bound save')}</span><h3>{text('ราคามีผลกับออเดอร์ใหม่', 'Prices affect new orders')}</h3><p>{text('บิลเดิม การชำระเงิน และสต็อกไม่เปลี่ยนตามราคาชุดนี้', 'Existing bills, payments and stock remain unchanged.')}</p><p>{text('หากถูกปฏิเสธ ให้เข้าสู่ระบบใหม่หรือขอสิทธิ์จากเจ้าของร้าน', 'If access is denied, sign in again or ask the owner for permission.')}</p></aside></div>}
  </section>;
}
