import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogStatus, categorySummary, filterCatalog } from '../apps/web/src/lib/catalog-view';

const money = { currency: 'USD', decimals: 2, amountMinor: '100' } as const;
test('status uses only price and availability from the menu read', () => {
  assert.equal(catalogStatus({ unitPrice: null, available: 9 }), 'price_missing');
  assert.equal(catalogStatus({ unitPrice: money, available: 0 }), 'sold_out');
  assert.equal(catalogStatus({ unitPrice: money, available: 3 }), 'on_sale');
});
test('filter and category summary are derived from products', () => {
  const products = [{ name: 'ลาเต้', nameEn: 'Latte', category: 'Coffee', description: '' }, { name: 'ชา', nameEn: 'Tea', category: 'Tea', description: 'green' }, { name: 'x', nameEn: 'Mystery', category: '', description: '' }];
  assert.deepEqual(filterCatalog(products, 'green', '').map(p => p.nameEn), ['Tea']);
  assert.deepEqual(filterCatalog(products, '', 'Coffee').map(p => p.nameEn), ['Latte']);
  assert.deepEqual(categorySummary(products), [{ category: '', count: 1 }, { category: 'Coffee', count: 1 }, { category: 'Tea', count: 1 }]);
});
