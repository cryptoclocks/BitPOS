import { formatMoney } from './money';
import { toMinor } from './shift-view';

// Types and small pure helpers for the cash register screen. Every amount is a string of integer minor units; nothing here
// prices a sale (the server does) — it only parses what the cashier typed and offers sensible cash-note shortcuts.
export interface CashSale {
  id: string; seq: string; receiptNo: string; status: 'PAID' | 'VOIDED'; currency: { code: string; decimals: number };
  subtotalMinor: string; discountMinor: string; totalMinor: string; netMinor: string; vatMinor: string; vatMode: 'none' | 'inclusive'; vatBps: number;
  tenderMinor: string; changeMinor: string; cashier: string; createdAt: string;
  void: { at: string; by: string; reason: string; restocked: boolean } | null;
  seller: { name?: string; nameEn?: string; taxId?: string; branch?: string; address?: string; addressEn?: string };
  lines: SaleLine[];
}
export interface Addon { id: string; label: string; labelEn: string; priceMinor: string }
export interface SaleLine { vatExempt?: boolean; lineNo: number; productId: string; name: string; nameEn: string; qty: number; unit: string; baseMinor: string | null; unitMinor: string; lineTotalMinor: string; sweetness: number | null; addons: Addon[] }
export interface CartLine { productId: string; qty: number; sweetness?: 0 | 25 | 50 | 75 | 100; addonIds?: string[] }
export interface HeldBill { id: string; label: string; items: CartLine[]; discount: DiscountInput; createdBy: string; createdAt: string }
export interface Drawer { periodStart: string; currency: string; decimals: number; opening: { floatMinor: string; openedBy: string; at: string } | null; orders: number; cashSalesMinor: string; cashInMinor?: string; cashOutMinor?: string; expectedMinor: string | null }
/** One cart line is a product with one set of options; the same drink with other options is another line. */
export const lineKey = (l: { productId: string; sweetness?: number; addonIds?: string[] }) => `${l.productId}|${l.sweetness ?? ''}|${[...new Set(l.addonIds ?? [])].sort().join(',')}`;
/** Short text for the options of a line, e.g. "หวาน 50% · วิปครีม". */
export function optionsText(sweetness: number | null | undefined, addons: { label: string; labelEn: string }[], language: 'th' | 'en' | 'both'): string {
  const parts: string[] = [];
  if (sweetness !== null && sweetness !== undefined) parts.push(language === 'th' ? `หวาน ${sweetness}%` : language === 'en' ? `Sweet ${sweetness}%` : `หวาน ${sweetness}% / Sweet ${sweetness}%`);
  for (const a of addons) parts.push(language === 'th' || !a.labelEn ? a.label : language === 'en' ? a.labelEn : a.labelEn === a.label ? a.label : `${a.label} / ${a.labelEn}`);
  return parts.join(' · ');
}
export interface CashQuote { currency: { code: string; decimals: number }; vatMode: 'none' | 'inclusive'; vatBps: number; subtotalMinor: string; discountMinor: string; totalMinor: string; netMinor: string; vatMinor: string; lines: { productId: string; qty: number; unitMinor: string; sweetness: number | null; addons: Addon[] }[] }
export type DiscountInput = { kind: 'percent'; bps: number } | { kind: 'amount'; minor: string } | null;

/** "Exact" first, then up to three round amounts a customer would plausibly hand over: the total rounded up to the next 50 and 100, then the larger notes. Minor units. */
export function quickTenders(totalMinor: bigint, decimals: number): bigint[] {
  const scale = 10n ** BigInt(decimals), up = (step: bigint) => ((totalMinor + step * scale - 1n) / (step * scale)) * step * scale;
  const candidates = [up(50n), up(100n), 500n * scale, 1000n * scale, 2000n * scale].filter(v => v > totalMinor);
  const rest = [...new Set(candidates.map(String))].map(BigInt).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).slice(0, 3);
  return [totalMinor, ...rest];
}
/** Parses the discount box. Percent allows two decimals (basis points); amount follows the currency's decimals. null = empty, undefined = not valid. */
export function parseDiscount(kind: 'percent' | 'amount', input: string, decimals: number): DiscountInput | undefined {
  if (input.trim() === '') return null;
  if (kind === 'percent') { const bps = toMinor(input, 2); if (bps === null) return undefined; const n = Number(bps); return n >= 1 && n <= 9999 ? { kind: 'percent', bps: n } : undefined; }
  const minor = toMinor(input, decimals); return minor === null || BigInt(minor) === 0n ? undefined : { kind: 'amount', minor };
}
export const moneyOf = (minor: string, currency: { code: string; decimals: number }) => formatMoney({ currency: currency.code, decimals: currency.decimals, amountMinor: minor } as never);
/** "6500" with 2 decimals -> "65.00" for editing in an input. */
export function minorToInput(minor: string, decimals: number): string {
  if (decimals === 0) return minor;
  const d = minor.padStart(decimals + 1, '0'); return `${d.slice(0, -decimals)}.${d.slice(-decimals)}`;
}

/** Demo-only starter price: catalog amount x 35, rounded to the nearest 5 baht (at least 10), as minor units of the cash currency. */
export function demoStarterPriceMinor(catalogMinor: string, catalogDecimals: number, cashDecimals: number): string {
  const num = BigInt(catalogMinor) * 35n, den = 10n ** BigInt(catalogDecimals);
  const baht = (num + den / 2n) / den, fives = ((baht + 2n) / 5n) * 5n, price = fives < 10n ? 10n : fives;
  return (price * 10n ** BigInt(cashDecimals)).toString();
}
