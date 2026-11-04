import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Session } from '../lib/table';

interface Choice { merchantId: string; name: string; role: 'owner' | 'manager'; current: boolean }

// M01: owners/managers of more than one shop move between them without signing in again. The server issues a NEW session for the target shop with the role held THERE and
// ends the old one. On success the whole workspace is remounted (onSwitched), so no order, cart, menu, draft or in-flight response of the old shop can reach the new one.
// The list is only shown when there is somewhere to go.
export default function BranchSwitcher({ session, language, onSwitched }: { session: Session; language: 'th' | 'en'; onSwitched: (next: Session) => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [choices, setChoices] = useState<Choice[]>([]); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<{ branches: Choice[] }>('/branches', undefined, session.token).then(r => { if (live) setChoices(r.branches); }).catch(() => { if (live) setChoices([]); });
    return () => { live = false; };
  }, [session.token]);
  if (choices.length < 2) return null;
  const current = choices.find(c => c.current);
  async function go(id: string) {
    if (busy) return; setBusy(true); setError('');
    try { const next = await api<Session>('/branches/switch', { merchantId: id }, session.token); onSwitched({ token: next.token, userId: next.userId, merchantId: next.merchantId, role: next.role }); }
    catch (e) { setError(e instanceof ApiError && e.status === 403 ? text('ไม่มีสิทธิ์เข้าสาขานี้ในขณะนี้', 'You cannot enter this branch right now.') : errorMessage(e)); setBusy(false); }
  }
  return <>
    <button type="button" className="secondary" aria-haspopup="dialog" onClick={() => { setOpen(true); setError(''); }}>{text('สาขา', 'Branch')}: {current?.name ?? '—'}</button>
    {open && <div className="switch-user-back" role="presentation" onClick={() => !busy && setOpen(false)}><div className="switch-user" role="dialog" aria-modal="true" aria-label={text('เลือกสาขา', 'Choose a branch')} onClick={e => e.stopPropagation()}>
      <h2>{text('เลือกสาขา', 'Choose a branch')}</h2>
      <p className="catalog-sub">{text('การสลับจะล้างหน้าจอ ตะกร้า และรายการที่ค้างของสาขาเดิมทั้งหมด และจะใช้สิทธิ์ที่คุณมีในสาขาใหม่', 'Switching clears the screen, cart and unsaved work of the current branch, and uses the role you hold in the new one.')}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="branch-list">{choices.map(c => <li key={c.merchantId}><span><strong>{c.name}</strong> <small>{c.role === 'owner' ? text('เจ้าของ', 'Owner') : text('ผู้จัดการ', 'Manager')}</small></span>{c.current ? <span className="badge">{text('สาขาปัจจุบัน', 'Current')}</span> : <button type="button" disabled={busy} onClick={() => void go(c.merchantId)}>{busy ? text('กำลังสลับ…', 'Switching…') : text('สลับไปสาขานี้', 'Switch here')}</button>}</li>)}</ul>
      <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>{text('ปิด', 'Close')}</button></div>
    </div></div>}
  </>;
}
