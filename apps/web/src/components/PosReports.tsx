import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import { salesSummary } from '../lib/sales-summary';
import type { PrivateOrder } from '../lib/table';
import type { Product } from '../lib/menu';
import { channelOf, hourlyBuckets, sumSingleDenomination } from '../lib/pos-overview';
import { dailyTotals, inRange, ordersCsv, statusCounts, topProducts } from '../lib/pos-reports';
import '../styles/pos-reports.css';

type View = 'daily' | 'period' | 'analytics' | 'top' | 'receive' | 'payouts' | 'export';
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Every figure is computed from the orders the POS already loaded (a recent window,
// not the full history) and says so. Nothing here is a closed-shift or accounting report.
interface SalesGroup { currency: string; decimals: number; sourceKind: string; orders: number; totalMinor: string }
interface ReceiveMove { id: string; productId: string; kind: 'RECEIVE' | 'ADJUST'; delta: number; reason: string; reference: string; createdAt: string }
interface SalesReport { from: string; to: string; timeZone: string; days: { day: string; groups: SalesGroup[] }[]; excludedOrders: number }
export default function PosReports({ orders, ready, failed, language, token, products = [] }: { orders: PrivateOrder[]; ready: boolean; failed: boolean; language: 'th' | 'en'; token?: string; products?: Product[] }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [view, setView] = useState<View>('daily');
  const [range, setRange] = useState({ from: localDay(), to: localDay() });
  const scoped = inRange(orders, range);
  const [server, setServer] = useState<SalesReport>(); const [serverState, setServerState] = useState<'idle' | 'loading' | 'error'>('idle'); const [serverError, setServerError] = useState('');
  useEffect(() => {
    if (!token || (view !== 'daily' && view !== 'period')) return;
    let active = true; setServerState('loading'); setServerError('');
    api<SalesReport>(`/reports/sales?from=${range.from}&to=${range.to}`, undefined, token).then(next => { if (active) { setServer(next); setServerState('idle'); } }).catch(error => { if (active) { setServer(undefined); setServerError(errorMessage(error)); setServerState('error'); } });
    return () => { active = false; };
  }, [token, view, range.from, range.to]);
  const [receipts, setReceipts] = useState<ReceiveMove[]>([]); const [receiptState, setReceiptState] = useState<'idle' | 'loading' | 'error'>('idle'); const [receiptError, setReceiptError] = useState(''); const [receiptMore, setReceiptMore] = useState(false);
  useEffect(() => {
    if (!token || view !== 'receive') return;
    let active = true; setReceiptState('loading'); setReceiptError(''); setReceiptMore(false);
    const first = new Date(`${range.from}T00:00:00`).getTime(), last = new Date(`${range.to}T23:59:59.999`).getTime();
    (async () => {
      const found: ReceiveMove[] = []; let cursor = ''; let pages = 0; let more = false;
      while (pages < 20) {
        const page = await api<{ movements: ReceiveMove[]; nextCursor: string | null }>(`/inventory/movements${cursor ? `?cursor=${cursor}` : ''}`, undefined, token);
        pages++;
        for (const move of page.movements) { const at = new Date(move.createdAt).getTime(); if (move.kind === 'RECEIVE' && at >= first && at <= last) found.push(move); }
        const oldest = page.movements[page.movements.length - 1];
        if (!page.nextCursor || !oldest || new Date(oldest.createdAt).getTime() < first) break;
        cursor = page.nextCursor; if (pages === 20) more = true;
      }
      if (active) { setReceipts(found); setReceiptMore(more); setReceiptState('idle'); }
    })().catch(error => { if (active) { setReceipts([]); setReceiptError(errorMessage(error)); setReceiptState('error'); } });
    return () => { active = false; };
  }, [token, view, range.from, range.to]);
  const productName = (id: string) => { const p = products.find(item => item.id === id); return p ? (language === 'th' ? p.name : p.nameEn) : id.slice(0, 8); };
  const serverView = !!server && (view === 'daily' || view === 'period');
  const sourceLabel = (kind: string) => ({ register: text('จุดขาย', 'Register'), device: text('POSClock', 'POSClock'), online: text('แอป', 'App'), legacy_counter: text('เดิม', 'Legacy') } as Record<string, string>)[kind] ?? kind;
  const serverMoney = (g: SalesGroup) => formatMoney({ currency: g.currency, decimals: g.decimals, amountMinor: g.totalMinor } as never);
  // KPI cards and channel shares come from the same server rows; see lib/sales-summary.ts for the single-currency rule.
  const raw = salesSummary(server?.days.flatMap(d => d.groups) ?? []);
  const summaryMoney = (amountMinor: bigint) => raw ? formatMoney({ currency: raw.currency, decimals: raw.decimals, amountMinor: amountMinor.toString() } as never) : '';
  const summary = raw && { total: summaryMoney(raw.totalMinor), orders: raw.orders, average: raw.orders > 0 ? summaryMoney(raw.averageMinor) : '—', channels: raw.channels };
  const paid = scoped.filter(order => order.status === 'PAID');
  const total = sumSingleDenomination(paid);
  const money = (value: ReturnType<typeof sumSingleDenomination>) => value === null ? '—' : value === 'mixed' ? text('หลายสกุลเงิน', 'Mixed currencies') : formatMoney(value);
  const views: [View, string][] = [['daily', text('รายวัน', 'Daily')], ['period', text('ตามช่วงเวลา', 'By period')], ['analytics', text('วิเคราะห์', 'Analytics')], ['top', text('ขายดี', 'Top products')], ['receive', text('รับเข้าสินค้า', 'Stock received')], ['payouts', text('ยอดสุทธิและรอบโอน', 'Net & payouts')], ['export', text('ส่งออก', 'Export')]];
  const statusLabel: Record<string, string> = { PAID: text('ชำระแล้ว', 'Paid'), AWAITING_PAYMENT: text('รอชำระเงิน', 'Awaiting payment'), AWAITING_WALLET: text('รอกระเป๋า', 'Awaiting wallet'), CONFIRMING: text('กำลังยืนยัน', 'Confirming'), EXPIRED: text('หมดอายุ', 'Expired'), RECOVERY: text('ต้องตรวจสอบ', 'Needs review') };
  function download() {
    const blob = new Blob(['﻿' + ordersCsv(scoped)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `bitpos-orders-${range.from}_${range.to}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const buckets = hourlyBuckets(paid), peak = Math.max(1, ...buckets.map(b => b.count));
  const top = topProducts(scoped), topMax = Math.max(1, ...top.map(t => t.qty));
  return <main className="pos-reports" aria-label={text('รายงาน', 'Reports')}>
    <div className="section-heading"><div><p className="eyebrow">{text('รายงาน', 'REPORTS')}</p><h1>{text('รายงานการขาย', 'Sales reports')}</h1><p className="reports-sub">{serverView ? text('ยอดจากเซิร์ฟเวอร์ตามวันที่เลือก ไม่ใช่รายงานบัญชี', 'Totals from the server for the selected dates. This is not an accounting report.') : text('คำนวณจากออเดอร์ล่าสุดที่โหลดอยู่ ไม่ใช่ประวัติทั้งหมดหรือรายงานบัญชี', 'Calculated from the recent orders currently loaded, not the full history or an accounting report.')}</p></div></div>
    <div className="reports-views" role="group" aria-label={text('มุมมองรายงาน', 'Report views')}>{views.map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
    {view !== 'payouts' && <div className="reports-range"><label>{text('ตั้งแต่', 'From')}<input type="date" value={range.from} max={range.to} onChange={event => event.target.value && setRange({ ...range, from: event.target.value })} /></label><label>{text('ถึง', 'To')}<input type="date" value={range.to} min={range.from} onChange={event => event.target.value && setRange({ ...range, to: event.target.value })} /></label><small>{serverView ? text(`วันที่ตามเวลาร้าน (${server!.timeZone})`, `Dates use the shop’s time (${server!.timeZone})`) : text('วันที่ตามเวลาเครื่องนี้', 'Dates use this device’s time zone')}</small></div>}
    {serverState === 'loading' && (view === 'daily' || view === 'period') && <p className="notice" role="status">{text('กำลังโหลดยอดจากเซิร์ฟเวอร์…', 'Loading server totals…')}</p>}
    {serverState === 'error' && (view === 'daily' || view === 'period') && <p className="notice" role="status">{text('ยังไม่ได้ยอดจากเซิร์ฟเวอร์ แสดงเฉพาะออเดอร์ล่าสุดที่โหลดอยู่', 'Server totals are unavailable, so only the recent loaded orders are shown.')} {serverError}</p>}
    {failed && <p className="error" role="status">{text('โหลดออเดอร์ไม่สำเร็จ ตัวเลขอาจไม่ล่าสุด', 'Orders could not be loaded. Figures may be stale.')}</p>}
    {!ready ? <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p> : view === 'receive' ? <section className="reports-card"><h2>{text('รายงานรับเข้าสินค้า', 'Stock received report')}</h2>{!token ? <p className="notice">{text('เฉพาะเจ้าของร้านและผู้จัดการ', 'Owner or manager only.')}</p> : receiptState === 'loading' ? <p className="notice" role="status">{text('กำลังโหลดรายการรับเข้า…', 'Loading stock received…')}</p> : receiptState === 'error' ? <p className="error" role="status">{text('โหลดรายการรับเข้าไม่สำเร็จ', 'Stock received could not be loaded.')} {receiptError}</p> : receipts.length ? <><p className="reports-sub">{text('จากบัญชีสต็อกฝั่งเซิร์ฟเวอร์ ไม่รวมการปรับสต็อก', 'From the server stock ledger. Adjustments are not included.')}</p>{receiptMore && <p className="notice" role="status">{text('แสดงเฉพาะรายการล่าสุดที่โหลดได้ ลดช่วงวันที่เพื่อดูให้ครบ', 'Showing the latest entries only. Narrow the date range to see all.')}</p>}<table className="catalog-table"><thead><tr><th>{text('เวลา', 'When')}</th><th>{text('สินค้า', 'Product')}</th><th>{text('จำนวน', 'Quantity')}</th><th>{text('เหตุผล', 'Reason')}</th></tr></thead><tbody>{receipts.map(move => <tr key={move.id}><td>{new Date(move.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')}</td><td>{productName(move.productId)}</td><td>+{move.delta}</td><td>{move.reason}{move.reference ? ` · ${move.reference}` : ''}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{text('รวมทั้งหมด', 'Total received')}</th><td colSpan={2}>{receipts.reduce((sum, move) => sum + move.delta, 0)}</td></tr></tfoot></table></> : <p className="notice">{text('ไม่มีรายการรับเข้าในช่วงนี้', 'No stock was received in this range.')}</p>}</section>
    : view === 'payouts' ? <section className="reports-card"><h2>{text('ยอดสุทธิและรอบโอน', 'Net sales & payout rounds')}</h2><p className="notice" role="status">{text('ยังไม่เปิดใช้งาน เซิร์ฟเวอร์ยังไม่ส่งค่าธรรมเนียม ส่วนลดที่หักจริง หรือรอบโอนของร้านค้า ตัวเลขยอดขายในหน้านี้จึงไม่ใช่ยอดที่จะได้รับ', 'Not available yet. The server does not provide merchant fees, applied deductions or payout rounds, so the sales figures here are not an amount you will receive.')}</p></section>
    : (view === 'daily' || view === 'period') && server ? <section className="reports-card" aria-label={text('ยอดขายจากเซิร์ฟเวอร์', 'Server sales totals')}>
      <p className="reports-sub">{text(`ยอดชำระแล้วจากเซิร์ฟเวอร์ ตลอดช่วงที่เลือก (${server.timeZone}) ก่อนหักคืนเงินและค่าธรรมเนียม ไม่รวมยอดข้ามสกุลเงิน`, `Paid totals from the server for the whole selected range (${server.timeZone}), before refunds and fees. Never added across currencies.`)}</p>
      {server.excludedOrders > 0 && <p className="notice" role="status">{text(`ไม่รวม ${server.excludedOrders} ออเดอร์เดิมที่ไม่มีข้อมูลราคา`, `${server.excludedOrders} older paid orders without price data are not included.`)}</p>}
      {summary && <><div className="reports-kpis reports-kpis-4"><article><small>{text('ยอดขายที่ชำระแล้ว', 'Paid sales')}</small><strong>{summary.total}</strong></article><article><small>{text('ออเดอร์ที่ชำระแล้ว', 'Paid orders')}</small><strong>{summary.orders}</strong></article><article><small>{text('เฉลี่ยต่อบิล', 'Average per bill')}</small><strong>{summary.average}</strong><span>{text('ปัดลงเป็นหน่วยเล็กสุด', 'Rounded down to the smallest unit')}</span></article><article><small>{text('ช่องทางที่มียอด', 'Active channels')}</small><strong>{summary.channels.length}</strong></article></div>
        <section className="channel-share" aria-label={text('สัดส่วนยอดขายตามช่องทาง', 'Sales share by channel')}><h3>{text('ช่องทางการขาย', 'Sales channels')}</h3>{summary.channels.map(c => <div className="channel-row" key={c.kind}><span>{sourceLabel(c.kind)}</span><div className="channel-bar" role="img" aria-label={`${sourceLabel(c.kind)} ${c.share}%`}><i style={{ width: `${c.share}%` }} /></div><b>{c.share}%</b></div>)}</section></>}
      {server.days.length ? <table><thead><tr><th>{text('วันที่', 'Date')}</th><th>{text('ช่องทาง', 'Source')}</th><th>{text('ออเดอร์ที่ชำระแล้ว', 'Paid orders')}</th><th>{text('ยอดชำระแล้ว', 'Paid total')}</th></tr></thead><tbody>{server.days.flatMap(day => day.groups.map((g, index) => <tr key={`${day.day}-${g.currency}-${g.decimals}-${g.sourceKind}`}><td>{index === 0 ? day.day : ''}</td><td>{sourceLabel(g.sourceKind)}</td><td>{g.orders}</td><td>{serverMoney(g)}</td></tr>))}</tbody></table> : <p className="notice">{text('ไม่มีออเดอร์ที่ชำระแล้วในช่วงนี้', 'No paid orders in this range.')}</p>}</section>
    : view === 'daily' || view === 'period' ? <section className="reports-card"><div className="reports-kpis"><article><small>{text('ยอดขายที่ชำระแล้ว', 'Paid sales')}</small><strong>{money(total)}</strong></article><article><small>{text('ออเดอร์ที่ชำระแล้ว', 'Paid orders')}</small><strong>{paid.length}</strong></article><article><small>{text('ออเดอร์ทั้งหมด', 'All orders')}</small><strong>{scoped.length}</strong></article></div>
      {dailyTotals(scoped).length ? <table><thead><tr><th>{text('วันที่', 'Date')}</th><th>{text('ออเดอร์', 'Orders')}</th><th>{text('ชำระแล้ว', 'Paid')}</th><th>{text('ยอดชำระแล้ว', 'Paid total')}</th></tr></thead><tbody>{dailyTotals(scoped).map(day => <tr key={day.day}><td>{day.day}</td><td>{day.orders}</td><td>{day.paid}</td><td>{money(day.total)}</td></tr>)}</tbody></table> : <p className="notice">{text('ไม่มีออเดอร์ในช่วงนี้', 'No orders in this range.')}</p>}</section>
    : view === 'analytics' ? <section className="reports-card"><h2>{text('ออเดอร์ที่ชำระแล้วรายชั่วโมง', 'Paid orders by hour')}</h2>{buckets.length ? <div className="reports-chart" role="img" aria-label={buckets.map(b => `${b.hour}:00 ${b.count}`).join(', ')}>{buckets.map(b => <div key={b.hour}><i style={{ height: `${Math.round(b.count / peak * 100)}%` }} /><small>{String(b.hour).padStart(2, '0')}</small></div>)}</div> : <p className="notice">{text('ยังไม่มีออเดอร์ที่ชำระแล้ว', 'No paid orders yet.')}</p>}
      <h2>{text('สถานะและช่องทาง', 'Status and channel')}</h2><ul className="reports-list">{Object.entries(statusCounts(scoped)).map(([status, count]) => <li key={status}><span>{statusLabel[status] ?? status}</span><b>{count}</b></li>)}{(['store', 'delivery', 'pickup'] as const).map(channel => <li key={channel}><span>{{ store: text('หน้าร้าน / โต๊ะ', 'In store / table'), delivery: text('แอพจัดส่ง', 'App delivery'), pickup: text('รับเอง / นำกลับ', 'Pickup / takeaway') }[channel]}</span><b>{scoped.filter(o => channelOf(o) === channel).length}</b></li>)}</ul></section>
    : view === 'top' ? <section className="reports-card"><h2>{text('สินค้าขายดี', 'Top products')}</h2><p className="reports-sub">{text('นับจำนวนชิ้นจากออเดอร์ที่ชำระแล้วเท่านั้น', 'Units from paid orders only.')}</p>{top.length ? <ol className="reports-top">{top.slice(0, 10).map(item => <li key={item.productId}><span>{language === 'th' ? item.name : item.nameEn}</span><progress max={topMax} value={item.qty} aria-label={item.nameEn} /><b>{item.qty}</b></li>)}</ol> : <p className="notice">{text('ยังไม่มีรายการขายในช่วงนี้', 'No sold items in this range.')}</p>}</section>
    : <section className="reports-card"><h2>{text('ส่งออกข้อมูล', 'Export')}</h2><p className="reports-sub">{text(`ไฟล์ CSV ของออเดอร์ ${scoped.length} รายการในช่วงที่เลือก สร้างบนเครื่องนี้จากข้อมูลที่โหลดอยู่ ไม่มีการอัปโหลด`, `A CSV of the ${scoped.length} orders in the selected range, built on this device from loaded data. Nothing is uploaded.`)}</p><button type="button" disabled={!scoped.length} onClick={download}>{text('ดาวน์โหลด CSV', 'Download CSV')}</button>{!scoped.length && <p className="notice">{text('ไม่มีออเดอร์ให้ส่งออก', 'No orders to export.')}</p>}</section>}
  </main>;
}
