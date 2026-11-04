import { api } from './api';
import type { DocLang, ReceiptLook } from './print-slip';

// M09: the shop-wide look of a printed bill (name, footer, default language, paper width) lives on the server. This module keeps the last copy the
// till loaded so any print button can read it synchronously; it carries no amounts. Until a copy loads, bills print exactly as they did before.
export interface ReceiptSettings { shopName: string; shopNameEn: string; footer: string; footerEn: string; defaultLang: DocLang; paperMm: 58 | 80; revision: number; configured: boolean }
let current: ReceiptSettings | undefined;
export const currentReceiptSettings = () => current;
export const rememberReceiptSettings = (value: ReceiptSettings | undefined) => { current = value; };
export async function loadReceiptSettings(token: string): Promise<ReceiptSettings> {
  const r = await api<{ settings: ReceiptSettings }>('/receipt-settings', undefined, token);
  current = r.settings; return r.settings;
}
/** The look to hand to receiptDoc / cashReceiptDoc / zReportDoc, optionally stamped as reprint copy `copy` (2 = first reprint). */
export function receiptLook(copy?: number): ReceiptLook | undefined {
  if (!current) return undefined;
  return { shopName: current.shopName, shopNameEn: current.shopNameEn, footer: current.footer, footerEn: current.footerEn, paperMm: current.paperMm, ...(copy ? { copy } : {}) };
}
