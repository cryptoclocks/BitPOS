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
/** The shop's time zone. Asia/Bangkok is the only zone the contract allows, so "today" and hours never follow the browser's zone. */
export const SHOP_TIME_ZONE = 'Asia/Bangkok';
/** The orders list endpoint returns at most this many newest orders (apps/api/src/orders.ts LIMIT 200). */
export const ORDER_LIST_CAP = 200;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: SHOP_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
export const shopDay = (at: Date): string => dayFormat.format(at);
export const shopHour = (at: Date): number => Number(hourFormat.format(at));
/** HH:mm in the shop's zone. */
export function shopTime(iso: string, language: 'th' | 'en'): string {
  return new Date(iso).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: SHOP_TIME_ZONE });
}
export function isToday(order: PrivateOrder, now: Date): boolean {
  if (!order.createdAt) return false;
  return shopDay(new Date(order.createdAt)) === shopDay(now);
}
/** True when the capped list may have dropped orders from today (the oldest returned order is itself from today). */
export function todayMayBeTruncated(orders: PrivateOrder[], now: Date): boolean {
  if (orders.length < ORDER_LIST_CAP) return false;
  const times = orders.filter(o => o.createdAt).map(o => Date.parse(o.createdAt!));
  return !!times.length && shopDay(new Date(Math.min(...times))) === shopDay(now);
}
export function hourlyBuckets(orders: PrivateOrder[]): { hour: number; count: number }[] {
  const hours = orders.filter(o => o.createdAt).map(o => shopHour(new Date(o.createdAt!)));
  if (!hours.length) return [];
  const last = Math.max(...hours), from = Math.max(0, Math.min(Math.min(...hours), 23 - 5)), to = Math.max(from + 5, last);
  return Array.from({ length: Math.min(24 - from, to - from + 1) }, (_, index) => ({ hour: from + index, count: hours.filter(h => h === from + index).length }));
}
