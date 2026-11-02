import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { toMinor } from '../lib/shift-view';
import { minorToInput, type Addon } from '../lib/cash-view';
import type { Product } from '../lib/menu';

export interface CashSettings { enabled: boolean; currency: string; decimals: number; vatMode: 'none' | 'inclusive'; vatBps: number; sellerName: string; sellerTaxId: string; sellerBranch: string; sellerAddress: string; receiptPrefix: string; staffMaxDiscountBps: number }
export interface PriceInfo { priceMinor: string; unit: string; sweetnessEnabled: boolean }
interface Barcode { barcode: string; productId: string }
interface PriceDraft { price?: string; unit?: string; sweet?: boolean }
interface AddonRow { id?: string; label: string; labelEn: string; price: string }

// Owner/manager setup for the cash register: shop profile and tax (owner only), the cash price list, and product barcodes.
export default function CashSettingsPanel({ token, role, language, products, settings, prices, addons, onSaved }: { token: string; role: string; language: 'th' | 'en'; products: Product[]; settings: CashSettings; prices: Map<string, PriceInfo>; addons: Map<string, Addon[]>; onSaved: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const owner = role === 'owner';
  const [form, setForm] = useState(settings); const [vatPct, setVatPct] = useState(String(settings.vatBps / 100)); const [staffPct, setStaffPct] = useState(String(settings.staffMaxDiscountBps / 100));
  const [draft, setDraft] = useState<Record<string, PriceDraft>>({}); const [editing, setEditing] = useState<string | null>(null); const [rows, setRows] = useState<AddonRow[]>([]); const [barcodes, setBarcodes] = useState<Barcode[]>([]); const [newCode, setNewCode] = useState<Record<string, string>>({});
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
    const set: { productId: string; priceMinor: string; unit?: string; sweetnessEnabled?: boolean }[] = [], clear: string[] = [];
    for (const [id, d] of Object.entries(draft)) {
      const cur = prices.get(id), priceText = d.price ?? (cur ? minorToInput(cur.priceMinor, decimals) : '');
      if (priceText.trim() === '') { if (cur) clear.push(id); continue; }
      const m = toMinor(priceText, decimals); if (m === null || BigInt(m) <= 0n) { setError(text(`ราคาไม่ถูกต้อง: ${priceText}`, `Invalid price: ${priceText}`)); return; }
      const unit = d.unit?.trim(), changed = cur?.priceMinor !== m || (unit !== undefined && unit !== cur?.unit) || (d.sweet !== undefined && d.sweet !== cur?.sweetnessEnabled);
      if (changed) set.push({ productId: id, priceMinor: m, ...(unit !== undefined ? { unit } : {}), ...(d.sweet !== undefined ? { sweetnessEnabled: d.sweet } : {}) });
    }
    if (!set.length && !clear.length) { setNote(text('ไม่มีรายการที่เปลี่ยน', 'Nothing changed')); return; }
    // The server takes at most 200 changes per request, so a large first-time price list is sent in slices.
    void run(text('บันทึกราคาแล้ว', 'Prices saved'), async () => {
      for (let i = 0; i < Math.max(set.length, clear.length); i += 200) await api('/cash/prices', { set: set.slice(i, i + 200), clear: clear.slice(i, i + 200) }, token, 'PUT');
      setDraft({});
    });
  };
  const startAddons = (id: string) => { setEditing(editing === id ? null : id); setRows((addons.get(id) ?? []).map(a => ({ id: a.id, label: a.label, labelEn: a.labelEn, price: minorToInput(a.priceMinor, decimals) }))); };
  const saveAddons = (productId: string) => {
    const out: { id?: string; label: string; labelEn: string; priceMinor: string }[] = [];
    for (const r of rows) {
      if (!r.label.trim()) continue;
      const m = toMinor(r.price.trim() === '' ? '0' : r.price, decimals); if (m === null) { setError(text(`ราคาไม่ถูกต้อง: ${r.price}`, `Invalid price: ${r.price}`)); return; }
      out.push({ ...(r.id ? { id: r.id } : {}), label: r.label.trim(), labelEn: r.labelEn.trim(), priceMinor: m });
    }
    void run(text('บันทึกตัวเลือกเสริมแล้ว', 'Extras saved'), async () => { await api('/cash/addons', { productId, addons: out }, token, 'PUT'); setEditing(null); });
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
      <table className="catalog-table cash-price-table"><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('ราคา', 'Price')}</th><th>{text('หน่วย', 'Unit')}</th><th>{text('ความหวาน', 'Sweetness')}</th><th>{text('เสริม', 'Extras')}</th></tr></thead>
        <tbody>{products.flatMap(p => { const cur = prices.get(p.id), d = draft[p.id] ?? {}; const rowsFor = [<tr key={p.id}>
          <td>{name(p)}</td>
          <td><input aria-label={text(`ราคาเงินสด ${name(p)}`, `Cash price of ${name(p)}`)} inputMode="decimal" value={d.price ?? (cur ? minorToInput(cur.priceMinor, decimals) : '')} onChange={e => setDraft(x => ({ ...x, [p.id]: { ...x[p.id], price: e.target.value } }))} /></td>
          <td><input aria-label={text(`หน่วยของ ${name(p)}`, `Unit of ${name(p)}`)} maxLength={20} placeholder={text('แก้ว', 'cup')} value={d.unit ?? cur?.unit ?? ''} onChange={e => setDraft(x => ({ ...x, [p.id]: { ...x[p.id], unit: e.target.value } }))} /></td>
          <td><input type="checkbox" aria-label={text(`เลือกความหวานได้ ${name(p)}`, `Sweetness choice for ${name(p)}`)} checked={d.sweet ?? cur?.sweetnessEnabled ?? false} onChange={e => setDraft(x => ({ ...x, [p.id]: { ...x[p.id], sweet: e.target.checked } }))} /></td>
          <td><button type="button" className="secondary" aria-expanded={editing === p.id} onClick={() => startAddons(p.id)}>{(addons.get(p.id)?.length ?? 0) || '+'}</button></td></tr>];
          if (editing === p.id) rowsFor.push(<tr key={`${p.id}-x`} className="cash-addon-row"><td colSpan={5}>
            <p className="catalog-sub">{text('ท็อปปิ้ง/ตัวเลือกเสริมของเมนูนี้ (ราคาบวกเพิ่มจากราคาเมนู ใส่ 0 ได้) ใบเสร็จเก่าไม่เปลี่ยนเมื่อแก้ไขทีหลัง', 'Toppings/extras for this item (added to its price; 0 is fine). Old receipts do not change when you edit later.')}</p>
            {rows.map((r, i) => <div key={i} className="cash-addon-edit"><input aria-label={text('ชื่อตัวเลือก', 'Extra name')} placeholder={text('ชื่อ เช่น วิปครีม', 'Name e.g. Whipped cream')} maxLength={40} value={r.label} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <input aria-label={text('ชื่ออังกฤษ', 'English name')} placeholder="English" maxLength={40} value={r.labelEn} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, labelEn: e.target.value } : x))} />
              <input aria-label={text('ราคาเพิ่ม', 'Extra price')} inputMode="decimal" placeholder="0.00" value={r.price} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
              <button type="button" className="secondary" aria-label={text('ลบ', 'Remove')} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>×</button></div>)}
            <div className="toolbar"><button type="button" className="secondary" disabled={rows.length >= 20} onClick={() => setRows(rs => [...rs, { label: '', labelEn: '', price: '' }])}>{text('+ เพิ่มตัวเลือก', '+ Add an extra')}</button><button type="button" disabled={busy} onClick={() => saveAddons(p.id)}>{text('บันทึกตัวเลือกเสริม', 'Save extras')}</button></div></td></tr>);
          return rowsFor; })}</tbody></table>
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
