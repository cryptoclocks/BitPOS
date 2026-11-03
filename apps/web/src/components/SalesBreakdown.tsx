import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import '../styles/sales-breakdown.css';

// M07: where the paid sales came from (channel, payment method, category) and what did NOT become revenue. Everything is read from the server
// for the same paid window as the totals; each currency has its own table and nothing is summed across currencies.
interface Tally { currency: string; decimals: number; orders: number; totalMinor: string }
interface Breakdown {
  from: string; to: string; timeZone: string; totals: Tally[];
  channels: (Tally & { channel: string })[]; methods: (Tally & { method: string })[];
  categories: { category: string; currency: string; decimals: number; units: number; totalMinor: string }[];
  unallocated: { currency: string; decimals: number; totalMinor: string }[];
  pipeline: { state: 'open' | 'late_settlement' | 'voided' | 'expired' | 'cash_voided'; currency: string; decimals: number; count: number; totalMinor: string }[];
}
export interface BillsPreset { state: 'paid' | 'all'; source: 'all' | 'store' | 'online' | 'cash'; from: string; to: string; n: number }
const storeKinds = ['register', 'device', 'legacy_counter'];
export default function SalesBreakdown({ token, language, from, to, onOpenBills }: { token: string; language: 'th' | 'en'; from: string; to: string; onOpenBills?: (preset: BillsPreset) => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [data, setData] = useState<Breakdown>(); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setState('loading'); setError('');
    api<Breakdown>(`/reports/breakdown?from=${from}&to=${to}`, undefined, token)
      .then(next => { if (active) { setData(next); setState('ready'); } })
      .catch(failure => { if (active) { setData(undefined); setError(errorMessage(failure)); setState('error'); } });
    return () => { active = false; };
  }, [token, from, to, attempt]);
  const money = (currency: string, decimals: number, amountMinor: string) => formatMoney({ currency, decimals, amountMinor } as never);
  const channelLabel = (kind: string) => ({ register: text('จุดขาย', 'Register'), device: text('POSClock', 'POSClock'), online: text('แอป', 'App'), cash_counter: text('เงินสด', 'Cash'), legacy_counter: text('เดิม', 'Legacy') } as Record<string, string>)[kind] ?? kind;
  const methodLabel = (kind: string) => kind === 'CASH' ? text('เงินสด', 'Cash') : kind === 'UNSPECIFIED' ? text('ไม่ระบุ', 'Unspecified') : kind;
  const stateLabel = (kind: string) => ({ open: text('ยังไม่ชำระ (รอจ่าย/กำลังยืนยัน)', 'Not paid yet (awaiting or confirming)'), late_settlement: text('ชำระหลังหมดเวลา — รอตรวจสอบ', 'Paid after expiry — needs review'), voided: text('ยกเลิกโดยร้าน', 'Voided by the shop'), expired: text('หมดเวลา', 'Expired'), cash_voided: text('ยกเลิกบิลเงินสด', 'Voided cash sale') } as Record<string, string>)[kind] ?? kind;
  const drill = (preset: Omit<BillsPreset, 'n' | 'from' | 'to'>) => onOpenBills?.({ ...preset, from, to, n: Date.now() });
  const currencies = [...new Set((data?.totals ?? []).map(t => `${t.currency}\u0000${t.decimals}`))].map(k => { const [currency, decimals] = k.split('\u0000'); return { currency: currency!, decimals: Number(decimals) }; });
  if (state === 'loading') return <section className="reports-card" aria-busy="true"><p className="notice" role="status">{text('กำลังโหลดการแจกแจงยอดขาย…', 'Loading the sales breakdown…')}</p></section>;
  if (state === 'error') return <section className="reports-card"><p className="notice" role="alert">{text('โหลดการแจกแจงยอดขายไม่สำเร็จ: ', 'Could not load the breakdown: ')}{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>{text('ลองอีกครั้ง', 'Try again')}</button></section>;
  if (!data) return null;
  const empty = !data.totals.length && !data.pipeline.length;
  return <section className="reports-card breakdown" aria-label={text('การแจกแจงยอดขาย', 'Sales breakdown')} data-breakdown="ready">
    <h2>{text('แจกแจงยอดขาย', 'Sales breakdown')}</h2>
    <p className="reports-sub">{text(`ช่วงเดียวกับยอดรวม (วันที่ชำระ ตามเวลา ${data.timeZone}) ตัวเลขทุกตารางรวมกันได้เท่ากับยอดรวมของสกุลนั้น และไม่รวมข้ามสกุลเงิน`, `Same window as the totals (paid date, ${data.timeZone}). Every table adds up to that currency’s total; currencies are never combined.`)}</p>
    {empty && <p className="notice" role="status">{text('ไม่มีการขายหรือบิลค้างในช่วงนี้', 'No sales or pending bills in this range.')}</p>}
    {currencies.map(({ currency, decimals }) => {
      const total = data.totals.find(t => t.currency === currency && t.decimals === decimals)!;
      const own = <T extends { currency: string; decimals: number }>(rows: T[]) => rows.filter(r => r.currency === currency && r.decimals === decimals);
      const unalloc = own(data.unallocated)[0];
      return <article className="breakdown-currency" key={currency + decimals} data-currency={currency}>
        <div className="breakdown-head"><h3>{currency}</h3><strong>{money(currency, decimals, total.totalMinor)}</strong><small>{text(`${total.orders} บิลที่ชำระแล้ว`, `${total.orders} paid bills`)}</small></div>
        <div className="breakdown-grid">
          <div><h4>{text('ช่องทางขาย', 'Channel')}</h4><table><tbody>{own(data.channels).map(row => <tr key={row.channel}><th scope="row">{channelLabel(row.channel)}</th><td>{row.orders}</td><td>{money(currency, decimals, row.totalMinor)}</td><td>{onOpenBills && <button type="button" className="breakdown-drill" onClick={() => drill({ state: 'paid', source: row.channel === 'cash_counter' ? 'cash' : row.channel === 'online' ? 'online' : storeKinds.includes(row.channel) ? 'store' : 'all' })}>{text('ดูบิล', 'View bills')}</button>}</td></tr>)}</tbody></table></div>
          <div><h4>{text('วิธีชำระเงิน', 'Payment method')}</h4><table><tbody>{own(data.methods).map(row => <tr key={row.method}><th scope="row">{methodLabel(row.method)}</th><td>{row.orders}</td><td>{money(currency, decimals, row.totalMinor)}</td></tr>)}</tbody></table></div>
          <div><h4>{text('หมวดสินค้า', 'Category')}</h4><table><tbody>{own(data.categories).map(row => <tr key={row.category}><th scope="row">{row.category || text('ไม่มีหมวด', 'No category')}</th><td>{text(`${row.units} ชิ้น`, `${row.units} units`)}</td><td>{money(currency, decimals, row.totalMinor)}</td></tr>)}{unalloc && <tr className="breakdown-unallocated"><th scope="row">{text('ส่วนลด/ภาษี/ปัดเศษ/ไม่มีรายการสินค้า', 'Discounts, tax, rounding, no line items')}</th><td /><td>{money(currency, decimals, unalloc.totalMinor)}</td></tr>}</tbody></table></div>
        </div>
      </article>;
    })}
    <article className="breakdown-pipeline" data-breakdown="not-revenue">
      <h3>{text('ไม่นับเป็นยอดขาย', 'Not counted as sales')}</h3>
      <p className="reports-sub">{text('บิลที่สร้างในช่วงนี้แต่ยังไม่ได้รับเงิน หรือถูกยกเลิก ดูแยกไว้เพื่อไม่ให้ยอดขายสูงเกินจริง', 'Bills created in this range that have not been paid or were cancelled. Kept apart so sales are never overstated.')}</p>
      {data.pipeline.length ? <table><tbody>{data.pipeline.map((row, index) => <tr key={row.state + row.currency + index}><th scope="row">{stateLabel(row.state)}</th><td>{row.count}</td><td>{row.currency ? money(row.currency, row.decimals, row.totalMinor) : '—'}</td></tr>)}</tbody></table> : <p className="notice">{text('ไม่มี', 'None')}</p>}
      {onOpenBills && <button type="button" className="breakdown-drill" onClick={() => drill({ state: 'all', source: 'all' })}>{text('ดูบิลทุกสถานะ', 'View bills in every state')}</button>}
    </article>
  </section>;
}
