import type { Money } from '../../../../packages/contracts/src/index';
import { parsePrice } from './money';
export function discountPreview(base: Money, percent: number) {
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw Error('INVALID_DISCOUNT');
  const original = BigInt(base.amountMinor);
  const reduction = original * BigInt(percent) / 100n;
  if (reduction <= 0n || reduction >= original) throw Error('INVALID_DISCOUNT');
  return { reduction: { ...base, amountMinor: reduction.toString() }, final: { ...base, amountMinor: (original - reduction).toString() }, effectivePercent: Number(reduction * 10000n / original) / 100 };
}
/** Resolve an exact money reduction to the existing server discount rule.
 * Never round a requested amount to a different price or widen its approved cap.
 */
export function percentForReduction(base: Money, value: string, cap: number): number {
  if (base.currency !== 'USD' && base.currency !== 'USDG') throw Error('UNSUPPORTED_CURRENCY');
  const amount = parsePrice(value.trim(), base.currency,base.decimals);
  for (let percent = 1; percent <= cap; percent++) {
    try { if (discountPreview(base, percent).reduction.amountMinor === amount) return percent; } catch {}
  }
  throw Error('AMOUNT_NOT_REPRESENTABLE');
}
