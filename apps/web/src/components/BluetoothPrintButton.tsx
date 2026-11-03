import React, { useState, useSyncExternalStore } from 'react';
import { bluetoothSupported, currentSettings, ensurePrinter, printHtml, queue } from '../lib/printer';
import { jobStateText, printerErrorText } from '../lib/printer/messages';
import '../styles/thermal-printer.css';

// One-tap receipt printing to the saved Bluetooth thermal printer. It only reads the document it is given; a failed or uncertain print
// never touches the order, its payment or the stock, and nothing is ever sent twice without the staff member choosing "print again".
export default function BluetoothPrintButton({ docKey, label, html, language, className = 'secondary' }: { docKey: string; label: string; html: () => string; language: 'th' | 'en'; className?: string }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const jobs = useSyncExternalStore(fn => queue.subscribe(fn), () => queue.snapshot(), () => queue.snapshot());
  const [note, setNote] = useState('');
  const mine = [...jobs].reverse().find(j => j.key === docKey);
  const live = !!mine && ['queued', 'preparing', 'sending'].includes(mine.state);
  if (!bluetoothSupported() && !currentSettings()) return null;
  async function go(reprint: boolean) {
    setNote('');
    const ready = await ensurePrinter();
    if (!ready.ok) { setNote(printerErrorText(ready.reason, language)); return; }
    const r = printHtml(docKey, label, html(), ready.settings, { reprint });
    if ('refused' in r) setNote(r.refused === 'DUPLICATE' ? text('กำลังพิมพ์ใบนี้อยู่', 'This receipt is already printing') : text('ใบนี้อาจพิมพ์ไปแล้ว ตรวจที่เครื่องแล้วกดพิมพ์ซ้ำ', 'This one may already have printed. Check the printer, then print again.'));
  }
  return <span className="bt-print">
    <button type="button" className={className} disabled={live} onClick={() => void go(false)}><span aria-hidden="true">🖨️</span> {text('พิมพ์ผ่าน Bluetooth', 'Print via Bluetooth')}</button>
    {mine && !live && mine.state !== 'cancelled' && <span className={`bt-print-state ${mine.state}`} role="status">{jobStateText(mine.state, mine.sentPackets, mine.totalPackets, language)}{mine.error && ` ${printerErrorText(mine.error, language)}`}{(mine.state === 'uncertain' || mine.state === 'failed' || mine.state === 'sent') && <button type="button" className="linklike" onClick={() => void go(true)}>{text('พิมพ์ซ้ำ', 'Print again')}</button>}</span>}
    {live && mine && <span className="bt-print-state sending" role="status">{jobStateText(mine.state, mine.sentPackets, mine.totalPackets, language)} <button type="button" className="linklike" onClick={() => queue.cancel(mine.id)}>{text('ยกเลิก', 'Cancel')}</button></span>}
    {note && <span className="bt-print-state failed" role="alert">{note}</span>}
  </span>;
}
