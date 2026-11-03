import { escapeHtml } from '../print-slip';

/** A short sample with Thai, English, digits and a width ruler, so the first physical print shows alignment, darkness and shaping. */
export function testReceiptHtml(language: 'th' | 'en', info: { printer: string; paperMm: number; density: number; when?: Date }): string {
  const th = language === 'th', when = (info.when ?? new Date()).toLocaleString(th ? 'th-TH' : 'en-GB');
  const rows = [['ลาเต้เย็น Iced latte', '65.00'], ['เอสเปรสโซ่ Espresso', '55.00'], ['บราวนี่ช็อกโกแลต Chocolate brownie', '75.00']];
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:12px/1.4 "Sarabun","Noto Sans Thai",system-ui,sans-serif}h1{font-size:18px;margin:0 0 2px;text-align:center}.c{text-align:center}hr{border:0;border-top:1px dashed #000;margin:5px 0}.row{display:flex;justify-content:space-between;gap:6px}.big{font-size:18px;font-weight:700}
.ruler{display:flex;justify-content:space-between;font-size:10px}.bar{height:6px;border-left:2px solid #000;border-right:2px solid #000;border-bottom:2px solid #000;margin-bottom:4px}</style></head><body>
<h1>BitPOS</h1><p class="c">${escapeHtml(th ? 'พิมพ์ทดสอบเครื่องพิมพ์ใบเสร็จ' : 'Receipt printer test')}<br>${escapeHtml(info.printer)} · ${info.paperMm} mm · ${th ? 'ความเข้ม' : 'darkness'} ${info.density}<br>${escapeHtml(when)}</p><hr>
<div class="bar"></div><div class="ruler"><span>◀</span><span>${info.paperMm} mm · ${th ? 'ขอบเนื้อหา' : 'content edges'}</span><span>▶</span></div><hr>
${rows.map(r => `<div class="row"><span>${escapeHtml(r[0]!)}</span><span>${r[1]}</span></div>`).join('')}<hr>
<div class="row big"><span>${escapeHtml(th ? 'ยอดรวม' : 'Total')} Total</span><span>195.00</span></div><hr>
<p class="c">ไม่มีการเรียกเก็บเงินจริง · No real charge<br>ก ข ฃ ค ฅ ฆ ง จ ฉ ช ซ ฌ ญ — ABCDEFG 0123456789</p></body></html>`;
}
