import type { OrderView } from '../../../../packages/contracts/src/index';
import { formatMoney, lineTotal } from './money';
import type { CashSale } from './cash-view';

// Slips are plain HTML documents printed from a hidden frame, so the app's own screen styles never leak into the print and
// nothing leaves the device. Every value is escaped; money comes from the server's integer minor units through formatMoney.
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Lang = 'th' | 'en';
const t = (language: Lang, th: string, en: string) => language === 'th' ? th : en;
const shortId = (order: Pick<OrderView, 'id'>) => order.id.slice(0, 8).toUpperCase();
const lineName = (line: OrderView['pricing']['lines'][number], language: Lang) => language === 'en' && line.nameEn ? line.nameEn : line.name;
const base = (width: string, body: string, title: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:${width} auto;margin:2mm}*{box-sizing:border-box}body{margin:0;width:${width};font:12px/1.35 "Sarabun","Noto Sans Thai",system-ui,sans-serif;color:#000}
h1{font-size:15px;margin:0 0 2px;text-align:center}.c{text-align:center}.r{text-align:right}hr{border:0;border-top:1px dashed #000;margin:5px 0}
.row{display:flex;justify-content:space-between;gap:6px}.row span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}.big{font-size:18px;font-weight:700}.sticker{page-break-after:always;padding:2px 3px}.sticker:last-child{page-break-after:auto}
</style></head><body>${body}</body></html>`;

/** 80 mm summary receipt for one order: lines, bill total and what was actually settled. */
export function receiptDoc(order: OrderView, language: Lang, shop = 'BitPOS'): string {
  const rows = order.pricing.lines.map(line => `<div class="row"><span>${line.qty}× ${escapeHtml(lineName(line, language))}</span><span>${escapeHtml(formatMoney(lineTotal(line)))}</span></div>`).join('');
  const paid = order.status === 'PAID';
  return base('72mm', `<h1>${escapeHtml(shop)}</h1><p class="c">${escapeHtml(t(language, 'ใบเสร็จอย่างย่อ', 'Short receipt'))}<br>#${shortId(order)} · ${escapeHtml(order.authority.serving.label)}</p><hr>${rows}<hr>
<div class="row big"><span>${escapeHtml(t(language, 'ยอดรวม', 'Total'))}</span><span>${escapeHtml(formatMoney(order.pricing.total))}</span></div>
<div class="row"><span>${escapeHtml(paid ? t(language, 'ชำระแล้ว', 'Paid') : t(language, 'ยังไม่ชำระ', 'Not paid'))}</span><span>${escapeHtml(formatMoney(order.settlement))}</span></div><hr>
<p class="c">${escapeHtml(t(language, 'ขอบคุณที่อุดหนุน', 'Thank you'))}</p>`, `${t(language, 'ใบเสร็จ', 'Receipt')} #${shortId(order)}`);
}

/** One cup label per unit ordered (a 2× latte prints two), carrying the queue code, item and note-free serving point. */
export function stickerDocs(order: OrderView, language: Lang): string {
  const total = order.pricing.lines.reduce((n, l) => n + l.qty, 0);
  let index = 0;
  const labels = order.pricing.lines.flatMap(line => Array.from({ length: line.qty }, () => {
    index += 1;
    return `<div class="sticker"><div class="row"><b class="big">#${shortId(order).slice(0, 4)}</b><span class="r">${index}/${total}</span></div><div>${escapeHtml(lineName(line, language))}</div><small>${escapeHtml(order.authority.serving.label)}</small></div>`;
  })).join('');
  return base('50mm', labels || `<p class="c">${escapeHtml(t(language, 'ไม่มีรายการ', 'No items'))}</p>`, `${t(language, 'สติกเกอร์แก้ว', 'Cup labels')} #${shortId(order)}`);
}

export interface ShiftSlip { periodStart: string; periodEnd: string; closedBy: string; note: string; countedCash: { minor: string; currency: string; decimals: number } | null; groups: { currency: string; decimals: number; orders: number; totalMinor: string }[] }
/** Z-report of a closed round exactly as the server froze it; totals are never added across currencies. */
export function zReportDoc(slip: ShiftSlip, language: Lang, shop = 'BitPOS'): string {
  const when = (iso: string) => new Date(iso).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const money = (minor: string, currency: string, decimals: number) => formatMoney({ currency, decimals, amountMinor: minor } as never);
  const groups = new Map<string, { currency: string; decimals: number; orders: number; total: bigint }>();
  for (const g of slip.groups) { const k = `${g.currency}/${g.decimals}`, e = groups.get(k) ?? { currency: g.currency, decimals: g.decimals, orders: 0, total: 0n }; e.orders += g.orders; e.total += BigInt(g.totalMinor); groups.set(k, e); }
  const rows = [...groups.values()].map(g => `<div class="row"><span>${g.orders} ${escapeHtml(t(language, 'ออเดอร์', 'orders'))}</span><span>${escapeHtml(money(g.total.toString(), g.currency, g.decimals))}</span></div>`).join('') || `<p class="c">${escapeHtml(t(language, 'ไม่มียอดในรอบนี้', 'No sales in this round'))}</p>`;
  const cash = slip.countedCash ? `<div class="row"><span>${escapeHtml(t(language, 'เงินสดที่นับได้', 'Counted cash'))}</span><span>${escapeHtml(money(slip.countedCash.minor, slip.countedCash.currency, slip.countedCash.decimals))}</span></div>` : '';
  return base('72mm', `<h1>${escapeHtml(shop)}</h1><p class="c"><b>Z-Report</b><br>${escapeHtml(when(slip.periodStart))}<br>– ${escapeHtml(when(slip.periodEnd))}</p><hr>${rows}${cash}<hr>
<small>${escapeHtml(t(language, 'ปิดโดย', 'Closed by'))}: ${escapeHtml(slip.closedBy)}${slip.note ? `<br>${escapeHtml(slip.note)}` : ''}</small>
<p class="c"><small>${escapeHtml(t(language, 'ยอดชำระแล้ว ก่อนหักคืนเงินและค่าธรรมเนียม', 'Paid sales before refunds and fees'))}</small></p>`, 'Z-Report');
}

