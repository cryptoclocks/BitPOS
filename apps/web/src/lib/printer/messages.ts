import type { JobState } from './queue';

type Lang = 'th' | 'en';
const pick = (l: Lang, th: string, en: string) => (l === 'th' ? th : en);

/** Plain-language text for an error code or a browser Bluetooth error. Never shows a raw stack or an internal code to staff. */
export function printerErrorText(error: string | undefined, language: Lang): string {
  const e = error ?? '';
  if (/UNSUPPORTED/.test(e)) return pick(language, 'เบราว์เซอร์นี้เชื่อมต่อ Bluetooth โดยตรงไม่ได้ ใช้ Chrome หรือ Edge บนคอมพิวเตอร์/Android หรือใช้ปุ่มพิมพ์ปกติ', 'This browser cannot use Bluetooth directly. Use Chrome or Edge on a computer or Android, or the normal print button.');
  if (/NOT_SELECTED|NOT_CONFIGURED/.test(e)) return pick(language, 'ยังไม่ได้เลือกเครื่องพิมพ์ ไปที่ ตั้งค่า › เครื่องพิมพ์ใบเสร็จ', 'No printer chosen yet. Go to Settings › Receipt printer.');
  if (/NotFoundError|CHOOSER_CANCELLED|User cancelled|cancelled the requestDevice/i.test(e)) return pick(language, 'ยังไม่ได้เลือกเครื่องพิมพ์ในหน้าต่างของเบราว์เซอร์', 'No printer was picked in the browser window.');
  if (/CONNECT_TIMEOUT|NetworkError|GATT|Connection failed/i.test(e)) return pick(language, 'เชื่อมต่อเครื่องพิมพ์ไม่ได้ ตรวจว่าเปิดเครื่องและอยู่ใกล้ ๆ แล้วกดเชื่อมต่อใหม่', 'Could not reach the printer. Check it is on and close by, then reconnect.');
  if (/DISCONNECTED/.test(e)) return pick(language, 'การเชื่อมต่อหลุดระหว่างพิมพ์ กระดาษอาจออกบางส่วนหรือครบแล้ว ตรวจที่เครื่องก่อนสั่งพิมพ์ซ้ำ', 'The connection dropped while printing. Paper may have come out in part or in full. Check the printer before printing again.');
  if (/CANCELLED/.test(e)) return pick(language, 'ยกเลิกการพิมพ์แล้ว ตรวจที่เครื่องก่อนสั่งพิมพ์ซ้ำ', 'Printing was cancelled. Check the printer before printing again.');
  if (/RECEIPT_TOO_LONG/.test(e)) return pick(language, 'ใบเสร็จยาวเกินที่รองรับ ใช้ปุ่มพิมพ์ปกติแทน', 'This receipt is longer than supported. Use the normal print button.');
  if (/SecurityError|NotAllowed/i.test(e)) return pick(language, 'เบราว์เซอร์ไม่อนุญาต Bluetooth หน้านี้ ต้องเปิดผ่าน HTTPS และอนุญาตเมื่อถูกถาม', 'The browser blocked Bluetooth on this page. It needs HTTPS and your permission.');
  return pick(language, 'พิมพ์ไม่สำเร็จ ลองเชื่อมต่อเครื่องพิมพ์ใหม่', 'Printing did not work. Try reconnecting the printer.');
}

export function jobStateText(state: JobState, sent: number, total: number, language: Lang): string {
  switch (state) {
    case 'queued': return pick(language, 'รอคิวพิมพ์…', 'Waiting in the print queue…');
    case 'preparing': return pick(language, 'กำลังเตรียมภาพใบเสร็จ…', 'Preparing the receipt image…');
    case 'sending': return pick(language, `กำลังส่งไปเครื่องพิมพ์ ${sent}/${total}`, `Sending to the printer ${sent}/${total}`);
    case 'sent': return pick(language, 'ส่งข้อมูลครบแล้ว ตรวจว่ากระดาษออก (ระบบยืนยันกระดาษที่ออกจริงไม่ได้)', 'All data sent. Check the paper came out (the app cannot confirm paper output).');
    case 'failed': return pick(language, 'ยังไม่ได้พิมพ์ ไม่มีข้อมูลถูกส่งไปเครื่อง', 'Not printed. Nothing was sent to the printer.');
    case 'uncertain': return pick(language, 'ไม่แน่ใจว่าพิมพ์ครบหรือไม่', 'Not sure whether it printed.');
    case 'cancelled': return pick(language, 'ยกเลิกแล้ว', 'Cancelled.');
  }
}
