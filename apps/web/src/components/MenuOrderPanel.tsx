import React, { useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Product } from '../lib/menu';
import { categoryOrder, moveItem, moveProduct } from '../lib/menu-order';
import '../styles/menu-order.css';

// M02: owner/manager ordering of categories and products. One click = one server call with the order the person saw, so a stale
// screen is refused (PRODUCT_CHANGED) instead of overwriting someone else's change.
export default function MenuOrderPanel({ products, token, language, onSaved }: { products: Product[]; token: string; language: 'th' | 'en'; onSaved: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const cats = categoryOrder(products);
  const shown = category === null ? products : products.filter(p => p.category === category);
  async function send(path: string, body: unknown) {
    setBusy(true); setMessage('');
    try { await api(path, body, token); setMessage(text('บันทึกลำดับแล้ว', 'Order saved')); onSaved(); }
    catch (error) { setMessage(error instanceof ApiError && error.code === 'PRODUCT_CHANGED' ? text('เมนูเปลี่ยนไปแล้ว โหลดล่าสุดแล้วลองอีกครั้ง', 'The menu changed. Reload and try again.') : errorMessage(error)); }
    setBusy(false);
  }
  const moveCategory = (c: string, d: -1 | 1) => { const next = moveItem(cats, c, d); if (next) void send('/categories/reorder', { categories: next, expected: cats }); };
  const moveOne = (id: string, d: -1 | 1) => { const next = moveProduct(products, id, d, category ?? undefined); if (next) void send('/products/reorder', { ids: next, expected: products.map(p => p.id) }); };
  const name = (p: Product) => language === 'th' ? p.name : p.nameEn;
  const label = (c: string) => c || text('ไม่มีหมวด', 'Uncategorised');
  if (!products.length) return null;
  return <section className="menu-order" aria-label={text('ลำดับเมนู', 'Menu order')}>
    <h2>{text('ลำดับเมนูและหมวด', 'Menu and category order')}</h2>
    <p className="catalog-sub">{text('ลำดับนี้ใช้กับหน้าขาย เมนู QR และเครื่องคิดเงินสด การย้ายหมวดจะจัดสินค้าของหมวดนั้นไว้ติดกัน', 'This order is used by the sales screen, the QR menu and the cash register. Moving a category keeps its products together.')}</p>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="menu-order-grid">
      <div><h3>{text('หมวด', 'Categories')}</h3>
        <ol>{cats.map((c, i) => <li key={c || 'none'}><button type="button" className="link" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>{label(c)}</button>
          <span className="menu-order-move"><button type="button" className="secondary" disabled={busy || i === 0} aria-label={`${text('ย้ายหมวดขึ้น', 'Move category up')}: ${label(c)}`} onClick={() => moveCategory(c, -1)}>↑</button><button type="button" className="secondary" disabled={busy || i === cats.length - 1} aria-label={`${text('ย้ายหมวดลง', 'Move category down')}: ${label(c)}`} onClick={() => moveCategory(c, 1)}>↓</button></span></li>)}</ol></div>
      <div><h3>{category === null ? text('สินค้าทั้งหมด', 'All products') : label(category)}</h3>
        <ol>{shown.map((p, i) => <li key={p.id}><span>{name(p)}</span>
          <span className="menu-order-move"><button type="button" className="secondary" disabled={busy || i === 0} aria-label={`${text('ย้ายสินค้าขึ้น', 'Move product up')}: ${name(p)}`} onClick={() => moveOne(p.id, -1)}>↑</button><button type="button" className="secondary" disabled={busy || i === shown.length - 1} aria-label={`${text('ย้ายสินค้าลง', 'Move product down')}: ${name(p)}`} onClick={() => moveOne(p.id, 1)}>↓</button></span></li>)}</ol></div>
    </div>
  </section>;
}
