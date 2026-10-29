import test from 'node:test';
import assert from 'node:assert/strict';
import { isLowStock, lowStockRows } from '../apps/web/src/lib/low-stock';

const row = (productId: string, available: number, reorderLevel: number | null) => ({ productId, stock: available, reserved: 0, available, reorderLevel });

test('low means a minimum is set and what can be sold is at or below it', () => {
  assert.equal(isLowStock(row('a', 8, 10)), true);
  assert.equal(isLowStock(row('b', 10, 10)), true, 'at the minimum counts');
  assert.equal(isLowStock(row('c', 11, 10)), false);
  assert.equal(isLowStock(row('d', 0, null)), false, 'no minimum means not tracked, even at zero');
  assert.equal(isLowStock(row('e', 0, 0)), true);
});

test('the most urgent restock comes first and ties keep the server order', () => {
  const rows = [row('ok', 50, 10), row('near', 9, 10), row('empty', 0, 10), row('tie1', 5, 10), row('tie2', 5, 10)];
  assert.deepEqual(lowStockRows(rows).map(r => r.productId), ['empty', 'tie1', 'tie2', 'near']);
});
