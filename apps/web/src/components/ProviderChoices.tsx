import React, { useState } from 'react';
import '../styles/provider-choices.css';

// DEMO-ONLY provider picker. LINE MAN, Wongnai, POS Pay, PromptPay, Stripe, live chat and paid packages have no API access yet, so these buttons only mark a choice in
// THIS browser (localStorage, per shop). Nothing is sent to any provider, no account is created, nobody is charged, no order, price or payment is affected. Every card says so.
type Id = 'lineman' | 'wongnai' | 'pos_pay' | 'promptpay' | 'stripe' | 'livechat' | 'package';
const providers: { id: Id; name: string; kind: [string, string] }[] = [
  { id: 'lineman', name: 'LINE MAN', kind: ['รับออเดอร์เดลิเวอรี', 'Delivery orders'] },
  { id: 'wongnai', name: 'Wongnai', kind: ['รับออเดอร์เดลิเวอรี', 'Delivery orders'] },
  { id: 'pos_pay', name: 'POS Pay', kind: ['รับชำระเงิน', 'Payments'] },
  { id: 'promptpay', name: 'PromptPay', kind: ['รับชำระเงิน (QR)', 'Payments (QR)'] },
  { id: 'stripe', name: 'Stripe', kind: ['รับชำระเงินด้วยบัตร', 'Card payments'] },
  { id: 'livechat', name: 'Live chat', kind: ['แชตสดกับทีมงาน', 'Live chat with the team'] },
  { id: 'package', name: 'Packages', kind: ['แพ็กเกจ/การสมัครใช้งาน', 'Packages / subscription'] },
];
const storeKey = (shop: string) => `bitpos.demo-provider-choices.${shop}`;
const read = (shop: string): Id[] => { try { const v = JSON.parse(window.localStorage.getItem(storeKey(shop)) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is Id => providers.some(p => p.id === x)) : []; } catch { return []; } };
export default function ProviderChoices({ shopId, language }: { shopId: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [chosen, setChosen] = useState<Id[]>(() => read(shopId));
  const toggle = (id: Id) => setChosen(prev => { const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; try { window.localStorage.setItem(storeKey(shopId), JSON.stringify(next)); } catch { /* storage may be blocked: the choice then lasts for this visit only */ } return next; });
  return <section className="provider-choices" aria-label={text('เลือกผู้ให้บริการ (เดโม)', 'Choose providers (demo)')}>
    <h3>{text('ผู้ให้บริการภายนอก (ปุ่มเดโม)', 'External providers (demo buttons)')}</h3>
    <p className="catalog-sub"><b>DEMO</b> {text('ยังไม่ได้รับ API/สิทธิ์จากผู้ให้บริการเหล่านี้ ปุ่มด้านล่างแค่ทำเครื่องหมายว่าสนใจ ไม่ได้เชื่อมต่อ ไม่ส่งข้อมูล ไม่สร้างบัญชี และไม่เก็บเงิน', 'No API or access has been granted by these providers yet. The buttons only mark an interest: nothing is connected, no data is sent, no account is created and nobody is charged.')}</p>
    <ul>{providers.map(p => { const on = chosen.includes(p.id); return <li key={p.id} data-chosen={on ? 'true' : 'false'}>
      <span><strong>{p.name}</strong><small>{text(p.kind[0], p.kind[1])}</small></span>
      <span className="provider-state">{on ? text('เลือกแล้ว (เดโม) — ยังไม่ทำงานจริง', 'Chosen (demo) — not working for real') : text('ยังไม่ได้เชื่อมต่อ', 'Not connected')}</span>
      <button type="button" className={on ? 'secondary' : undefined} aria-pressed={on} onClick={() => toggle(p.id)}>{on ? text('ยกเลิกการเลือก (เดโม)', 'Unselect (demo)') : text('เลือกใช้ (เดโม)', 'Choose (demo)')}</button>
    </li>; })}</ul>
  </section>;
}
