import React, { useState } from 'react';
import { platformDestinations } from '../lib/platform-hub';
import PlatformSidebar from './PlatformSidebar';
import '../styles/food-dispatch.css';
import '../styles/platform.css';
import '../styles/platform-hub.css';

// Navigation only. It reads no data and performs no operation; access to every
// linked page is still enforced by that page's own server calls.
export default function PlatformHub() {
  const [language, setLanguage] = useState<'th' | 'en'>('th');
  const thai = language === 'th';
  const i = thai ? 0 : 1;
  const text = (th: string, en: string) => thai ? th : en;
  return <div className="platform-shell" lang={language}>
    <PlatformSidebar thai={thai} current="/platform" />
    <main className="platform-hub">
      <header><div><p className="eyebrow">PLATFORM</p><h1>{text('ศูนย์ปฏิบัติการแพลตฟอร์ม', 'Platform operations')}</h1><p>{text('เครื่องมือเจ้าหน้าที่ แยกตามสิทธิ์ที่ได้รับ รายการที่ยังไม่เชื่อมต่อบอกสิ่งที่ต้องมีก่อน', 'Staff tools, split by granted authority. Items not connected say what they need first.')}</p></div><button type="button" className="secondary" aria-pressed={thai} onClick={() => setLanguage(thai ? 'en' : 'th')}>{thai ? 'English' : 'ไทย'}</button></header>
      <table>
        <thead><tr><th scope="col">{text('เครื่องมือ', 'Tool')}</th><th scope="col">{text('หน้าที่ / สิ่งที่ต้องมี', 'Purpose / needs')}</th><th scope="col">{text('สถานะ', 'Status')}</th><th scope="col">{text('ทางเข้า', 'Entry')}</th></tr></thead>
        <tbody>{platformDestinations.map(item => <tr key={item.id} data-connected={item.href ? 'true' : 'false'}>
          <th scope="row"><span>{item.id}</span> {item.title[i]}</th>
          <td>{item.href ? item.duty![i] : item.needs![i]}</td>
          <td><em>{item.href ? text('พร้อมใช้งาน', 'Ready') : text('ยังไม่เชื่อมต่อ', 'Not connected')}</em></td>
          <td>{item.href ? <a href={item.href}>{text('เปิดหน้า', 'Open page')}</a> : '—'}</td>
        </tr>)}</tbody>
      </table>
      <p className="platform-hub-note">{text('ทุกหน้าตรวจสิทธิ์ที่เซิร์ฟเวอร์ ลิงก์ในหน้านี้ไม่ได้ให้สิทธิ์เพิ่ม', 'Every page checks authority on the server. A link here grants nothing.')}</p>
    </main>
  </div>;
}
