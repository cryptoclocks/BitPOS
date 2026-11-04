import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import '../styles/channel-reconciliation.css';

// M12: what each outside channel can honestly do today, and a read-only check of one delivery channel against what BitPOS stored. It calls no provider
// and changes nothing; each finding says which existing screen fixes it.
type Source = 'grabfood' | 'lineman';
interface Provider { id: string; kind: 'delivery' | 'payment'; state: 'adapter_unverified' | 'credentials_only' | 'blocked_external'; needs: string }
interface Sample { id: string; shortNumber: string; externalOrderId: string; detail: string }
interface Issue { code: string; severity: 'attention' | 'info'; count: number; sample: Sample[] }
interface Recon { source: Source; environment: string; linked: boolean; sync: { lastSyncAt: string | null; lastResult: string; ageMinutes: number | null }; statusCounts: Record<string, number>; events: { total: number; poll: number; command: number }; issues: Issue[]; clean: boolean }
export default function ChannelReconciliation({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [providers, setProviders] = useState<Provider[]>(); const [source, setSource] = useState<Source>('grabfood'); const [recon, setRecon] = useState<Recon>();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setRecon(undefined);
    Promise.all([api<{ providers: Provider[] }>('/channels/providers', undefined, token), api<Recon>(`/channels/reconciliation?source=${source}`, undefined, token)])
      .then(([p, r]) => { if (live) { setProviders(p.providers); setRecon(r); } })
      .catch(e => { if (live) setError(errorMessage(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, source, attempt]);
  const name: Record<string, string> = { grabfood: 'GrabFood', lineman: 'LINE MAN', wongnai: 'Wongnai', pos_pay: 'POS Pay', promptpay: 'PromptPay', stripe: 'Stripe' };
  const state: Record<Provider['state'], string> = { adapter_unverified: text('มีโค้ดเชื่อมต่อแล้ว แต่ยังไม่เคยทดสอบกับ sandbox จริง', 'Adapter built, never verified against a live sandbox'), credentials_only: text('เก็บคีย์ได้อย่างเดียว ยังไม่มีโค้ดเชื่อมต่อ', 'Credential slot only; no adapter'), blocked_external: text('ยังทำไม่ได้', 'Blocked') };
  const needs: Record<string, string> = { live_sandbox_check: text('ต้องมีคีย์ sandbox จริงและการทดสอบกับผู้ให้บริการ', 'Needs live sandbox keys and a provider test'), official_api_access: text('ต้องได้สิทธิ์ใช้ API อย่างเป็นทางการและเอกสารจากผู้ให้บริการ', 'Needs official API access and documentation from the provider'), bank_or_psp_account: text('ต้องมีบัญชีธนาคารหรือผู้ให้บริการชำระเงิน', 'Needs a bank or payment-service-provider account'), provider_account: text('ต้องมีบัญชีผู้ให้บริการ', 'Needs a provider account') };
  const issueText: Record<string, [string, string, string]> = {
    PENDING_COMMAND: [text('คำสั่งรับ/ปฏิเสธ/พร้อมส่ง ค้างไม่ทราบผล', 'Accept/reject/ready command stuck, outcome unknown'), text('กด "ซิงก์ออเดอร์" เพื่อดูว่าผู้ให้บริการทำอะไรไปแล้ว ห้ามสั่งซ้ำก่อนนั้น', 'Sync orders to see what the provider did; do not resend before that.'), ''],
    NEEDS_ATTENTION: [text('ออเดอร์ต้องให้คนตรวจ', 'Order needs a person'), text('เปิดออเดอร์ในหน้าออเดอร์เดลิเวอรี', 'Open it in the delivery orders screen.'), ''],
    UNMAPPED_LINES: [text('รับออเดอร์แล้วแต่มีรายการที่ยังไม่ผูกกับสินค้า (สต็อกยังไม่ถูกตัด)', 'Accepted, but some items are not mapped to a product (stock not taken)'), text('ไปผูกรหัสสินค้าในหน้า "ผูกสินค้า" สต็อกจะถูกตัดครั้งเดียวหลังผูก', 'Map the item id in the item map; stock is then taken once.'), ''],
    STOCK_NOT_APPLIED: [text('รับออเดอร์แล้วแต่สต็อกยังไม่ถูกตัด', 'Accepted but stock has not been taken yet'), text('ซิงก์ออเดอร์อีกครั้ง ถ้ายังค้างให้แจ้งผู้ดูแลระบบ', 'Sync again; if it stays, tell your administrator.'), ''],
    STOCK_SHORT: [text('สต็อกไม่พอ ตัดได้น้อยกว่าที่สั่ง', 'Shelf was short; less stock was taken than ordered'), text('ตรวจนับสต็อกจริงแล้วปรับสต็อกในหน้าสต็อก', 'Count the real stock and adjust it in Stock.'), text('ขาด', 'short by')],
    NET_UNKNOWN: [text('ออเดอร์ที่เสร็จแล้วแต่ไม่มียอดสุทธิที่จะได้รับ', 'Completed order with no net payout amount'), text('รอผู้ให้บริการส่งยอดสุทธิ หรือบันทึกตอนกระทบยอดโอน', 'Wait for the provider’s net amount, or note it when you reconcile the payout.'), ''],
    CANCELLED_STOCK_TAKEN: [text('ออเดอร์ถูกยกเลิกแต่ตัดสต็อกไปแล้ว', 'Cancelled after stock was taken'), text('ระบบไม่คืนสต็อกให้เอง ถ้าของกลับเข้าชั้นได้ ให้บันทึก "รับเข้า" ในหน้าสต็อก', 'Stock is not returned automatically. If the food goes back on the shelf, record a Receive in Stock.'), text('ชิ้น', 'units')],
    SYNC_FAILED: [text('ซิงก์ครั้งล่าสุดล้มเหลว', 'The last sync failed'), text('ตรวจคีย์และการเชื่อมต่อในหน้าตั้งค่าช่องทาง แล้วซิงก์ใหม่', 'Check the keys and connection above, then sync again.'), ''],
    SYNC_STALE: [text('ไม่ได้ซิงก์มานาน', 'No sync for a long time'), text('กด "ซิงก์ออเดอร์" ในหน้าออเดอร์เดลิเวอรี', 'Press Sync orders in the delivery orders screen.'), text('นาที', 'minutes')],
  };
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB') : '—';
  return <section className="panel channel-recon" aria-label={text('สถานะและการกระทบยอดช่องทาง', 'Channel status and reconciliation')}>
    <h2>{text('สถานะช่องทางภายนอก', 'Outside channel status')}</h2>
    <p className="reports-sub">{text('บอกตามจริงว่าแต่ละช่องทางทำอะไรได้แล้วบ้าง สถานะเลื่อนขึ้นได้เมื่อมีเอกสาร สิทธิ์ และผลทดสอบจากผู้ให้บริการเท่านั้น ไม่มีตัวจำลอง (mock) ให้ร้านเลือกใช้', 'What each channel can honestly do today. A channel only moves up with documentation, access and a passing provider test. No mock provider is ever offered to a shop.')}</p>
    {error && <p className="error" role="alert">{error} <button type="button" className="secondary" onClick={() => setAttempt(n => n + 1)}>{text('ลองอีกครั้ง', 'Retry')}</button></p>}
    {loading && !error && <p className="notice" role="status" aria-busy="true">{text('กำลังโหลด…', 'Loading…')}</p>}
    {providers && <ul className="channel-recon-providers">{providers.map(p => <li key={p.id} data-state={p.state}><strong>{name[p.id] ?? p.id}</strong><span className={`recon-chip ${p.state}`}>{state[p.state]}</span><small>{needs[p.needs] ?? p.needs}</small></li>)}</ul>}
    <h3>{text('ตรวจความถูกต้องของออเดอร์เดลิเวอรี', 'Delivery order check')}</h3>
    <div className="toolbar"><label>{text('ช่องทาง', 'Channel')}<select value={source} onChange={e => setSource(e.target.value as Source)}><option value="grabfood">GrabFood</option><option value="lineman">LINE MAN</option></select></label><button type="button" className="secondary" disabled={loading} onClick={() => setAttempt(n => n + 1)}>{text('ตรวจใหม่', 'Check again')}</button></div>
    {recon && <>
      <p className="reports-sub">{text(`สภาพแวดล้อม ${recon.environment} · ${recon.linked ? 'เชื่อมแล้ว' : 'ยังไม่ได้เชื่อม'} · ซิงก์ล่าสุด ${when(recon.sync.lastSyncAt)}${recon.sync.lastResult ? ` (${recon.sync.lastResult})` : ''} · ${recon.events.total} เหตุการณ์ที่บันทึก (ไม่นับซ้ำ)`, `Environment ${recon.environment} · ${recon.linked ? 'linked' : 'not linked'} · last sync ${when(recon.sync.lastSyncAt)}${recon.sync.lastResult ? ` (${recon.sync.lastResult})` : ''} · ${recon.events.total} distinct events recorded`)}</p>
      {Object.keys(recon.statusCounts).length > 0 && <p className="reports-sub">{Object.entries(recon.statusCounts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
      {!recon.issues.length && <p className="notice" role="status">{Object.keys(recon.statusCounts).length ? text('ไม่พบความผิดปกติ', 'Nothing needs attention.') : text('ยังไม่มีออเดอร์จากช่องทางนี้', 'No orders from this channel yet.')}</p>}
      {recon.issues.length > 0 && <ul className="channel-recon-issues">{recon.issues.map(i => { const [title, hint, unit] = issueText[i.code] ?? [i.code, '', '']; return <li key={i.code} data-severity={i.severity}>
        <p><span className={`recon-chip ${i.severity}`}>{i.severity === 'attention' ? text('ต้องจัดการ', 'Needs action') : text('ข้อมูล', 'Info')}</span> <strong>{title}</strong> · {i.count}</p>
        <p className="reports-sub">{hint}</p>
        {i.sample.some(s => s.externalOrderId) && <p className="recon-sample">{i.sample.slice(0, 5).map(s => `#${s.shortNumber || s.externalOrderId.slice(0, 8)}${s.detail ? ` (${i.code === 'STOCK_SHORT' || i.code === 'CANCELLED_STOCK_TAKEN' ? `${unit} ${s.detail}` : s.detail})` : ''}`).join(', ')}{i.count > 5 ? ` …` : ''}</p>}
        {!i.sample.some(s => s.externalOrderId) && i.sample[0]?.detail && <p className="recon-sample">{i.sample[0].detail}{unit ? ` ${unit}` : ''}</p>}
      </li>; })}</ul>}
    </>}
  </section>;
}
