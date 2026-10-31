import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Session } from '../lib/table';

interface Entry { id: string; actor: string; action: string; subject: string; createdAt: string }
const known: Record<string, [string, string]> = {
  'opening_hours.configure': ['ตั้งเวลาทำการ', 'Opening hours changed'],
  'inventory.receive': ['รับสินค้าเข้า', 'Stock received'],
  'inventory.adjust': ['ปรับสต็อก', 'Stock adjusted'],
  'collection.configure': ['ตั้งค่าการรับสินค้า', 'Collection settings changed'],
  'payment_asset.configure': ['ตั้งค่าสินทรัพย์รับชำระ', 'Payment asset configured'],
  'session.login': ['เข้าสู่ระบบ', 'Signed in'],
  'catalog.product.create': ['เพิ่มสินค้า', 'Product added'],
  'catalog.product.update': ['แก้ไขสินค้า', 'Product edited'],
  'catalog.product.archive': ['เก็บสินค้าเข้าคลัง', 'Product archived'],
  'catalog.product.unarchive': ['นำสินค้ากลับมาขาย', 'Product restored'],
  'catalog.category.rename': ['เปลี่ยนชื่อหมวดสินค้า', 'Category renamed'],
  'pricing.publish': ['ประกาศราคาเมนู', 'Menu prices published'],
  'device.update': ['แก้ไขอุปกรณ์', 'Device updated'],
  'register.pair': ['จับคู่จุดขายกับจอ', 'Register paired to a screen'],
  'register.update': ['แก้ไขจุดขาย', 'Register updated'],
  'table.update': ['แก้ไขโต๊ะ', 'Table updated'],
  'table.clear': ['ล้างโต๊ะ', 'Table cleared'],
};
const promotionLabel = (action: string): [string, string] | undefined => action.startsWith('promotion.') ? ['การทำงานกับโปรโมชัน', 'Promotion activity'] : undefined;
// Read-only view of the server audit log. The log records what the server already
// wrote; this page can neither edit nor delete entries.
export default function ActivityHistory({ session, language }: { session: Session; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [entries, setEntries] = useState<Entry[]>(); const [next, setNext] = useState<string | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function load(cursor?: string) {
    setBusy(true); setMessage('');
    try {
      const page = await api<{ entries: Entry[]; nextCursor: string | null }>(`/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, session.token);
      setEntries(current => cursor && current ? [...current, ...page.entries] : page.entries); setNext(page.nextCursor);
    } catch (error) { setMessage(errorMessage(error)); }
    setBusy(false);
  }
  useEffect(() => { void load(); }, [session.token]);
  return <section className="panel" aria-label={text('ประวัติการใช้งาน', 'Activity history')}>
    <h2>{text('ประวัติการใช้งาน', 'Activity history')}</h2>
    <p>{text('เหตุการณ์สำคัญที่เซิร์ฟเวอร์บันทึกไว้ อ่านอย่างเดียว ผู้ทำรายการแสดงเป็นรหัสผู้ใช้', 'Key events the server recorded. Read-only. The actor is shown as a user id.')}</p>
    {message && <p className="error" role="alert">{message}</p>}
    {!entries && !message && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {entries && (entries.length ? <table className="catalog-table"><thead><tr><th>{text('เวลา', 'When')}</th><th>{text('เหตุการณ์', 'Event')}</th><th>{text('รายการที่เกี่ยวข้อง', 'Subject')}</th><th>{text('ผู้ทำรายการ', 'Actor')}</th></tr></thead><tbody>{entries.map(e => <tr key={e.id}><td>{new Date(e.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')}</td><td>{(known[e.action] ?? promotionLabel(e.action)) ? (known[e.action] ?? promotionLabel(e.action)!)[language === 'th' ? 0 : 1] : e.action}</td><td><small>{e.subject}</small></td><td title={e.actor}><small>{e.actor.slice(0, 8)}</small></td></tr>)}</tbody></table> : <p className="notice">{text('ยังไม่มีเหตุการณ์', 'No events recorded yet.')}</p>)}
    <div className="toolbar">{next && <button type="button" className="secondary" disabled={busy} onClick={() => void load(next)}>{text('โหลดรายการเก่ากว่า', 'Load older')}</button>}<button type="button" className="secondary" disabled={busy} onClick={() => void load()}>{text('โหลดใหม่', 'Refresh')}</button></div>
  </section>;
}
