/** Parses what a person typed as a money amount into integer minor units; null when it is not a plain non-negative amount
 * with at most `decimals` fractional digits. No floating point is used. */
export function toMinor(input: string, decimals: number): string | null {
  const value = input.trim().replace(/,/g, '');
  const match = /^(\d{1,15})(?:\.(\d*))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return null;
  const minor = BigInt(match[1] + fraction.padEnd(decimals, '0'));
  return minor.toString();
}
/** Sums the open period per currency/precision; never across denominations. */
export function perDenomination(groups: readonly { currency: string; decimals: number; orders: number; totalMinor: string }[]) {
  const map = new Map<string, { currency: string; decimals: number; orders: number; totalMinor: bigint }>();
  for (const g of groups) {
    const key = `${g.currency}/${g.decimals}`, entry = map.get(key) ?? { currency: g.currency, decimals: g.decimals, orders: 0, totalMinor: 0n };
    entry.orders += g.orders; entry.totalMinor += BigInt(g.totalMinor); map.set(key, entry);
  }
  return [...map.values()];
}
