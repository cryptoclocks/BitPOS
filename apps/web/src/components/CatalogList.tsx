import React, { useState } from 'react';
import { formatMoney } from '../lib/money';
import type { Product } from '../lib/menu';
import { catalogStatus, categorySummary, filterCatalog } from '../lib/catalog-view';
import StockManager from './StockManager';
import SuppliersManager from './SuppliersManager';
import ProductAvailabilityPanel from './ProductAvailabilityPanel';
import MenuOrderPanel from './MenuOrderPanel';
import { CategoryRename, ProductDetailsForm } from './CatalogEditor';
import { ProductStoryForm } from './ProductStoryForm';
import '../styles/catalog-list.css';

// P06/P24 presentation over the menu the server already returned. Product and
// category creation/rename have no API yet, so no such control is offered; the
// only actions are the existing offer editor and the Settings pricing page.
export default function CatalogList({ products, language, canEdit, menuReady, onEditOffer, onOpenPricing, editor, stockToken, onChanged }: { products: Product[]; language: 'th' | 'en'; canEdit: boolean; menuReady: boolean; onEditOffer: (id: string) => void; onOpenPricing?: () => void; editor?: React.ReactNode; stockToken?: string; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [query, setQuery] = useState(''); const [category, setCategory] = useState(''); const [view, setView] = useState<'catalog' | 'stock' | 'suppliers'>('catalog'); const [detailsId, setDetailsId] = useState(''); const [creating, setCreating] = useState(false);
  const detailsProduct = products.find(p => p.id === detailsId);
  const categories = categorySummary(products);
  const rows = filterCatalog(products, query, category);
  const label = { on_sale: text('เปิดขาย', 'On sale'), sold_out: text('สินค้าหมด', 'Sold out'), price_missing: text('ยังไม่ตั้งราคา', 'Price not set') } as const;
  return <main className="catalog-list" aria-label={text('สินค้าและเมนู', 'Products and menu')}>
    <div className="section-heading"><div><p className="eyebrow">{text('จัดการร้าน', 'YOUR SHOP')}</p><h1>{text('สินค้าและเมนู', 'Products & menu')}</h1><p className="catalog-sub">{text('แตะ “แก้ไข” บนการ์ดเพื่อเปลี่ยนชื่อ หมวด รูป และคำอธิบาย', 'Tap “Edit” on a card to change its name, category, photo and description.')}</p></div>{stockToken && <button type="button" onClick={() => { setDetailsId(''); setCreating(true); }}>{text('เพิ่มสินค้า', 'Add product')}</button>}{onOpenPricing && <button type="button" className="secondary" onClick={onOpenPricing}>{text('ตั้งราคาและสกุลเงิน', 'Set prices & currency')}</button>}</div>
    {editor}
    {stockToken && creating && <ProductDetailsForm key="new" token={stockToken} language={language} onSaved={() => onChanged?.()} onClose={() => setCreating(false)} />}
    {stockToken && detailsProduct && <ProductDetailsForm key={detailsProduct.id} product={detailsProduct} token={stockToken} language={language} onSaved={() => onChanged?.()} onClose={() => setDetailsId('')} />}
    {stockToken && detailsProduct && <ProductStoryForm key={`story-${detailsProduct.id}`} productId={detailsProduct.id} token={stockToken} language={language} />}
    <div className="catalog-views" data-crumb role="group" aria-label={text('มุมมอง', 'View')}><button type="button" aria-pressed={view === 'catalog'} onClick={() => setView('catalog')}>{text('สินค้า', 'Catalog')}</button><button type="button" aria-pressed={view === 'stock'} onClick={() => setView('stock')}>{text('สต็อก', 'Stock')}</button>{stockToken && <button type="button" aria-pressed={view === 'suppliers'} onClick={() => setView('suppliers')}>{text('ซัพพลายเออร์', 'Suppliers')}</button>}</div>
    {view === 'suppliers' && stockToken ? <section className="catalog-stock"><SuppliersManager token={stockToken} language={language} /></section> : view === 'stock' && stockToken ? <section className="catalog-stock"><StockManager products={products} token={stockToken} language={language} /></section> : view === 'stock' ? <section className="catalog-stock" aria-label={text('สต็อกปัจจุบัน', 'Current stock')}>
      <p className="catalog-sub">{text('จำนวนพร้อมขายตามที่เซิร์ฟเวอร์รายงานในเมนู ไม่ใช่บัญชีสต็อก', 'Available quantity as the server reports it in the menu. This is not a stock ledger.')}</p>
      <table className="catalog-table"><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('หมวด', 'Category')}</th><th>{text('พร้อมขาย', 'Available')}</th></tr></thead><tbody>{[...products].sort((a, b) => a.available - b.available).map(product => <tr key={product.id}><td><strong>{language === 'th' ? product.name : product.nameEn}</strong></td><td>{product.category || '—'}</td><td data-status={product.available > 0 ? 'on_sale' : 'sold_out'}>{product.available > 0 ? product.available : text('หมด', 'Sold out')}</td></tr>)}</tbody></table>
      <div className="catalog-unavailable" role="note"><h2>{text('ยังไม่เปิดใช้งาน', 'Not available yet')}</h2><p className="catalog-sub">{text('รายการเหล่านี้ยังไม่มี หรือใช้ได้เฉพาะบทบาทที่มีสิทธิ์', 'These do not exist yet, or are limited to roles that can manage stock.')}</p><ul>{[text('แจ้งเตือนสต็อกต่ำ', 'Low-stock alerts'), text('ซัพพลายเออร์', 'Suppliers'), text('รับเข้า/ปรับสต็อก (เฉพาะเจ้าของและผู้จัดการ)', 'Receive/adjust stock (owner and manager only)')].map(name => <li key={name}>{name}</li>)}</ul></div>
    </section> : <>
    {!menuReady && <p className="notice" role="status">{text('กำลังอัปเดตเมนู รายการอาจไม่ล่าสุด', 'Menu is updating; the list may be out of date.')}</p>}
    <div className="catalog-toolbar"><input aria-label={text('ค้นหาสินค้า', 'Search products')} value={query} placeholder={text('ค้นหาสินค้า…', 'Search products…')} onChange={event => setQuery(event.target.value)} /><small>{text(`${rows.length} จาก ${products.length} รายการ`, `${rows.length} of ${products.length} products`)}</small></div>
    <div className="catalog-chips" role="group" aria-label={text('หมวดสินค้า', 'Categories')}><button type="button" aria-pressed={!category} onClick={() => setCategory('')}>{text('ทั้งหมด', 'All')}</button>{categories.filter(c => c.category).map(c => <button type="button" key={c.category} aria-pressed={category === c.category} onClick={() => setCategory(c.category)}>{c.category} · {c.count}</button>)}</div>
    {rows.length ? <ul className="catalog-grid">{rows.map(product => { const status = catalogStatus(product); const name = language === 'th' ? product.name : product.nameEn; return <li key={product.id} className="catalog-card" data-status={status}>
      <div className="catalog-card-photo">{product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">☕</span>}<span className="catalog-card-status" data-status={status}>{label[status]}</span></div>
      <div className="catalog-card-body"><small>{product.category || text('ไม่มีหมวด', 'Uncategorised')}</small><strong>{name}</strong>
        <div className="catalog-card-meta"><b>{product.unitPrice ? formatMoney(product.unitPrice) : '—'}</b>{status === 'on_sale' && <span>{product.available} {text('พร้อมขาย', 'available')}</span>}{product.promotion && <span className="catalog-offer">{text('มีข้อเสนอ', 'Offer active')}</span>}</div></div>
      {canEdit && <div className="catalog-card-actions">{stockToken && <button type="button" className="secondary" aria-label={`${text('แก้ไขรายละเอียด', 'Edit details of')} ${product.nameEn}`} onClick={() => setDetailsId(product.id)}>{text('แก้ไข', 'Edit')}</button>}{product.basePrice && <button type="button" className="secondary" aria-label={`${text('แก้ไขข้อเสนอ', 'Edit offer for')} ${product.nameEn}`} onClick={() => onEditOffer(product.id)}>{text('ข้อเสนอ', 'Offer')}</button>}</div>}
    </li>; })}</ul> : <p className="notice">{products.length ? text('ไม่พบสินค้าที่ตรงกับคำค้น', 'No products match your search.') : !menuReady ? text('กำลังโหลดรายการสินค้า…', 'Loading products…') : text('ยังไม่มีสินค้าในเมนู', 'No products in the menu yet.')}</p>}
    {stockToken && <details className="catalog-more"><summary>{text('พักขายและเวลาขาย', 'Pause & selling hours')}</summary><ProductAvailabilityPanel products={products} token={stockToken} language={language} canEditHours={canEdit} onChanged={() => onChanged?.()} /></details>}
    {canEdit && stockToken && <details className="catalog-more"><summary>{text('ลำดับเมนู', 'Menu order')}</summary><MenuOrderPanel products={products} token={stockToken} language={language} onSaved={() => onChanged?.()} /></details>}
    <details className="catalog-more"><summary>{text('หมวดสินค้า', 'Categories')} · {categories.filter(c => c.category).length}</summary><section className="catalog-categories"><p className="catalog-sub">{text('เปลี่ยนชื่อหมวดได้ การสร้างหมวดว่างยังไม่เปิดใช้', 'You can rename a category; creating an empty category is not available.')}</p>{stockToken && <CategoryRename products={products} token={stockToken} language={language} onSaved={() => onChanged?.()} />}<ul>{categories.map(c => <li key={c.category || 'none'}><span>{c.category || text('ไม่มีหมวด', 'Uncategorised')}</span><b>{c.count}</b></li>)}</ul></section></details>
    </>}
  </main>;
}
