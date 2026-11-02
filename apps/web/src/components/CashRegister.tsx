import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { requestId } from '../lib/request-id';
import { toMinor } from '../lib/shift-view';
import { cashReceiptDoc, printDocument } from '../lib/print-slip';
import { minorToInput, parseDiscount, quickTenders, moneyOf, type CashQuote, type CashSale } from '../lib/cash-view';
import { play } from '../lib/sfx';
import type { Product } from '../lib/menu';
import CashSettingsPanel, { type CashSettings } from './CashSettingsPanel';
import '../styles/cash-register.css';

interface CartLine { productId: string; qty: number }
const MAX_QTY = 100;

// Cash sales at the counter. The screen only collects what was rung up and what was handed over: every price, discount, tax split and
// the change come back from the server, and nothing is considered sold until the server has answered with a stored receipt.
export default function CashRegister({ token, role, language, products, onChanged }: { token: string; role: string; language: 'th' | 'en'; products: Product[]; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const manage = role === 'owner' || role === 'manager';
  const [settings, setSettings] = useState<CashSettings>(); const [prices, setPrices] = useState<Map<string, string>>(new Map());
  const [cart, setCart] = useState<CartLine[]>([]); const [search, setSearch] = useState(''); const [category, setCategory] = useState('');
  const [scan, setScan] = useState(''); const [scanNote, setScanNote] = useState('');
  const [discKind, setDiscKind] = useState<'percent' | 'amount'>('percent'); const [discText, setDiscText] = useState('');
  const [tender, setTender] = useState(''); const [quote, setQuote] = useState<CashQuote | null>(null); const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState<CashSale | null>(null);
  const [showSettings, setShowSettings] = useState(false); const [showSales, setShowSales] = useState(false);
  const quoteSeq = useRef(0); const key = useRef({ sig: '', id: requestId() }); const scanRef = useRef<HTMLInputElement>(null);

  const loadConfig = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api<{ settings: CashSettings }>('/cash/settings', undefined, token), api<{ prices: { productId: string; priceMinor: string }[] }>('/cash/prices', undefined, token)]);
      setSettings(s.settings); setPrices(new Map(p.prices.map(x => [x.productId, x.priceMinor]))); setError('');
    } catch (e) { setError(errorMessage(e)); }
  }, [token]);
  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const currency = settings ? { code: settings.currency, decimals: settings.decimals } : { code: 'THB', decimals: 2 };
  const name = (p: Product) => language === 'en' && p.nameEn ? p.nameEn : p.name;
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))], [products]);
  const shown = products.filter(p => (!category || p.category === category) && (!search || `${p.name} ${p.nameEn}`.toLowerCase().includes(search.toLowerCase())));
  const discount = parseDiscount(discKind, discText, currency.decimals);

  useEffect(() => {
    if (!cart.length) { quoteSeq.current++; setQuote(null); setQuoteError(''); return; }
    if (discount === undefined) { quoteSeq.current++; setQuote(null); setQuoteError(text('ส่วนลดไม่ถูกต้อง', 'The discount is not valid')); return; }
    const id = ++quoteSeq.current;
    const timer = window.setTimeout(() => {
      api<CashQuote>('/cash/quote', { items: cart, discount }, token)
        .then(q => { if (id === quoteSeq.current) { setQuote(q); setQuoteError(''); } })
        .catch(e => { if (id === quoteSeq.current) { setQuote(null); setQuoteError(errorMessage(e)); } });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [cart, discKind, discText, token, settings?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  function add(productId: string, by = 1) {
    const p = byId.get(productId); if (!p) return;
    if (!prices.has(productId)) { setError(text('สินค้านี้ยังไม่ได้ตั้งราคาเงินสด', 'This product has no cash price yet')); return; }
    setError(''); setDone(null);
    setCart(c => {
      const at = c.findIndex(l => l.productId === productId), qty = (at >= 0 ? c[at].qty : 0) + by;
      if (qty <= 0) { play('remove'); return c.filter(l => l.productId !== productId); }
      if (qty > MAX_QTY || qty > p.available) { setError(text('จำนวนเกินที่มีในสต็อก', 'More than is in stock')); return c; }
      play('add'); return at >= 0 ? c.map(l => l.productId === productId ? { ...l, qty } : l) : [...c, { productId, qty }];
    });
  }
  async function onScan(code: string) {
    const c = code.trim(); if (!c) return;
    try { const r = await api<{ productId: string }>(`/barcodes/lookup?code=${encodeURIComponent(c)}`, undefined, token); setScanNote(''); add(r.productId); }
    catch { setScanNote(text(`ไม่พบบาร์โค้ด ${c}`, `No product has the barcode ${c}`)); play('remove'); }
    setScan(''); scanRef.current?.focus();
  }

  const tenderMinor = tender.trim() === '' ? null : toMinor(tender, currency.decimals);
  const total = quote ? BigInt(quote.totalMinor) : null;
  const enough = total !== null && tenderMinor !== null && BigInt(tenderMinor) >= total;
  const change = enough ? (BigInt(tenderMinor!) - total!).toString() : null;
  async function pay() {
    if (!quote || !enough || busy || discount === undefined) return;
    const body = { items: cart, discount, tenderMinor: tenderMinor! }, sig = JSON.stringify(body);
    // A retry of the very same request reuses its key, so a lost answer can never ring the sale twice; any change starts a new key.
    if (key.current.sig !== sig) key.current = { sig, id: requestId() };
    setBusy(true); setError('');
    try {
      const r = await api<{ sale: CashSale }>('/cash/sales', { idempotencyKey: key.current.id, ...body }, token);
      setDone(r.sale); setCart([]); setTender(''); setDiscText(''); setQuote(null); key.current = { sig: '', id: requestId() }; play('order'); onChanged?.();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }

  if (!settings) return <section className="panel cash-register" aria-label={text('ขายเงินสด', 'Cash register')}><p role={error ? 'alert' : 'status'}>{error || text('กำลังโหลด…', 'Loading…')}</p></section>;
  return <section className="panel cash-register" aria-label={text('ขายเงินสด', 'Cash register')}>
    <header className="cash-head">
      <div><h1>{text('ขายเงินสด', 'Cash register')}</h1><p className="catalog-sub">{text(`สกุลเงิน ${currency.code} · ราคา ส่วนลด ภาษี และเงินทอนคำนวณที่เซิร์ฟเวอร์`, `${currency.code} · prices, discount, tax and change are worked out by the server`)}</p></div>
      <div className="cash-head-actions">
        <button type="button" className="secondary" onClick={() => setShowSales(v => !v)} aria-expanded={showSales}>{text('รายการขายล่าสุด', 'Recent sales')}</button>
        {manage && <button type="button" className="secondary" onClick={() => setShowSettings(v => !v)} aria-expanded={showSettings}>{text('ตั้งค่าเงินสด·ราคา·บาร์โค้ด', 'Cash setup')}</button>}
      </div>
    </header>
    {error && <p className="notice" role="alert">{error}</p>}
    {!settings.enabled && <p className="notice" role="status">{manage ? text('ยังไม่ได้เปิดใช้เครื่องคิดเงินสด เปิดที่ "ตั้งค่าเงินสด" ด้านบน (เฉพาะเจ้าของร้านเปิดได้)', 'Cash register is off. Turn it on under "Cash setup" above (owner only).') : text('ร้านยังไม่เปิดใช้เครื่องคิดเงินสด', 'The shop has not turned the cash register on.')}</p>}
    {showSettings && manage && <CashSettingsPanel token={token} role={role} language={language} products={products} settings={settings} prices={prices} onSaved={() => void loadConfig()} />}
    {showSales && <RecentSales token={token} role={role} language={language} refreshKey={done?.id ?? ''} onChanged={onChanged} />}
    <div className="cash-grid">
      <div className="cash-products">
        <div className="cash-tools">
          <label className="cash-scan"><span aria-hidden="true">▥</span><span className="sr-only">{text('สแกนบาร์โค้ด', 'Scan barcode')}</span>
            <input ref={scanRef} value={scan} inputMode="text" autoComplete="off" placeholder={text('สแกนบาร์โค้ดแล้วกด Enter', 'Scan a barcode, then Enter')} onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void onScan(scan); } }} /></label>
          <input aria-label={text('ค้นหาเมนู', 'Search menu')} value={search} placeholder={text('ค้นหาเมนู…', 'Search menu…')} onChange={e => setSearch(e.target.value)} />
          {categories.length > 0 && <select aria-label={text('หมวดหมู่', 'Category')} value={category} onChange={e => setCategory(e.target.value)}><option value="">{text('ทุกหมวด', 'All')}</option>{categories.map(c => <option key={c}>{c}</option>)}</select>}
        </div>
        {scanNote && <p className="notice" role="status">{scanNote}</p>}
        <ul className="cash-cards">
          {shown.map((p, i) => { const price = prices.get(p.id), inCart = cart.find(l => l.productId === p.id)?.qty ?? 0, out = p.available <= 0;
            return <li key={p.id} style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
              <button type="button" className={`cash-card${inCart ? ' picked' : ''}`} disabled={!settings.enabled || price === undefined || out} onClick={() => add(p.id)}>
                {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <span className="cash-card-art" aria-hidden="true">☕</span>}
                <span className="cash-card-name">{name(p)}</span>
                <span className="cash-card-price">{price === undefined ? text('ยังไม่ตั้งราคา', 'No cash price') : out ? text('หมด', 'Sold out') : moneyOf(price, currency)}</span>
                {inCart > 0 && <b key={inCart} className="cash-card-badge">{inCart}</b>}
              </button></li>; })}
        </ul>
        {!shown.length && <p className="notice" role="status">{text('ไม่พบเมนู', 'No matching items')}</p>}
      </div>
      <aside className="cash-bill" aria-label={text('บิลปัจจุบัน', 'Current bill')}>
        <h2>{text('บิลปัจจุบัน', 'Current bill')}</h2>
        {!cart.length && !done && <p className="cash-empty">{text('แตะเมนูหรือสแกนบาร์โค้ดเพื่อเริ่มขาย', 'Tap an item or scan a barcode to start')}</p>}
        {done && <SuccessSheet sale={done} language={language} onNew={() => { setDone(null); scanRef.current?.focus(); }} />}
        <ul className="cash-lines">{cart.map(l => { const p = byId.get(l.productId), unit = prices.get(l.productId);
          return <li key={l.productId}><span className="cash-line-name">{p ? name(p) : l.productId}<small>{unit ? moneyOf(unit, currency) : ''}</small></span>
            <span className="cash-qty"><button type="button" aria-label={text('ลด', 'Less')} onClick={() => add(l.productId, -1)}>−</button><b key={l.qty}>{l.qty}</b><button type="button" aria-label={text('เพิ่ม', 'More')} onClick={() => add(l.productId, 1)}>+</button></span></li>; })}</ul>
        {cart.length > 0 && <>
          <div className="cash-discount"><label>{text('ส่วนลด', 'Discount')}
            <span className="cash-discount-row"><select aria-label={text('ชนิดส่วนลด', 'Discount type')} value={discKind} onChange={e => setDiscKind(e.target.value as 'percent' | 'amount')}><option value="percent">%</option><option value="amount">{currency.code}</option></select>
              <input inputMode="decimal" value={discText} placeholder="0" onChange={e => setDiscText(e.target.value)} /></span></label></div>
          {quoteError && <p className="notice" role="alert">{quoteError}</p>}
          {quote && <dl className="cash-totals">
            <div><dt>{text('รวม', 'Subtotal')}</dt><dd>{moneyOf(quote.subtotalMinor, currency)}</dd></div>
            {BigInt(quote.discountMinor) > 0n && <div className="cash-saving"><dt>{text('ส่วนลด', 'Discount')}</dt><dd>-{moneyOf(quote.discountMinor, currency)}</dd></div>}
            {quote.vatMode === 'inclusive' && <div><dt>{text(`VAT ${quote.vatBps / 100}% (รวมในราคา)`, `VAT ${quote.vatBps / 100}% (included)`)}</dt><dd>{moneyOf(quote.vatMinor, currency)}</dd></div>}
            <div className="cash-grand"><dt>{text('รวมทั้งสิ้น', 'Total')}</dt><dd key={quote.totalMinor} className="cash-pop">{moneyOf(quote.totalMinor, currency)}</dd></div>
          </dl>}
          {quote && <div className="cash-tender">
            <label>{text('รับเงินมา', 'Cash received')}<input inputMode="decimal" value={tender} placeholder={minorToInput('0', currency.decimals)} onChange={e => setTender(e.target.value)} /></label>
            <div className="cash-quick">{quickTenders(BigInt(quote.totalMinor), currency.decimals).map((v, i) => <button key={String(v)} type="button" className="secondary" onClick={() => setTender(minorToInput(String(v), currency.decimals))}>{i === 0 ? text('พอดี', 'Exact') : moneyOf(String(v), currency).replace(`${currency.code} `, '').replace(/\.00$/, '')}</button>)}</div>
            <p className={`cash-change${change !== null ? ' ready' : ''}`} aria-live="polite">{change !== null ? <>{text('เงินทอน', 'Change')} <b key={change} className="cash-pop">{moneyOf(change, currency)}</b></> : tenderMinor !== null && total !== null ? <span className="cash-short">{text('รับเงินไม่พอ', 'Not enough received')}</span> : <span>&nbsp;</span>}</p>
          </div>}
          <button type="button" className="cash-pay" disabled={!enough || busy || !settings.enabled} onClick={() => void pay()}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('รับเงินและออกใบเสร็จ', 'Take payment')}</button>
          <button type="button" className="secondary cash-clear" disabled={busy} onClick={() => { setCart([]); setTender(''); setDiscText(''); }}>{text('ล้างบิล', 'Clear bill')}</button>
        </>}
      </aside>
    </div>
  </section>;
}

function SuccessSheet({ sale, language, onNew }: { sale: CashSale; language: 'th' | 'en'; onNew: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  return <div className="cash-done" role="status" aria-live="polite">
    <svg className="cash-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M14 27l8 8 16-17" /></svg>
    <p className="cash-done-title">{text('ขายสำเร็จ', 'Sale complete')} · {sale.receiptNo}</p>
    <p className="cash-done-change">{text('เงินทอน', 'Change')} <b>{moneyOf(sale.changeMinor, sale.currency)}</b></p>
    <div className="toolbar"><button type="button" onClick={() => void printDocument(cashReceiptDoc(sale, language))}>{text('พิมพ์ใบเสร็จ', 'Print receipt')}</button><button type="button" className="secondary" onClick={onNew}>{text('ขายรายการใหม่', 'New sale')}</button></div>
  </div>;
}

function RecentSales({ token, role, language, refreshKey, onChanged }: { token: string; role: string; language: 'th' | 'en'; refreshKey: string; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [sales, setSales] = useState<CashSale[]>([]); const [error, setError] = useState(''); const [voiding, setVoiding] = useState(''); const [reason, setReason] = useState(''); const [restock, setRestock] = useState(false); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ sales: CashSale[] }>('/cash/sales', undefined, token).then(r => { setSales(r.sales); setError(''); }).catch(e => setError(errorMessage(e))), [token]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  async function reprint(id: string) { try { const r = await api<{ sale: CashSale }>(`/cash/sales/${encodeURIComponent(id)}`, undefined, token); await printDocument(cashReceiptDoc(r.sale, language)); } catch (e) { setError(errorMessage(e)); } }
  async function doVoid(id: string) {
    setBusy(true);
    try { await api(`/cash/sales/${encodeURIComponent(id)}/void`, { reason, restock }, token); setVoiding(''); setReason(''); setRestock(false); onChanged?.(); await load(); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  return <section className="cash-sales" aria-label={text('รายการขายล่าสุด', 'Recent sales')}>
    {error && <p className="notice" role="alert">{error}</p>}
    {!sales.length && !error && <p className="notice" role="status">{text('ยังไม่มีรายการขายเงินสด', 'No cash sales yet')}</p>}
    <ul>{sales.map(s => <li key={s.id} className={s.status === 'VOIDED' ? 'voided' : ''}>
      <span className="cash-sales-no">{s.receiptNo}</span><time dateTime={s.createdAt}>{new Date(s.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
      <b>{moneyOf(s.totalMinor, s.currency)}</b>{s.status === 'VOIDED' && <span className="channel-status cancelled">{text('ยกเลิก', 'Void')}</span>}
      <button type="button" className="secondary" onClick={() => void reprint(s.id)}>{text('พิมพ์ซ้ำ', 'Reprint')}</button>
      {(role === 'owner' || role === 'manager') && s.status === 'PAID' && <button type="button" className="secondary" onClick={() => setVoiding(voiding === s.id ? '' : s.id)}>{text('ยกเลิกบิล', 'Void')}</button>}
      {voiding === s.id && <div className="cash-void"><label>{text('เหตุผล (บังคับ)', 'Reason (required)')}<input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label>
        <label className="cash-check-row"><input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} />{text('คืนสินค้าเข้าสต็อก (ใช้ขายต่อได้)', 'Return the goods to stock (sellable again)')}</label>
        <button type="button" disabled={busy || !reason.trim()} onClick={() => void doVoid(s.id)}>{text('ยืนยันยกเลิก', 'Confirm void')}</button></div>}
    </li>)}</ul>
  </section>;
}
