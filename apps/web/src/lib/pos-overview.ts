import type { PrivateOrder } from './table';

type Money = PrivateOrder['pricing']['total'];
export type Channel = 'store' | 'delivery' | 'pickup';

// Presentation derived only from the orders the server already returned. Nothing
// here is a settlement, fee or comparison figure: totals are summed only inside
// one denomination, and facts the API does not provide are stated as unavailable.
export function sumSingleDenomination(orders: PrivateOrder[]): Money | 'mixed' | null {
  let total: bigint | undefined; let first: Money | undefined;
  for (const order of orders) {
    const money = order.pricing.total;
    if (!first) first = money;
    else if (first.currency !== money.currency || first.decimals !== money.decimals) return 'mixed';
    total = (total ?? 0n) + BigInt(money.amountMinor);
  }
  return first ? { ...first, amountMinor: (total ?? 0n).toString() } as Money : null;
}
export function channelOf(order: PrivateOrder): Channel {
  const kind = order.authority.serving.kind;
  if (kind === 'delivery') return 'delivery';
  if (kind === 'pickup' || kind === 'takeaway') return 'pickup';
  return 'store';
}
export function isToday(order: PrivateOrder, now: Date): boolean {
  if (!order.createdAt) return false;
  const at = new Date(order.createdAt);
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
}
export function hourlyBuckets(orders: PrivateOrder[]): { hour: number; count: number }[] {
  const hours = orders.filter(o => o.createdAt).map(o => new Date(o.createdAt!).getHours());
  if (!hours.length) return [];
  const last = Math.max(...hours), from = Math.max(0, Math.min(Math.min(...hours), 23 - 5)), to = Math.max(from + 5, last);
  return Array.from({ length: Math.min(24 - from, to - from + 1) }, (_, index) => ({ hour: from + index, count: hours.filter(h => h === from + index).length }));
}
