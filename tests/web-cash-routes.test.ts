import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRoutes } from '../apps/web/src/lib/api-routes';

const allowed = (path: string, method: string) => { const route = apiRoutes.find(([pattern]) => pattern.test(path)); return !!route && route[1].includes(method); };
const id = '00000000-0000-4000-8000-000000000001';
test('every call the cash register, barcode and channel screens make is forwarded by the web proxy', () => {
  for (const [path, method] of [['cash/settings', 'GET'], ['cash/settings', 'PUT'], ['cash/prices', 'GET'], ['cash/prices', 'PUT'], ['cash/addons', 'GET'], ['cash/addons', 'PUT'],
    ['cash/drawer', 'GET'], ['cash/drawer', 'PUT'], ['cash/held', 'GET'], ['cash/held', 'POST'], [`cash/held/${id}/recall`, 'POST'], [`cash/held/${id}/discard`, 'POST'],
    ['cash/quote', 'POST'], ['cash/sales', 'GET'], ['cash/sales', 'POST'], [`cash/sales/${id}`, 'GET'], [`cash/sales/${id}/void`, 'POST'],
    ['barcodes', 'GET'], ['barcodes', 'PUT'], ['barcodes/delete', 'POST'], ['barcodes/lookup', 'GET'], ['reports/export', 'GET'], ['shifts', 'GET'], ['shifts/close', 'POST'],
    ['channels/credentials', 'GET'], ['channels/item-map', 'PUT'], ['channels/orders', 'GET'], ['channels/orders/sync', 'POST'], [`channels/orders/${id}/command`, 'POST'], [`channels/orders/${id}/settlement`, 'POST']] as const)
    assert.ok(allowed(path, method), `${method} ${path} should be forwarded`);
});
test('methods and shapes the screens never use are not forwarded', () => {
  for (const [path, method] of [['cash/sales', 'DELETE'], ['cash/sales', 'PUT'], [`cash/sales/${id}`, 'POST'], [`cash/sales/${id}`, 'DELETE'], [`cash/sales/${id}/void`, 'GET'], ['cash/settings', 'POST'], ['cash/held', 'DELETE'],
    [`cash/held/${id}/recall`, 'GET'], ['cash/sales/not-an-id', 'GET'], ['cash/sales/../settings', 'GET'], ['barcodes', 'DELETE'], ['barcodes/delete', 'GET'], ['cash/unknown', 'GET'], [`channels/orders/${id}/settlement`, 'GET']] as const)
    assert.ok(!allowed(path, method), `${method} ${path} should be refused`);
});
