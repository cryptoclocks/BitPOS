import React, { useState } from 'react';
import { platformDestinations } from '../lib/platform-hub';
import '../styles/platform-hub.css';

// Navigation only. It reads no data and performs no operation; access to every
// linked page is still enforced by that page's own server calls.
export default function PlatformHub() {
  const [language, setLanguage] = useState<'th' | 'en'>('en');
  const i = language === 'th' ? 0 : 1;
  const text = (th: string, en: string) => language === 'th' ? th : en;
  return <main className="platform-hub" lang={language}>
    <header><div><p className="eyebrow">PLATFORM</p><h1>{text('ศูนย์ปฏิบัติการแพลตฟอร์ม', 'Platform operations')}</h1><p>{text('เมนูที่ลิงก์ได้คือหน้าที่มีอยู่จริง รายการที่ยังไม่เชื่อมต่อบอกสิ่งที่ต้องมีก่อน', 'Linked items are pages that exist. Items not connected say what they need first.')}</p></div><button type="button" className="secondary" aria-pressed={language === 'th'} onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}>{language === 'th' ? 'English' : 'ไทย'}</button></header>
    <ul>{platformDestinations.map(item => <li key={item.id} data-connected={item.href ? 'true' : 'false'}>{item.href ? <a href={item.href}><span>{item.id}</span><strong>{item.title[i]}</strong><small>{text('เปิดหน้า', 'Open page')}</small></a> : <div><span>{item.id}</span><strong>{item.title[i]}</strong><small>{text('ยังไม่เชื่อมต่อ · ', 'Not connected · ')}{item.needs![i]}</small></div>}</li>)}</ul>
  </main>;
}
