// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// The Muse tab of meta-pos (Meta edition): the Meta-only pages (table bookings and floor; Muse Spark offers; consented customers; Muse Connector; AI evidence; Stripe payouts)
// shown inside the POS screens. The POS session is exchanged once for the Meta staff cookie (/meta/staff/api/sso);
// every Meta page still re-reads the member's role on the server.
import React, { useEffect, useState } from 'react';
import MerchantIcon from './MerchantIcon';
import { metaApi } from './MetaCounterBill';

const PAGES = [
 ['assistant', '/meta/staff/assistant', 'ผู้ช่วยเจ้าของร้าน', 'Owner assistant', 'help'],
 ['bookings', '/meta/staff/bookings', 'จองโต๊ะ', 'Table bookings', 'chart'],
 ['stockcount', '/meta/staff/stockcount', 'นับสต็อกจากรูป (SAM)', 'Count stock (SAM)', 'box'],
 ['offers', '/meta/staff/offers', 'โปร Muse Spark', 'Muse Spark offers', 'card'],
 ['customers', '/meta/staff/customers', 'ลูกค้า Messenger', 'Messenger customers', 'staff'],
 ['connector', '/meta/staff/connector', 'Muse Connector', 'Muse Connector', 'link'],
 ['ledger', '/meta/staff/ledger', 'หลักฐาน AI', 'AI evidence', 'check'],
 ['payouts', '/meta/staff/payouts', 'ยอดโอน Stripe', 'Stripe payouts', 'card'],
 ['look', '/meta/staff/settings/look', 'หน้าตาร้าน', 'Shop look', 'edit'],
 ['settings', '/meta/staff/settings', 'อุปกรณ์และ Messenger', 'Devices & Messenger', 'settings'],
] as const;

export default function MetaHub({ session, language, only }: { session: { token: string; role: string }; language: 'th' | 'en'; only?: (typeof PAGES)[number][0] }) {
 const text = (th: string, en: string) => language === 'th' ? th : en;
 const [ready, setReady] = useState<'wait' | 'ok' | 'error'>('wait');
 const [page, setPage] = useState<(typeof PAGES)[number][0]>(only ?? 'assistant');
 useEffect(() => { let on = true; setReady('wait'); void metaApi('/sso', session.token, {}).then(() => on && setReady('ok')).catch(() => on && setReady('error')); return () => { on = false; }; }, [session.token]);
 const boss = session.role !== 'staff';
 // Promotions has its own POS tab (Muse Spark offers); the Muse tab lists the rest.
 const shown = only ? PAGES.filter(p => p[0] === only) : PAGES.filter(p => p[0] !== 'offers' && (boss || !['ledger', 'payouts', 'assistant', 'look'].includes(p[0])));
 const current = shown.find(p => p[0] === page) ?? shown[0];
 return <section className="panel meta-hub">
  {!only && <div className="meta-hub-head"><div><span className="floor-eyebrow">MUSE · META</span><h2>{only === 'offers' ? text('โปรโมชัน', 'Promotions') : text('ฟีเจอร์ของ Meta', 'Meta features')}</h2><p>{only === 'offers' ? text('Muse Spark ร่างโปร · เจ้าของอนุมัติ หรือตั้ง Allow All · ราคาคิดโดยเซิร์ฟเวอร์', 'Muse Spark drafts · the owner approves or sets Allow All · the server prices') : text('จองโต๊ะ · ลูกค้า Messenger · Muse Connector · หลักฐาน AI · ยอดโอน Stripe · หน้าตาร้าน · อุปกรณ์', 'Table bookings · Messenger customers · Muse Connector · AI evidence · Stripe payouts · shop look · devices')}</p></div></div>}
  {!only && <div className="meta-hub-tabs" role="tablist">{shown.map(([id, , th, en, icon]) => <button key={id} role="tab" aria-selected={current[0] === id} className={current[0] === id ? '' : 'secondary'} onClick={() => setPage(id)}><MerchantIcon name={icon} />{text(th, en)}</button>)}</div>}
  {ready === 'wait' && <p className="notice" role="status">{text('กำลังเชื่อมต่อ…', 'Connecting…')}</p>}
  {ready === 'error' && <p className="notice" role="alert">{text('เปิดหน้า Meta ไม่ได้ กรุณาเข้าสู่ระบบใหม่', 'Could not open the Meta pages. Please sign in again.')}</p>}
  {ready === 'ok' && <iframe key={`${current[0]}:${language}`} className="meta-frame" title={text(current[2], current[3])} src={`/meta/staff/lang?l=${language}&b=${encodeURIComponent(current[1])}`} />}
 </section>;
}
