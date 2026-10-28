import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { requestId } from '../lib/request-id';
import { filterSuppliers } from '../lib/suppliers-view';
import type { SupplierFilter, SupplierRow } from '../lib/suppliers-view';

// P21: the shop's supplier directory (owner/manager). Rows are deactivated, never deleted, and every save sends
// the version that was read; a changed row is refused and reloaded. It is a directory, not purchasing.
export default function SuppliersManager({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [rows, setRows] = useState<SupplierRow[]>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SupplierFilter>('all'); const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierRow | 'new'>(); const [form, setForm] = useState({ name: '', supplies: '', contact: '', phone: '' });
  const [keyRef] = useState({ current: requestId() });
  async function load() {
    try { setRows((await api<{ suppliers: SupplierRow[] }>('/suppliers', undefined, token)).suppliers); setMessage(''); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  useEffect(() => { void load(); }, [token]);
  const open = (target: SupplierRow | 'new') => { setEditing(target); setForm(target === 'new' ? { name: '', supplies: '', contact: '', phone: '' } : { name: target.name, supplies: target.supplies, contact: target.contact, phone: target.phone }); setMessage(''); };
  const valid = form.name.trim().length > 0 && form.name.trim().length <= 120;
  async function save() {
    if (!editing || !valid) return;
    setBusy(true); setMessage('');
    const fields = { name: form.name.trim(), supplies: form.supplies.trim(), contact: form.contact.trim(), phone: form.phone.trim() };
    try {
      if (editing === 'new') { await api('/suppliers', { ...fields, idempotencyKey: keyRef.current }, token); keyRef.current = requestId(); }
      else await api(`/suppliers/${editing.id}`, { ...fields, expectedVersion: editing.version }, token, 'PATCH');
      setEditing(undefined); setMessage(text('บันทึกแล้ว', 'Saved')); await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') { setMessage(text('ข้อมูลซัพพลายเออร์เปลี่ยนไปแล้ว โหลดล่าสุดแล้วลองอีกครั้ง', 'This supplier changed in the meantime. The latest was loaded; check and try again.')); setEditing(undefined); await load(); }
      else setMessage(errorMessage(error));
    }
    setBusy(false);
  }
  async function toggle(row: SupplierRow) {
    setBusy(true); setMessage('');
    try { await api(`/suppliers/${row.id}`, { active: !row.active, expectedVersion: row.version }, token, 'PATCH'); await load(); }
    catch (error) { if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') { setMessage(text('ข้อมูลเปลี่ยนไปแล้ว โหลดล่าสุดแล้ว', 'Changed in the meantime; the latest was loaded.')); await load(); } else setMessage(errorMessage(error)); }
    setBusy(false);
  }
  if (!rows) return <p className={message ? 'error' : 'notice'} role="status">{message || text('กำลังโหลดซัพพลายเออร์…', 'Loading suppliers…')}</p>;
  const shown = filterSuppliers(rows, filter, search);
  return <section aria-label={text('ซัพพลายเออร์', 'Suppliers')}>
    <p className="catalog-sub">{text('รายชื่อผู้จัดหาสินค้าของร้าน ปิดการใช้งานได้ แต่ลบไม่ได้ ไม่ใช่ระบบสั่งซื้อ', 'The shop’s supplier directory. Suppliers can be deactivated but not deleted. This is not purchasing.')}</p>
    <div className="supplier-tools"><input type="search" aria-label={text('ค้นหารายการ', 'Search')} placeholder={text('ค้นหาซัพพลายเออร์', 'Search suppliers')} value={search} onChange={event => setSearch(event.target.value)} />
      <button type="button" disabled={busy} onClick={() => open('new')}>{text('เพิ่มซัพพลายเออร์', 'Add supplier')}</button></div>
    <div className="stock-views" role="group" aria-label={text('สถานะ', 'Status')}>{(['all', 'active', 'inactive'] as const).map(id => <button type="button" className="secondary" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{{ all: text('ทั้งหมด', 'All'), active: text('ใช้งาน', 'Active'), inactive: text('ปิดใช้งาน', 'Inactive') }[id]}</button>)}<small>{text(`${shown.length} รายการ`, `${shown.length} shown`)}</small></div>
    {shown.length ? <table className="catalog-table"><thead><tr><th>{text('รายการ', 'Supplier')}</th><th>{text('รายละเอียด', 'Details')}</th><th>{text('สถานะ', 'Status')}</th><th>{text('อัปเดตล่าสุด', 'Last update')}</th><th><span className="visually-hidden">{text('การทำงาน', 'Actions')}</span></th></tr></thead>
      <tbody>{shown.map(row => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{[row.supplies, row.contact, row.phone].filter(Boolean).join(' · ') || '—'}</td><td>{row.active ? text('ใช้งาน', 'Active') : text('ปิดใช้งาน', 'Inactive')}</td><td>{new Date(row.updatedAt).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' })}</td>
        <td><button type="button" className="secondary" disabled={busy} aria-label={`${text('แก้ไข', 'Edit')} ${row.name}`} onClick={() => open(row)}>{text('แก้ไข', 'Edit')}</button> <button type="button" className="secondary" disabled={busy} aria-label={`${row.active ? text('ปิดใช้งาน', 'Deactivate') : text('เปิดใช้งาน', 'Activate')} ${row.name}`} onClick={() => void toggle(row)}>{row.active ? text('ปิดใช้งาน', 'Deactivate') : text('เปิดใช้งาน', 'Activate')}</button></td></tr>)}</tbody></table>
      : <p className="notice">{rows.length ? text('ไม่พบซัพพลายเออร์ที่ตรงกับตัวกรอง', 'No suppliers match the filter.') : text('ยังไม่มีซัพพลายเออร์ กด "เพิ่มซัพพลายเออร์" เพื่อเริ่ม', 'No suppliers yet. Use “Add supplier” to start.')}</p>}
    {editing && <form className="panel" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>{editing === 'new' ? text('เพิ่มซัพพลายเออร์', 'Add supplier') : `${text('แก้ไข', 'Edit')} · ${editing.name}`}</h2>
      <label>{text('ชื่อ', 'Name')}<input value={form.name} maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>
      <label>{text('สินค้าที่จัดหา', 'What they supply')}<input value={form.supplies} maxLength={200} onChange={event => setForm({ ...form, supplies: event.target.value })} /></label>
      <label>{text('ผู้ติดต่อ', 'Contact person')}<input value={form.contact} maxLength={120} onChange={event => setForm({ ...form, contact: event.target.value })} /></label>
      <label>{text('โทรศัพท์', 'Phone')}<input value={form.phone} maxLength={40} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      <div className="toolbar"><button disabled={!valid || busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button><button type="button" className="secondary" onClick={() => setEditing(undefined)}>{text('ยกเลิก', 'Cancel')}</button></div>
    </form>}
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