/** True when a cash sale may be shown as an abbreviated tax invoice: tax-inclusive, with a seller name and a 13-digit tax id. */
export const isTaxInvoice = (sale: Pick<CashSale, 'vatMode' | 'seller'>) => sale.vatMode === 'inclusive' && !!sale.seller.name && /^[0-9]{13}$/.test(sale.seller.taxId ?? '');
/** Cash register slip. Tax-inclusive sales with a complete seller profile print as an abbreviated tax invoice, everything else as a plain receipt. A voided sale is stamped. */
export function cashReceiptDoc(sale: CashSale, language: Lang): string {
  const money = (minor: string) => escapeHtml(formatMoney({ currency: sale.currency.code, decimals: sale.currency.decimals, amountMinor: minor } as never));
  const invoice = isTaxInvoice(sale), when = new Date(sale.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows = sale.lines.map(l => `<div class="row"><span>${l.qty}× ${escapeHtml(language === 'en' && l.nameEn ? l.nameEn : l.name)}<br><small>@ ${money(l.unitMinor)}</small></span><span>${money(l.lineTotalMinor)}</span></div>`).join('');
  const seller = sale.seller.name ? `<h1>${escapeHtml(sale.seller.name)}</h1>${sale.seller.address ? `<p class="c">${escapeHtml(sale.seller.address)}</p>` : ''}${invoice ? `<p class="c">${escapeHtml(t(language, 'เลขประจำตัวผู้เสียภาษี', 'Tax ID'))} ${escapeHtml(sale.seller.taxId ?? '')} · ${escapeHtml(t(language, 'สาขา', 'Branch'))} ${escapeHtml(sale.seller.branch ?? '00000')}</p>` : ''}` : '<h1>BitPOS</h1>';
  const discount = BigInt(sale.discountMinor) > 0n ? `<div class="row"><span>${escapeHtml(t(language, 'ยอดก่อนลด', 'Subtotal'))}</span><span>${money(sale.subtotalMinor)}</span></div><div class="row"><span>${escapeHtml(t(language, 'ส่วนลด', 'Discount'))}</span><span>-${money(sale.discountMinor)}</span></div>` : '';
  const vat = invoice ? `<div class="row"><span>${escapeHtml(t(language, 'มูลค่าก่อนภาษี', 'Amount before VAT'))}</span><span>${money(sale.netMinor)}</span></div><div class="row"><span>VAT ${(sale.vatBps / 100).toString()}%</span><span>${money(sale.vatMinor)}</span></div><p class="c"><small>${escapeHtml(t(language, 'ราคารวมภาษีมูลค่าเพิ่มแล้ว', 'Prices include VAT'))}</small></p>` : '';
  const voided = sale.status === 'VOIDED' ? `<p class="c big">*** ${escapeHtml(t(language, 'ยกเลิกแล้ว', 'VOID'))} ***</p>` : '';
  const title = invoice ? t(language, 'ใบกำกับภาษีอย่างย่อ', 'Abbreviated tax invoice') : t(language, 'ใบเสร็จรับเงิน', 'Receipt');
  return base('72mm', `${seller}<p class="c"><b>${escapeHtml(title)}</b><br>${escapeHtml(t(language, 'เลขที่', 'No.'))} ${escapeHtml(sale.receiptNo)}<br>${escapeHtml(when)}</p>${voided}<hr>${rows}<hr>${discount}
<div class="row big"><span>${escapeHtml(t(language, 'รวมทั้งสิ้น', 'Total'))}</span><span>${money(sale.totalMinor)}</span></div>${vat}
<div class="row"><span>${escapeHtml(t(language, 'รับเงินสด', 'Cash received'))}</span><span>${money(sale.tenderMinor)}</span></div><div class="row"><span>${escapeHtml(t(language, 'เงินทอน', 'Change'))}</span><span>${money(sale.changeMinor)}</span></div><hr>
<p class="c">${escapeHtml(t(language, 'ขอบคุณที่อุดหนุน', 'Thank you'))}</p>`, `${title} ${sale.receiptNo}`);
}

/** Prints an HTML document from an off-screen frame. Resolves false when the browser blocks it. */
export function printDocument(html: string): Promise<boolean> {
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.onload = () => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); resolve(true); } catch { resolve(false); }
      window.setTimeout(() => frame.remove(), 60_000);
    };
    frame.srcdoc = html; document.body.appendChild(frame);
  });
}
