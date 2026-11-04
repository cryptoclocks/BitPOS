import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import '../styles/sales-breakdown.css';
import '../styles/branch-comparison.css';

// M10: read-only comparison of the shops this sign-in owns or manages. It does not switch the working shop: the register, its open order and the
// device it talks to stay exactly as they are. Money is shown per currency; the aggregate only adds the same currency across shops.
interface Tally { currency: string; decimals: number; orders: number; totalMinor: string }
interface Shop { merchantId: string; name: string; role: 'owner' | 'manager'; current: boolean; timeZone: string | null; error: boolean; totals: Tally[]; channels: (Tally & { channel: string })[]; pipeline: { state: string; currency: string; decimals: number; count: number; totalMinor: string }[] }
interface Aggregate { currency: string; decimals: number; shops: number; orders: number; totalMinor: string }
interface Comparison { from: string; to: string; shops: Shop[]; aggregate: Aggregate[]; excludedShops: number; truncated: boolean; complete: boolean }
export default function BranchComparison({ token, language, from, to }: { token: string; language: 'th' | 'en'; from: string; to: string }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [data, setData] = useState<Comparison>(); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setState('loading'); setError(''); setData(undefined);
    api<Comparison>(`/branches/comparison?from=${from}&to=${to}`, undefined, token)
      .then(next => { if (active) { setData(next); setState('ready'); } })
      .catch(failure => { if (active) { setError(errorMessage(failure)); setState('error'); } });
    return () => { active = false; };
  }, [token, from, to, attempt]);
  const money = (t: { currency: string; decimals: number }, amountMinor: string) => formatMoney({ currency: t.currency, decimals: t.decimals, amountMinor } as never);
  const channelLabel = (kind: string) => ({ register: text('จุดขาย', 'Register'), device: 'POSClock', online: text('แอป', 'App'), cash_counter: text('เงินสด', 'Cash'), legacy_counter: text('เดิม', 'Legacy') } as Record<string, string>)[kind] ?? kind;
  const roleLabel = (r: Shop['role']) => r === 'owner' ? text('เจ้าของ', 'Owner') : text('ผู้จัดการ', 'Manager');
  const notRevenue = (s: Shop) => s.pipeline.reduce((n, p) => n + p.count, 0);
  if (state === 'loading') return <section className="reports-card" aria-busy="true"><p className="notice" role="status">{text('กำลังโหลดการเปรียบเทียบสาขา…', 'Loading the branch comparison…')}</p></section>;
  if (state === 'error' || !data) return <section className="reports-card"><p className="notice" role="alert">{text('โหลดการเปรียบเทียบสาขาไม่สำเร็จ: ', 'Could not load the branch comparison: ')}{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>{text('ลองอีกครั้ง', 'Try again')}</button></section>;
  const single = data.shops.length < 2;
  return <section className="reports-card breakdown branch-comparison" aria-label={text('เปรียบเทียบสาขา', 'Branch comparison')} data-branches="ready">
    <h2>{text('เปรียบเทียบสาขา', 'Branch comparison')}</h2>
    <p className="reports-sub">{text('ดูเฉพาะร้านที่บัญชีนี้เป็นเจ้าของหรือผู้จัดการ อ่านอย่างเดียว ไม่ได้สลับร้านที่ทำงานอยู่ ออเดอร์และเครื่องที่เปิดอยู่ไม่ถูกเปลี่ยน แต่ละร้านตัดวันตามเวลาของร้านนั้น ยอดรวมบวกเฉพาะสกุลเงินเดียวกัน', 'Only shops this account owns or manages. Read-only: it does not switch the shop you are working in, and the open order and device stay as they are. Each shop is cut on its own time zone; the aggregate only adds the same currency.')}</p>
    {!data.complete && <p className="notice" role="alert">{text('บางสาขาโหลดไม่สำเร็จ ยอดรวมด้านล่างจึงไม่ครบทุกสาขา', 'Some branches failed to load, so the aggregate below is partial.')}</p>}
    {data.truncated && <p className="notice" role="status">{text('แสดงเฉพาะ 25 ร้านแรก', 'Only the first 25 shops are shown.')}</p>}
    {single && <p className="notice" role="status">{text('บัญชีนี้เป็นเจ้าของหรือผู้จัดการร้านนี้ร้านเดียว การเปรียบเทียบจะแสดงเมื่อมีตั้งแต่สองร้านขึ้นไป', 'This account owns or manages only this shop. The comparison appears once there are two or more.')}</p>}
    {!single && <article className="breakdown-currency" data-branches="aggregate">
      <h3>{text('รวมทุกสาขาที่โหลดได้ (แยกตามสกุลเงิน)', 'All loaded branches (per currency)')}</h3>
      {data.aggregate.length ? <table><tbody>{data.aggregate.map(a => <tr key={a.currency + a.decimals}><th scope="row">{a.currency}</th><td>{text(`${a.shops} ร้าน · ${a.orders} บิล`, `${a.shops} ${a.shops === 1 ? 'shop' : 'shops'} · ${a.orders} ${a.orders === 1 ? 'bill' : 'bills'}`)}</td><td>{money(a, a.totalMinor)}</td></tr>)}</tbody></table> : <p className="notice">{text('ไม่มียอดขายในช่วงนี้', 'No sales in this range.')}</p>}
    </article>}
    <div className="branch-grid">{data.shops.map(s => <article className="breakdown-currency" key={s.merchantId} data-shop={s.merchantId} data-current={s.current ? 'true' : undefined}>
      <div className="breakdown-head"><h3>{s.name || text('(ไม่มีชื่อ)', '(no name)')}</h3>{s.current && <small className="branch-chip">{text('ร้านที่ทำงานอยู่', 'Working shop')}</small>}<small>{roleLabel(s.role)}{s.timeZone ? ` · ${s.timeZone}` : ''}</small></div>
      {s.error ? <p className="notice" role="alert">{text('โหลดร้านนี้ไม่สำเร็จ', 'This shop could not be loaded.')}</p> : <>
        {s.totals.length ? <table><tbody>{s.totals.map(t => <tr key={t.currency + t.decimals}><th scope="row">{t.currency}</th><td>{text(`${t.orders} บิล`, `${t.orders} ${t.orders === 1 ? 'bill' : 'bills'}`)}</td><td>{money(t, t.totalMinor)}</td></tr>)}</tbody></table> : <p className="notice">{text('ไม่มียอดขายในช่วงนี้', 'No sales in this range.')}</p>}
        {s.channels.length > 0 && <details><summary>{text('ช่องทางขาย', 'Channels')}</summary><table><tbody>{s.channels.map(c => <tr key={c.channel + c.currency + c.decimals}><th scope="row">{channelLabel(c.channel)} · {c.currency}</th><td>{c.orders}</td><td>{money(c, c.totalMinor)}</td></tr>)}</tbody></table></details>}
        {notRevenue(s) > 0 && <small>{text(`ไม่นับเป็นยอดขาย ${notRevenue(s)} บิล (ค้างชำระ/ยกเลิก/หมดเวลา)`, `${notRevenue(s)} bills not counted as sales (open, voided, expired)`)}</small>}
      </>}
    </article>)}</div>
    {data.excludedShops > 0 && <p className="reports-sub">{text(`ไม่รวม ${data.excludedShops} ร้านที่บัญชีนี้เป็นพนักงานหรือถูกปิดใช้งาน/อยู่นอกเวลา`, `${data.excludedShops} shop(s) where this account is staff, disabled or outside its hours are not included.`)}</p>}
  </section>;
}
