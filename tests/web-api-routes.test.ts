import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRoutes } from '../apps/web/src/lib/api-routes';

const allowed = (path: string, method: string) => { const route = apiRoutes.find(([pattern]) => pattern.test(path)); return !!route && route[1].includes(method); };
const id = '00000000-0000-4000-8000-000000000001';
test('merchant routes used by the POS are forwarded with exactly their methods', () => {
  for (const [path, method] of [['settings/hours', 'GET'], ['settings/hours', 'PUT'], ['reports/sales', 'GET'], ['returns', 'GET'], ['shifts', 'GET'], ['team', 'GET'], [`team/${id}`, 'PATCH'], ['shifts/close', 'POST'], ['suppliers', 'GET'], ['suppliers', 'POST'], [`suppliers/${id}`, 'PATCH'], ['inventory/stock', 'GET'], ['inventory/reorder', 'POST'], ['inventory/movements', 'GET'], ['inventory/movements', 'POST'], ['activity', 'GET'], [`products/${id}`, 'PATCH'], ['categories/rename', 'POST'], ['products', 'POST'], [`products/${id}/archive`, 'POST'], [`products/${id}/unarchive`, 'POST']] as const) assert.ok(allowed(path, method), `${method} ${path}`);
  for (const [path, method] of [['settings/hours', 'DELETE'], ['reports/sales', 'POST'], ['returns', 'POST'], ['shifts', 'POST'], ['team', 'POST'], [`team/${id}`, 'GET'], [`team/${id}`, 'DELETE'], ['shifts/close', 'GET'], ['suppliers', 'DELETE'], [`suppliers/${id}`, 'DELETE'], [`suppliers/${id}`, 'GET'], ['returns/other', 'GET'], ['inventory/stock', 'POST'], ['inventory/reorder', 'GET'], ['activity', 'POST'], [`products/${id}`, 'DELETE'], [`products/${id}/archive`, 'GET'], ['products', 'GET'], ['categories/rename', 'GET'], ['inventory/other', 'GET'], ['reports/other', 'GET']] as const) assert.equal(allowed(path, method), false, `${method} ${path}`);
});
test('ride staff proxy exposes only fare publication and incident review methods',()=>{
  for(const [path,method] of [['mobile/v1/rides/fare','GET'],['mobile/v1/rides/fare','PUT'],['mobile/v1/rides/incidents','GET'],[`mobile/v1/rides/incidents/${id}/review`,'POST']] as const)assert.ok(allowed(path,method),`${method} ${path}`);
  for(const [path,method] of [['mobile/v1/rides/fare','POST'],['mobile/v1/rides/incidents','POST'],[`mobile/v1/rides/incidents/${id}/review`,'GET'],[`mobile/v1/rides/${id}/complete`,'POST']] as const)assert.equal(allowed(path,method),false,`${method} ${path}`);
});
