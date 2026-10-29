import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { requestId } from '../lib/request-id';
import type { Product } from '../lib/menu';
import { isLowStock, lowStockRows } from '../lib/low-stock';

interface StockRow { productId: string; stock: number; reserved: number; available: number; reorderLevel: number | null }
interface Movement { id: string; productId: string; kind: 'RECEIVE' | 'ADJUST'; delta: number; stockBefore: number; stockAfter: number; reason: string; reference: string; actor: string; createdAt: string }

// Manual receive/adjust against the server ledger (owner/manager). Each save sends the stock
// quantity that was read; a changed quantity is refused, and nothing is assumed saved until
// the server answers.
export default function StockManager({ products, token, language }: { products: Product[]; token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [rows, setRows] = useState<StockRow[]>(); const [history, setHistory] = useState<Movement[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ row: StockRow; kind: 'RECEIVE' | 'ADJUST' }>(); const [delta, setDelta] = useState(''); const [reason, setReason] = useState(''); const [reference, setReference] = useState('');
  const [keyRef] = useState({ current: requestId() });
  const [view, setView] = useState<'all' | 'low'>('all'); const [levelFor, setLevelFor] = useState<StockRow>(); const [level, setLevel] = useState('');
  const name = (id: string) => { const p = products.find(item => item.id === id); return p ? (language === 'th' ? p.name : p.nameEn) : id.slice(0, 8); };
  async function load() {
    setMessage('');
    try {
      const [stock, moves] = await Promise.all([api<{ products: StockRow[] }>('/inventory/stock', undefined, token), api<{ movements: Movement[] }>('/inventory/movements', undefined, token)]);
      setRows(stock.products); setHistory(moves.movements);
    } catch (error) { setMessage(errorMessage(error)); }
  }
  useEffect(() => { void load(); }, [token]);
  const amount = Number(delta), signed = target?.kind === 'ADJUST' ? amount : Math.abs(amount);
  const valid = !!target && Number.isInteger(amount) && amount !== 0 && Math.abs(amount) <= 100000 && reason.trim().length > 0 && target.row.stock + signed >= target.row.reserved;
  async function save() {
    if (!target || !valid) return;
    setBusy(true); setMessage('');
    try {
      await api('/inventory/movements', { productId: target.row.productId, kind: target.kind, delta: signed, reason: reason.trim(), reference: reference.trim(), expectedStock: target.row.stock, idempotencyKey: keyRef.current }, token);
      keyRef.current = requestId(); setTarget(undefined); setDelta(''); setReason(''); setReference(''); setMessage(text('บันทึกแล้ว', 'Saved')); await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STOCK_CHANGED') { setMessage(text('จำนวนสต็อกเปลี่ยนไปแล้ว โหลดล่าสุดแล้วลองอีกครั้ง', 'Stock changed in the meantime. The latest was loaded; check and try again.')); setTarget(undefined); await load(); }
      else setMessage(errorMessage(error));
    }
    setBusy(false);
  }
  const levelValue = level.trim() === '' ? null : Number(level), levelValid = levelValue === null || (Number.isInteger(levelValue) && levelValue >= 0 && levelValue <= 100000);
  async function saveLevel() {
    if (!levelFor || !levelValid) return;
    setBusy(true); setMessage('');
    try { await api('/inventory/reorder', { productId: levelFor.productId, reorderLevel: levelValue }, token); setLevelFor(undefined); setLevel(''); setMessage(text('บันทึกขั้นต่ำแล้ว', 'Minimum saved')); await load(); }
    catch (error) { setMessage(errorMessage(error)); }
    setBusy(false);
  }
  if (!rows) return <p className={message ? 'error' : 'notice'} role="status">{message || text('กำลังโหลดสต็อก…', 'Loading stock…')}</p>;
  return <section aria-label={text('สต็อกและรายการเคลื่อนไหว', 'Stock and movements')}>
    <p className="catalog-sub">{text('จำนวนจริงจากเซิร์ฟเวอร์ การรับเข้าและปรับสต็อกบันทึกเป็นรายการที่แก้ไม่ได้', 'Live quantities from the server. Receiving and adjusting are recorded as immutable ledger entries.')}</p>
    <div className="stock-views" role="group" aria-label={text('มุมมองสต็อก', 'Stock views')}><button type="button" className="secondary" aria-pressed={view === 'all'} onClick={() => setView('all')}>{text('ทั้งหมด', 'All')}</button><button type="button" className="secondary" aria-pressed={view === 'low'} onClick={() => setView('low')}>{text('ใกล้หมด', 'Low stock')} ({rows.filter(isLowStock).length})</button></div>
    {view === 'low' ? (() => { const low = lowStockRows(rows); return low.length ? <table className="catalog-table"><thead><tr><th>{text('รายการ', 'Item')}</th><th>{text('รายละเอียด', 'Details')}</th><th>{text('สถานะ', 'Status')}</th><th><span className="visually-hidden">{text('การทำงาน', 'Actions')}</span></th></tr></thead><tbody>{low.map(row => <tr key={row.productId}><td><strong>{name(row.productId)}</strong></td><td>{text(`เหลือ ${row.available} / ขั้นต่ำ ${row.reorderLevel}`, `${row.available} left / minimum ${row.reorderLevel}`)}</td><td>{text('ควรรับเข้า', 'Restock')}</td><td><button type="button" className="secondary" disabled={busy} onClick={() => { setTarget({ row, kind: 'RECEIVE' }); setDelta(''); }}>{text('รับเข้า', 'Receive')}</button></td></tr>)}</tbody></table> : <p className="notice">{rows.some(row => row.reorderLevel !== null) ? text('ไม่มีสินค้าใกล้หมดตอนนี้', 'Nothing is low right now.') : text('ยังไม่ได้ตั้งขั้นต่ำของสินค้า ตั้งได้ที่ปุ่ม "ตั้งขั้นต่ำ" ในมุมมองทั้งหมด', 'No minimums are set yet. Use “Set minimum” in the All view.')}</p>; })() : <>
    <table className="catalog-table"><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('คงเหลือ', 'In stock')}</th><th>{text('จองไว้', 'Reserved')}</th><th>{text('พร้อมขาย', 'Available')}</th><th>{text('ขั้นต่ำ', 'Minimum')}</th><th><span className="visually-hidden">{text('การทำงาน', 'Actions')}</span></th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.productId}><td><strong>{name(row.productId)}</strong></td><td>{row.stock}</td><td>{row.reserved}</td><td data-status={row.available > 0 ? 'on_sale' : 'sold_out'}>{row.available}</td><td>{row.reorderLevel === null ? '—' : row.reorderLevel}{isLowStock(row) ? ` · ${text('ใกล้หมด', 'Low')}` : ''}</td>
        <td><button type="button" className="secondary" disabled={busy} aria-label={`${text('รับเข้า', 'Receive')} ${name(row.productId)}`} onClick={() => { setTarget({ row, kind: 'RECEIVE' }); setDelta(''); }}>{text('รับเข้า', 'Receive')}</button> <button type="button" className="secondary" disabled={busy} aria-label={`${text('ปรับ', 'Adjust')} ${name(row.productId)}`} onClick={() => { setTarget({ row, kind: 'ADJUST' }); setDelta(''); }}>{text('ปรับ', 'Adjust')}</button> <button type="button" className="secondary" disabled={busy} aria-label={`${text('ตั้งขั้นต่ำ', 'Set minimum')} ${name(row.productId)}`} onClick={() => { setLevelFor(row); setLevel(row.reorderLevel === null ? '' : String(row.reorderLevel)); }}>{text('ตั้งขั้นต่ำ', 'Set minimum')}</button></td></tr>)}</tbody></table></>}
    {levelFor && <form className="panel" onSubmit={event => { event.preventDefault(); void saveLevel(); }}>
      <h2>{text('ตั้งขั้นต่ำ', 'Set minimum')} · {name(levelFor.productId)}</h2>
      <label>{text('จำนวนขั้นต่ำ (เว้นว่าง = ไม่ติดตาม)', 'Minimum quantity (empty = not tracked)')}<input type="number" step="1" min="0" max="100000" value={level} onChange={event => setLevel(event.target.value)} /></label>
      {!levelValid && <p className="error" role="alert">{text('ใส่จำนวนเต็ม 0 ถึง 100000', 'Enter a whole number from 0 to 100000.')}</p>}
      <div className="toolbar"><button disabled={!levelValid || busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button><button type="button" className="secondary" onClick={() => setLevelFor(undefined)}>{text('ยกเลิก', 'Cancel')}</button></div>
    </form>}
    {target && <form className="panel" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>{target.kind === 'RECEIVE' ? text('รับสินค้าเข้า', 'Receive stock') : text('ปรับสต็อก', 'Adjust stock')} · {name(target.row.productId)}</h2>
      <label>{target.kind === 'RECEIVE' ? text('จำนวนที่รับเข้า', 'Quantity received') : text('จำนวนที่เปลี่ยน (ลบ = ลดสต็อก)', 'Change (negative reduces stock)')}<input type="number" step="1" value={delta} onChange={event => setDelta(event.target.value)} required /></label>
      <label>{text('เหตุผล', 'Reason')}<input value={reason} maxLength={200} onChange={event => setReason(event.target.value)} required /></label>
      <label>{text('อ้างอิง (ไม่บังคับ)', 'Reference (optional)')}<input value={reference} maxLength={80} onChange={event => setReference(event.target.value)} /></label>
      {delta !== '' && Number.isInteger(amount) && target.row.stock + signed < target.row.reserved && <p className="error" role="alert">{text('ต่ำกว่าจำนวนที่จองไว้ไม่ได้', 'Stock cannot go below what is reserved.')}</p>}
      <div className="toolbar"><button disabled={!valid || busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button><button type="button" className="secondary" onClick={() => setTarget(undefined)}>{text('ยกเลิก', 'Cancel')}</button></div>
    </form>}
    {message && <p className="notice" role="status">{message}</p>}
    <h2>{text('รายการเคลื่อนไหวล่าสุด', 'Recent movements')}</h2>
    {history.length ? <table className="catalog-table"><thead><tr><th>{text('เวลา', 'When')}</th><th>{text('สินค้า', 'Product')}</th><th>{text('ประเภท', 'Type')}</th><th>{text('เปลี่ยน', 'Change')}</th><th>{text('หลังเปลี่ยน', 'After')}</th><th>{text('เหตุผล', 'Reason')}</th></tr></thead><tbody>{history.map(m => <tr key={m.id}><td>{new Date(m.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')}</td><td>{name(m.productId)}</td><td>{m.kind === 'RECEIVE' ? text('รับเข้า', 'Receive') : text('ปรับ', 'Adjust')}</td><td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td><td>{m.stockAfter}</td><td>{m.reason}{m.reference ? ` · ${m.reference}` : ''}</td></tr>)}</tbody></table> : <p className="notice">{text('ยังไม่มีรายการ', 'No movements yet.')}</p>}
  </section>;
}
