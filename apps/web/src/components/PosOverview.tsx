import React from 'react';
import { formatMoney } from '../lib/money';
import type { PrivateOrder } from '../lib/table';
import { channelOf, hourlyBuckets, isToday, shopTime, sumSingleDenomination, todayMayBeTruncated, type Channel } from '../lib/pos-overview';
import '../styles/pos-overview.css';

const inProgress = (order: PrivateOrder) => order.status === 'PAID' && !!order.fulfillment && order.fulfillment.status !== 'COLLECTED';

export default function PosOverview({ orders, ready, failed, language, now = new Date(), onOpenOrders }: { orders: PrivateOrder[]; ready: boolean; failed: boolean; language: 'th' | 'en'; now?: Date; onOpenOrders: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const today = orders.filter(order => isToday(order, now));
  const paid = today.filter(order => order.status === 'PAID');
  const sales = sumSingleDenomination(paid);
  const buckets = hourlyBuckets(paid);
  const peak = Math.max(1, ...buckets.map(b => b.count));
  const channels: { key: Channel; label: string }[] = [
    { key: 'store', label: text('หน้าร้าน / โต๊ะ', 'In store / table') },
    { key: 'delivery', label: text('แอพจัดส่ง', 'App delivery') },
    { key: 'pickup', label: text('รับเอง / นำกลับ', 'Pickup / takeaway') },
  ];
  const statusLabel = (order: PrivateOrder) => order.status === 'PAID'
    ? (order.fulfillment ? { RECEIVED: text('รับออเดอร์แล้ว', 'Received'), PREPARING: text('กำลังเตรียม', 'Preparing'), READY: text('พร้อมรับ', 'Ready'), COLLECTED: text('รับแล้ว', 'Collected') }[order.fulfillment.status] : text('ชำระแล้ว', 'Paid'))
    : order.status === 'EXPIRED' ? text('หมดอายุ', 'Expired') : order.status === 'RECOVERY' ? text('ต้องตรวจสอบ', 'Needs review') : text('รอชำระเงิน', 'Awaiting payment');
  const recent = [...today].sort((a, b) => Date.parse(b.createdAt!) - Date.parse(a.createdAt!)).slice(0, 5);
  return <main className="pos-overview" aria-label={text('ภาพรวมร้าน', 'Shop overview')}>
    <div className="section-heading"><div><p className="eyebrow">{text('วันนี้', 'TODAY')}</p><h1>{text('ภาพรวมร้าน', 'Shop overview')}</h1><p className="pos-overview-sub">{text('สรุปจากออเดอร์ที่โหลดอยู่ในระบบ ไม่ใช่รายงานปิดรอบ', 'Summarised from the orders currently loaded. This is not a closed-shift report.')}</p></div></div>
    {ready && todayMayBeTruncated(orders, now) && <p className="notice" role="status">{text('ระบบส่งออเดอร์ล่าสุดสูงสุด 200 รายการ ตัวเลขวันนี้อาจไม่ครบ ดูยอดเต็มในรายงาน', 'The server returns only the newest 200 orders, so today\'s figures may be incomplete. Use Reports for the full total.')}</p>}
    {failed && <p className="error" role="status">{text('โหลดออเดอร์ไม่สำเร็จ ตัวเลขอาจไม่ล่าสุด', 'Orders could not be loaded. Figures may be stale.')}</p>}
    {!ready ? <p className="notice" role="status">{text('กำลังโหลดภาพรวม…', 'Loading overview…')}</p> : <>
      <section className="pos-overview-kpis" aria-label={text('ตัวเลขสำคัญ', 'Key figures')}>
        <article><small>{text('ยอดขายวันนี้', 'Sales today')}</small><strong>{sales === null ? '—' : sales === 'mixed' ? text('หลายสกุลเงิน', 'Mixed currencies') : formatMoney(sales)}</strong><span>{sales === 'mixed' ? text('ไม่รวมยอดข้ามสกุลเงิน', 'Not totalled across denominations') : text(`${paid.length} ออเดอร์ที่ชำระแล้ว`, `${paid.length} paid orders`)}</span></article>
        <article><small>{text('ออเดอร์ทั้งหมดวันนี้', 'Orders today')}</small><strong>{today.length}</strong><span>{text('รวมที่ยังไม่ชำระ', 'Including unpaid')}</span></article>
        <article><small>{text('กำลังดำเนินการ', 'In progress')}</small><strong>{today.filter(inProgress).length}</strong><span>{text('ชำระแล้ว ยังไม่ส่งมอบ', 'Paid, not yet collected')}</span></article>
        <article><small>{text('ยอดสุทธิร้าน', 'Net after fees')}</small><strong>—</strong><span>{text('เซิร์ฟเวอร์ยังไม่ส่งยอดหลังหักค่าธรรมเนียม', 'The server does not provide fee-adjusted totals yet')}</span></article>
      </section>
      <div className="pos-overview-grid">
        <section aria-label={text('ออเดอร์ชำระแล้วรายชั่วโมง', 'Paid orders by hour')}><h2>{text('ออเดอร์ที่ชำระแล้วรายชั่วโมง', 'Paid orders by hour')}</h2>
          {buckets.length ? <div className="pos-overview-chart" role="img" aria-label={buckets.map(b => `${b.hour}:00 ${b.count}`).join(', ')}>{buckets.map(b => <div key={b.hour}><i style={{ height: `${Math.round(b.count / peak * 100)}%` }} data-peak={b.count === peak ? 'true' : undefined} /><small>{String(b.hour).padStart(2, '0')}:00</small></div>)}</div> : <p className="notice">{text('ยังไม่มีออเดอร์ที่ชำระแล้ววันนี้', 'No paid orders today yet.')}</p>}
        </section>
        <section aria-label={text('ช่องทางการขาย', 'Sales channels')}><h2>{text('ช่องทางการขาย', 'Sales channels')}</h2>
          {channels.map(channel => { const count = today.filter(o => channelOf(o) === channel.key).length, share = today.length ? Math.round(count / today.length * 100) : 0; return <div className="pos-overview-channel" key={channel.key}><span>{channel.label}<b>{share}%</b></span><progress max={100} value={share} aria-label={channel.label} /></div>; })}
          <small>{text('สัดส่วนตามจำนวนออเดอร์', 'Share by order count')}</small>
        </section>
      </div>
      <section className="pos-overview-recent"><div className="pos-overview-recent-head"><h2>{text('ออเดอร์ล่าสุด', 'Recent orders')}</h2><button type="button" className="secondary" onClick={onOpenOrders}>{text('เปิดศูนย์ออเดอร์', 'Open order center')}</button></div>
        {recent.length ? <table><thead><tr><th>{text('ออเดอร์', 'Order')}</th><th>{text('ช่องทาง', 'Channel')}</th><th>{text('สถานะ', 'Status')}</th><th>{text('ยอดรวม', 'Total')}</th><th>{text('เวลา', 'Time')}</th></tr></thead><tbody>{recent.map(order => <tr key={order.id}><td>#{order.id.slice(0, 8)}</td><td>{channels.find(c => c.key === channelOf(order))!.label}</td><td>{statusLabel(order)}</td><td>{formatMoney(order.pricing.total)}</td><td>{shopTime(order.createdAt!, language)}</td></tr>)}</tbody></table> : <p className="notice">{text('ยังไม่มีออเดอร์วันนี้', 'No orders today yet.')}</p>}
      </section>
    </>}
  </main>;
}
