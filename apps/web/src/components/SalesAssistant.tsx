import React, { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import '../styles/sales-breakdown.css';
import '../styles/sales-assistant.css';

// M11: owner-only, read-only assistant. A question is only ever turned into one of the fixed reports below; the figures shown are that report's rows
// from the server, with the window, time zone and currency. Nothing here changes data, so there is nothing to confirm. If the AI provider is not
// available the report pickers still work.
const metrics = ['sales_total', 'sales_by_channel', 'sales_by_method', 'sales_by_category', 'top_products', 'not_revenue'] as const;
const periods = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month'] as const;
type Metric = typeof metrics[number]; type Period = typeof periods[number];
interface Row { key: string; label: string; currency: string; decimals: number; count: number; totalMinor: string; previous: { count: number; totalMinor: string } | null; deltaMinor: string | null }
interface Evidence { metric: Metric; period: Period; from: string; to: string; timeZone: string; compare: { from: string; to: string } | null; countKind: 'bills' | 'units'; note: string | null; rows: Row[]; generatedAt: string }
type Answer = { status: 'answered'; source: 'preset' | 'provider'; interpretation: { metric: Metric; period: Period; compare: boolean }; evidence: Evidence } | { status: 'unsupported' } | { status: 'unavailable'; code: string };
export default function SalesAssistant({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [metric, setMetric] = useState<Metric>('sales_total'); const [period, setPeriod] = useState<Period>('last_7_days'); const [compare, setCompare] = useState(false); const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer>(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const metricLabel: Record<Metric, string> = { sales_total: text('ยอดขายรวม', 'Total sales'), sales_by_channel: text('ยอดขายตามช่องทาง', 'Sales by channel'), sales_by_method: text('ยอดขายตามวิธีชำระเงิน', 'Sales by payment method'), sales_by_category: text('ยอดขายตามหมวดสินค้า', 'Sales by category'), top_products: text('สินค้าขายดี', 'Top products'), not_revenue: text('บิลที่ไม่นับเป็นยอดขาย', 'Bills not counted as sales') };
  const periodLabel: Record<Period, string> = { today: text('วันนี้', 'Today'), yesterday: text('เมื่อวาน', 'Yesterday'), last_7_days: text('7 วันล่าสุด', 'Last 7 days'), last_30_days: text('30 วันล่าสุด', 'Last 30 days'), this_month: text('เดือนนี้', 'This month'), last_month: text('เดือนที่แล้ว', 'Last month') };
  const keyLabel = (e: Evidence, r: Row) => {
    const channel: Record<string, string> = { register: text('จุดขาย', 'Register'), device: 'POSClock', online: text('แอป', 'App'), cash_counter: text('เงินสด', 'Cash'), legacy_counter: text('เดิม', 'Legacy') };
    const state: Record<string, string> = { open: text('ยังไม่ชำระ', 'Not paid yet'), late_settlement: text('ชำระหลังหมดเวลา', 'Paid after expiry'), voided: text('ยกเลิกโดยร้าน', 'Voided by the shop'), expired: text('หมดเวลา', 'Expired'), cash_voided: text('ยกเลิกบิลเงินสด', 'Voided cash sale') };
    if (e.metric === 'sales_total') return text('รวม', 'Total');
    if (e.metric === 'sales_by_channel') return channel[r.key] ?? r.key;
    if (e.metric === 'sales_by_method') return r.key === 'CASH' ? text('เงินสด', 'Cash') : r.key === 'UNSPECIFIED' ? text('ไม่ระบุ', 'Unspecified') : r.key;
    if (e.metric === 'sales_by_category') return r.key === '__unallocated' ? text('ส่วนลด/ภาษี/ปัดเศษ/ไม่มีรายการสินค้า', 'Discounts, tax, rounding, no line items') : r.key || text('ไม่มีหมวด', 'No category');
    if (e.metric === 'not_revenue') return state[r.key] ?? r.key;
    return r.label;
  };
  async function run(body: unknown) {
    setBusy(true); setError(''); setAnswer(undefined);
    try { setAnswer(await api<Answer>('/assistant/ask', body, token)); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  const money = (r: { currency: string; decimals: number }, v: string) => formatMoney({ currency: r.currency, decimals: r.decimals, amountMinor: v } as never);
  const delta = (r: { currency: string; decimals: number }, v: string) => { const m = money(r, v); return BigInt(v) > 0n ? m.replace(/^(\S+ )/, '$1+') : m; };
  const e = answer?.status === 'answered' ? answer.evidence : undefined;
  const currencies = e ? [...new Set(e.rows.map(r => `${r.currency}\u0000${r.decimals}`))].map(k => { const [c, d] = k.split('\u0000'); return { currency: c!, decimals: Number(d) }; }) : [];
  const noteText = (n: string | null) => n === 'line_revenue_before_discounts' ? text('ยอดต่อสินค้าคิดจากราคาต่อหน่วย × จำนวน ก่อนส่วนลด จึงอาจไม่เท่ายอดบิล', 'Per-product revenue is unit price × quantity before discounts, so it can differ from the bill totals.') : n === 'unallocated_row_is_discounts_tax_rounding' ? text('แถวที่เหลือคือส่วนต่างจากส่วนลด ภาษี และการปัดเศษ', 'The remaining row is the difference from discounts, tax and rounding.') : n === 'not_counted_as_sales' ? text('บิลเหล่านี้ไม่นับเป็นยอดขาย', 'These bills are not counted as sales.') : '';
  return <section className="reports-card sales-assistant" aria-label={text('ผู้ช่วยวิเคราะห์ยอดขาย', 'Sales assistant')} data-assistant="ready">
    <h2>{text('ผู้ช่วยวิเคราะห์ยอดขาย', 'Sales assistant')}</h2>
    <p className="reports-sub">{text('อ่านอย่างเดียว ไม่เปลี่ยนข้อมูลใด ๆ AI ทำได้แค่เลือกรายงานที่ตายตัวด้านล่างให้ตรงกับคำถาม ตัวเลขทั้งหมดมาจากการคำนวณของเซิร์ฟเวอร์ ไม่ได้มาจากข้อความของ AI', 'Read-only: it changes nothing. The AI can only pick one of the fixed reports below for your question; every figure comes from the server’s own calculation, not from the AI’s text.')}</p>
    <form className="assistant-form" onSubmit={ev => { ev.preventDefault(); if (question.trim().length >= 2) void run({ question: question.trim() }); }}>
      <label>{text('ถามเป็นประโยค (ใช้ AI ตีความ)', 'Ask in a sentence (the AI picks the report)')}<input value={question} maxLength={300} placeholder={text('เช่น เมื่อวานช่องทางไหนขายดีที่สุด', 'e.g. which channel sold best yesterday')} onChange={ev => setQuestion(ev.target.value)} /></label>
      <button type="submit" disabled={busy || question.trim().length < 2}>{text('ถาม', 'Ask')}</button>
    </form>
    <form className="assistant-form" onSubmit={ev => { ev.preventDefault(); void run({ query: { metric, period, compare } }); }}>
      <label>{text('รายงาน', 'Report')}<select value={metric} onChange={ev => setMetric(ev.target.value as Metric)}>{metrics.map(m => <option key={m} value={m}>{metricLabel[m]}</option>)}</select></label>
      <label>{text('ช่วงเวลา', 'Period')}<select value={period} onChange={ev => setPeriod(ev.target.value as Period)}>{periods.map(p => <option key={p} value={p}>{periodLabel[p]}</option>)}</select></label>
      <label className="assistant-check"><input type="checkbox" checked={compare} onChange={ev => setCompare(ev.target.checked)} />{text('เทียบกับช่วงก่อนหน้า', 'Compare with the previous period')}</label>
      <button type="submit" className="secondary" disabled={busy}>{text('ดูรายงาน (ไม่ใช้ AI)', 'Show report (no AI)')}</button>
    </form>
    {busy && <p className="notice" role="status" aria-busy="true">{text('กำลังคำนวณ…', 'Working…')}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {answer?.status === 'unavailable' && <p className="notice" role="alert">{text('ตอนนี้ใช้ AI ตีความคำถามไม่ได้ (', 'The AI cannot read your question right now (')}{answer.code}{text(') เลือกรายงานและช่วงเวลาจากรายการด้านบนได้เลย', '). Pick a report and period above instead.')}</p>}
    {answer?.status === 'unsupported' && <p className="notice" role="status">{text('คำถามนี้ไม่อยู่ในรายงานที่ผู้ช่วยตอบได้ ลองเลือกจากรายการ: ', 'That question is not covered by a report the assistant can run. Pick one from the list: ')}{metrics.map(m => metricLabel[m]).join(' · ')}</p>}
    {answer?.status === 'answered' && e && <article className="assistant-answer" aria-live="polite">
      <h3>{metricLabel[e.metric]} · {periodLabel[e.period]}{answer.interpretation.compare ? ` · ${text('เทียบช่วงก่อน', 'vs previous')}` : ''}</h3>
      <p className="reports-sub">{answer.source === 'provider' ? text('AI ตีความคำถามเป็นรายงานนี้ — ถ้าไม่ตรง ให้เลือกเองจากรายการด้านบน', 'The AI read your question as this report. If that is wrong, pick one above.') : text('รายงานที่คุณเลือกเอง ไม่ได้ใช้ AI', 'The report you picked yourself; no AI used.')}</p>
      {!e.rows.length && <p className="notice" role="status">{text('ไม่มีข้อมูลในช่วงนี้', 'No data in this range.')}</p>}
      {currencies.map(c => <div key={c.currency + c.decimals} className="assistant-table" data-currency={c.currency}>
        <h4>{c.currency}</h4>
        <div className="assistant-scroll"><table><thead><tr><th>{text('รายการ', 'Item')}</th><th>{e.countKind === 'units' ? text('ชิ้น', 'Units') : text('บิล', 'Bills')}</th><th>{text('ยอด', 'Amount')}</th>{e.compare && <th>{text('ช่วงก่อน', 'Previous')}</th>}{e.compare && <th>{text('ต่าง', 'Change')}</th>}</tr></thead>
          <tbody>{e.rows.filter(r => r.currency === c.currency && r.decimals === c.decimals).map(r => <tr key={r.key + r.currency}><th scope="row">{keyLabel(e, r)}</th><td>{r.count}</td><td>{money(r, r.totalMinor)}</td>{e.compare && <td>{r.previous ? money(r, r.previous.totalMinor) : '—'}</td>}{e.compare && <td>{r.deltaMinor !== null ? delta(r, r.deltaMinor) : '—'}</td>}</tr>)}</tbody></table></div>
      </div>)}
      {noteText(e.note) && <p className="reports-sub">{noteText(e.note)}</p>}
      <p className="assistant-evidence">{text('หลักฐาน: ', 'Evidence: ')}{e.from === e.to ? e.from : `${e.from} → ${e.to}`} ({e.timeZone}){e.compare ? ` · ${text('ช่วงก่อน', 'previous')} ${e.compare.from === e.compare.to ? e.compare.from : `${e.compare.from} → ${e.compare.to}`}` : ''} · {text('คำนวณโดยเซิร์ฟเวอร์เมื่อ', 'computed by the server at')} {new Date(e.generatedAt).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB')}</p>
    </article>}
  </section>;
}
