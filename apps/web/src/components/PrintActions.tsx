import React, { useState } from 'react';
import type { OrderView } from '../../../../packages/contracts/src/index';
import { printDocument, receiptDoc, stickerDocs } from '../lib/print-slip';
import { queuePhrase, speak } from '../lib/voice-call';
import '../styles/print-actions.css';

// Counter helpers for one order: short receipt, one cup label per drink, and a spoken call for a ready order. All local to the
// device; none of them changes the order.
export default function PrintActions({ order, language }: { order: OrderView; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [note, setNote] = useState('');
  const ready = order.fulfillment?.status === 'READY';
  async function print(html: string) { setNote((await printDocument(html)) ? '' : text('เบราว์เซอร์บล็อกการพิมพ์', 'The browser blocked printing')); }
  function call() {
    const r = speak(queuePhrase(order, language), language);
    setNote(r === 'spoken' ? '' : r === 'no_voice' ? text('เครื่องนี้ไม่มีเสียงพูดภาษาไทย (ติดตั้งเสียงไทยในระบบก่อน)', 'No voice for this language is installed on this device') : text('เบราว์เซอร์นี้ไม่รองรับเสียงพูด', 'This browser has no speech support'));
  }
  return <div className="print-actions" role="group" aria-label={text('พิมพ์และเรียกคิว', 'Print and call')}>
    <button type="button" className="secondary" onClick={() => void print(receiptDoc(order, language))}><span aria-hidden="true">🧾</span> {text('พิมพ์ใบเสร็จย่อ', 'Print receipt')}</button>
    <button type="button" className="secondary" onClick={() => void print(stickerDocs(order, language))}><span aria-hidden="true">🏷️</span> {text('พิมพ์สติกเกอร์แก้ว', 'Print cup labels')}</button>
    {ready && <button type="button" className="print-call" onClick={call}><span aria-hidden="true">📣</span> {text('เรียกคิวด้วยเสียง', 'Call by voice')}</button>}
    {note && <p className="notice" role="status">{note}</p>}
  </div>;
}
