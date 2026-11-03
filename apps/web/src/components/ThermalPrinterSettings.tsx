import React, { useState, useSyncExternalStore } from 'react';
import { bluetoothSupported, choosePrinter, currentSettings, ensurePrinter, forgetPrinter, printConfirmedJob, printHtml, printer, queue, storeSettings } from '../lib/printer';
import { PAPER_OPTIONS, type PrinterSettings } from '../lib/printer/settings';
import { PERIPAGE_A9SMAX, wireDensity, type Density } from '../lib/printer/peripage';
import { jobStateText, printerErrorText } from '../lib/printer/messages';
import { testReceiptHtml } from '../lib/printer/test-receipt';
import '../styles/thermal-printer.css';

// Owner screen: choose, connect, test and forget the Bluetooth thermal printer. Saved on this browser only; nothing here reaches the server.
export default function ThermalPrinterSettings({ language }: { language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const link = useSyncExternalStore(fn => printer.subscribe(fn), () => `${printer.state()}|${printer.name()}`, () => 'unsupported|');
  const jobs = useSyncExternalStore(fn => queue.subscribe(fn), () => queue.snapshot(), () => queue.snapshot());
  const [saved, setSaved] = useState<PrinterSettings | null>(() => currentSettings());
  const [all, setAll] = useState(false); const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [error, setError] = useState('');
  const supported = bluetoothSupported(); const state = link.split('|')[0]!;
  const stateText: Record<string, string> = { unsupported: text('ไม่รองรับ', 'Not supported'), idle: text('ยังไม่เชื่อมต่อ', 'Not connected'), connecting: text('กำลังเชื่อมต่อ…', 'Connecting…'), connected: text('เชื่อมต่อแล้ว', 'Connected'), lost: text('การเชื่อมต่อหลุด', 'Connection lost') };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setNote(''); try { await fn(); } catch (e) { setError(printerErrorText(e instanceof Error ? `${e.name} ${e.message}` : String(e), language)); } setBusy(false); };
  const update = (patch: Partial<PrinterSettings>) => { if (!saved) return; const next = { ...saved, ...patch }; storeSettings(next); setSaved(next); };
  const test = () => run(async () => {
    const ready = await ensurePrinter(); if (!ready.ok) throw new Error(ready.reason);
    const html = testReceiptHtml(language, { printer: ready.settings.deviceName || PERIPAGE_A9SMAX.label, paperMm: ready.settings.contentMm, density: ready.settings.density });
    const r = printHtml(`test-${Date.now()}`, 'Printer test', html, ready.settings); if ('refused' in r) throw new Error('DUPLICATE');
    setNote(text('ส่งงานทดสอบเข้าคิวแล้ว', 'Test job queued.'));
  });
  const testConfirmed = () => run(async () => { const ready = await ensurePrinter(); if (!ready.ok) throw new Error(ready.reason); printConfirmedJob(ready.settings); setNote(text('ส่งภาพทดสอบที่ยืนยันแล้วเข้าคิวแล้ว', 'Verified test image queued.')); });

  return <section className="panel thermal-setup" aria-label={text('เครื่องพิมพ์ใบเสร็จ', 'Receipt printer')}>
    <h2>{text('เครื่องพิมพ์ใบเสร็จ Bluetooth', 'Bluetooth receipt printer')}</h2>
    <p className="thermal-note">{text(`รองรับ ${PERIPAGE_A9SMAX.label} (ทดสอบกับเครื่องจริงแล้ว) ค่าที่ตั้งเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่ส่งขึ้นเซิร์ฟเวอร์`, `Supports the ${PERIPAGE_A9SMAX.label} (tested on real hardware). Settings stay in this browser only and are never sent to the server.`)}</p>
    {!supported && <p className="thermal-warn" role="status">{printerErrorText('UNSUPPORTED', language)} {text('Safari, iPhone/iPad และ Firefox ยังต้องใช้ตัวช่วยพิมพ์ (ดูเอกสาร) หรือพิมพ์ผ่านหน้าต่างพิมพ์ปกติ', 'Safari, iPhone/iPad and Firefox need the print helper (see the docs) or the normal print dialog.')}</p>}
    {error && <p className="thermal-warn" role="alert">{error}</p>}{note && <p className="notice" role="status">{note}</p>}

    <div className="thermal-card"><h3>{text('1. เลือกและเชื่อมต่อ', '1. Choose and connect')}</h3>
      <div className="thermal-row"><strong>{saved ? saved.deviceName || text('เครื่องพิมพ์ที่เลือกไว้', 'Chosen printer') : text('ยังไม่ได้เลือกเครื่องพิมพ์', 'No printer chosen')}</strong><span className={`thermal-pill ${state}`}>{stateText[state]}</span></div>
      <div className="thermal-row">
        <button type="button" disabled={!supported || busy} onClick={() => void run(async () => { const s = await choosePrinter(all); setSaved(s); })}>{saved ? text('เลือกเครื่องใหม่', 'Choose another') : text('ค้นหาและเลือกเครื่องพิมพ์', 'Find and choose a printer')}</button>
        <label className="cash-check-row"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />{text('แสดงอุปกรณ์ทั้งหมด (ไม่รับรองรุ่นอื่น)', 'Show all devices (other models are not supported)')}</label>
      </div>
      {saved && <div className="thermal-row">
        <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => { const ready = await ensurePrinter(); if (!ready.ok) throw new Error(ready.reason); await printer.connect(); })}>{text('เชื่อมต่อใหม่', 'Reconnect')}</button>
        <button type="button" className="secondary" disabled={busy || state !== 'connected'} onClick={() => printer.disconnect()}>{text('ตัดการเชื่อมต่อ', 'Disconnect')}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm(text('ลืมเครื่องพิมพ์นี้บนเครื่อง POS เครื่องนี้?', 'Forget this printer on this POS device?'))) void run(async () => { await forgetPrinter(); setSaved(null); }); }}>{text('ลืมเครื่องพิมพ์', 'Forget printer')}</button>
      </div>}
    </div>

    {saved && <div className="thermal-card"><h3>{text('2. กระดาษและความเข้ม', '2. Paper and darkness')}</h3>
      <fieldset className="thermal-choices" aria-label={text('ความกว้างกระดาษ', 'Paper width')}>{PAPER_OPTIONS.map(o => <label key={o.mm}><input type="radio" name="paper" checked={saved.contentMm === o.mm} onChange={() => update({ contentMm: o.mm })} /><span>{o.label}</span><small>{o.note}</small></label>)}</fieldset>
      <fieldset className="thermal-choices" aria-label={text('ความเข้ม', 'Darkness')}>{([0, 1, 2] as Density[]).map(d => <label key={d}><input type="radio" name="density" checked={saved.density === d} onChange={() => update({ density: d })} /><span>{[text('อ่อน', 'Light'), text('กลาง', 'Medium'), text('เข้ม', 'Dark')][d]}</span><small>{text(`ส่งค่า ${wireDensity(d)} ให้เครื่องรุ่นนี้`, `sent as ${wireDensity(d)} for this model`)}</small></label>)}</fieldset>
      <p className="thermal-note">{text('หน้ากระดาษ 107 มม. พื้นที่พิมพ์ประมาณ 102 มม. (300 DPI = 1200 จุด) ขนาด 80/58 มม. จัดเนื้อหาไว้กึ่งกลางและยังไม่ได้ทดสอบกับกระดาษจริงขนาดนั้น', 'Paper is 107 mm with about 102 mm printable (300 DPI = 1200 dots). The 80/58 mm options centre the content and have not been tested with that paper.')}</p>
    </div>}

    {saved && <div className="thermal-card"><h3>{text('3. พิมพ์ทดสอบ', '3. Test print')}</h3>
      <div className="thermal-row"><button type="button" disabled={busy || !supported} onClick={() => void test()}>{text('พิมพ์ทดสอบ (ไทย + อังกฤษ)', 'Test print (Thai + English)')}</button>
        <button type="button" className="secondary" disabled={busy || !supported} onClick={() => void testConfirmed()}>{text('พิมพ์ภาพทดสอบที่ยืนยันแล้ว', 'Print the verified test image')}</button></div>
      <p className="thermal-note">{text('การส่งข้อมูลครบไม่ได้ยืนยันว่ากระดาษออกครบ ตรวจที่เครื่องทุกครั้ง ถ้าไม่แน่ใจ ระบบจะไม่พิมพ์ซ้ำเอง', 'Finishing the transfer does not prove the paper came out. Always look at the printer. If unsure, nothing is reprinted automatically.')}</p>
      <ul className="thermal-jobs" aria-label={text('งานพิมพ์ล่าสุด', 'Recent print jobs')}>{[...jobs].reverse().slice(0, 5).map(j => <li key={j.id}><strong>{j.label}</strong><span>{jobStateText(j.state, j.sentPackets, j.totalPackets, language)}</span>{j.error && <small>{printerErrorText(j.error, language)}</small>}</li>)}</ul>
    </div>}
  </section>;
}
