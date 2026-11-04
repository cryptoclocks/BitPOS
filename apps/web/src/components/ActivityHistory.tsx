import React, { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { collectExport, exportPath } from '../lib/report-export';
import type { ExportPage } from '../lib/report-export';
import type { Session } from '../lib/table';
import '../styles/activity-history.css';

// M09: read-only view of the server audit log (the application role cannot edit or delete it). Filters run on the server, so every page is a page of the
// filtered log. The actor is the account id the server recorded; the name and role are looked up from today's team list and may be missing for
// former staff or system actors.
interface Entry { id: string; actor: string; actorRole: 'owner' | 'manager' | 'staff' | null; actorName: string | null; action: string; subject: string; createdAt: string }
type Category = '' | 'sales' | 'cash' | 'stock' | 'catalog' | 'team' | 'settings' | 'reports';
const known: Record<string, [string, string]> = {
  'order.create': ['สร้างออเดอร์', 'Order created'], 'order.dismiss': ['เคลียร์ออเดอร์ออกจากจอ', 'Order cleared from screen'], 'order.void_unpaid': ['ยกเลิกออเดอร์ที่ยังไม่ชำระ', 'Unpaid order voided'],
  'order.cancel_unpaid': ['ยกเลิกออเดอร์ที่ยังไม่ชำระ', 'Unpaid order cancelled'], 'order.timeout_unpaid': ['ออเดอร์หมดเวลา', 'Order timed out'], 'order.dismiss_paid_for_new_order': ['เคลียร์บิลที่ชำระแล้วเพื่อเริ่มออเดอร์ใหม่', 'Paid bill cleared to start a new order'],
  'order.online.accepted': ['ร้านรับออเดอร์ออนไลน์', 'Online order accepted'], 'order.online.rejected': ['ร้านปฏิเสธออเดอร์ออนไลน์', 'Online order rejected'], 'order.online.timed_out': ['ออเดอร์ออนไลน์หมดเวลารับ', 'Online order acceptance timed out'],
  'order.recovery.acknowledged': ['รับทราบการชำระหลังหมดเวลา', 'Late payment acknowledged'], 'order.pickup.resend': ['ส่งแจ้งรับสินค้าอีกครั้ง', 'Pickup notice resent'], 'order.reservation_anomaly': ['พบความผิดปกติของสต็อกที่จอง', 'Stock reservation anomaly'],
  'bill.void': ['ยกเลิกบิลที่ยังไม่ชำระ', 'Unpaid bill voided'], 'receipt.reprint': ['พิมพ์ใบเสร็จซ้ำ', 'Receipt reprinted'], 'receipt.settings': ['แก้หน้าตาใบเสร็จ', 'Receipt layout changed'],
  'cash.sale': ['ขายเงินสด', 'Cash sale'], 'cash.void': ['ยกเลิกบิลเงินสด', 'Cash sale voided'], 'cash.recall': ['เรียกบิลเงินสดกลับมาพิมพ์', 'Cash sale recalled'], 'cash.settings': ['ตั้งค่าขายเงินสด', 'Cash settings changed'], 'cash.prices': ['ตั้งราคาขายเงินสด', 'Cash prices changed'],
  'cash.movement.in': ['นำเงินเข้าลิ้นชัก', 'Cash put in drawer'], 'cash.movement.out': ['นำเงินออกจากลิ้นชัก', 'Cash taken from drawer'], 'shift.close': ['ปิดรอบขาย', 'Shift closed'],
  'inventory.receive': ['รับสินค้าเข้า', 'Stock received'], 'inventory.adjust': ['ปรับสต็อก', 'Stock adjusted'], 'inventory.reorder_level': ['ตั้งจุดสั่งซื้อ', 'Reorder level set'],
  'supplier.create': ['เพิ่มซัพพลายเออร์', 'Supplier added'], 'supplier.update': ['แก้ไขซัพพลายเออร์', 'Supplier edited'], 'supplier.deactivate': ['ปิดใช้งานซัพพลายเออร์', 'Supplier deactivated'], 'supplier.activate': ['เปิดใช้งานซัพพลายเออร์', 'Supplier reactivated'],
  'catalog.product.create': ['เพิ่มสินค้า', 'Product added'], 'catalog.product.update': ['แก้ไขสินค้า', 'Product edited'], 'catalog.product.archive': ['เก็บสินค้าเข้าคลัง', 'Product archived'], 'catalog.product.unarchive': ['นำสินค้ากลับมาขาย', 'Product restored'],
  'catalog.product.pause': ['พักขายสินค้า', 'Product paused'], 'catalog.product.resume': ['เปิดขายสินค้าอีกครั้ง', 'Product resumed'], 'catalog.product.window': ['ตั้งช่วงเวลาขายสินค้า', 'Selling hours set'], 'catalog.product.image.upload': ['อัปโหลดรูปสินค้า', 'Product image uploaded'],
  'catalog.product.story.update': ['แก้เรื่องราวสินค้า', 'Product story edited'], 'catalog.category.rename': ['เปลี่ยนชื่อหมวดสินค้า', 'Category renamed'], 'pricing.publish': ['ประกาศราคาเมนู', 'Menu prices published'],
  'product.offer.enable': ['เปิดขายออนไลน์', 'Online offer enabled'], 'product.offer.disable': ['ปิดขายออนไลน์', 'Online offer disabled'], 'opening_hours.configure': ['ตั้งเวลาทำการ', 'Opening hours changed'],
  'team.role': ['เปลี่ยนบทบาทสมาชิก', 'Member role changed'], 'team.profile': ['แก้โปรไฟล์พนักงาน', 'Staff profile edited'], 'team.pin.set': ['ตั้ง PIN พนักงาน', 'Staff PIN set'], 'team.pin.clear': ['ล้าง PIN พนักงาน', 'Staff PIN cleared'],
  'team.enable': ['เปิดใช้งานพนักงาน', 'Staff enabled'], 'team.disable': ['ปิดใช้งานพนักงาน', 'Staff disabled'], 'profile.update': ['แก้โปรไฟล์', 'Profile edited'],
  'session.login': ['เข้าสู่ระบบ', 'Signed in'], 'session.logout': ['ออกจากระบบ', 'Signed out'], 'session.logout_all': ['ออกจากระบบทุกเครื่อง', 'Signed out everywhere'], 'session.switch': ['สลับผู้ใช้', 'User switched'], 'session.switch.refused': ['สลับผู้ใช้ไม่ผ่าน', 'User switch refused'],
  'session.switch.locked': ['PIN ถูกล็อกชั่วคราว', 'PIN temporarily locked'], 'session.revoke': ['เพิกถอนเซสชัน', 'Session revoked'], 'session.demo_login': ['เข้าสู่ระบบแบบสาธิต', 'Demo sign-in'],
  'register.pair': ['จับคู่จุดขายกับจอ', 'Register paired to a screen'], 'register.update': ['แก้ไขจุดขาย', 'Register updated'], 'device.update': ['แก้ไขอุปกรณ์', 'Device updated'], 'device.credential.rotate': ['เปลี่ยนรหัสอุปกรณ์', 'Device credential rotated'], 'device.credential.revoke': ['เพิกถอนรหัสอุปกรณ์', 'Device credential revoked'],
  'table.update': ['แก้ไขโต๊ะ', 'Table updated'], 'table.clear': ['ล้างโต๊ะ', 'Table cleared'], 'payment_asset.configure': ['ตั้งค่าสินทรัพย์รับชำระ', 'Payment asset configured'], 'treasury.update': ['เปลี่ยนกระเป๋ารับเงิน', 'Payment wallet changed'],
  'collection.configure': ['ตั้งค่าการรับสินค้า', 'Collection settings changed'], 'rewards.configure': ['ตั้งค่ารางวัล', 'Rewards configured'], 'loyalty.tier.configure': ['ตั้งระดับสมาชิก', 'Loyalty tiers configured'],
  'channel.environment.set': ['ตั้งสภาพแวดล้อมช่องทาง', 'Channel environment set'], 'channel.credentials.save': ['บันทึกคีย์ช่องทาง', 'Channel credentials saved'], 'channel.credentials.test': ['ทดสอบคีย์ช่องทาง', 'Channel credentials tested'], 'channel.credentials.delete': ['ลบคีย์ช่องทาง', 'Channel credentials removed'],
  'customer.edit': ['แก้ข้อมูลลูกค้า', 'Customer edited'], 'report.export': ['ส่งออกรายงาน CSV', 'Report exported (CSV)'],
};
const promotionLabel = (action: string): [string, string] | undefined => action.startsWith('promotion.') ? ['การทำงานกับโปรโมชัน', 'Promotion activity'] : undefined;
const categories: { id: Category; th: string; en: string }[] = [
  { id: '', th: 'ทุกประเภท', en: 'All kinds' }, { id: 'sales', th: 'ออเดอร์และบิล', en: 'Orders & bills' }, { id: 'cash', th: 'เงินสดและรอบขาย', en: 'Cash & shifts' }, { id: 'stock', th: 'สต็อกและซัพพลายเออร์', en: 'Stock & suppliers' },
  { id: 'catalog', th: 'เมนูและราคา', en: 'Menu & prices' }, { id: 'team', th: 'ทีมและการเข้าใช้', en: 'Team & access' }, { id: 'settings', th: 'ตั้งค่าร้าน', en: 'Shop settings' }, { id: 'reports', th: 'รายงาน', en: 'Reports' },
];
const isoDay = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
export default function ActivityHistory({ session, language }: { session: Session; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [category, setCategory] = useState<Category>(''); const [actor, setActor] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [entries, setEntries] = useState<Entry[]>(); const [next, setNext] = useState<string | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [exporting, setExporting] = useState(false);
  const query = useCallback((cursor?: string | null) => {
    const p = new URLSearchParams(); if (category) p.set('category', category); if (actor.trim()) p.set('actor', actor.trim()); if (from) p.set('from', from); if (to) p.set('to', to); if (cursor) p.set('cursor', cursor);
    const q = p.toString(); return `/activity${q ? `?${q}` : ''}`;
  }, [category, actor, from, to]);
  async function load(cursor?: string | null) {
    setBusy(true); setMessage('');
    try {
      const page = await api<{ entries: Entry[]; nextCursor: string | null }>(query(cursor), undefined, session.token);
      setEntries(current => cursor && current ? [...current, ...page.entries.filter(e => !current.some(c => c.id === e.id))] : page.entries); setNext(page.nextCursor);
    } catch (error) { setMessage(errorMessage(error)); if (!cursor) setEntries(undefined); }
    setBusy(false);
  }
  useEffect(() => { void load(); }, [session.token, category, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  async function exportCsv() {
    const range = { from: from || isoDay(-29), to: to || isoDay(0) };
    if (range.to < range.from) { setMessage(text('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม', 'The end date must not be before the start date.')); return; }
    setExporting(true); setMessage('');
    try {
      const file = await collectExport(cursor => api<ExportPage>(exportPath('audit', range.from, range.to, cursor), undefined, session.token));
      const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a');
      link.href = url; link.download = file.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(text(`ส่งออก ${file.rows} รายการ (${range.from} ถึง ${range.to})`, `Exported ${file.rows} entries (${range.from} to ${range.to})`));
    } catch (error) { setMessage(errorMessage(error)); }
    setExporting(false);
  }
  const roleLabel = { owner: text('เจ้าของ', 'Owner'), manager: text('ผู้จัดการ', 'Manager'), staff: text('พนักงาน', 'Staff') };
  const actorCell = (e: Entry) => {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(e.actor);
    if (!isId) return <small>{e.actor}</small>;
    return <span title={e.actor}>{e.actorName ?? (e.actorRole ? roleLabel[e.actorRole] : text('ไม่พบในทีมปัจจุบัน', 'Not on the current team'))}<small className="activity-id">{e.actor.slice(0, 8)}</small></span>;
  };
  const label = (action: string) => { const hit = known[action] ?? promotionLabel(action); return hit ? hit[language === 'th' ? 0 : 1] : null; };
  return <section className="panel activity-history" aria-label={text('ประวัติการใช้งาน', 'Activity history')}>
    <h2>{text('ประวัติการใช้งาน', 'Activity history')}</h2>
    <p>{text('เหตุการณ์สำคัญที่เซิร์ฟเวอร์บันทึกไว้ อ่านอย่างเดียว ระบบไม่เปิดให้แก้หรือลบรายการ ชื่อผู้ทำรายการดูจากทีมปัจจุบัน', 'Key events the server recorded. Read-only: entries cannot be edited or deleted. The actor name comes from the current team list.')}</p>
    <form className="activity-filters" onSubmit={e => { e.preventDefault(); void load(); }}>
      <label>{text('ประเภท', 'Kind')}<select value={category} onChange={e => setCategory(e.target.value as Category)}>{categories.map(c => <option key={c.id} value={c.id}>{text(c.th, c.en)}</option>)}</select></label>
      <label>{text('ตั้งแต่', 'From')}<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
      <label>{text('ถึง', 'To')}<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
      <label className="activity-actor">{text('รหัสผู้ทำรายการ (เต็ม)', 'Actor id (full)')}<input value={actor} maxLength={64} pattern="[A-Za-z0-9._:\-]+" onChange={e => setActor(e.target.value)} /></label>
      <button type="submit" disabled={busy}>{text('ค้นหา', 'Search')}</button>
    </form>
    {message && <p className="error" role="alert">{message} {entries === undefined && <button type="button" className="secondary" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Retry')}</button>}</p>}
    {!entries && !message && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {entries && (entries.length ? <div className="activity-scroll"><table><thead><tr><th>{text('เวลา', 'When')}</th><th>{text('เหตุการณ์', 'Event')}</th><th>{text('รายการที่เกี่ยวข้อง', 'Subject')}</th><th>{text('ผู้ทำรายการ', 'Actor')}</th></tr></thead><tbody>{entries.map(e => <tr key={e.id}><td data-label={text('เวลา', 'When')}>{new Date(e.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')}</td><td data-label={text('เหตุการณ์', 'Event')}>{label(e.action) ?? <code>{e.action}</code>}</td><td data-label={text('รายการที่เกี่ยวข้อง', 'Subject')}><small>{e.subject}</small></td><td data-label={text('ผู้ทำรายการ', 'Actor')}>{actorCell(e)}</td></tr>)}</tbody></table></div> : <p className="notice" role="status">{category || actor || from || to ? text('ไม่พบเหตุการณ์ตามเงื่อนไข', 'No events match these filters.') : text('ยังไม่มีเหตุการณ์', 'No events recorded yet.')}</p>)}
    <div className="toolbar">{next && <button type="button" className="secondary" disabled={busy} onClick={() => void load(next)}>{text('โหลดรายการเก่ากว่า', 'Load older')}</button>}<button type="button" className="secondary" disabled={busy} onClick={() => void load()}>{text('โหลดใหม่', 'Refresh')}</button><button type="button" className="secondary" disabled={exporting} onClick={() => void exportCsv()}>{exporting ? text('กำลังสร้างไฟล์…', 'Building file…') : text('ดาวน์โหลด CSV', 'Download CSV')}</button></div>
    <p className="reports-sub">{text('CSV ใช้ช่วงวันที่ที่เลือก (ถ้าไม่เลือก ใช้ 30 วันล่าสุด) และไม่ใช้ตัวกรองประเภท/รหัสผู้ทำรายการ', 'The CSV covers the dates you pick (the last 30 days if none) and ignores the kind and actor filters.')}</p>
  </section>;
}
