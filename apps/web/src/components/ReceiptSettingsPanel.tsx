import React, { useEffect, useMemo, useState } from 'react';
import type { OrderView } from '../../../../packages/contracts/src/index';
import { errorMessage } from '../lib/api';
import { api } from '../lib/api';
import { printDocument, receiptDoc, type DocLang } from '../lib/print-slip';
import { loadReceiptSettings, rememberReceiptSettings, type ReceiptSettings } from '../lib/receipt-look';
import '../styles/receipt-settings.css';

// M09: how a printed bill looks, kept on the server so every till prints the same. Only the owner edits it. The preview below is built from invented
// sample lines and is labelled as a sample; real bills always print their own lines and totals. Checked with the browser's print preview; a
// Bluetooth thermal printer has not been checked with this layout on real hardware.
const money = (amountMinor: string) => ({ currency: 'THB', decimals: 2, amountMinor });
const sample = {
  id: '00000000-0000-4000-8000-000000000000', status: 'PAID', settlement: money('15000'),
  authority: { serving: { label: 'โต๊ะ 3 / Table 3' } },
  pricing: { total: money('15000'), lines: [
    { productId: 'sample-1', name: 'ลาเต้เย็น', nameEn: 'Iced latte', qty: 2, unitPrice: money('6500') },
    { productId: 'sample-2', name: 'ครัวซองต์', nameEn: 'Croissant', qty: 1, unitPrice: money('2000') },
  ] },
} as unknown as OrderView;
type Draft = Pick<ReceiptSettings, 'shopName' | 'shopNameEn' | 'footer' | 'footerEn' | 'defaultLang' | 'paperMm'>;
const pick = (s: ReceiptSettings): Draft => ({ shopName: s.shopName, shopNameEn: s.shopNameEn, footer: s.footer, footerEn: s.footerEn, defaultLang: s.defaultLang, paperMm: s.paperMm });

