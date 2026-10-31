import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { PrivateOrder } from '../lib/table';
import { shopTime, todayMayBeTruncated, viewFromOrders, viewFromSummary, type Channel, type OverviewSummaryWire } from '../lib/pos-overview';
import '../styles/pos-overview.css';

export default function PosOverview({ orders, ready, failed, language, token, now = new Date(), onOpenOrders }: { orders: PrivateOrder[]; ready: boolean; failed: boolean; language: 'th' | 'en'; token?: string; now?: Date; onOpenOrders: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  // The numbers come from the server (SQL over every order, shop time zone). The capped order list is only a fallback.
  const [summary, setSummary] = useState<OverviewSummaryWire>();
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>(token ? 'loading' : 'failed');
  const ordersKey = orders.reduce((n, order) => n + order.version + (order.fulfillment?.version ?? 0), orders.length);
  useEffect(() => {
    if (!token) { setSummary(undefined); setState('failed'); return; }
    let active = true;
    api<OverviewSummaryWire>('/overview/summary', undefined, token)
      .then(next => { if (active) { setSummary(next); setState('ok'); } })
      .catch(() => { if (active) { setSummary(undefined); setState('failed'); } });
    return () => { active = false; };
  }, [token, ordersKey]);
  const fromServer = state === 'ok' && !!summary;
  const view = fromServer ? viewFromSummary(summary!) : viewFromOrders(orders, now);
  const waiting = fromServer ? false : state === 'loading' && !summary ? true : !ready;
  const peak = Math.max(1, ...view.buckets.map(b => b.count));
  const channels: { key: Channel; label: string }[] = [
    { key: 'store', label: text('หน้าร้าน / โต๊ะ', 'In store / table') },
    { key: 'delivery', label: text('แอพจัดส่ง', 'App delivery') },
    { key: 'pickup', label: text('รับเอง / นำกลับ', 'Pickup / takeaway') },
  ];
  const statusLabel = (status: string, fulfillment: string | null) => status === 'PAID'
    ? (fulfillment ? ({ RECEIVED: text('รับออเดอร์แล้ว', 'Received'), PREPARING: text('กำลังเตรียม', 'Preparing'), READY: text('พร้อมรับ', 'Ready'), COLLECTED: text('รับแล้ว', 'Collected') } as Record<string, string>)[fulfillment] ?? fulfillment : text('ชำระแล้ว', 'Paid'))
    : status === 'EXPIRED' ? text('หมดอายุ', 'Expired') : status === 'RECOVERY' ? text('ต้องตรวจสอบ', 'Needs review') : text('รอชำระเงิน', 'Awaiting payment');
  const sales = view.sales;
  const multi = sales.kind === 'money' && sales.items.length > 1;
  return <main className="pos-overview" aria-label={text('ภาพรวมร้าน', 'Shop overview')}>
    <div className="section-heading"><div><p className="eyebrow">{text('วันนี้', 'TODAY')}</p><h1>{text('ภาพรวมร้าน', 'Shop overview')}</h1>
      <p className="pos-overview-sub">{fromServer
        ? text('คำนวณที่เซิร์ฟเวอร์จากทุกออเดอร์ของวันนี้ตามเวลาร้าน (Asia/Bangkok) ยอดขายและออเดอร์ที่ชำระแล้วนับตามเวลาชำระเงิน จำนวนออเดอร์ทั้งหมดและช่องทางนับตามเวลาสร้างออเดอร์ ตรงกับรายงานและไฟล์ส่งออก ไม่ใช่รายงานปิดรอบ', 'Computed on the server from every order today in shop time (Asia/Bangkok). Sales and paid orders count by the time paid; total orders and channels count by the time created. Same rule as Reports and the CSV export. Not a closed-shift report.')
        : text('สรุปจากออเดอร์ที่โหลดอยู่ในระบบ ไม่ใช่รายงานปิดรอบ', 'Summarised from the orders currently loaded. This is not a closed-shift report.')}</p></div></div>
    {!fromServer && state === 'failed' && ready && <p className="notice" role="status" data-overview-fallback="orders">{text('ยังโหลดสรุปจากเซิร์ฟเวอร์ไม่ได้ ตัวเลขด้านล่างมาจากออเดอร์ล่าสุดที่โหลดไว้ในเครื่องนี้', 'The server summary is unavailable. Figures below come from the latest orders loaded on this device.')}</p>}
    {!fromServer && ready && todayMayBeTruncated(orders, now) && <p className="notice" role="status">{text('ระบบส่งออเดอร์ล่าสุดสูงสุด 200 รายการ ตัวเลขวันนี้อาจไม่ครบ ดูยอดเต็มในรายงาน', 'The server returns only the newest 200 orders, so today\'s figures may be incomplete. Use Reports for the full total.')}</p>}
    {!fromServer && failed && <p className="error" role="status">{text('โหลดออเดอร์ไม่สำเร็จ ตัวเลขอาจไม่ล่าสุด', 'Orders could not be loaded. Figures may be stale.')}</p>}
    {view.excludedOrders > 0 && <p className="notice" role="status">{text(`ออเดอร์เดิม ${view.excludedOrders} รายการที่ชำระแล้วไม่มีข้อมูลราคา นับในจำนวนแต่ไม่รวมในยอดขาย`, `${view.excludedOrders} older paid orders have no price record: counted as paid, not in sales.`)}</p>}
    {waiting ? <p className="notice" role="status">{text('กำลังโหลดภาพรวม…', 'Loading overview…')}</p> : <>
      <section className="pos-overview-kpis" aria-label={text('ตัวเลขสำคัญ', 'Key figures')}>
        <article><small>{text('ยอดขายวันนี้', 'Sales today')}</small><strong>{sales.kind === 'money' ? sales.items.map(m => <span className="pos-overview-money" key={m.currency + m.decimals}>{formatMoney(m)}</span>) : sales.kind === 'mixed' ? text('หลายสกุลเงิน', 'Mixed currencies') : '—'}</strong>
          <span>{sales.kind === 'hidden' ? text('เฉพาะเจ้าของร้านและผู้จัดการ', 'Owner or manager only') : sales.kind === 'mixed' || multi ? text('ไม่รวมยอดข้ามสกุลเงิน', 'Not totalled across denominations') : text(`${view.paidCount} ออเดอร์ที่ชำระแล้ว`, `${view.paidCount} paid orders`)}</span></article>
        <article><small>{text('ออเดอร์ทั้งหมดวันนี้', 'Orders today')}</small><strong>{view.todayCount}</strong><span>{text('รวมที่ยังไม่ชำระ', 'Including unpaid')}</span></article>
        <article><small>{text('กำลังดำเนินการ', 'In progress')}</small><strong>{view.inProgress}</strong><span>{text('ชำระแล้ว ยังไม่ส่งมอบ', 'Paid, not yet collected')}</span></article>
        <article><small>{text('ยอดสุทธิร้าน', 'Net after fees')}</small><strong>—</strong><span>{text('เซิร์ฟเวอร์ยังไม่ส่งยอดหลังหักค่าธรรมเนียม', 'The server does not provide fee-adjusted totals yet')}</span></article>
      </section>
      <div className="pos-overview-grid">
        <section aria-label={text('ออเดอร์ชำระแล้วรายชั่วโมง', 'Paid orders by hour')}><h2>{text('ออเดอร์ที่ชำระแล้วรายชั่วโมง', 'Paid orders by hour')}</h2>
          {view.buckets.length ? <div className="pos-overview-chart" role="img" aria-label={view.buckets.map(b => `${b.hour}:00 ${b.count}`).join(', ')}>{view.buckets.map(b => <div key={b.hour}><i style={{ height: `${Math.round(b.count / peak * 100)}%` }} data-peak={b.count === peak ? 'true' : undefined} /><small>{String(b.hour).padStart(2, '0')}:00</small></div>)}</div> : <p className="notice">{text('ยังไม่มีออเดอร์ที่ชำระแล้ววันนี้', 'No paid orders today yet.')}</p>}
        </section>
        <section aria-label={text('ช่องทางการขาย', 'Sales channels')}><h2>{text('ช่องทางการขาย', 'Sales channels')}</h2>
          {channels.map(channel => { const count = view.channels[channel.key], share = view.todayCount ? Math.round(count / view.todayCount * 100) : 0; return <div className="pos-overview-channel" key={channel.key}><span>{channel.label}<b>{share}%</b></span><progress max={100} value={share} aria-label={channel.label} /></div>; })}
          <small>{text('สัดส่วนตามจำนวนออเดอร์', 'Share by order count')}</small>
        </section>
      </div>
      <section className="pos-overview-recent"><div className="pos-overview-recent-head"><h2>{text('ออเดอร์ล่าสุด', 'Recent orders')}</h2><button type="button" className="secondary" onClick={onOpenOrders}>{text('เปิดศูนย์ออเดอร์', 'Open order center')}</button></div>
        {view.recent.length ? <table><thead><tr><th>{text('ออเดอร์', 'Order')}</th><th>{text('ช่องทาง', 'Channel')}</th><th>{text('สถานะ', 'Status')}</th><th>{text('ยอดรวม', 'Total')}</th><th>{text('เวลา', 'Time')}</th></tr></thead><tbody>{view.recent.map(order => <tr key={order.id}><td>#{order.id.slice(0, 8)}</td><td>{channels.find(c => c.key === order.channel)!.label}</td><td>{statusLabel(order.status, order.fulfillmentStatus)}</td><td>{formatMoney(order.total)}</td><td>{shopTime(order.createdAt, language)}</td></tr>)}</tbody></table> : <p className="notice">{text('ยังไม่มีออเดอร์วันนี้', 'No orders today yet.')}</p>}
      </section>
    </>}
  </main>;
}
