import type { PrivateOrder } from './table';
import { channelOf, sumSingleDenomination } from './pos-overview';
import { formatMoney } from './money';

export interface Range { from: string; to: string } // yyyy-mm-dd, local, inclusive
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function inRange(orders: PrivateOrder[], range: Range): PrivateOrder[] {
  return orders.filter(order => order.createdAt && dayKey(order.createdAt) >= range.from && dayKey(order.createdAt) <= range.to);
}
export function dailyTotals(orders: PrivateOrder[]): { day: string; paid: number; orders: number; total: ReturnType<typeof sumSingleDenomination> }[] {
  const days = new Map<string, PrivateOrder[]>();
  for (const order of orders) if (order.createdAt) days.set(dayKey(order.createdAt), [...(days.get(dayKey(order.createdAt)) ?? []), order]);
  return [...days].sort(([a], [b]) => a < b ? 1 : -1).map(([day, rows]) => { const paid = rows.filter(row => row.status === 'PAID'); return { day, paid: paid.length, orders: rows.length, total: sumSingleDenomination(paid) }; });
}
export function topProducts(orders: PrivateOrder[]): { productId: string; name: string; nameEn: string; qty: number }[] {
  const totals = new Map<string, { productId: string; name: string; nameEn: string; qty: number }>();
  for (const order of orders) if (order.status === 'PAID') for (const line of order.pricing.lines) {
    const prior = totals.get(line.productId);
    totals.set(line.productId, { productId: line.productId, name: line.name, nameEn: line.nameEn, qty: (prior?.qty ?? 0) + line.qty });
  }
  return [...totals.values()].sort((a, b) => b.qty - a.qty || a.nameEn.localeCompare(b.nameEn));
}
export function statusCounts(orders: PrivateOrder[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const order of orders) counts[order.status] = (counts[order.status] ?? 0) + 1;
  return counts;
}
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; // spreadsheet formula guard
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
export function ordersCsv(orders: PrivateOrder[]): string {
  const rows = [['order_id', 'created_at', 'status', 'channel', 'currency', 'amount_minor', 'amount', 'items']];
  for (const order of orders) rows.push([order.id, order.createdAt ?? '', order.status, channelOf(order), order.pricing.total.currency, order.pricing.total.amountMinor, formatMoney(order.pricing.total), order.pricing.lines.map(line => `${line.qty}x ${line.nameEn}`).join('; ')]);
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
