import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Session } from '../lib/table';

interface Person { userId: string; role: 'manager' | 'staff'; displayName: string }

// A signed-in till hands over to another cashier with that person's PIN. The server decides everything: owners can never be switched to, five
// wrong PINs lock that person for five minutes, and a disabled or out-of-hours account is refused. The previous session is ended on success.
export default function SwitchUser({ session, language, onSwitched }: { session: Session; language: 'th' | 'en'; onSwitched: (next: Session) => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [open, setOpen] = useState(false); const [people, setPeople] = useState<Person[]>(); const [error, setError] = useState('');
  const [picked, setPicked] = useState(''); const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false); const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return; let live = true; setPeople(undefined); setError('');
    api<{ people: Person[] }>('/team/directory', undefined, session.token).then(r => { if (live) setPeople(r.people.filter(p => p.userId !== session.userId)); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [open, session.token, session.userId]);
  useEffect(() => { if (picked) input.current?.focus(); }, [picked]);
  const close = () => { setOpen(false); setPicked(''); setPin(''); setError(''); };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !picked || !/^[0-9]{4,8}$/.test(pin)) return;
    setBusy(true); setError('');
    try {
      const next = await api<Session>('/session/switch', { userId: picked, pin }, session.token);
      void api('/session', undefined, session.token, 'DELETE').catch(() => undefined);
      setPin(''); close(); onSwitched({ token: next.token, userId: next.userId, merchantId: next.merchantId, role: next.role });
    } catch (e) { setPin(''); setError(e instanceof ApiError && e.code === 'AUTH_REQUIRED' ? text('PIN ไม่ถูกต้อง', 'Wrong PIN') : errorMessage(e)); }
    setBusy(false);
  }
  return <>
    <button type="button" className="secondary" onClick={() => setOpen(true)}>{text('สลับผู้ใช้', 'Switch user')}</button>
    {open && <div className="switch-user-back" role="presentation" onClick={close}><div className="switch-user" role="dialog" aria-modal="true" aria-label={text('สลับผู้ใช้ด้วย PIN', 'Switch user with PIN')} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      <h2>{text('สลับผู้ใช้', 'Switch user')}</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {!people && !error && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
      {people && !people.length && <p className="notice" role="status">{text('ยังไม่มีผู้ใช้ที่ตั้ง PIN ไว้ เจ้าของร้านตั้งได้ที่ ตั้งค่า › ผู้ใช้งานและสิทธิ์', 'Nobody has a PIN yet. The owner can set one in Settings › Users & permissions.')}</p>}
      {people && !!people.length && <form onSubmit={e => void submit(e)}>
        <fieldset className="switch-user-people"><legend>{text('เลือกผู้ใช้', 'Choose a person')}</legend>{people.map(p => <label key={p.userId}><input type="radio" name="who" checked={picked === p.userId} onChange={() => { setPicked(p.userId); setError(''); setPin(''); }} /><span>{p.displayName || `#${p.userId.slice(0, 8)}`}</span><small>{p.role === 'manager' ? text('ผู้จัดการ', 'Manager') : text('พนักงาน', 'Staff')}</small></label>)}</fieldset>
        <label>{text('PIN (4–8 หลัก)', 'PIN (4–8 digits)')}<input ref={input} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,8}" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} disabled={!picked || busy} /></label>
        <div className="toolbar"><button type="submit" disabled={!picked || busy || !/^[0-9]{4,8}$/.test(pin)}>{busy ? text('กำลังตรวจสอบ…', 'Checking…') : text('ยืนยัน', 'Confirm')}</button><button type="button" className="secondary" onClick={close}>{text('ยกเลิก', 'Cancel')}</button></div></form>}
      {people && !people.length && <div className="toolbar"><button type="button" className="secondary" onClick={close}>{text('ปิด', 'Close')}</button></div>}
    </div></div>}
  </>;
}
