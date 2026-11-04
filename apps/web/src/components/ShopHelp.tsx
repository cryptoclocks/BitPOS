import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { helpTopics } from '../lib/help-topics';
import ShopSupport from './ShopSupport';
import '../styles/shop-help.css';

// M13: in-system help for the shop. A readiness check read from the shop's own data, how-to topics, and an honest list of what BitPOS cannot offer yet
// (no live chat vendor, no paid packages). Nothing here contacts anyone or charges anything.
type Section = 'floor' | 'prices' | 'wallet' | 'users' | 'receipt' | 'hours';
interface Item { id: string; level: 'required' | 'recommended'; done: boolean; detail: { count: number; of?: number } | null }
interface Readiness { items: Item[]; ready: boolean; lowStock: number }
export default function ShopHelp({ token, language, go }: { token: string; language: 'th' | 'en'; go: (section: Section) => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [data, setData] = useState<Readiness>(); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setState('loading'); setError('');
    api<Readiness>('/help/readiness', undefined, token).then(r => { if (live) { setData(r); setState('ready'); } }).catch(e => { if (live) { setError(errorMessage(e)); setState('error'); } });
    return () => { live = false; };
  }, [token, attempt]);
  const label: Record<string, [string, string, Section | null]> = {
    wallet: [text('กระเป๋ารับเงินของร้าน', 'Shop payment wallet'), text('ตั้งกระเป๋าที่ร้านใช้รับเงิน (ระบบตรวจแค่ว่ามีค่า ไม่ได้ตรวจว่าถูกต้อง)', 'Set the wallet payments arrive in (only checked for being present, not for being right).'), 'wallet'],
    products: [text('มีสินค้าที่ขายได้', 'At least one live product'), text('เพิ่มสินค้าในหน้าเมนู', 'Add products in the menu screen.'), null],
    prices: [text('ประกาศราคาเมนูแล้ว', 'Menu prices published'), text('ประกาศราคาในตั้งค่า › เมนูและราคา', 'Publish prices in Settings › Menu & prices.'), 'prices'],
    register: [text('มีจุดขาย', 'A register exists'), text('เพิ่มจุดขายใน ตั้งค่า › ผังร้านและอุปกรณ์', 'Add a register in Settings › Floor & devices.'), 'floor'],
    register_paired: [text('จุดขายจับคู่กับจอแล้ว', 'A register is paired to a screen'), text('จับคู่จุดขายกับจอลูกค้าใน ตั้งค่า › ผังร้านและอุปกรณ์', 'Pair a register to a customer screen in Settings › Floor & devices.'), 'floor'],
    hours: [text('ตั้งเวลาทำการ', 'Opening hours set'), text('ตั้งเวลาเปิด-ปิดและเขตเวลาของร้าน รายงานจะตัดวันตามเขตเวลานี้', 'Set opening hours and the time zone; reports cut days on it.'), 'hours'],
    receipt: [text('ตั้งหน้าตาใบเสร็จ', 'Receipt layout set'), text('ตั้งชื่อร้านและข้อความท้ายบิล', 'Set the shop name and footer.'), 'receipt'],
    team_pins: [text('พนักงานทุกคนมี PIN', 'Every staff account has a PIN'), text('ตั้ง PIN เพื่อสลับผู้ใช้ที่เครื่องเดียวกัน', 'Set PINs so people can switch user on a shared till.'), 'users'],
  };
  const providerRows: [string, string, string][] = [
    [text('แชตสดกับทีมงาน', 'Live chat with the team'), text('ยังไม่มี', 'Not available'), text('ยังไม่มีผู้ให้บริการแชต จึงไม่มีช่องทางนี้ในแอป', 'No chat vendor is connected, so there is no live chat in the app.')],
    [text('แพ็กเกจ/การสมัครใช้งาน', 'Packages / subscription'), text('ยังไม่เปิด', 'Not offered'), text('ยังไม่มีแพ็กเกจ ราคา หรือสัญญา ระบบไม่เรียกเก็บเงินร้านใด ๆ', 'There are no packages, prices or contracts, and nothing is billed to any shop.')],
  ];
  const countText = (i: Item) => i.detail ? (i.detail.of !== undefined ? ` (${i.detail.count}/${i.detail.of})` : ` (${i.detail.count})`) : '';
  return <section className="panel shop-help" aria-label={text('ช่วยเหลือและตรวจความพร้อม', 'Help and readiness')}>
    <h2>{text('ช่วยเหลือและตรวจความพร้อมของร้าน', 'Help and shop readiness')}</h2>
    <h3>{text('ตรวจความพร้อมก่อนเปิดขาย', 'Readiness before selling')}</h3>
    <p className="reports-sub">{text('อ่านจากข้อมูลจริงของร้าน ไม่ใช่จากที่เราบอกว่าตั้งแล้ว ข้อ "จำเป็น" ต้องครบจึงจะขายได้', 'Read from the shop’s real data, not from what anyone says is set up. Every "Required" item must be done before you can sell.')}</p>
    {state === 'loading' && <p className="notice" role="status" aria-busy="true">{text('กำลังตรวจ…', 'Checking…')}</p>}
    {state === 'error' && <p className="error" role="alert">{error} <button type="button" className="secondary" onClick={() => setAttempt(n => n + 1)}>{text('ลองอีกครั้ง', 'Retry')}</button></p>}
    {data && <>
      <p className={`notice help-verdict ${data.ready ? 'ok' : 'todo'}`} role="status">{data.ready ? text('รายการที่จำเป็นครบแล้ว', 'All required items are done.') : text('ยังมีรายการจำเป็นที่ยังไม่ครบ', 'Some required items are still missing.')}{data.lowStock > 0 ? ` ${text(`· สินค้าใกล้หมด ${data.lowStock} รายการ`, `· ${data.lowStock} product(s) at or below their reorder level`)}` : ''}</p>
      <ul className="help-items">{data.items.map(i => { const [title, hint, section] = label[i.id] ?? [i.id, '', null]; return <li key={i.id} data-done={i.done ? 'true' : 'false'}>
        <span className={`help-chip ${i.done ? 'done' : i.level === 'required' ? 'req' : 'rec'}`}>{i.done ? text('เรียบร้อย', 'Done') : i.level === 'required' ? text('จำเป็น', 'Required') : text('แนะนำ', 'Recommended')}</span>
        <strong>{title}{countText(i)}</strong>
        {!i.done && <small>{hint}</small>}
        {!i.done && section && <button type="button" className="secondary" onClick={() => go(section)}>{text('ไปตั้งค่า', 'Go to setting')}</button>}
      </li>; })}</ul>
    </>}
    <h3>{text('วิธีใช้งาน', 'How things work')}</h3>
    <div className="help-topics">{helpTopics.map(t => <details key={t.id}><summary>{text(t.title[0], t.title[1])}</summary><ul>{t.points.map(([th, en], idx) => <li key={idx}>{text(th, en)}</li>)}</ul></details>)}</div>
    <ShopSupport token={token} language={language} />
    <h3>{text('ติดต่อทีมงานและแพ็กเกจ', 'Contact and packages')}</h3>
    <ul className="help-items">{providerRows.map(([name, status, why]) => <li key={name} data-done="false"><span className="help-chip rec">{status}</span><strong>{name}</strong><small>{why}</small></li>)}</ul>
  </section>;
}
