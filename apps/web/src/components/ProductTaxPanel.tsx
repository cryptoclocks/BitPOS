import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Product } from '../lib/menu';
import '../styles/channel-prices.css';

// M03b: owner marks products that carry no VAT (for the cash register's tax-inclusive split). One toggle = one saved change; a receipt keeps the flag it was sold with.
export default function ProductTaxPanel({ token, products, language }: { token: string; products: Product[]; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [flags, setFlags] = useState<Record<string, boolean>>({}); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState(''); const [message, setMessage] = useState('');
  async function load() {
    setState('loading'); setMessage('');
    try { const r = await api<{ products: { id: string; vatExempt: boolean }[] }>('/products/vat', undefined, token); setFlags(Object.fromEntries(r.products.map(p => [p.id, p.vatExempt]))); setState('ready'); }
    catch (error) { setMessage(errorMessage(error)); setState('error'); }
  }
  useEffect(() => { void load(); }, [token]);
  async function toggle(id: string) {
    setBusyId(id); setMessage('');
    try { const r = await api<{ vatExempt: boolean }>(`/products/${id}/vat`, { vatExempt: !flags[id], expected: !!flags[id] }, token, 'PUT'); setFlags(f => ({ ...f, [id]: r.vatExempt })); }
    catch (error) { setMessage(error instanceof ApiError && error.code === 'PRODUCT_CHANGED' ? text('ค่านี้เปลี่ยนไปแล้ว โหลดล่าสุดแล้วลองอีกครั้ง', 'This changed. Reload and try again.') : errorMessage(error)); if (error instanceof ApiError && error.code === 'PRODUCT_CHANGED') void load(); }
    setBusyId('');
  }
  return <section className="panel channel-prices" aria-label={text('สินค้าที่ไม่คิด VAT', 'VAT-exempt products')}>
    <h2>{text('สินค้าที่ไม่คิด VAT', 'VAT-exempt products')}</h2>
    <p className="catalog-sub">{text('ใช้กับเครื่องคิดเงินสดที่ตั้งเป็นราคารวม VAT: สินค้าที่ติ๊กไว้ยังอยู่ในยอดรวม แต่ไม่มี VAT ส่วนลดท้ายบิลแบ่งตามสัดส่วน ใบเสร็จที่ออกแล้วไม่เปลี่ยน ควรให้นักบัญชีตรวจสอบก่อนใช้จริง', 'For a cash register set to VAT-inclusive prices: ticked products stay in the total but carry no VAT. A bill discount is shared in proportion. Issued receipts do not change. Have an accountant confirm before real use.')}</p>
    {state === 'loading' && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {state === 'error' && <div role="alert"><p className="error">{message}</p><button type="button" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Try again')}</button></div>}
    {state === 'ready' && <ul className="tax-list">{products.map(p => <li key={p.id}><label><input type="checkbox" checked={!!flags[p.id]} disabled={busyId === p.id} onChange={() => void toggle(p.id)} /> {language === 'th' ? p.name : p.nameEn}</label></li>)}</ul>}
    {state === 'ready' && message && <p role="status" className="notice">{message}</p>}
  </section>;
}
