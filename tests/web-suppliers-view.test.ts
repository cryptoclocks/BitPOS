import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSuppliers } from '../apps/web/src/lib/suppliers-view';
import type { SupplierRow } from '../apps/web/src/lib/suppliers-view';

const row = (id: string, name: string, supplies: string, active: boolean, contact = '', phone = ''): SupplierRow => ({ id, name, supplies, contact, phone, active, version: 1, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z' });

test('status filter applies first and search covers name, supplies, contact and phone', () => {
  const rows = [row('a', 'Coffee Supply Co.', 'Beans / milk', true, 'Nok', '0812345678'), row('b', 'Morning Bakery', 'Croissant / cake', true), row('c', 'Old Dairy', 'Milk', false)];
  assert.equal(filterSuppliers(rows, 'all', '').length, 3);
  assert.deepEqual(filterSuppliers(rows, 'active', '').map(r => r.id), ['a', 'b']);
  assert.deepEqual(filterSuppliers(rows, 'inactive', '').map(r => r.id), ['c']);
  assert.deepEqual(filterSuppliers(rows, 'all', 'MILK').map(r => r.id), ['a', 'c'], 'matches what they supply, ignoring case');
  assert.deepEqual(filterSuppliers(rows, 'active', 'milk').map(r => r.id), ['a'], 'filter and search both apply');
  assert.deepEqual(filterSuppliers(rows, 'all', 'nok').map(r => r.id), ['a'], 'contact person');
  assert.deepEqual(filterSuppliers(rows, 'all', '0812').map(r => r.id), ['a'], 'phone');
});
