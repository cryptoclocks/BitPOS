import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import '../styles/shop-support.css';

interface Case { id: string; subject: string; state: 'OPEN' | 'ANSWERED' | 'RESOLVED'; version: string; createdAt: string; updatedAt: string }
interface Message { id: string; authorKind: 'SHOP' | 'STAFF'; body: string; createdAt: string }

// Requests from the shop to the BitPOS team (owner/manager). Answers come from platform support staff; nothing here is live chat and nobody is paged:
// the copy says so. Each send carries an idempotency key kept until it succeeds, so a retry after a dropped connection never creates a second request.
export default function ShopSupport({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [cases, setCases] = useState<Case[]>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [open, setOpen] = useState<{ case: Case; messages: Message[] }>(); const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [reply, setReply] = useState('');
  const [pending, setPending] = useState<{ key: string; sig: string }>();
  const load = useCallback(async () => { setError(''); try { setCases((await api<{ cases: Case[] }>('/support/cases', undefined, token)).cases); } catch (e) { setError(errorMessage(e)); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  const stateLabel = (s: Case['state']) => s === 'OPEN' ? text('รอทีมงาน', 'Waiting for the team') : s === 'ANSWERED' ? text('ทีมงานตอบแล้ว', 'Answered') : text('ปิดแล้ว', 'Closed');
  const when = (iso: string) => new Date(iso).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  const keyFor = (sig: string) => { if (pending?.sig === sig) return pending.key; const key = crypto.randomUUID(); setPending({ key, sig }); return key; };
  async function guarded(fn: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e instanceof ApiError && e.code === 'SUPPORT_CASE_CLOSED' ? text('คำร้องนี้ปิดแล้ว เปิดคำร้องใหม่ได้', 'This request is closed. Open a new one.') : e instanceof ApiError && e.code === 'SUPPORT_LIMIT' ? text('มีคำร้องที่ยังไม่ปิดครบ 20 รายการหรือข้อความเต็มแล้ว', 'Too many open requests or messages.') : errorMessage(e)); } setBusy(false); }
  async function openCase(id: string) { await guarded(async () => setOpen(await api(`/support/cases/${id}`, undefined, token))); }
  async function create() {
    await guarded(async () => {
      const sig = `new|${subject.trim()}|${body.trim()}`; const r = await api<{ case: Case }>('/support/cases', { subject: subject.trim(), body: body.trim(), idempotencyKey: keyFor(sig) }, token);
      setPending(undefined); setSubject(''); setBody(''); setMessage(text('ส่งคำร้องแล้ว ทีมงานจะตอบในหน้านี้ (ไม่ใช่แชตสด)', 'Request sent. The team answers here (this is not live chat).')); await load(); setOpen(await api(`/support/cases/${r.case.id}`, undefined, token));
    });
  }
  async function send() {
    if (!open) return;
    await guarded(async () => {
      const sig = `reply|${open.case.id}|${reply.trim()}`; await api(`/support/cases/${open.case.id}/messages`, { body: reply.trim(), idempotencyKey: keyFor(sig) }, token);
      setPending(undefined); setReply(''); await load(); setOpen(await api(`/support/cases/${open.case.id}`, undefined, token));
    });
  }
  async function resolve() { if (!open || !window.confirm(text('ปิดคำร้องนี้?', 'Close this request?'))) return; await guarded(async () => { await api(`/support/cases/${open.case.id}/resolve`, undefined, token, 'POST'); await load(); setOpen(await api(`/support/cases/${open.case.id}`, undefined, token)); }); }
  const validNew = subject.trim().length >= 3 && body.trim().length >= 1;
  return <section className="shop-support" aria-label={text('ส่งคำร้องถึงทีมงาน', 'Requests to the team')}>
    <h3>{text('ส่งคำร้องถึงทีมงาน BitPOS', 'Send a request to the BitPOS team')}</h3>
    <p className="reports-sub">{text('ไม่ใช่แชตสด: ทีมงานอ่านและตอบในหน้านี้ ไม่ต้องใส่รหัสผ่านหรือคีย์กระเป๋าในคำร้อง เจ้าของ/ผู้จัดการส่งได้', 'Not live chat: the team reads and answers here. Never put passwords or wallet keys in a request. Owners and managers can send.')}</p>
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error} <button type="button" className="secondary" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Retry')}</button></p>}
    {!open && <>
      <form className="shop-support-new" onSubmit={e => { e.preventDefault(); void create(); }}>
        <label>{text('หัวข้อ (3–120 ตัวอักษร)', 'Subject (3–120 characters)')}<input value={subject} maxLength={120} disabled={busy} onChange={e => setSubject(e.target.value)} /></label>
        <label>{text('รายละเอียด', 'Details')}<textarea value={body} maxLength={4000} rows={4} disabled={busy} onChange={e => setBody(e.target.value)} /></label>
        <button disabled={busy || !validNew}>{busy ? text('กำลังส่ง…', 'Sending…') : text('ส่งคำร้อง', 'Send request')}</button>
      </form>
      {!cases && !error && <p className="notice" role="status">{text('กำลังโหลดคำร้อง…', 'Loading requests…')}</p>}
      {cases && !cases.length && <p className="notice">{text('ยังไม่มีคำร้อง', 'No requests yet.')}</p>}
      {cases && cases.length > 0 && <ul className="shop-support-list">{cases.map(c => <li key={c.id}><button type="button" className="shop-support-row" disabled={busy} onClick={() => void openCase(c.id)}><strong>{c.subject}</strong><span className={`help-chip ${c.state === 'ANSWERED' ? 'done' : c.state === 'OPEN' ? 'req' : 'rec'}`}>{stateLabel(c.state)}</span><small>{when(c.updatedAt)}</small></button></li>)}</ul>}
    </>}
    {open && <div className="shop-support-thread">
      <button type="button" className="secondary" onClick={() => { setOpen(undefined); setMessage(''); }}>{text('กลับไปรายการ', 'Back to the list')}</button>
      <h4>{open.case.subject}</h4><p><span className={`help-chip ${open.case.state === 'ANSWERED' ? 'done' : open.case.state === 'OPEN' ? 'req' : 'rec'}`}>{stateLabel(open.case.state)}</span></p>
      <div className="shop-support-messages">{open.messages.map(m => <article key={m.id} className={m.authorKind === 'STAFF' ? 'staff' : 'shop'}><strong>{m.authorKind === 'STAFF' ? text('ทีมงาน BitPOS', 'BitPOS team') : text('ร้านของคุณ', 'Your shop')}</strong><time>{when(m.createdAt)}</time><p>{m.body}</p></article>)}</div>
      {open.case.state !== 'RESOLVED' ? <form onSubmit={e => { e.preventDefault(); void send(); }}>
        <label>{text('ตอบกลับ', 'Reply')}<textarea value={reply} maxLength={4000} rows={3} disabled={busy} onChange={e => setReply(e.target.value)} /></label>
        <div className="toolbar"><button disabled={busy || !reply.trim()}>{text('ส่งข้อความ', 'Send message')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void resolve()}>{text('ปิดคำร้อง', 'Close request')}</button></div>
      </form> : <p className="bill-note">{text('คำร้องนี้ปิดแล้ว หากยังมีปัญหาให้เปิดคำร้องใหม่', 'This request is closed. Open a new one if the problem continues.')}</p>}
    </div>}
  </section>;
}
