import React, { useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Product } from '../lib/menu';

interface Details { name: string; nameEn: string; category: string; description: string }
const detailsOf = (p: Product): Details => ({ name: p.name, nameEn: p.nameEn, category: p.category, description: p.description });

// Descriptive product edits and category rename (owner/manager). Price, stock, offers and
// options are edited elsewhere and are not touched. The stored values the form started from
// are sent back, so an edit made elsewhere in the meantime is refused, not overwritten.
export function ProductDetailsForm({ product, token, language, onSaved, onClose }: { product?: Product; token: string; language: 'th' | 'en'; onSaved: () => void; onClose: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [start] = useState<Details>(() => product ? detailsOf(product) : { name: '', nameEn: '', category: '', description: '' }); const [draft, setDraft] = useState(start); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start), valid = draft.name.trim() !== '' && draft.nameEn.trim() !== '';
  const set = (key: keyof Details) => (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  async function save() {
    setBusy(true); setMessage('');
    try { if (product) await api(`/products/${encodeURIComponent(product.id)}`, { ...draft, expected: start }, token, 'PATCH'); else await api('/products', draft, token); onSaved(); onClose(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'PRODUCT_CHANGED' && !product) setMessage(text('มีสินค้าชื่ออังกฤษนี้อยู่แล้ว', 'A product with this English name already exists.'));
      else if (error instanceof ApiError && error.code === 'PRODUCT_CHANGED') { setConflict(true); setMessage(text('สินค้านี้ถูกแก้จากที่อื่น ปิดแล้วเปิดใหม่เพื่อดูค่าล่าสุด (ร่างของคุณยังอยู่ในฟอร์มนี้)', 'This product changed elsewhere. Close and reopen to see the latest (your draft stays in this form).')); }
      else setMessage(errorMessage(error));
    }
    setBusy(false);
  }
  async function archive() {
    if (!product || !window.confirm(text('เก็บสินค้านี้เข้าคลัง? จะไม่แสดงในเมนูและสต็อก แต่ออเดอร์เก่ายังอยู่', 'Archive this product? It leaves menus and stock lists; past orders stay intact.'))) return;
    setBusy(true); setMessage('');
    try { await api(`/products/${encodeURIComponent(product.id)}/archive`, {}, token); onSaved(); onClose(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'PRODUCT_HAS_STOCK') setMessage(text('ต้องปรับสต็อกเป็น 0 ก่อนเก็บสินค้า', 'Set stock to 0 before archiving.'));
      else if (error instanceof ApiError && error.code === 'PRODUCT_HAS_RESERVATIONS') setMessage(text('สินค้านี้ถูกจองในออเดอร์ที่ค้างอยู่ รอให้ปิดก่อน', 'This product is reserved by open orders; wait until they close.'));
      else setMessage(errorMessage(error));
    }
    setBusy(false);
  }
  return <form className="panel" onSubmit={event => { event.preventDefault(); void save(); }} aria-label={product ? text('แก้ไขรายละเอียดสินค้า', 'Edit product details') : text('เพิ่มสินค้า', 'Add product')}>
    <h2>{product ? text('แก้ไขรายละเอียดสินค้า', 'Edit product details') : text('เพิ่มสินค้า', 'Add product')}</h2>
    <p className="catalog-sub">{product ? text('ราคา สต็อก ข้อเสนอ และตัวเลือกแก้ในที่อื่น ไม่ถูกเปลี่ยนจากฟอร์มนี้', 'Price, stock, offers and options are edited elsewhere and are not changed here.') : text('สินค้าใหม่เริ่มที่สต็อก 0 และยังไม่มีราคา ขายไม่ได้จนกว่าจะตั้งราคาใน ตั้งค่า → เมนูและราคา และรับสต็อกเข้า', 'A new product starts with stock 0 and no price. It cannot be sold until you set its price in Settings → Menu & prices and receive stock.')}</p>
    <label>{text('ชื่อ (ไทย)', 'Name (Thai)')}<input value={draft.name} maxLength={80} onChange={set('name')} required /></label>
    <label>{text('ชื่อ (อังกฤษ)', 'Name (English)')}<input value={draft.nameEn} maxLength={80} onChange={set('nameEn')} required /></label>
    <label>{text('หมวด', 'Category')}<input value={draft.category} maxLength={40} onChange={set('category')} /></label>
    <label>{text('คำอธิบาย', 'Description')}<input value={draft.description} maxLength={200} onChange={set('description')} /></label>
    {message && <p className={conflict ? 'error' : 'notice'} role="alert">{message}</p>}
    {product && <p><button type="button" className="secondary" disabled={busy} onClick={() => void archive()}>{text('เก็บสินค้าเข้าคลัง', 'Archive product')}</button></p>}
    <div className="toolbar"><button disabled={!dirty || !valid || busy || conflict}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button><button type="button" className="secondary" onClick={() => { if (!dirty || window.confirm(text('ทิ้งข้อความที่ยังไม่บันทึก?', 'Discard unsaved edits?'))) onClose(); }}>{text('ยกเลิก', 'Cancel')}</button></div>
  </form>;
}

export function CategoryRename({ products, token, language, onSaved }: { products: Product[]; token: string; language: 'th' | 'en'; onSaved: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const names = [...new Set(products.map(p => p.category).filter(Boolean))];
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const count = products.filter(p => p.category === from).length, valid = !!from && to.trim() !== '' && to.trim() !== from;
  async function save() {
    setBusy(true); setMessage('');
    try { await api('/categories/rename', { from, to: to.trim(), expectedCount: count }, token); setFrom(''); setTo(''); setMessage(text('เปลี่ยนชื่อหมวดแล้ว', 'Category renamed')); onSaved(); }
    catch (error) { setMessage(error instanceof ApiError && error.code === 'PRODUCT_CHANGED' ? text('สินค้าในหมวดนี้เปลี่ยนไปแล้ว โหลดล่าสุดแล้วลองอีกครั้ง', 'Products in this category changed. Reload and try again.') : errorMessage(error)); }
    setBusy(false);
  }
  if (!names.length) return null;
  return <form className="toolbar" onSubmit={event => { event.preventDefault(); void save(); }} aria-label={text('เปลี่ยนชื่อหมวด', 'Rename category')}>
    <label>{text('หมวดที่จะเปลี่ยนชื่อ', 'Category to rename')}<select value={from} onChange={event => setFrom(event.target.value)}><option value="">{text('เลือกหมวด', 'Choose a category')}</option>{names.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    <label>{text('ชื่อใหม่ (ชื่อที่มีอยู่จะรวมหมวด)', 'New name (an existing name merges)')}<input value={to} maxLength={40} onChange={event => setTo(event.target.value)} /></label>
    <button disabled={!valid || busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('เปลี่ยนชื่อหมวด', 'Rename category')}</button>
    {message && <p className="notice" role="status">{message}</p>}
  </form>;
}
