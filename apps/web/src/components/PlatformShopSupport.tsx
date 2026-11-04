import { useEffect, useRef, useState } from 'react';
import PlatformSidebar from './PlatformSidebar';
import { ShopSupportSession, type ShopCase, type ShopMessage, type ShopSupportCommand } from '../lib/shop-support-session';
import { PlatformError } from '../lib/platform-session';
import '../styles/food-dispatch.css';
import '../styles/support.css';

// Platform staff console for requests written by shops. Sign in is the same staff identity (phone code) as the customer-support console. Every list/read asks for a
// purpose that is stored in an immutable audit; a command keeps its commandId until it succeeds, so a retry after a dropped connection is not applied twice.
export default function PlatformShopSupport() {
  const ref = useRef<ShopSupportSession | null>(null); if (!ref.current) ref.current = new ShopSupportSession(); const api = ref.current;
  const [thai, setThai] = useState(true), [account, setAccount] = useState<string | null>(null), [phone, setPhone] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [merchant, setMerchant] = useState(''), [purpose, setPurpose] = useState('');
  const [items, setItems] = useState<ShopCase[] | null>(null), [detail, setDetail] = useState<{ ticket: ShopCase; messages: ShopMessage[] } | null>(null), [body, setBody] = useState(''), [reason, setReason] = useState('');
  const pending = useRef<{ sig: string; id: string } | null>(null);
  const alive = useRef(true); const t = (th: string, en: string) => thai ? th : en;
  useEffect(() => { alive.current = true; return () => { alive.current = false; void api.logout().catch(() => {}); }; }, [api]);
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { const c = e instanceof PlatformError ? e.code : 'REQUEST_UNAVAILABLE'; if (c === 'AUTH_REQUIRED') { setAccount(null); setItems(null); setDetail(null); } setError(c); } if (alive.current) setBusy(false); }
  const messages: Record<string, [string, string]> = { ROLE_REQUIRED: ['ไม่มีสิทธิ์กับร้านนี้', 'No access to this shop'], VERSION_CONFLICT: ['คำร้องเปลี่ยนแล้ว โหลดใหม่', 'The request changed. Reload it.'], SUPPORT_CASE_CLOSED: ['คำร้องปิดแล้ว', 'The request is closed'], INVALID_REQUEST: ['ข้อมูลไม่ถูกต้อง', 'Invalid input'], AUTH_REQUIRED: ['เข้าสู่ระบบอีกครั้ง', 'Sign in again'] };
  async function load() { setDetail(null); setItems((await api.list(merchant.trim(), purpose.trim())).items); }
  async function open(id: string) { setDetail(await api.read(id, purpose.trim())); setBody(''); setReason(''); }
  async function act(action: ShopSupportCommand['action']) {
    if (!detail || !reason.trim() || (action === 'REPLY' && !body.trim())) return;
    const message = action === 'REPLY' ? body.trim() : '', sig = [detail.ticket.id, detail.ticket.version, action, message, reason.trim()].join('|');
    if (pending.current?.sig !== sig) pending.current = { sig, id: crypto.randomUUID() };
    await api.command(detail.ticket.id, { commandId: pending.current.id, expectedVersion: detail.ticket.version, action, message, reason: reason.trim() });
    pending.current = null; await open(detail.ticket.id); await load().catch(() => {});
  }
  const state = (s: string) => s === 'RESOLVED' ? t('ปิดแล้ว', 'Resolved') : s === 'ANSWERED' ? t('ตอบแล้ว', 'Answered') : t('รอตอบ', 'Waiting');
  return <main className="dispatch-console support-console"><PlatformSidebar thai={thai} current="/platform/shop-support" /><div className="dispatch-main">
    <header><span>{t('เจ้าหน้าที่ช่วยเหลือร้านค้า', 'Shop support team')}</span><button onClick={() => setThai(!thai)}>{thai ? 'English' : 'ไทย'}</button></header>
    <section className="dispatch-heading"><h1>{t('คำร้องจากร้านค้า', 'Requests from shops')}</h1><p>{t('ตอบคำร้องของร้านที่คุณได้รับสิทธิ์ ทุกการเปิดอ่านบันทึกพร้อมวัตถุประสงค์', 'Answer requests from shops you are scoped to. Every read is audited with its purpose.')}</p></section>
    {error && <p role="alert" className="dispatch-notice">{messages[error] ? t(...messages[error]) : error}</p>}
    {!account ? <section className="dispatch-panel"><h2>{t('เข้าสู่ระบบเจ้าหน้าที่', 'Staff sign in')}</h2>
      <form onSubmit={e => { e.preventDefault(); void run(async () => { if (!sent) { await api.requestOtp(phone); if (alive.current) setSent(true); } else { await api.verify(phone, code); if (alive.current) { setAccount(api.accountId); setCode(''); } } }); }}>
        <label>{t('เบอร์โทร', 'Phone')}<input value={phone} onChange={e => setPhone(e.target.value)} disabled={sent || busy} /></label>
        {sent && <label>{t('รหัสยืนยัน', 'Code')}<input value={code} onChange={e => setCode(e.target.value)} disabled={busy} inputMode="numeric" /></label>}
        <button disabled={busy || !phone.trim() || (sent && !code.trim())}>{sent ? t('ยืนยัน', 'Verify') : t('ส่งรหัส', 'Send code')}</button></form></section>
    : <>
      <section className="dispatch-panel support-toolbar">
        <label>{t('รหัสร้าน (merchant id)', 'Shop id (merchant id)')}<input value={merchant} onChange={e => setMerchant(e.target.value)} disabled={busy} /></label>
        <label>{t('วัตถุประสงค์ในการเปิดอ่าน', 'Purpose of access')}<input value={purpose} maxLength={300} onChange={e => setPurpose(e.target.value)} disabled={busy} /></label>
        <button disabled={busy || !merchant.trim() || !purpose.trim()} onClick={() => void run(load)}>{t('โหลดคำร้อง', 'Load requests')}</button></section>
      <div className={'support-workspace' + (detail ? ' has-detail' : '')}>
        <section className="dispatch-panel"><h2>{t('คำร้อง', 'Requests')}</h2>{items?.length === 0 && <p>{t('ไม่มีคำร้อง', 'No requests.')}</p>}
          {items?.map(c => <button className="support-ticket" key={c.id} aria-pressed={detail?.ticket.id === c.id} disabled={busy} onClick={() => void run(() => open(c.id))}><strong>{c.subject}</strong><span>{state(c.state)}</span></button>)}</section>
        <section className="dispatch-panel">{detail ? <>
          <button className="support-back" disabled={busy} onClick={() => setDetail(null)}>{t('กลับ', 'Back')}</button><h2>{detail.ticket.subject}</h2><p>{state(detail.ticket.state)}</p>
          <div className="support-thread">{detail.messages.map(m => <article key={m.id} className={m.authorKind === 'STAFF' ? 'support-message staff' : 'support-message'}><strong>{m.authorKind === 'STAFF' ? t('ทีมงาน', 'Team') : t('ร้านค้า', 'Shop')}</strong><p>{m.body}</p></article>)}</div>
          <label>{t('ข้อความตอบ', 'Reply')}<textarea value={body} onChange={e => setBody(e.target.value)} maxLength={4000} disabled={busy} /></label>
          <label>{t('เหตุผลที่ดำเนินการ (บันทึกใน audit)', 'Reason (stored in the audit)')}<input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} disabled={busy} /></label>
          <div className="toolbar">{detail.ticket.state !== 'RESOLVED' && <button disabled={busy || !reason.trim() || !body.trim()} onClick={() => void run(() => act('REPLY'))}>{t('ส่งคำตอบ', 'Send reply')}</button>}
            {detail.ticket.state !== 'RESOLVED' ? <button disabled={busy || !reason.trim()} onClick={() => void run(() => act('RESOLVE'))}>{t('ปิดคำร้อง', 'Resolve')}</button> : <button disabled={busy || !reason.trim()} onClick={() => void run(() => act('REOPEN'))}>{t('เปิดใหม่', 'Reopen')}</button>}</div>
        </> : <p>{t('เลือกคำร้องจากรายการ', 'Choose a request from the list.')}</p>}{busy && <p role="status">{t('กำลังโหลด…', 'Loading…')}</p>}</section></div></>}
  </div></main>;
}
