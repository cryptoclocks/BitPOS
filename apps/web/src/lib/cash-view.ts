import { formatMoney } from './money';
import { toMinor } from './shift-view';

// Types and small pure helpers for the cash register screen. Every amount is a string of integer minor units; nothing here
// prices a sale (the server does) — it only parses what the cashier typed and offers sensible cash-note shortcuts.
export interface CashSale {
  id: string; seq: string; receiptNo: string; status: 'PAID' | 'VOIDED'; currency: { code: string; decimals: number };
  subtotalMinor: string; discountMinor: string; totalMinor: string; netMinor: string; vatMinor: string; vatMode: 'none' | 'inclusive'; vatBps: number;
  tenderMinor: string; changeMinor: string; cashier: string; createdAt: string;
  void: { at: string; by: string; reason: string; restocked: boolean } | null;
  seller: { name?: string; taxId?: string; branch?: string; address?: string };
  lines: { lineNo: number; productId: string; name: string; nameEn: string; qty: number; unitMinor: string; lineTotalMinor: string }[];
}
export interface CashQuote { currency: { code: string; decimals: number }; vatMode: 'none' | 'inclusive'; vatBps: number; subtotalMinor: string; discountMinor: string; totalMinor: string; netMinor: string; vatMinor: string; lines: { productId: string; qty: number; unitMinor: string }[] }
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
