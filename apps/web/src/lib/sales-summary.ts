export interface SalesGroupRow { currency: string; decimals: number; sourceKind: string; orders: number; totalMinor: string }
export interface SalesSummary { currency: string; decimals: number; totalMinor: bigint; orders: number; averageMinor: bigint; channels: { kind: string; orders: number; share: number }[] }
/** Totals and channel shares from server sales rows. Money is never added across currencies: with more than one currency/precision there is no summary. */
export function salesSummary(groups: readonly SalesGroupRow[]): SalesSummary | null {
  if (!groups.length || new Set(groups.map(g => `${g.currency}/${g.decimals}`)).size !== 1) return null;
  const { currency, decimals } = groups[0], bySource = new Map<string, { orders: number; total: bigint }>();
  let totalMinor = 0n, orders = 0;
  for (const g of groups) {
    const amount = BigInt(g.totalMinor);
    totalMinor += amount; orders += g.orders;
    const current = bySource.get(g.sourceKind) ?? { orders: 0, total: 0n };
    current.orders += g.orders; current.total += amount; bySource.set(g.sourceKind, current);
  }
  const channels = [...bySource.entries()]
    .sort((a, b) => (b[1].total > a[1].total ? 1 : b[1].total < a[1].total ? -1 : a[0].localeCompare(b[0])))
    .map(([kind, c]) => ({ kind, orders: c.orders, share: totalMinor > 0n ? Number(c.total * 1000n / totalMinor) / 10 : 0 }));
  return { currency, decimals, totalMinor, orders, averageMinor: orders > 0 ? totalMinor / BigInt(orders) : 0n, channels };
}
