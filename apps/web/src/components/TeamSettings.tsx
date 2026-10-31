import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';

interface Member { userId: string; role: 'owner' | 'manager' | 'staff'; you: boolean }

// P25 (owner only): who can use this shop's POS and with which role. The owner can move a manager or staff member between
// those two roles; owners and the owner's own entry are never changed here. Names and invitations live in the auth
// service and are not offered, so a member is shown by a short id.
export default function TeamSettings({ token, language, signedInAs }: { token: string; language: 'th' | 'en'; signedInAs: string }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [members, setMembers] = useState<Member[]>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  async function load() {
    try { setMembers((await api<{ members: Member[] }>('/team', undefined, token)).members); setMessage(''); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  useEffect(() => { void load(); }, [token]);
  const roleLabel = { owner: text('เจ้าของร้าน', 'Owner'), manager: text('ผู้จัดการ', 'Manager'), staff: text('พนักงาน', 'Staff') };
  const roleHint = { owner: text('จัดการร้านและสิทธิ์', 'Runs the shop and permissions'), manager: text('จัดการการขาย สต็อก และรายงาน', 'Sales, stock and reports'), staff: text('รับและเตรียมออเดอร์', 'Takes and prepares orders') };
  async function change(member: Member, role: 'manager' | 'staff') {
    if (member.role === 'owner' || member.role === role) return;
    setBusy(member.userId); setMessage('');
    try { await api(`/team/${member.userId}`, { role, expectedRole: member.role }, token, 'PATCH'); setMessage(text('เปลี่ยนสิทธิ์แล้ว มีผลทันที', 'Role changed; it applies at once.')); await load(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') { setMessage(text('สิทธิ์ของคนนี้เปลี่ยนไปแล้ว โหลดล่าสุดแล้ว', 'This person’s role changed in the meantime; the latest was loaded.')); await load(); }
      else setMessage(errorMessage(error));
    }
    setBusy('');
  }
  if (!members) return <section className="panel"><h2>{text('ผู้ใช้งานและสิทธิ์', 'Users & permissions')}</h2><p className={message ? 'error' : 'notice'} role="status">{message || text('กำลังโหลดผู้ใช้งาน…', 'Loading users…')}</p></section>;
  return <section className="panel team-settings" aria-label={text('ผู้ใช้งานและสิทธิ์', 'Users & permissions')}>
    <h2>{text('ผู้ใช้งานและสิทธิ์', 'Users & permissions')}</h2>
    <p>{text(`คุณเข้าสู่ระบบด้วยบทบาท: ${signedInAs}`, `You are signed in with the role: ${signedInAs}`)}</p>
    <p className="reports-sub">{text('รายชื่อผู้ใช้ที่เข้าร้านนี้ได้ เปลี่ยนสิทธิ์ผู้จัดการและพนักงานได้ เจ้าของร้านและตัวคุณเองเปลี่ยนจากหน้านี้ไม่ได้ ชื่อและการเชิญผู้ใช้ใหม่อยู่ในบริการยืนยันตัวตน ยังไม่เปิดใช้ที่นี่ สิทธิ์ถูกบังคับที่เซิร์ฟเวอร์ทุกคำขอ', 'Everyone who can sign in to this shop. You can move managers and staff between those roles; owners and you yourself cannot be changed here. Names and invitations live in the sign-in service and are not offered here. Roles are enforced by the server on every request.')}</p>
    <table className="catalog-table"><thead><tr><th>{text('ผู้ใช้', 'User')}</th><th>{text('สิทธิ์', 'Role')}</th><th>{text('สถานะ', 'Status')}</th><th><span className="visually-hidden">{text('การทำงาน', 'Actions')}</span></th></tr></thead>
      <tbody>{members.map(member => <tr key={member.userId}>
        <td><strong>{member.you ? text('คุณ', 'You') : text('ผู้ใช้', 'User')}</strong> <small>#{member.userId.slice(0, 8)}</small></td>
        <td>{roleLabel[member.role]} · {roleHint[member.role]}</td><td>{text('ใช้งาน', 'Active')}</td>
        <td>{member.role === 'owner' || member.you ? '—' : (['manager', 'staff'] as const).filter(role => role !== member.role).map(role => <button type="button" className="secondary" key={role} disabled={!!busy} aria-label={`${text('เปลี่ยนเป็น', 'Change to')} ${roleLabel[role]} #${member.userId.slice(0, 8)}`} onClick={() => void change(member, role)}>{text('เปลี่ยนเป็น', 'Make')} {roleLabel[role]}</button>)}</td></tr>)}</tbody></table>
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
