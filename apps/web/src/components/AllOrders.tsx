import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';

export interface BitposRow { id: string; status: string; total: { currency: string; decimals: number; amountMinor: string }; createdAt?: string }
interface GrabRow { id: string; shortNumber: string; externalOrderId: string; status: string; orderTime: string; currency: { code: string; decimals: number }; customerPaidMinor: string | null; subtotalMinor: string }
interface Row { key: string; source: 'bitpos' | 'grabfood'; ref: string; status: string; at: string; money: string; attention: boolean }
const SYNC_MS = 30_000;

// One time-ordered list across sources. It only reads and links: accepting, rejecting and marking ready stay in each source's own tab,
// because each source has different documented operations. Money is shown in each order's own currency, never summed across sources.
export default function AllOrders({ token, language, bitpos, open }: { token: string; language: 'th' | 'en'; bitpos: BitposRow[]; open: (source: 'bitpos' | 'grabfood') => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [grab, setGrab] = useState<GrabRow[]>([]); const [linked, setLinked] = useState(true);
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    try { await api('/channels/orders/sync', {}, token); } catch { /* not connected yet: the Grab tab explains it */ }
    try { const v = await api<{ linked: boolean; orders: GrabRow[] }>('/channels/orders?source=grabfood', undefined, token); if (alive.current) { setGrab(v.orders); setLinked(v.linked); } } catch { /* keep the last list */ }
  }, [token]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), SYNC_MS); return () => window.clearInterval(t); }, [load]);

  const label: Record<string, string> = { received: text('รอรับ', 'New'), accept_pending: text('กำลังรับ…', 'Accepting…'), accepted: text('รับแล้ว', 'Accepted'), ready: text('พร้อมรับ', 'Ready'), handed_over: text('ส่งมอบแล้ว', 'Handed over'), completed: text('เสร็จสิ้น', 'Completed'), rejected: text('ปฏิเสธแล้ว', 'Rejected'), cancelled: text('ยกเลิก', 'Cancelled'), expired: text('หมดเวลา', 'Expired') };
  const rows: Row[] = [
    ...bitpos.map(o => ({ key: `b-${o.id}`, source: 'bitpos' as const, ref: o.id.slice(0, 8), status: o.status, at: o.createdAt ?? '', money: formatMoney(o.total as never), attention: false })),
    ...grab.map(o => ({ key: `g-${o.id}`, source: 'grabfood' as const, ref: o.shortNumber || o.externalOrderId, status: label[o.status] ?? o.status, at: o.orderTime, money: formatMoney({ currency: o.currency.code, decimals: o.currency.decimals, amountMinor: o.customerPaidMinor ?? o.subtotalMinor } as never), attention: o.status === 'received' }))
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 100);
  const waiting = rows.filter(r => r.attention).length;

  return <section className="panel all-orders" aria-label={text('ออเดอร์ทั้งหมด', 'All orders')}>
    <div className="channel-orders-head"><h1>{text('ออเดอร์ทั้งหมด', 'All orders')}</h1>{waiting > 0 && <span className="channel-status received" role="status">{text(`GrabFood รอรับ ${waiting}`, `${waiting} GrabFood waiting`)}</span>}</div>
    <p className="catalog-sub">{text('รวมทุกช่องทางตามเวลา — กดเปิดเพื่อจัดการในแท็บของแต่ละช่องทาง ยอดแสดงตามสกุลเงินของแต่ละออเดอร์ ไม่รวมกัน', 'Every source by time. Open an order to act on it in its own tab. Amounts stay in each order\'s own currency and are never added together.')}</p>
    {!linked && <p className="notice" role="status">{text('GrabFood ยังไม่ได้เชื่อมต่อ จึงยังไม่มีออเดอร์จากช่องทางนี้', 'GrabFood is not connected yet, so no orders from it appear.')}</p>}
    {rows.length === 0 && <p role="status">{text('ยังไม่มีออเดอร์', 'No orders yet')}</p>}
    <ul className="all-order-list">
      {rows.map((r, i) => <li key={r.key} className={`all-order${r.attention ? ' attention' : ''}`} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
        <span className={`all-source ${r.source}`}>{r.source === 'bitpos' ? 'BitPOS' : 'GrabFood'}</span>
        <strong>#{r.ref}</strong><span>{r.status}</span><span className="all-money">{r.money}</span>
        {r.at && <time dateTime={r.at}>{new Date(r.at).toLocaleTimeString()}</time>}
        <button type="button" className="secondary" onClick={() => open(r.source)}>{text('เปิด', 'Open')}</button>
      </li>)}
    </ul>
  </section>;
}