export default function ReceiptSettingsPanel({ token, language, canEdit }: { token: string; language: 'th' | 'en'; canEdit: boolean }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [saved, setSaved] = useState<ReceiptSettings>(); const [draft, setDraft] = useState<Draft>(); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [attempt, setAttempt] = useState(0); const [previewLang, setPreviewLang] = useState<DocLang>(language);
  useEffect(() => {
    let live = true; setState('loading'); setError('');
    loadReceiptSettings(token).then(s => { if (live) { setSaved(s); setDraft(pick(s)); setState('ready'); } }).catch(e => { if (live) { setError(errorMessage(e)); setState('error'); } });
    return () => { live = false; };
  }, [token, attempt]);
  const dirty = !!saved && !!draft && JSON.stringify(pick(saved)) !== JSON.stringify(draft);
  const html = useMemo(() => draft ? receiptDoc(sample, previewLang, { ...draft, shopName: draft.shopName || text('ชื่อร้านของคุณ', 'Your shop name') }) : '', [draft, previewLang]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(d => d && { ...d, [key]: value }); setMessage(''); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || !saved || !canEdit) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const r = await api<{ settings: ReceiptSettings }>('/receipt-settings', { ...draft, expectedRevision: saved.revision }, token, 'PUT');
      rememberReceiptSettings(r.settings); setSaved(r.settings); setDraft(pick(r.settings)); setMessage(text('บันทึกแล้ว ทุกเครื่องจะใช้หน้าตาใหม่เมื่อเปิดหน้าใหม่', 'Saved. Every till uses the new layout once it reloads.'));
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  if (state === 'loading') return <section className="panel receipt-settings" aria-busy="true"><p className="notice" role="status">{text('กำลังโหลดการตั้งค่าใบเสร็จ…', 'Loading receipt settings…')}</p></section>;
  if (state === 'error' || !draft || !saved) return <section className="panel receipt-settings"><p className="error" role="alert">{text('โหลดการตั้งค่าใบเสร็จไม่สำเร็จ: ', 'Could not load receipt settings: ')}{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>{text('ลองอีกครั้ง', 'Try again')}</button></section>;
  const ro = !canEdit || busy;
  return <section className="panel receipt-settings" aria-label={text('หน้าตาใบเสร็จ', 'Receipt layout')}>
    <h2>{text('หน้าตาใบเสร็จ', 'Receipt layout')}</h2>
    <p className="reports-sub">{text('ตั้งชื่อร้านและข้อความท้ายบิลให้เหมือนกันทุกเครื่อง ยอดเงิน รายการสินค้า และสถานะชำระมาจากออเดอร์จริงเสมอ ตั้งค่านี้ไม่เปลี่ยนตัวเลขใด ๆ', 'Set the shop name and footer once for every till. Amounts, lines and payment status always come from the real order; this never changes a number.')}</p>
    {!canEdit && <p className="notice" role="status">{text('เฉพาะเจ้าของร้านแก้ไขได้', 'Only the owner can edit this.')}</p>}
    <div className="receipt-settings-grid">
      <form onSubmit={save} className="receipt-settings-form">
        <label>{text('ชื่อร้านบนบิล (ไทย)', 'Shop name on the bill (Thai)')}<input value={draft.shopName} maxLength={80} readOnly={ro} onChange={e => set('shopName', e.target.value)} /></label>
        <label>{text('ชื่อร้านบนบิล (English)', 'Shop name on the bill (English)')}<input value={draft.shopNameEn} maxLength={80} readOnly={ro} onChange={e => set('shopNameEn', e.target.value)} /></label>
        <label>{text('ข้อความท้ายบิล (ไทย)', 'Footer (Thai)')}<input value={draft.footer} maxLength={160} readOnly={ro} placeholder={text('เช่น ขอบคุณที่อุดหนุน', 'e.g. Thank you')} onChange={e => set('footer', e.target.value)} /></label>
        <label>{text('ข้อความท้ายบิล (English)', 'Footer (English)')}<input value={draft.footerEn} maxLength={160} readOnly={ro} onChange={e => set('footerEn', e.target.value)} /></label>
        <label>{text('ภาษาบิลเริ่มต้น', 'Default bill language')}<select value={draft.defaultLang} disabled={ro} onChange={e => set('defaultLang', e.target.value as DocLang)}><option value="th">ไทย</option><option value="en">English</option><option value="both">{text('สองภาษา', 'Thai + English')}</option></select></label>
        <label>{text('ความกว้างกระดาษ', 'Paper width')}<select value={draft.paperMm} disabled={ro} onChange={e => set('paperMm', Number(e.target.value) as 58 | 80)}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></label>
        <p className="reports-sub">{text('แต่ละเครื่องยังเลือกภาษาบิลของตัวเองได้ ค่านี้ใช้เมื่อเครื่องนั้นยังไม่เคยเลือก', 'Each device can still pick its own bill language; this applies until it does.')}</p>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="notice" role="status">{message}</p>}
        {canEdit && <div className="toolbar"><button disabled={busy || !dirty}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button><button type="button" className="secondary" disabled={busy || !dirty} onClick={() => { setDraft(pick(saved)); setMessage(''); setError(''); }}>{text('ยกเลิกการแก้', 'Discard changes')}</button></div>}
      </form>
      <div className="receipt-preview" data-receipt-preview="sample">
        <div className="receipt-preview-head"><strong>{text('ตัวอย่าง (ข้อมูลสมมติ ไม่ใช่บิลจริง)', 'Sample (invented data, not a real bill)')}</strong>
          <label>{text('ดูเป็น', 'View as')}<select value={previewLang} onChange={e => setPreviewLang(e.target.value as DocLang)}><option value="th">ไทย</option><option value="en">English</option><option value="both">{text('สองภาษา', 'Thai + English')}</option></select></label></div>
        <iframe title={text('ตัวอย่างใบเสร็จ', 'Receipt preview')} sandbox="" srcDoc={html} style={{ width: draft.paperMm === 58 ? '210px' : '300px' }} />
        <button type="button" className="secondary" onClick={() => void printDocument(html)}>{text('เปิดหน้าพิมพ์ของเบราว์เซอร์ (ตัวอย่าง)', 'Open browser print preview (sample)')}</button>
        <p className="reports-sub">{text('ตรวจผ่านหน้าพิมพ์ของเบราว์เซอร์แล้ว แต่ยังไม่ได้ตรวจกับเครื่องพิมพ์ใบเสร็จ Bluetooth จริงด้วยหน้าตาแบบนี้ ใบเสร็จนี้เป็นใบเสร็จอย่างย่อ ไม่ใช่ใบกำกับภาษี', 'Checked in the browser print preview only; not yet checked with this layout on a real Bluetooth thermal printer. This is a short receipt, not a tax invoice.')}</p>
      </div>
    </div>
  </section>;
}
