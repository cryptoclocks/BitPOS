import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { requestId } from '../lib/request-id';
import { toMinor } from '../lib/shift-view';
import { cashReceiptDoc, printDocument } from '../lib/print-slip';
import { lineKey, minorToInput, moneyOf, optionsText, parseDiscount, quickTenders, type Addon, type CartLine, type CashQuote, type CashSale, type Drawer, type HeldBill } from '../lib/cash-view';
import { play } from '../lib/sfx';
import ReceiptLangPicker from './ReceiptLangPicker';
import { readReceiptLang } from '../lib/receipt-lang';
import type { DocLang } from '../lib/print-slip';
import type { Product } from '../lib/menu';
import CashSettingsPanel, { type CashSettings, type PriceInfo } from './CashSettingsPanel';
import '../styles/cash-register.css';

const SWEETNESS = [0, 25, 50, 75, 100] as const;
const MAX_QTY = 100;

// Cash sales at the counter. The screen only collects what was rung up and what was handed over: every price, add-on, discount, tax split
// and the change come back from the server, and nothing is considered sold until the server has answered with a stored receipt.
export default function CashRegister({ token, role, language, products, onChanged }: { token: string; role: string; language: 'th' | 'en'; products: Product[]; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const manage = role === 'owner' || role === 'manager';
  const [settings, setSettings] = useState<CashSettings>(); const [prices, setPrices] = useState<Map<string, PriceInfo>>(new Map()); const [addons, setAddons] = useState<Map<string, Addon[]>>(new Map());
  const [drawer, setDrawer] = useState<Drawer>(); const [held, setHeld] = useState<HeldBill[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]); const [search, setSearch] = useState(''); const [category, setCategory] = useState('');
  const [scan, setScan] = useState(''); const [scanNote, setScanNote] = useState('');
  const [discKind, setDiscKind] = useState<'percent' | 'amount'>('percent'); const [discText, setDiscText] = useState('');
  const [tender, setTender] = useState(''); const [quote, setQuote] = useState<CashQuote | null>(null); const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState<CashSale | null>(null);
  const [showSettings, setShowSettings] = useState(false); const [showSales, setShowSales] = useState(false);
  const [picking, setPicking] = useState<string | null>(null); const [holdLabel, setHoldLabel] = useState(''); const [floatText, setFloatText] = useState('');
  const quoteSeq = useRef(0); const key = useRef({ sig: '', id: requestId() }); const scanRef = useRef<HTMLInputElement>(null);

  const loadConfig = useCallback(async () => {
    try {
      const [s, p, a, d, h] = await Promise.all([
        api<{ settings: CashSettings }>('/cash/settings', undefined, token),
        api<{ prices: ({ productId: string } & PriceInfo)[] }>('/cash/prices', undefined, token),
        api<{ addons: (Addon & { productId: string })[] }>('/cash/addons', undefined, token),
        api<Drawer>('/cash/drawer', undefined, token),
        api<{ held: HeldBill[] }>('/cash/held', undefined, token)]);
      setSettings(s.settings); setPrices(new Map(p.prices.map(x => [x.productId, { priceMinor: x.priceMinor, unit: x.unit, sweetnessEnabled: x.sweetnessEnabled }])));
      const by = new Map<string, Addon[]>(); for (const x of a.addons) by.set(x.productId, [...(by.get(x.productId) ?? []), { id: x.id, label: x.label, labelEn: x.labelEn, priceMinor: x.priceMinor }]);
      setAddons(by); setDrawer(d); setHeld(h.held); setError('');
    } catch (e) { setError(errorMessage(e)); }
  }, [token]);
  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const currency = settings ? { code: settings.currency, decimals: settings.decimals } : { code: 'THB', decimals: 2 };
  const name = (p: Product) => language === 'en' && p.nameEn ? p.nameEn : p.name;
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))], [products]);
  const shown = products.filter(p => (!category || p.category === category) && (!search || `${p.name} ${p.nameEn}`.toLowerCase().includes(search.toLowerCase())));
  const discount = parseDiscount(discKind, discText, currency.decimals);
  const needsOptions = (id: string) => !!prices.get(id)?.sweetnessEnabled || (addons.get(id)?.length ?? 0) > 0;
  const inCartOf = (id: string) => cart.filter(l => l.productId === id).reduce((n, l) => n + l.qty, 0);

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

  /** Adds `by` of one product with one set of options; the same drink with other options is its own line. */
  function add(line: CartLine, by = line.qty) {
    const p = byId.get(line.productId); if (!p) return;
    if (!prices.has(line.productId)) { setError(text('สินค้านี้ยังไม่ได้ตั้งราคาเงินสด', 'This product has no cash price yet')); return; }
    setError(''); setDone(null);
    setCart(c => {
      const k = lineKey(line), at = c.findIndex(l => lineKey(l) === k), qty = (at >= 0 ? c[at].qty : 0) + by;
      const others = c.filter((_, i) => i !== at && c[i].productId === line.productId).reduce((n, l) => n + l.qty, 0);
      if (qty <= 0) { play('remove'); return c.filter((_, i) => i !== at); }
      if (qty > MAX_QTY || qty + others > p.available) { setError(text('จำนวนเกินที่มีในสต็อก', 'More than is in stock')); return c; }
      play('add'); return at >= 0 ? c.map((l, i) => i === at ? { ...l, qty } : l) : [...c, { ...line, qty }];
    });
  }
  const tap = (id: string) => { if (needsOptions(id)) setPicking(id); else add({ productId: id, qty: 1 }); };
  async function onScan(code: string) {
    const c = code.trim(); if (!c) return;
    try { const r = await api<{ productId: string }>(`/barcodes/lookup?code=${encodeURIComponent(c)}`, undefined, token); setScanNote(''); tap(r.productId); }
    catch { setScanNote(text(`ไม่พบบาร์โค้ด ${c}`, `No product has the barcode ${c}`)); play('remove'); }
    setScan(''); scanRef.current?.focus();
  }

  const tenderMinor = tender.trim() === '' ? null : toMinor(tender, currency.decimals);
  const total = quote ? BigInt(quote.totalMinor) : null;
  const enough = total !== null && tenderMinor !== null && BigInt(tenderMinor) >= total;
  const change = enough ? (BigInt(tenderMinor!) - total!).toString() : null;
  async function pay(exact = false) {
    if (!quote || busy || discount === undefined) return;
    const tenderValue = exact ? quote.totalMinor : tenderMinor;
    if (tenderValue === null || BigInt(tenderValue) < BigInt(quote.totalMinor)) return;
    const body = { items: cart, discount, tenderMinor: tenderValue }, sig = JSON.stringify(body);
    // A retry of the very same request reuses its key, so a lost answer can never ring the sale twice; any change starts a new key.
    if (key.current.sig !== sig) key.current = { sig, id: requestId() };
    setBusy(true); setError('');
    try {
      const r = await api<{ sale: CashSale }>('/cash/sales', { idempotencyKey: key.current.id, ...body }, token);
      setDone(r.sale); setCart([]); setTender(''); setDiscText(''); setQuote(null); key.current = { sig: '', id: requestId() }; play('order'); onChanged?.(); void loadConfig();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  async function hold() {
    if (!cart.length || !holdLabel.trim() || busy || discount === undefined) return;
    setBusy(true); setError('');
    try { await api('/cash/held', { label: holdLabel.trim(), items: cart, discount }, token); setCart([]); setTender(''); setDiscText(''); setHoldLabel(''); play('add'); await loadConfig(); }
    catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  async function recall(id: string) {
    if (cart.length && !window.confirm(text('บิลปัจจุบันจะถูกแทนที่ ดำเนินการต่อ?', 'The current bill will be replaced. Continue?'))) return;
    setBusy(true); setError('');
    try { const r = await api<{ held: HeldBill }>(`/cash/held/${encodeURIComponent(id)}/recall`, {}, token); setCart(r.held.items); setDiscKind(r.held.discount?.kind ?? 'percent'); setDiscText(r.held.discount ? r.held.discount.kind === 'percent' ? String(r.held.discount.bps / 100) : minorToInput(r.held.discount.minor, currency.decimals) : ''); setDone(null); play('add'); await loadConfig(); }
    catch (e) { setError(errorMessage(e)); await loadConfig(); }
    setBusy(false);
  }
  async function discard(id: string) {
    if (!window.confirm(text('ทิ้งบิลที่พักไว้นี้?', 'Throw away this held bill?'))) return;
    try { await api(`/cash/held/${encodeURIComponent(id)}/discard`, {}, token); await loadConfig(); } catch (e) { setError(errorMessage(e)); }
  }
  async function openDrawer() {
    const minor = toMinor(floatText, currency.decimals); if (minor === null) { setError(text('จำนวนเงินไม่ถูกต้อง', 'The amount is not valid')); return; }
    setBusy(true); setError('');
    try { await api('/cash/drawer', { floatMinor: minor }, token, 'PUT'); setFloatText(''); await loadConfig(); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }

  if (!settings) return <section className="panel cash-register" aria-label={text('ขายเงินสด', 'Cash register')}><p role={error ? 'alert' : 'status'}>{error || text('กำลังโหลด…', 'Loading…')}</p></section>;
  const pickingProduct = picking ? byId.get(picking) : undefined;
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
    {settings.enabled && drawer && (drawer.opening
      ? <p className="cash-drawer" role="status"><span aria-hidden="true">🗄️</span> {text('ลิ้นชักเงินสด', 'Cash drawer')}: {text('เปิดด้วย', 'opened with')} {moneyOf(drawer.opening.floatMinor, currency)} · {text('ขายเงินสด', 'cash sales')} {moneyOf(drawer.cashSalesMinor, currency)} · <b>{text('ควรมี', 'should hold')} {moneyOf(drawer.expectedMinor ?? '0', currency)}</b></p>
      : <div className="cash-drawer open" role="group" aria-label={text('เปิดลิ้นชัก', 'Open the drawer')}><span>{text('ยังไม่ได้บันทึกเงินทอนตั้งต้นของรอบนี้', 'No starting float recorded for this round')}</span>
        <input aria-label={text('เงินทอนตั้งต้น', 'Starting float')} inputMode="decimal" value={floatText} placeholder={minorToInput('0', currency.decimals)} onChange={e => setFloatText(e.target.value)} />
        <button type="button" disabled={busy || floatText.trim() === ''} onClick={() => void openDrawer()}>{text('เปิดลิ้นชัก', 'Open drawer')}</button></div>)}
    {showSettings && manage && <CashSettingsPanel token={token} role={role} language={language} products={products} settings={settings} prices={prices} addons={addons} onSaved={() => void loadConfig()} />}
    {showSales && <RecentSales token={token} role={role} language={language} refreshKey={done?.id ?? ''} onChanged={() => { onChanged?.(); void loadConfig(); }} />}
    {held.length > 0 && <ul className="cash-held" aria-label={text('บิลที่พักไว้', 'Held bills')}>{held.map(h => <li key={h.id}><b>{h.label}</b><small>{h.items.reduce((n, i) => n + i.qty, 0)} {text('ชิ้น', 'items')}</small>
      <button type="button" className="secondary" disabled={busy} onClick={() => void recall(h.id)}>{text('เรียกกลับ', 'Recall')}</button>
      <button type="button" className="secondary" aria-label={text(`ทิ้งบิล ${h.label}`, `Discard ${h.label}`)} onClick={() => void discard(h.id)}>×</button></li>)}</ul>}
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
          {shown.map((p, i) => { const info = prices.get(p.id), inCart = inCartOf(p.id), out = p.available <= 0;
            return <li key={p.id} style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
              <button type="button" className={`cash-card${inCart ? ' picked' : ''}`} disabled={!settings.enabled || !info || out} onClick={() => tap(p.id)}>
                {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <span className="cash-card-art" aria-hidden="true">☕</span>}
                <span className="cash-card-name">{name(p)}</span>
                <span className="cash-card-price">{!info ? text('ยังไม่ตั้งราคา', 'No cash price') : out ? text('หมด', 'Sold out') : <>{moneyOf(info.priceMinor, currency)}{info.unit && <small> / {info.unit}</small>}{needsOptions(p.id) && <small className="cash-card-opt"> · {text('มีตัวเลือก', 'options')}</small>}</>}</span>
                {inCart > 0 && <b key={inCart} className="cash-card-badge">{inCart}</b>}
              </button></li>; })}
        </ul>
        {!shown.length && <p className="notice" role="status">{text('ไม่พบเมนู', 'No matching items')}</p>}
      </div>
      <aside className="cash-bill" aria-label={text('บิลปัจจุบัน', 'Current bill')}>
        <h2>{text('บิลปัจจุบัน', 'Current bill')}</h2>
        {!cart.length && !done && <p className="cash-empty">{text('แตะเมนูหรือสแกนบาร์โค้ดเพื่อเริ่มขาย', 'Tap an item or scan a barcode to start')}</p>}
        {done && <SuccessSheet sale={done} language={language} onNew={() => { setDone(null); scanRef.current?.focus(); }} />}
        <ul className="cash-lines">{cart.map(l => { const p = byId.get(l.productId), info = prices.get(l.productId), chosen = (l.addonIds ?? []).map(id => (addons.get(l.productId) ?? []).find(a => a.id === id)).filter((a): a is Addon => !!a), opts = optionsText(l.sweetness, chosen, language);
          const unit = info ? (BigInt(info.priceMinor) + chosen.reduce((n, a) => n + BigInt(a.priceMinor), 0n)).toString() : null;
          return <li key={lineKey(l)}><span className="cash-line-name">{p ? name(p) : l.productId}{opts && <em>{opts}</em>}<small>{unit ? moneyOf(unit, currency) : ''}{info?.unit ? ` / ${info.unit}` : ''}</small></span>
            <span className="cash-qty"><button type="button" aria-label={text('ลด', 'Less')} onClick={() => add(l, -1)}>−</button><b key={l.qty}>{l.qty}</b><button type="button" aria-label={text('เพิ่ม', 'More')} onClick={() => add(l, 1)}>+</button></span></li>; })}</ul>
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
          {quote && <button type="button" className="cash-quick-sale" disabled={busy || !settings.enabled} onClick={() => void pay(true)}>⚡ {text('ขายด่วน · รับเงินพอดี', 'Quick sale · exact cash')}</button>}
          {quote && <div className="cash-tender">
            <label>{text('หรือรับเงินมา', 'Or cash received')}<input inputMode="decimal" value={tender} placeholder={minorToInput('0', currency.decimals)} onChange={e => setTender(e.target.value)} /></label>
            <div className="cash-quick">{quickTenders(BigInt(quote.totalMinor), currency.decimals).slice(1).map(v => <button key={String(v)} type="button" className="secondary" onClick={() => setTender(minorToInput(String(v), currency.decimals))}>{minorToInput(String(v), currency.decimals).replace(/\.00$/, '')}</button>)}</div>
            <p className={`cash-change${change !== null ? ' ready' : ''}`} aria-live="polite">{change !== null ? <>{text('เงินทอน', 'Change')} <b key={change} className="cash-pop">{moneyOf(change, currency)}</b></> : tenderMinor !== null && total !== null ? <span className="cash-short">{text('รับเงินไม่พอ', 'Not enough received')}</span> : <span>&nbsp;</span>}</p>
          </div>}
          <button type="button" className="cash-pay" disabled={!enough || busy || !settings.enabled} onClick={() => void pay()}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('รับเงินและออกใบเสร็จ', 'Take payment')}</button>
          <div className="cash-hold"><input aria-label={text('ชื่อโต๊ะหรือบาร์', 'Table or bar name')} value={holdLabel} maxLength={40} placeholder={text('โต๊ะ / บาร์ เช่น B1', 'Table / bar e.g. B1')} onChange={e => setHoldLabel(e.target.value)} />
            <button type="button" className="secondary" disabled={busy || !holdLabel.trim() || discount === undefined} onClick={() => void hold()}>{text('พักบิล', 'Hold bill')}</button></div>
          <button type="button" className="secondary cash-clear" disabled={busy} onClick={() => { setCart([]); setTender(''); setDiscText(''); }}>{text('ล้างบิล', 'Clear bill')}</button>
        </>}
      </aside>
    </div>
    {pickingProduct && <OptionSheet key={pickingProduct.id} product={pickingProduct} info={prices.get(pickingProduct.id)!} addons={addons.get(pickingProduct.id) ?? []} currency={currency} language={language} available={pickingProduct.available - inCartOf(pickingProduct.id)}
      onClose={() => setPicking(null)} onAdd={line => { add(line); setPicking(null); }} />}
  </section>;
}

function OptionSheet({ product, info, addons, currency, language, available, onClose, onAdd }: { product: Product; info: PriceInfo; addons: Addon[]; currency: { code: string; decimals: number }; language: 'th' | 'en'; available: number; onClose: () => void; onAdd: (line: CartLine) => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [sweet, setSweet] = useState<number | undefined>(info.sweetnessEnabled ? 100 : undefined); const [picked, setPicked] = useState<string[]>([]); const [qty, setQty] = useState(1);
  const unit = BigInt(info.priceMinor) + addons.filter(a => picked.includes(a.id)).reduce((n, a) => n + BigInt(a.priceMinor), 0n);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  return <div className="cash-sheet-back" role="presentation" onClick={onClose}>
    <div className="cash-sheet" role="dialog" aria-modal="true" aria-label={language === 'en' && product.nameEn ? product.nameEn : product.name} onClick={e => e.stopPropagation()}>
      <h2>{language === 'en' && product.nameEn ? product.nameEn : product.name}</h2>
      {info.sweetnessEnabled && <fieldset><legend>{text('ความหวาน', 'Sweetness')}</legend><div className="cash-chips-row">{SWEETNESS.map(v => <button key={v} type="button" className={`cash-opt${sweet === v ? ' on' : ''}`} aria-pressed={sweet === v} onClick={() => setSweet(v)}>{v}%</button>)}</div></fieldset>}
      {addons.length > 0 && <fieldset><legend>{text('ท็อปปิ้ง / ตัวเลือกเสริม', 'Toppings / extras')}</legend><div className="cash-chips-row">{addons.map(a => { const on = picked.includes(a.id);
        return <button key={a.id} type="button" className={`cash-opt${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setPicked(p => on ? p.filter(x => x !== a.id) : [...p, a.id])}>{language === 'en' && a.labelEn ? a.labelEn : a.label}{BigInt(a.priceMinor) > 0n && <small> +{moneyOf(a.priceMinor, currency).replace(`${currency.code} `, '')}</small>}</button>; })}</div></fieldset>}
      <div className="cash-sheet-foot"><span className="cash-qty"><button type="button" aria-label={text('ลด', 'Less')} disabled={qty <= 1} onClick={() => setQty(q => q - 1)}>−</button><b key={qty}>{qty}</b><button type="button" aria-label={text('เพิ่ม', 'More')} disabled={qty >= Math.min(available, MAX_QTY)} onClick={() => setQty(q => q + 1)}>+</button></span>
        <button type="button" className="cash-pay" disabled={available < 1} onClick={() => onAdd({ productId: product.id, qty, ...(sweet !== undefined ? { sweetness: sweet as CartLine['sweetness'] } : {}), ...(picked.length ? { addonIds: picked } : {}) })}>{text('เพิ่มลงบิล', 'Add to bill')} · {moneyOf((unit * BigInt(qty)).toString(), currency)}</button></div>
      <button type="button" className="secondary" onClick={onClose}>{text('ยกเลิก', 'Cancel')}</button>
    </div></div>;
}

function SuccessSheet({ sale, language, onNew }: { sale: CashSale; language: 'th' | 'en'; onNew: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [bill, setBill] = useState<DocLang>(() => readReceiptLang(language));
  return <div className="cash-done" role="status" aria-live="polite">
    <svg className="cash-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M14 27l8 8 16-17" /></svg>
    <p className="cash-done-title">{text('ขายสำเร็จ', 'Sale complete')} · {sale.receiptNo}</p>
    <p className="cash-done-change">{text('เงินทอน', 'Change')} <b>{moneyOf(sale.changeMinor, sale.currency)}</b></p>
    <ReceiptLangPicker value={bill} onChange={setBill} language={language} />
    <div className="toolbar"><button type="button" onClick={() => void printDocument(cashReceiptDoc(sale, bill))}>{text('พิมพ์ใบเสร็จ', 'Print receipt')}</button><button type="button" className="secondary" onClick={onNew}>{text('ขายรายการใหม่', 'New sale')}</button></div>
  </div>;
}

function RecentSales({ token, role, language, refreshKey, onChanged }: { token: string; role: string; language: 'th' | 'en'; refreshKey: string; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [bill, setBill] = useState<DocLang>(() => readReceiptLang(language)); const [sales, setSales] = useState<CashSale[]>([]); const [error, setError] = useState(''); const [voiding, setVoiding] = useState(''); const [reason, setReason] = useState(''); const [restock, setRestock] = useState(false); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ sales: CashSale[] }>('/cash/sales', undefined, token).then(r => { setSales(r.sales); setError(''); }).catch(e => setError(errorMessage(e))), [token]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  async function reprint(id: string) { try { const r = await api<{ sale: CashSale }>(`/cash/sales/${encodeURIComponent(id)}`, undefined, token); await printDocument(cashReceiptDoc(r.sale, bill)); } catch (e) { setError(errorMessage(e)); } }
  async function doVoid(id: string) {
    setBusy(true);
    try { await api(`/cash/sales/${encodeURIComponent(id)}/void`, { reason, restock }, token); setVoiding(''); setReason(''); setRestock(false); onChanged?.(); await load(); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  return <section className="cash-sales" aria-label={text('รายการขายล่าสุด', 'Recent sales')}>
    <ReceiptLangPicker value={bill} onChange={setBill} language={language} />
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
