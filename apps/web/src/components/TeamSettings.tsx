import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';

interface Member { userId: string; role: 'owner' | 'manager' | 'staff'; you: boolean; displayName: string; active: boolean; accessFrom: string | null; accessTo: string | null; hasPin: boolean; pinLockedUntil: string | null; revision: string }

// Owner only: who can use this shop's POS, with which role, name, allowed hours and PIN. Everything is enforced on the server on every request:
// switching someone off ends their sessions at once, allowed hours are checked per request, and PINs are stored only as a salted hash. Owners
// and your own entry cannot be switched off or time-limited. Adding a new person (an account) lives in the sign-in service and is not offered here.
export default function TeamSettings({ token, language, signedInAs }: { token: string; language: 'th' | 'en'; signedInAs: string }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [members, setMembers] = useState<Member[]>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState(''); const [name, setName] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [pin, setPin] = useState('');
  async function load() {
    try { setMembers((await api<{ members: Member[] }>('/team', undefined, token)).members); setMessage(''); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  useEffect(() => { void load(); }, [token]);
  const roleLabel = { owner: text('เจ้าของร้าน', 'Owner'), manager: text('ผู้จัดการ', 'Manager'), staff: text('พนักงาน', 'Staff') };
  const roleHint = { owner: text('จัดการร้านและสิทธิ์', 'Runs the shop and permissions'), manager: text('จัดการการขาย สต็อก และรายงาน', 'Sales, stock and reports'), staff: text('ขายและรับออเดอร์', 'Sells and takes orders') };
  const label = (m: Member) => m.displayName || `#${m.userId.slice(0, 8)}`;
  const conflict = text('ข้อมูลของคนนี้เปลี่ยนไปแล้ว โหลดล่าสุดแล้ว ลองอีกครั้ง', 'This person changed in the meantime. Latest is loaded; try again.');
  async function run(member: Member, call: () => Promise<unknown>, done: string) {
    setBusy(member.userId); setMessage('');
    try { await call(); setMessage(done); setPin(''); await load(); }
    catch (error) {
      if (error instanceof ApiError && (error.code === 'VERSION_CONFLICT' || error.code === 'PRODUCT_CHANGED')) { setMessage(conflict); await load(); }
      else setMessage(errorMessage(error));
    }
    setBusy('');
  }
  const change = (member: Member, role: 'manager' | 'staff') => member.role === 'owner' || member.role === role ? undefined : run(member, () => api(`/team/${member.userId}`, { role, expectedRole: member.role }, token, 'PATCH'), text('เปลี่ยนสิทธิ์แล้ว มีผลทันที', 'Role changed; it applies at once.'));
  const profile = (member: Member, body: Record<string, unknown>, done: string) => run(member, () => api(`/team/${member.userId}/profile`, { expectedRevision: member.revision, ...body }, token, 'PUT'), done);
  const setPinFor = (member: Member, value: string | null) => run(member, () => api(`/team/${member.userId}/pin`, { expectedRevision: member.revision, pin: value }, token, 'PUT'), value ? text('ตั้ง PIN แล้ว', 'PIN set.') : text('ลบ PIN แล้ว', 'PIN removed.'));
  const begin = (m: Member) => { setOpenId(openId === m.userId ? '' : m.userId); setName(m.displayName); setFrom(m.accessFrom ?? ''); setTo(m.accessTo ?? ''); setPin(''); setMessage(''); };
  if (!members) return <section className="panel"><h2>{text('ผู้ใช้งานและสิทธิ์', 'Users & permissions')}</h2><p className={message ? 'error' : 'notice'} role="status">{message || text('กำลังโหลดผู้ใช้…', 'Loading users…')}</p>{message && <button type="button" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Retry')}</button>}</section>;
  return <section className="panel team-settings" aria-label={text('ผู้ใช้งานและสิทธิ์', 'Users & permissions')}>
    <h2>{text('ผู้ใช้งานและสิทธิ์', 'Users & permissions')}</h2>
    <p>{text(`คุณเข้าสู่ระบบด้วยบทบาท: ${signedInAs}`, `You are signed in with the role: ${signedInAs}`)}</p>
    <p className="reports-sub">{text('ตั้งชื่อ เปลี่ยนสิทธิ์ ปิด/เปิดการใช้งาน กำหนดช่วงเวลาที่ใช้ POS ได้ และตั้ง PIN สำหรับสลับผู้ใช้ที่หน้าร้าน เจ้าของร้านและตัวคุณเองปิดหรือจำกัดเวลาไม่ได้ การเพิ่มคนใหม่ (บัญชี) อยู่ในบริการยืนยันตัวตน ยังไม่เปิดที่นี่ ทุกอย่างถูกบังคับที่เซิร์ฟเวอร์ทุกคำขอ', 'Name people, change roles, switch accounts off, limit the hours they may use the POS, and set a PIN for switching user at the till. Owners and you cannot be switched off or time-limited. Adding a new person (an account) lives in the sign-in service and is not offered here. All of it is enforced on the server on every request.')}</p>
    {message && <p className="notice" role="status">{message}</p>}
    <table className="catalog-table"><thead><tr><th>{text('ผู้ใช้', 'User')}</th><th>{text('สิทธิ์', 'Role')}</th><th>{text('สถานะ', 'Status')}</th><th><span className="visually-hidden">{text('การทำงาน', 'Actions')}</span></th></tr></thead>
      <tbody>{members.flatMap(member => { const locked = member.role !== 'owner' && !member.you; const rows = [<tr key={member.userId}>
        <td><strong>{label(member)}</strong>{member.you && <small> · {text('คุณ', 'You')}</small>}<br /><small>#{member.userId.slice(0, 8)}</small></td>
        <td>{roleLabel[member.role]} · {roleHint[member.role]}</td>
        <td><span className={`team-chip ${member.active ? 'on' : 'off'}`}>{member.active ? text('ใช้งาน', 'Active') : text('ปิดใช้งาน', 'Switched off')}</span>{member.accessFrom && member.accessTo && <small> · {member.accessFrom}–{member.accessTo}</small>}{member.hasPin && <small> · PIN{member.pinLockedUntil ? ` (${text('ล็อก', 'locked')})` : ''}</small>}</td>
        <td>{member.role === 'owner' ? '—' : <>{(['manager', 'staff'] as const).filter(role => role !== member.role && !member.you).map(role => <button type="button" className="secondary" key={role} disabled={!!busy} aria-label={`${text('เปลี่ยนเป็น', 'Change to')} ${roleLabel[role]} ${label(member)}`} onClick={() => void change(member, role)}>{text('เปลี่ยนเป็น', 'Make')} {roleLabel[role]}</button>)} <button type="button" className="secondary" aria-expanded={openId === member.userId} onClick={() => begin(member)}>{text('จัดการ', 'Manage')}</button></>}</td></tr>];
        if (openId === member.userId) rows.push(<tr key={`${member.userId}-x`} className="team-detail"><td colSpan={4}><div className="team-detail-grid">
          <fieldset><legend>{text('ชื่อที่แสดง', 'Display name')}</legend><label>{text('ชื่อ (สูงสุด 60 ตัวอักษร)', 'Name (up to 60 characters)')}<input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label><button type="button" disabled={!!busy || name.trim() === member.displayName} onClick={() => void profile(member, { displayName: name.trim() }, text('บันทึกชื่อแล้ว', 'Name saved.'))}>{text('บันทึกชื่อ', 'Save name')}</button></fieldset>
          {locked && <fieldset><legend>{text('การใช้งาน', 'Access')}</legend>
            <button type="button" className={member.active ? 'secondary' : ''} disabled={!!busy} onClick={() => { if (!member.active || window.confirm(text('ปิดการใช้งานคนนี้? เซสชันที่เปิดอยู่จะถูกยกเลิกทันที', 'Switch this person off? Their open sessions end immediately.'))) void profile(member, { active: !member.active }, member.active ? text('ปิดการใช้งานแล้ว', 'Switched off.') : text('เปิดการใช้งานแล้ว', 'Switched on.')); }}>{member.active ? text('ปิดการใช้งาน', 'Switch off') : text('เปิดการใช้งาน', 'Switch on')}</button>
            <div className="availability-times"><label>{text('ใช้ได้ตั้งแต่', 'From')}<input type="time" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{text('ถึง', 'To')}<input type="time" value={to} onChange={e => setTo(e.target.value)} /></label></div>
            <p className="catalog-sub">{text('เวลาของร้าน ข้ามเที่ยงคืนได้ เว้นว่าง = ไม่จำกัด', 'Shop time; may cross midnight. Empty = no limit.')}</p>
            <div className="toolbar"><button type="button" disabled={!!busy || !from || !to || from === to} onClick={() => void profile(member, { access: { from, to } }, text('บันทึกช่วงเวลาแล้ว', 'Hours saved.'))}>{text('บันทึกช่วงเวลา', 'Save hours')}</button>{member.accessFrom && <button type="button" className="secondary" disabled={!!busy} onClick={() => void profile(member, { access: null }, text('ล้างการจำกัดเวลาแล้ว', 'Hours limit cleared.'))}>{text('ไม่จำกัดเวลา', 'No limit')}</button>}</div></fieldset>}
          <fieldset><legend>PIN</legend><p className="catalog-sub">{member.hasPin ? text('ตั้ง PIN ไว้แล้ว ใส่ใหม่เพื่อรีเซ็ต (ปลดล็อกด้วย)', 'A PIN is set. Enter a new one to reset it (this also clears a lock).') : text('ยังไม่มี PIN คนนี้จะไม่อยู่ในรายชื่อสลับผู้ใช้', 'No PIN yet, so this person is not offered when switching user.')}</p>
            <label>{text('PIN ใหม่ (4–8 หลัก)', 'New PIN (4–8 digits)')}<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></label>
            <div className="toolbar"><button type="button" disabled={!!busy || !/^[0-9]{4,8}$/.test(pin)} onClick={() => void setPinFor(member, pin)}>{text('ตั้ง PIN', 'Set PIN')}</button>{member.hasPin && <button type="button" className="secondary" disabled={!!busy} onClick={() => void setPinFor(member, null)}>{text('ลบ PIN', 'Remove PIN')}</button>}</div></fieldset>
        </div></td></tr>);
        return rows; })}</tbody></table>
  </section>;
}
