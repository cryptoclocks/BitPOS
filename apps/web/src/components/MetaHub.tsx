// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// The Muse tab of meta-pos (Meta edition): the Meta-only pages (orders from NFC tap, Messenger, AI agents and Stripe
// bills; table bookings and floor; Muse Spark offers; consented customers; Muse Connector; AI evidence; Stripe payouts)
// shown inside the POS screens. The POS session is exchanged once for the Meta staff cookie (/meta/staff/api/sso);
// every Meta page still re-reads the member's role on the server.
import React, { useEffect, useState } from 'react';
import MerchantIcon from './MerchantIcon';
import { metaApi } from './MetaCounterBill';

const PAGES = [
 ['orders', '/meta/staff', 'ออเดอร์ Meta', 'Meta orders', 'receipt'],
 ['kitchen', '/meta/staff/kitchen', 'คิวครัว', 'Kitchen', 'coffee'],
 ['bookings', '/meta/staff/bookings', 'จองโต๊ะ', 'Table bookings', 'chart'],
 ['offers', '/meta/staff/offers', 'โปร Muse Spark', 'Muse Spark offers', 'card'],
 ['customers', '/meta/staff/customers', 'ลูกค้า Messenger', 'Messenger customers', 'staff'],
 ['connector', '/meta/staff/connector', 'Muse Connector', 'Muse Connector', 'link'],
 ['ledger', '/meta/staff/ledger', 'หลักฐาน AI', 'AI evidence', 'check'],
 ['payouts', '/meta/staff/payouts', 'ยอดโอน Stripe', 'Stripe payouts', 'card'],
 ['settings', '/meta/staff/settings', 'อุปกรณ์และ Messenger', 'Devices & Messenger', 'settings'],
] as const;

export default function MetaHub({ session, language }: { session: { token: string; role: string }; language: 'th' | 'en' }) {
 const text = (th: string, en: string) => language === 'th' ? th : en;
 const [ready, setReady] = useState<'wait' | 'ok' | 'error'>('wait');
 const [page, setPage] = useState<(typeof PAGES)[number][0]>('orders');
 useEffect(() => { let on = true; setReady('wait'); void metaApi('/sso', session.token, {}).then(() => on && setReady('ok')).catch(() => on && setReady('error')); return () => { on = false; }; }, [session.token]);
 const boss = session.role !== 'staff';
 const shown = PAGES.filter(p => boss || !['ledger', 'payouts'].includes(p[0]));
 const current = shown.find(p => p[0] === page) ?? shown[0];
 return <section className="panel meta-hub">
  <div className="meta-hub-head"><div><span className="floor-eyebrow">MUSE · META</span><h2>{text('ฟีเจอร์ของ Meta', 'Meta features')}</h2><p>{text('แตะ NFC · Messenger · Muse Spark · Stripe · จองโต๊ะ', 'NFC tap · Messenger · Muse Spark · Stripe · table bookings')}</p></div></div>
  <div className="meta-hub-tabs" role="tablist">{shown.map(([id, , th, en, icon]) => <button key={id} role="tab" aria-selected={current[0] === id} className={current[0] === id ? '' : 'secondary'} onClick={() => setPage(id)}><MerchantIcon name={icon} />{text(th, en)}</button>)}</div>
  {ready === 'wait' && <p className="notice" role="status">{text('กำลังเชื่อมต่อ…', 'Connecting…')}</p>}
  {ready === 'error' && <p className="notice" role="alert">{text('เปิดหน้า Meta ไม่ได้ กรุณาเข้าสู่ระบบใหม่', 'Could not open the Meta pages. Please sign in again.')}</p>}
  {ready === 'ok' && <iframe key={`${current[0]}:${language}`} className="meta-frame" title={text(current[2], current[3])} src={`/meta/staff/lang?l=${language}&b=${encodeURIComponent(current[1])}`} />}
 </section>;
}
