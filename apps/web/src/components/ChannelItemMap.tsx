import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';

export interface MapProduct { id: string; name: string; nameEn: string }
interface Unmapped { externalItemId: string; lines: number; qty: number; lastSeen: string; lastUnit: { currency: string; decimals: number; amountMinor: string } }
interface Mapping { externalItemId: string; productId: string }
interface Listing { unmapped: Unmapped[]; mapped: Mapping[] }

// The platform sends item ids, not names, so the owner chooses which BitPOS product each id means. Nothing is matched by name,
// and until a line is mapped it is shown as "not mapped" and never touches stock.
export default function ChannelItemMap({ source, token, language, products, canEdit, onChanged }: { source: 'grabfood' | 'lineman'; token: string; language: 'th' | 'en'; products: MapProduct[]; canEdit: boolean; onChanged?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [data, setData] = useState<Listing | null>(null); const [error, setError] = useState(''); const [busyId, setBusyId] = useState(''); const [pick, setPick] = useState<Record<string, string>>({}); const [done, setDone] = useState('');
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(() => api<Listing>(`/channels/item-map?source=${source}`, undefined, token).then(v => { if (alive.current) { setData(v); setError(''); } }).catch(e => { if (alive.current) setError(errorMessage(e)); }), [source, token]);
  useEffect(() => { void load(); }, [load]);
  const productName = (id: string) => { const p = products.find(x => x.id === id); return p ? (language === 'en' && p.nameEn ? p.nameEn : p.name) : text('สินค้าที่ถูกลบ/ซ่อน', 'Removed or hidden product'); };
  const productLabel = (p: MapProduct) => language === 'en' && p.nameEn ? p.nameEn : p.name;

  async function save(externalItemId: string, productId: string | null) {
    setBusyId(externalItemId); setDone(''); setError('');
    try {
      const r = await api<{ updatedLines: number }>('/channels/item-map', { source, externalItemId, productId }, token, 'PUT');
      if (alive.current) { setDone(productId ? text(`จับคู่แล้ว (อัปเดต ${r.updatedLines} รายการในออเดอร์)`, `Mapped (${r.updatedLines} order lines updated)`) : text('ยกเลิกการจับคู่แล้ว', 'Mapping removed')); setPick(p => { const n = { ...p }; delete n[externalItemId]; return n; }); }
      await load(); onChanged?.();
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    if (alive.current) setBusyId('');
  }

  const count = data?.unmapped.length ?? 0;
  const money = (u: Unmapped) => formatMoney({ currency: u.lastUnit.currency, decimals: u.lastUnit.decimals, amountMinor: u.lastUnit.amountMinor } as never);
  return <details className="channel-map" open={count > 0}>
    <summary>{text('จับคู่เมนูกับสินค้าใน BitPOS', 'Match platform items to BitPOS products')}{data && <span key={count} className={`channel-map-count${count ? ' warn' : ''}`}>{count ? text(`${count} รายการยังไม่จับคู่`, `${count} not mapped`) : text('จับคู่ครบแล้ว', 'all mapped')}</span>}</summary>
    <p className="catalog-sub">{text('แพลตฟอร์มส่งมาแค่รหัสเมนู ไม่มีชื่อ ร้านเลือกเองว่ารหัสไหนคือสินค้าอะไร ระบบไม่เดาจากชื่อ และรายการที่ยังไม่จับคู่จะไม่ตัดสต็อก', 'The platform sends item ids, not names. You choose which product each id is. Nothing is guessed from names, and unmapped items never touch stock.')}</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {done && <p className="notice" role="status">{done}</p>}
    {!canEdit && <p className="notice" role="status">{text('เฉพาะเจ้าของร้านหรือผู้จัดการจับคู่ได้', 'Only an owner or manager can change mappings.')}</p>}
    {data && data.unmapped.length === 0 && data.mapped.length === 0 && <p role="status">{text('ยังไม่มีเมนูจากแพลตฟอร์ม — จะแสดงที่นี่เมื่อมีออเดอร์เข้ามา', 'No platform items yet — they appear here once an order arrives.')}</p>}
    <ul className="channel-map-list">
      {data?.unmapped.map((u, i) => <li key={u.externalItemId} className="channel-map-row" style={{ '--i': i } as React.CSSProperties}>
        <div className="channel-map-id"><code>{u.externalItemId}</code><span className="catalog-sub">{text(`เห็น ${u.lines} ครั้ง · รวม ${u.qty} ชิ้น · ราคาล่าสุด ${money(u)}`, `seen ${u.lines}× · ${u.qty} pcs · last price ${money(u)}`)}</span></div>
        {canEdit && <div className="channel-map-pick">
          <label><span className="sr-only">{text('สินค้า', 'Product')}</span><select value={pick[u.externalItemId] ?? ''} disabled={busyId === u.externalItemId} onChange={e => setPick(p => ({ ...p, [u.externalItemId]: e.target.value }))}><option value="">{text('เลือกสินค้า…', 'Choose a product…')}</option>{products.map(p => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}</select></label>
          <button type="button" disabled={!pick[u.externalItemId] || busyId === u.externalItemId} onClick={() => void save(u.externalItemId, pick[u.externalItemId])}>{text('จับคู่', 'Map')}</button>
        </div>}
      </li>)}
      {data?.mapped.map((m, i) => <li key={m.externalItemId} className="channel-map-row mapped" style={{ '--i': (data?.unmapped.length ?? 0) + i } as React.CSSProperties}>
        <div className="channel-map-id"><code>{m.externalItemId}</code><span>→ {productName(m.productId)}</span></div>
        {canEdit && <button type="button" className="secondary" disabled={busyId === m.externalItemId} onClick={() => { if (window.confirm(text('ยกเลิกการจับคู่นี้? ออเดอร์ที่ยังไม่จบจะกลับเป็น "ยังไม่จับคู่"', 'Remove this mapping? Open orders go back to "not mapped".'))) void save(m.externalItemId, null); }}>{text('ยกเลิกการจับคู่', 'Remove')}</button>}
      </li>)}
    </ul>
  </details>;
}
