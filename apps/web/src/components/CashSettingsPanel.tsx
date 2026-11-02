import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { toMinor } from '../lib/shift-view';
import { minorToInput } from '../lib/cash-view';
import type { Product } from '../lib/menu';

export interface CashSettings { enabled: boolean; currency: string; decimals: number; vatMode: 'none' | 'inclusive'; vatBps: number; sellerName: string; sellerTaxId: string; sellerBranch: string; sellerAddress: string; receiptPrefix: string; staffMaxDiscountBps: number }
interface Barcode { barcode: string; productId: string }

// Owner/manager setup for the cash register: shop profile and tax (owner only), the cash price list, and product barcodes.
export default function CashSettingsPanel({ token, role, language, products, settings, prices, onSaved }: { token: string; role: string; language: 'th' | 'en'; products: Product[]; settings: CashSettings; prices: Map<string, string>; onSaved: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const owner = role === 'owner';
  const [form, setForm] = useState(settings); const [vatPct, setVatPct] = useState(String(settings.vatBps / 100)); const [staffPct, setStaffPct] = useState(String(settings.staffMaxDiscountBps / 100));
  const [draft, setDraft] = useState<Record<string, string>>({}); const [barcodes, setBarcodes] = useState<Barcode[]>([]); const [newCode, setNewCode] = useState<Record<string, string>>({});
  const [note, setNote] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const decimals = settings.decimals, name = (p: Product) => language === 'en' && p.nameEn ? p.nameEn : p.name;
  const loadCodes = () => api<{ barcodes: Barcode[] }>('/barcodes', undefined, token).then(r => setBarcodes(r.barcodes)).catch(e => setError(errorMessage(e)));
  useEffect(() => { void loadCodes(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof CashSettings>(k: K, v: CashSettings[K]) => setForm(f => ({ ...f, [k]: v }));

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true); setNote(''); setError('');
    try { await fn(); setNote(label); onSaved(); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  const bps = (input: string) => { const m = toMinor(input, 2); return m === null ? null : Number(m); };
  const saveProfile = () => {
    const vat = bps(vatPct), staff = bps(staffPct);
    if (vat === null || vat > 3000 || staff === null || staff > 9999) { setError(text('เปอร์เซ็นต์ไม่ถูกต้อง', 'A percentage is not valid')); return; }
    void run(text('บันทึกการตั้งค่าแล้ว', 'Settings saved'), () => api('/cash/settings', { ...form, vatBps: vat, staffMaxDiscountBps: staff }, token, 'PUT'));
  };
  const savePrices = () => {
    const set: { productId: string; priceMinor: string }[] = [], clear: string[] = [];
    for (const [id, v] of Object.entries(draft)) {
      if (v.trim() === '') { if (prices.has(id)) clear.push(id); continue; }
      const m = toMinor(v, decimals); if (m === null || BigInt(m) <= 0n) { setError(text(`ราคาไม่ถูกต้อง: ${v}`, `Invalid price: ${v}`)); return; }
      if (prices.get(id) !== m) set.push({ productId: id, priceMinor: m });
    }
    if (!set.length && !clear.length) { setNote(text('ไม่มีราคาที่เปลี่ยน', 'No price changed')); return; }
    // The server takes at most 200 changes per request, so a large first-time price list is sent in slices.
    void run(text('บันทึกราคาแล้ว', 'Prices saved'), async () => {
      for (let i = 0; i < Math.max(set.length, clear.length); i += 200) await api('/cash/prices', { set: set.slice(i, i + 200), clear: clear.slice(i, i + 200) }, token, 'PUT');
      setDraft({});
    });
  };
  const addCode = (productId: string) => void run(text('เพิ่มบาร์โค้ดแล้ว', 'Barcode added'), async () => { await api('/barcodes', { productId, barcode: (newCode[productId] ?? '').trim() }, token, 'PUT'); setNewCode(c => ({ ...c, [productId]: '' })); await loadCodes(); });
  const removeCode = (barcode: string) => void run(text('ลบบาร์โค้ดแล้ว', 'Barcode removed'), async () => { await api('/barcodes/delete', { barcode }, token); await loadCodes(); });

  return <section className="cash-setup" aria-label={text('ตั้งค่าเครื่องคิดเงินสด', 'Cash register setup')}>
    {error && <p className="notice" role="alert">{error}</p>}{note && <p className="notice" role="status">{note}</p>}
    <details open className="cash-setup-block"><summary>{text('ร้านและภาษี', 'Shop and tax')}</summary>
      {!owner && <p className="notice" role="status">{text('เฉพาะเจ้าของร้านแก้ส่วนนี้ได้', 'Only the owner can change this section.')}</p>}
      <fieldset disabled={!owner || busy} className="cash-form">
        <label className="cash-check-row"><input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />{text('เปิดใช้เครื่องคิดเงินสด', 'Turn the cash register on')}</label>
        <label>{text('ชื่อร้าน/ผู้ขาย', 'Seller name')}<input value={form.sellerName} maxLength={120} onChange={e => set('sellerName', e.target.value)} /></label>
        <label>{text('ที่อยู่', 'Address')}<input value={form.sellerAddress} maxLength={300} onChange={e => set('sellerAddress', e.target.value)} /></label>
        <label>{text('เลขประจำตัวผู้เสียภาษี (13 หลัก)', 'Tax ID (13 digits)')}<input inputMode="numeric" value={form.sellerTaxId} maxLength={13} onChange={e => set('sellerTaxId', e.target.value.replace(/\D/g, ''))} /></label>
        <label>{text('รหัสสาขา (5 หลัก)', 'Branch code (5 digits)')}<input inputMode="numeric" value={form.sellerBranch} maxLength={5} onChange={e => set('sellerBranch', e.target.value.replace(/\D/g, ''))} /></label>
        <label>{text('ภาษีมูลค่าเพิ่ม', 'VAT')}<select value={form.vatMode} onChange={e => set('vatMode', e.target.value as 'none' | 'inclusive')}><option value="none">{text('ไม่คิด (ออกใบเสร็จธรรมดา)', 'Not charged (plain receipt)')}</option><option value="inclusive">{text('รวมอยู่ในราคาแล้ว (ใบกำกับภาษีอย่างย่อ)', 'Included in prices (abbreviated tax invoice)')}</option></select></label>
        {form.vatMode === 'inclusive' && <label>{text('อัตรา VAT (%)', 'VAT rate (%)')}<input inputMode="decimal" value={vatPct} onChange={e => setVatPct(e.target.value)} /></label>}
        <label>{text('อักษรนำหน้าเลขที่ใบเสร็จ', 'Receipt number prefix')}<input value={form.receiptPrefix} maxLength={6} onChange={e => set('receiptPrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
        <label>{text('พนักงานลดราคาได้สูงสุด (%) · 0 = ห้ามลด', 'Most a staff member may discount (%) · 0 = none')}<input inputMode="decimal" value={staffPct} onChange={e => setStaffPct(e.target.value)} /></label>
        <p className="cash-warning" role="note">{text('ใบกำกับภาษีอย่างย่อที่ระบบพิมพ์ ยังไม่ได้รับการตรวจโดยนักบัญชีหรือกรมสรรพากร โปรดให้นักบัญชียืนยันรูปแบบ อัตราภาษี และเลขที่ก่อนใช้จริง ระบบนี้ไม่ได้ยื่นภาษีหรือเชื่อมต่อกรมสรรพากร', 'The abbreviated tax invoice has not been reviewed by an accountant or the Revenue Department. Have an accountant confirm the format, rate and numbering before real use. This system does not file taxes or connect to the authority.')}</p>
        <div className="toolbar"><button type="button" onClick={saveProfile}>{text('บันทึกการตั้งค่า', 'Save settings')}</button></div>
      </fieldset>
    </details>
    <details className="cash-setup-block"><summary>{text(`ราคาเงินสด (${settings.currency})`, `Cash prices (${settings.currency})`)}</summary>
      <p className="catalog-sub">{text('ราคาที่ร้านรับเป็นเงินสด ตั้งแยกจากราคา USD/USDG ไม่มีการแปลงอัตราแลกเปลี่ยน เว้นว่างเพื่อไม่ขายสินค้านั้นด้วยเงินสด', 'The price the shop takes in cash. Kept separate from the USD/USDG prices; nothing is converted. Leave blank to not sell that item for cash.')}</p>
      <table className="catalog-table"><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('ราคา', 'Price')}</th></tr></thead>
        <tbody>{products.map(p => <tr key={p.id}><td>{name(p)}</td><td><input aria-label={text(`ราคาเงินสด ${name(p)}`, `Cash price of ${name(p)}`)} inputMode="decimal" value={draft[p.id] ?? (prices.has(p.id) ? minorToInput(prices.get(p.id)!, decimals) : '')} onChange={e => setDraft(d => ({ ...d, [p.id]: e.target.value }))} /></td></tr>)}</tbody></table>
      <div className="toolbar"><button type="button" disabled={busy} onClick={savePrices}>{text('บันทึกราคา', 'Save prices')}</button></div>
    </details>
    <details className="cash-setup-block"><summary>{text('บาร์โค้ดสินค้า', 'Product barcodes')}</summary>
      <p className="catalog-sub">{text('สแกนแล้วต้องตรงรหัสเป๊ะ ระบบไม่เดาจากชื่อสินค้า (ตัวอักษร ตัวเลข และ - ยาว 4–32)', 'A scan must match exactly; nothing is guessed from names (letters, digits and -, 4–32 long).')}</p>
      <ul className="cash-codes">{products.map(p => <li key={p.id}><span>{name(p)}</span>
        <span className="cash-chips">{barcodes.filter(b => b.productId === p.id).map(b => <span key={b.barcode} className="cash-chip"><code>{b.barcode}</code><button type="button" aria-label={text(`ลบ ${b.barcode}`, `Remove ${b.barcode}`)} disabled={busy} onClick={() => removeCode(b.barcode)}>×</button></span>)}</span>
        <span className="cash-addcode"><input aria-label={text(`เพิ่มบาร์โค้ดของ ${name(p)}`, `Add a barcode for ${name(p)}`)} value={newCode[p.id] ?? ''} placeholder={text('รหัสบาร์โค้ด', 'Barcode')} onChange={e => setNewCode(c => ({ ...c, [p.id]: e.target.value }))} /><button type="button" className="secondary" disabled={busy || !(newCode[p.id] ?? '').trim()} onClick={() => addCode(p.id)}>{text('เพิ่ม', 'Add')}</button></span></li>)}</ul>
    </details>
  </section>;
}
