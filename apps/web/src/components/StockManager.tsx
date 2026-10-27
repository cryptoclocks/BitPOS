import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { requestId } from '../lib/request-id';
import type { Product } from '../lib/menu';

interface StockRow { productId: string; stock: number; reserved: number; available: number }
interface Movement { id: string; productId: string; kind: 'RECEIVE' | 'ADJUST'; delta: number; stockBefore: number; stockAfter: number; reason: string; reference: string; actor: string; createdAt: string }

// Manual receive/adjust against the server ledger (owner/manager). Each save sends the stock
// quantity that was read; a changed quantity is refused, and nothing is assumed saved until
// the server answers.
export default function StockManager({ products, token, language }: { products: Product[]; token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [rows, setRows] = useState<StockRow[]>(); const [history, setHistory] = useState<Movement[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ row: StockRow; kind: 'RECEIVE' | 'ADJUST' }>(); const [delta, setDelta] = useState(''); const [reason, setReason] = useState(''); const [reference, setReference] = useState('');
  const [keyRef] = useState({ current: requestId() });
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
  if (!rows) return <p className={message ? 'error' : 'notice'} role="status">{message || text('กำลังโหลดสต็อก…', 'Loading stock…')}</p>;
  return <section aria-label={text('สต็อกและรายการเคลื่อนไหว', 'Stock and movements')}>
    <p className="catalog-sub">{text('จำนวนจริงจากเซิร์ฟเวอร์ การรับเข้าและปรับสต็อกบันทึกเป็นรายการที่แก้ไม่ได้', 'Live quantities from the server. Receiving and adjusting are recorded as immutable ledger entries.')}</p>
    <table className="catalog-table"><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('คงเหลือ', 'In stock')}</th><th>{text('จองไว้', 'Reserved')}</th><th>{text('พร้อมขาย', 'Available')}</th><th><span className="visually-hidden">{text('การทำงาน', 'Actions')}</span></th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.productId}><td><strong>{name(row.productId)}</strong></td><td>{row.stock}</td><td>{row.reserved}</td><td data-status={row.available > 0 ? 'on_sale' : 'sold_out'}>{row.available}</td>
        <td><button type="button" className="secondary" disabled={busy} aria-label={`${text('รับเข้า', 'Receive')} ${name(row.productId)}`} onClick={() => { setTarget({ row, kind: 'RECEIVE' }); setDelta(''); }}>{text('รับเข้า', 'Receive')}</button> <button type="button" className="secondary" disabled={busy} aria-label={`${text('ปรับ', 'Adjust')} ${name(row.productId)}`} onClick={() => { setTarget({ row, kind: 'ADJUST' }); setDelta(''); }}>{text('ปรับ', 'Adjust')}</button></td></tr>)}</tbody></table>
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
