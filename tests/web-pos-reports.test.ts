import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell, dailyTotals, inRange, ordersCsv, statusCounts, topProducts } from '../apps/web/src/lib/pos-reports';
import type { PrivateOrder } from '../apps/web/src/lib/table';

const usd = (amountMinor: string) => ({ currency: 'USD', decimals: 2, amountMinor });
const order = (id: string, status: string, at: string, total: string, lines: { productId: string; name: string; nameEn: string; qty: number }[] = []): PrivateOrder => ({ id, status, createdAt: at, pricing: { kind: 'versioned', priceVersion: 'v', lines, total: usd(total) }, authority: { serving: { kind: 'counter' } } } as unknown as PrivateOrder);
const rows = [order('a', 'PAID', '2026-10-25T10:00:00', '100', [{ productId: 'p1', name: 'ก', nameEn: 'Latte', qty: 2 }]), order('b', 'PAID', '2026-10-26T10:00:00', '300', [{ productId: 'p1', name: 'ก', nameEn: 'Latte', qty: 1 }, { productId: 'p2', name: 'ข', nameEn: 'Tea', qty: 5 }]), order('c', 'AWAITING_PAYMENT', '2026-10-26T11:00:00', '999')];

test('range is inclusive and local-day based', () => {
  assert.deepEqual(inRange(rows, { from: '2026-10-26', to: '2026-10-26' }).map(o => o.id), ['b', 'c']);
});
test('daily totals sum only paid orders per day', () => {
  const days = dailyTotals(rows);
  assert.equal(days[0].day, '2026-10-26'); assert.equal(days[0].orders, 2); assert.equal(days[0].paid, 1);
  assert.deepEqual(days[0].total, usd('300'));
});
test('top products and status counts ignore unpaid lines', () => {
  assert.deepEqual(topProducts(rows).map(p => [p.nameEn, p.qty]), [['Tea', 5], ['Latte', 3]]);
  assert.deepEqual(statusCounts(rows), { PAID: 2, AWAITING_PAYMENT: 1 });
});
test('csv escapes quotes and neutralises spreadsheet formulas', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.match(ordersCsv(rows), /^order_id,created_at,status,channel,currency,amount_minor,amount,items\r\n/);
});
