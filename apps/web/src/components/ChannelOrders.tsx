import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import ChannelItemMap, { type MapProduct } from './ChannelItemMap';

interface Line { lineNo: number; externalItemId: string; qty: number; unitMinor: string; note: string; mapped: boolean; productId: string | null; stock: { requested: number; applied: number } | null }
interface ChannelOrder { id: string; environment: string; externalOrderId: string; shortNumber: string; status: string; rawStatus: string; paymentType: string; paymentCollector: string; settlementState: string; currency: { code: string; decimals: number }; subtotalMinor: string; totalMinor: string | null; customerPaidMinor: string | null; netEarningMinor: string | null; orderTime: string; pendingCommand: string | null; lastCommandError: string; lines: Line[] }
interface Receivable { currency: { code: string; decimals: number }; orders: number; netEarningMinor: string; ordersWithoutNet: number }
interface Listing { receivable: Receivable[]; activeEnvironment: string; linked: boolean; lastSyncAt: string | null; lastSyncResult: string; orders: ChannelOrder[] }
const SYNC_MS = 30_000;

// Orders that came from a delivery platform. Money is shown in the platform's own currency; buttons exist only for
// operations the provider's documented API supports (accept / reject / ready). LINE MAN has no documented API, so it only explains that.
export default function ChannelOrders({ source, token, language, products = [], canMap = false }: { source: 'grabfood' | 'lineman'; token: string; language: 'th' | 'en'; products?: MapProduct[]; canMap?: boolean }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [data, setData] = useState<Listing | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const name = source === 'grabfood' ? 'GrabFood' : 'LINE MAN';
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(() => api<Listing>(`/channels/orders?source=${source}`, undefined, token).then(v => { if (alive.current) { setData(v); setError(''); } }).catch(e => { if (alive.current) setError(errorMessage(e)); }), [source, token]);
  const sync = useCallback(async () => {
    if (source !== 'grabfood') return;
    try { await api('/channels/orders/sync', {}, token); } catch (e) { if (alive.current) setError(errorMessage(e)); }
    await load();
  }, [source, token, load]);
  useEffect(() => { void load(); if (source !== 'grabfood') return; void sync(); const t = window.setInterval(() => void sync(), SYNC_MS); return () => window.clearInterval(t); }, [source, load, sync]);

  if (source === 'lineman') return <section className="panel channel-orders" aria-label="LINE MAN">
    <h1>LINE MAN</h1>
    <p className="notice" role="status">{text('ยังรับออเดอร์ LINE MAN ไม่ได้ — ยังไม่มีเอกสาร API สาธารณะและยังไม่ได้รับอนุมัติสิทธิ์เชื่อม POS (เก็บคีย์ล่วงหน้าได้ที่ ตั้งค่า → ช่องทางเดลิเวอรี)', 'LINE MAN orders cannot be received yet: there is no public API documentation and POS access has not been granted. You can store keys in advance under Settings → Delivery channels.')}</p>
  </section>;

  async function settle(order: ChannelOrder, to: 'receivable' | 'settled' | 'disputed') {
    setBusy(true); setNotice('');
    try { await api(`/channels/orders/${encodeURIComponent(order.id)}/settlement`, { to }, token); setNotice(text('บันทึกสถานะการรับเงินแล้ว', 'Settlement status saved')); }
    catch (e) { setNotice(errorMessage(e)); }
    await load(); setBusy(false);
  }
  async function act(order: ChannelOrder, command: 'accept' | 'reject' | 'ready' | 'preparing') {
    if (command === 'reject' && !window.confirm(text('ปฏิเสธออเดอร์นี้?', 'Reject this order?'))) return;
    setBusy(true); setNotice('');
    try {
      const r = await api<{ outcome: string; error: string }>(`/channels/orders/${encodeURIComponent(order.id)}/command`, { command }, token);
      setNotice(r.outcome === 'done' ? text('ส่งคำสั่งสำเร็จ', 'Command sent') : r.outcome === 'unknown' ? text('ไม่ทราบผล (ติดต่อ Grab ไม่ได้) — รอตรวจสอบรอบถัดไป ห้ามกดซ้ำ', 'Outcome unknown (could not reach Grab) — wait for the next check, do not retry') : text(`Grab ปฏิเสธคำสั่ง (${r.error})`, `Grab refused the command (${r.error})`));
    } catch (e) { setNotice(errorMessage(e)); }
    await load(); setBusy(false);
  }
  const statusLabel: Record<string, string> = { received: text('รอรับ', 'New'), accept_pending: text('กำลังรับ…', 'Accepting…'), accepted: text('รับแล้ว', 'Accepted'), preparing: text('กำลังทำ', 'Preparing'), ready: text('พร้อมรับ', 'Ready'), handed_over: text('ส่งมอบแล้ว', 'Handed over'), completed: text('เสร็จสิ้น', 'Completed'), reject_pending: text('กำลังปฏิเสธ…', 'Rejecting…'), rejected: text('ปฏิเสธแล้ว', 'Rejected'), cancelled: text('ยกเลิก', 'Cancelled'), expired: text('หมดเวลา', 'Expired'), needs_attention: text('ต้องตรวจสอบ', 'Needs attention') };
  const kitchen = (data?.orders ?? []).filter(o => ['accepted', 'preparing'].includes(o.status)).sort((a, b) => a.orderTime.localeCompare(b.orderTime));
  const settleLabel: Record<string, string> = { receivable: text('รอรับเงินจากแพลตฟอร์ม', 'awaiting payout'), settled: text('ได้รับเงินแล้ว (ร้านยืนยันเอง)', 'received (shop-confirmed)'), disputed: text('มีข้อพิพาท', 'disputed'), not_applicable: '' };
  const lineName = (l: Line) => { const p = l.productId ? products.find(x => x.id === l.productId) : undefined; return p ? (language === 'en' && p.nameEn ? p.nameEn : p.name) : l.externalItemId.length > 14 ? `${l.externalItemId.slice(0, 12)}…` : l.externalItemId; };
  const money = (o: ChannelOrder, minor: string | null) => minor === null ? '—' : formatMoney({ currency: o.currency.code, decimals: o.currency.decimals, amountMinor: minor } as never);

  return <section className="panel channel-orders" aria-label={name}>
    <div className="channel-orders-head">
      <h1>{name}</h1>
      {data && <span className={`channel-env ${data.activeEnvironment}`}>{data.activeEnvironment === 'sandbox' ? text('Sandbox (ทดสอบ)', 'Sandbox (test)') : text('ของจริง', 'Live')}</span>}
      <button type="button" disabled={busy} onClick={() => { setBusy(true); void sync().finally(() => setBusy(false)); }}>{text('ดึงออเดอร์ตอนนี้', 'Refresh now')}</button>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!data && !error && <p role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {data && !data.linked && <p className="notice" role="status">{text('ยังไม่ได้เชื่อมต่อ: ใส่คีย์แล้วกด "ทดสอบการเชื่อมต่อ" ที่ ตั้งค่า → ช่องทางเดลิเวอรี', 'Not connected: save keys and press "Test connection" under Settings → Delivery channels.')}</p>}
    {data && data.lastSyncAt && <p className="catalog-sub">{text('ตรวจล่าสุด', 'Last checked')} {new Date(data.lastSyncAt).toLocaleTimeString()} · {data.lastSyncResult === 'ok' ? text('สำเร็จ', 'ok') : data.lastSyncResult}</p>}
    {data && data.receivable.length > 0 && <div className="channel-receivable" role="status"><strong>{text('ยังรอรับเงินจากแพลตฟอร์ม', 'Still awaiting payout')}</strong>{data.receivable.map(r => <span key={r.currency.code}>{r.orders} {text('ออเดอร์', 'orders')} · {formatMoney({ currency: r.currency.code, decimals: r.currency.decimals, amountMinor: r.netEarningMinor } as never)} {text('(ร้านได้สุทธิ)', '(net to shop)')}{r.ordersWithoutNet > 0 && <em> · {text(`${r.ordersWithoutNet} ออเดอร์ไม่มียอดสุทธิ`, `${r.ordersWithoutNet} without a net amount`)}</em>}</span>)}<small>{text('ตัวเลขนี้มาจากข้อมูลออเดอร์ ไม่ใช่รายการโอนจริงจากแพลตฟอร์ม', 'Figures come from order data, not from actual platform payouts.')}</small></div>}
    <ChannelItemMap source={source} token={token} language={language} products={products} canEdit={canMap} onChanged={() => void load()} />
    {kitchen.length > 0 && <section className="channel-kitchen" aria-label={text('คิวครัว', 'Kitchen queue')}>
      <h2>{text('คิวครัว', 'Kitchen queue')} <span className="channel-map-count" key={kitchen.length}>{kitchen.length}</span></h2>
      <ul>{kitchen.map((o, i) => <li key={o.id} className={`channel-kitchen-card ${o.status}`} style={{ '--i': i } as React.CSSProperties}>
        <div className="channel-kitchen-top"><strong>#{o.shortNumber || o.externalOrderId}</strong><span className={`channel-status ${o.status}`}>{statusLabel[o.status]}</span><time dateTime={o.orderTime}>{text(`${Math.max(0, Math.round((Date.now() - new Date(o.orderTime).getTime()) / 60000))} นาทีที่แล้ว`, `${Math.max(0, Math.round((Date.now() - new Date(o.orderTime).getTime()) / 60000))} min ago`)}</time></div>
        <ul>{o.lines.map(l => <li key={l.lineNo}><b>{l.qty}×</b> {lineName(l)}{!l.mapped && <em className="channel-unmapped"> · {text('ยังไม่จับคู่เมนู', 'not mapped')}</em>}{l.note && <span className="channel-kitchen-note"> — {l.note}</span>}</li>)}</ul>
        {!o.pendingCommand && <div className="toolbar">
          {o.status === 'accepted' && <button disabled={busy} onClick={() => void act(o, 'preparing')}>{text('เริ่มทำ', 'Start preparing')}</button>}
          <button className={o.status === 'accepted' ? 'secondary' : ''} disabled={busy} onClick={() => void act(o, 'ready')}>{text('ทำเสร็จ · พร้อมรับ', 'Done · ready for pickup')}</button>
        </div>}
      </li>)}</ul>
    </section>}
    {data && data.linked && data.orders.length === 0 && !error && <p role="status">{text('ยังไม่มีออเดอร์วันนี้', 'No orders today yet')}</p>}
    <ul className="channel-order-list">
      {data?.orders.map(o => <li key={o.id} className="channel-order">
        <div className="channel-order-head"><strong>#{o.shortNumber || o.externalOrderId}</strong><span className={`channel-status ${o.status}`}>{statusLabel[o.status] ?? o.status}</span><time dateTime={o.orderTime}>{new Date(o.orderTime).toLocaleTimeString()}</time></div>
        <p className="catalog-sub">{text('รหัสอ้างอิง', 'Reference')}: {o.externalOrderId}{o.rawStatus && ` · ${o.rawStatus}`}</p>
        <ul>{o.lines.map(l => <li key={l.lineNo}>{l.qty}× {lineName(l)} · {money(o, l.unitMinor)}{!l.mapped && <em className="channel-unmapped"> · {text('ยังไม่จับคู่เมนู', 'menu item not mapped')}</em>}{l.stock && (l.stock.applied === l.stock.requested ? <em className="channel-stock ok"> · {text('ตัดสต็อกแล้ว', 'stock taken')}</em> : <em className="channel-stock short"> · {text(`ตัดสต็อกได้ ${l.stock.applied}/${l.stock.requested} (ของในระบบไม่พอ)`, `stock taken ${l.stock.applied}/${l.stock.requested} (not enough on hand)`)}</em>)}{l.note && ` — ${l.note}`}</li>)}</ul>
        <p>{text('ยอดสินค้า', 'Items')} {money(o, o.subtotalMinor)} · {text('ลูกค้าจ่าย', 'Customer paid')} {money(o, o.customerPaidMinor)} · {text('ร้านได้สุทธิ', 'Net to shop')} {money(o, o.netEarningMinor)}</p>
        <p className="catalog-sub">{o.paymentCollector === 'platform' ? <>{text('แพลตฟอร์มเก็บเงิน', 'Collected by the platform')} · <span key={o.settlementState} className={`channel-settle ${o.settlementState}`}>{settleLabel[o.settlementState] ?? o.settlementState}</span></> : text('เก็บเงินสดที่ร้าน', 'Cash collected by the shop')}{o.lastCommandError && ` · ${o.lastCommandError}`}</p>
        {canMap && o.paymentCollector === 'platform' && o.status === 'completed' && <div className="toolbar channel-settle-actions">
          {o.settlementState !== 'settled' && <button className="secondary" disabled={busy} onClick={() => void settle(o, 'settled')}>{text('ได้รับเงินแล้ว (ฉันตรวจเอง)', 'Mark received (I checked)')}</button>}
          {o.settlementState !== 'disputed' && <button className="secondary" disabled={busy} onClick={() => void settle(o, 'disputed')}>{text('มีข้อพิพาท', 'Dispute')}</button>}
          {o.settlementState !== 'receivable' && <button className="secondary" disabled={busy} onClick={() => void settle(o, 'receivable')}>{text('กลับเป็นรอรับเงิน', 'Back to pending')}</button>}
        </div>}
        <div className="toolbar">
          {o.status === 'received' && !o.pendingCommand && <><button disabled={busy} onClick={() => void act(o, 'accept')}>{text('รับออเดอร์', 'Accept')}</button><button className="secondary" disabled={busy} onClick={() => void act(o, 'reject')}>{text('ปฏิเสธ', 'Reject')}</button></>}
          {o.status === 'accepted' && !o.pendingCommand && <button className="secondary" disabled={busy} onClick={() => void act(o, 'preparing')}>{text('เริ่มทำ', 'Start preparing')}</button>}
          {['accepted', 'preparing'].includes(o.status) && !o.pendingCommand && <button disabled={busy} onClick={() => void act(o, 'ready')}>{text('พร้อมรับ', 'Mark ready')}</button>}
          {o.pendingCommand && <span role="status">{text('รอผลจาก Grab…', 'Waiting for Grab…')}</span>}
        </div>
      </li>)}
    </ul>
  </section>;
}
