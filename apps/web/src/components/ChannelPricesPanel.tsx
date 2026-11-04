import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { decimalAmount, formatMoney, parsePrice } from '../lib/money';
import type { Product } from '../lib/menu';
import { cellKey, channelChanges, channelOrder, savedMap, type Channel, type ChannelCell } from '../lib/channel-prices';
import '../styles/channel-prices.css';

interface View { priceVersion: string | null; currency: 'USD' | 'USDG' | null; decimals: number | null; revision: string; prices: ChannelCell[] }

// M03b: owner-set price per channel. Blank = the base price. Changes affect NEW quotes only; a quote already issued is refused on accept (QUOTE_CHANGED)
// rather than silently repriced, and paid orders keep their frozen lines.
export default function ChannelPricesPanel({ token, products, language, onSaved }: { token: string; products: Product[]; language: 'th' | 'en'; onSaved?: () => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [view, setView] = useState<View>(); const [draft, setDraft] = useState<Record<string, string>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const names: Record<Channel, string> = { counter: text('หน้าร้าน (เคาน์เตอร์)', 'Counter'), table: text('สั่งที่โต๊ะ / QR', 'Table / QR'), online: text('สั่งออนไลน์', 'Online') };
  async function load() {
    setState('loading'); setMessage('');
    try { const next = await api<View>('/settings/channel-prices', undefined, token); setView(next); setDraft({}); setState('ready'); }
    catch (error) { setMessage(errorMessage(error)); setState('error'); }
  }
  useEffect(() => { void load(); }, [token]);
  const decimals = (view?.decimals ?? 2) as 2 | 4 | 6, currency = view?.currency ?? 'USD';
  const saved = savedMap(view?.prices ?? []);
  const shown = (id: string, ch: Channel) => { const key = cellKey(id, ch); if (key in draft) return draft[key]!; const m = saved.get(key); return m ? decimalAmount(currency === 'USDG' ? { currency: 'USDG', decimals: 6, amountMinor: m } : { currency: 'USD', decimals: decimals === 4 ? 4 : 2, amountMinor: m }) : ''; };
  async function save() {
    if (!view?.priceVersion) return;
    const changes = channelChanges(saved, draft, t => parsePrice(t, currency, decimals));
    if ('bad' in changes) { setMessage(text(`ตรวจราคา: ใช้ตัวเลขไม่เกิน ${decimals} ตำแหน่งทศนิยม`, `Check the price: at most ${decimals} decimal places.`)); return; }
    if (!changes.set.length) { setMessage(text('ไม่มีการเปลี่ยนแปลง', 'Nothing changed')); return; }
    setBusy(true); setMessage('');
    try { await api('/settings/channel-prices', { priceVersion: view.priceVersion, expectedRevision: view.revision, set: changes.set }, token, 'PUT'); setMessage(text('บันทึกราคาตามช่องทางแล้ว มีผลกับออเดอร์ใหม่', 'Channel prices saved. They apply to new orders.')); await load(); onSaved?.(); setMessage(text('บันทึกราคาตามช่องทางแล้ว มีผลกับออเดอร์ใหม่', 'Channel prices saved. They apply to new orders.')); }
    catch (error) { setMessage(error instanceof ApiError && error.status === 409 ? text('ราคามีการเปลี่ยนแปลงแล้ว โหลดล่าสุดแล้วลองอีกครั้ง', 'Prices changed. Reload and try again.') : errorMessage(error)); }
    setBusy(false);
  }
  return <section className="panel channel-prices" aria-label={text('ราคาตามช่องทาง', 'Prices per channel')}>
    <h2>{text('ราคาตามช่องทางขาย', 'Prices per sales channel')}</h2>
    <p className="catalog-sub">{text('เว้นว่าง = ใช้ราคาพื้นฐานของเมนู ราคาช่องทางแทนที่ราคาพื้นฐานเฉพาะช่องทางนั้น และสินค้านั้นจะไม่ได้ส่วนลดโปรโมชันของเมนูในช่องทางนั้น (ไม่ซ้อนส่วนลด) เครื่องคิดเงินสดมีรายการราคาแยกของตัวเอง ราคาจาก GrabFood มาจากแพลตฟอร์ม', 'Blank = the menu base price. A channel price replaces the base price on that channel only, and the product gets no menu promotion there (no stacking). The cash register has its own price list; GrabFood prices come from the platform.')}</p>
    {state === 'loading' && <p className="notice" role="status">{text('กำลังโหลดราคา…', 'Loading prices…')}</p>}
    {state === 'error' && <div role="alert"><p className="error">{message}</p><button type="button" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Try again')}</button></div>}
    {state === 'ready' && view && !view.priceVersion && <p className="notice">{text('ตั้งราคาเมนูพื้นฐานก่อน แล้วจึงตั้งราคาตามช่องทางได้', 'Publish the base menu prices first, then set channel prices.')}</p>}
    {state === 'ready' && view?.priceVersion && <>
      <div className="channel-prices-scroll"><table><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('ราคาพื้นฐาน', 'Base price')}</th>{channelOrder.map(c => <th key={c}>{names[c]}</th>)}</tr></thead>
        <tbody>{products.map(p => <tr key={p.id}><td className="cp-name"><strong>{language === 'th' ? p.name : p.nameEn}</strong></td><td data-label={text('ราคาพื้นฐาน', 'Base price')}>{p.basePrice ? formatMoney(p.basePrice) : '—'}</td>
          {channelOrder.map(c => <td key={c} data-label={names[c]}><input inputMode="decimal" value={shown(p.id, c)} placeholder={text('ใช้ราคาพื้นฐาน', 'Base price')} disabled={busy} aria-label={`${names[c]}: ${language === 'th' ? p.name : p.nameEn}`} onChange={e => { setMessage(''); setDraft(d => ({ ...d, [cellKey(p.id, c)]: e.target.value })); }} /></td>)}</tr>)}</tbody></table></div>
      <div className="toolbar"><button type="button" disabled={busy || !Object.keys(draft).length} onClick={() => void save()}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึกราคาตามช่องทาง', 'Save channel prices')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void load()}>{text('โหลดราคาที่บันทึก', 'Reload saved prices')}</button></div>
      {message && <p role="status" className="notice">{message}</p>}
    </>}
  </section>;
}
