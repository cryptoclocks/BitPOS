import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRoutes } from '../apps/web/src/lib/api-routes';

const allowed = (path: string, method: string) => { const route = apiRoutes.find(([pattern]) => pattern.test(path)); return !!route && route[1].includes(method); };
const id = '00000000-0000-4000-8000-000000000001';
test('merchant routes used by the POS are forwarded with exactly their methods', () => {
  for (const [path, method] of [['settings/hours', 'GET'], ['settings/hours', 'PUT'], ['settings/rewards', 'GET'], ['settings/rewards', 'PUT'], ['reports/sales', 'GET'], ['overview/summary', 'GET'], ['returns', 'GET'], ['shifts', 'GET'], ['team', 'GET'], [`team/${id}`, 'PATCH'], ['shifts/close', 'POST'], ['suppliers', 'GET'], ['suppliers', 'POST'], [`suppliers/${id}`, 'PATCH'], ['inventory/stock', 'GET'], ['inventory/reorder', 'POST'], ['inventory/movements', 'GET'], ['inventory/movements', 'POST'], ['activity', 'GET'], [`products/${id}`, 'PATCH'], ['categories/rename', 'POST'], ['products', 'POST'], [`products/${id}/archive`, 'POST'], [`products/${id}/unarchive`, 'POST']] as const) assert.ok(allowed(path, method), `${method} ${path}`);
  for (const [path, method] of [['settings/hours', 'DELETE'], ['settings/rewards', 'POST'], ['settings/rewards', 'DELETE'], ['reports/sales', 'POST'], ['overview/summary', 'POST'], ['overview/other', 'GET'], ['returns', 'POST'], ['shifts', 'POST'], ['team', 'POST'], [`team/${id}`, 'GET'], [`team/${id}`, 'DELETE'], ['shifts/close', 'GET'], ['suppliers', 'DELETE'], [`suppliers/${id}`, 'DELETE'], [`suppliers/${id}`, 'GET'], ['returns/other', 'GET'], ['inventory/stock', 'POST'], ['inventory/reorder', 'GET'], ['activity', 'POST'], [`products/${id}`, 'DELETE'], [`products/${id}/archive`, 'GET'], ['products', 'GET'], ['categories/rename', 'GET'], ['inventory/other', 'GET'], ['reports/other', 'GET']] as const) assert.equal(allowed(path, method), false, `${method} ${path}`);
});
test('ride staff proxy exposes only fare publication and incident review methods',()=>{
  for(const [path,method] of [['mobile/v1/rides/fare','GET'],['mobile/v1/rides/fare','PUT'],['mobile/v1/rides/incidents','GET'],[`mobile/v1/rides/incidents/${id}/review`,'POST']] as const)assert.ok(allowed(path,method),`${method} ${path}`);
  for(const [path,method] of [['mobile/v1/rides/fare','POST'],['mobile/v1/rides/incidents','POST'],[`mobile/v1/rides/incidents/${id}/review`,'GET'],[`mobile/v1/rides/${id}/complete`,'POST']] as const)assert.equal(allowed(path,method),false,`${method} ${path}`);
});

// Every literal path the web app passes to api() must be forwarded by the same-origin proxy, or that screen silently fails in a real deployment while
// API-level tests (which never go through the proxy) stay green. Dynamic prefixes (a path ending in "/" or built from a variable) are checked by their own tests.
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
test('every literal api() path used by the web app is allowed by the proxy',()=>{
 const root=join(process.cwd(),'apps','web','src');
 const walk=(d:string):string[]=>readdirSync(d).flatMap(f=>{const p=join(d,f);return statSync(p).isDirectory()?walk(p):/\.tsx?$/.test(f)?[p]:[];});
 const missing:string[]=[];let checked=0;
 for(const file of walk(root))for(const m of readFileSync(file,'utf8').matchAll(/\bapi(?:<[^>]*>)?\(\s*([`'])(\/[^`']*)\1/g)){
  const raw=m[2]!;if(raw.endsWith('/')||/\$\{[^}]*$/.test(raw)||/\$\{[^}]*\}\$\{/.test(raw)||(raw.match(/\$\{/g)??[]).length>=2&&/\/\$\{[^}]*\}$/.test(raw))continue;
  const path=raw.replace(/\$\{[^}]*\}/g,'11111111-1111-4111-8111-111111111111').replace(/^\//,'').split('?')[0]!;
  if(path==='11111111-1111-4111-8111-111111111111'||/^[^/]+\/[^/]+$/.test(path)&&/^(orders|food|tables?)\//.test(path))continue;
  checked++;if(!apiRoutes.some(([r])=>r.test(path)))missing.push(path);
 }
 assert.ok(checked>80,'scan found the calls');assert.deepEqual(missing,[]);
});

test('owner-signed refund routes are forwarded as POST only', () => {
  for (const tail of ['refund', 'refund/prepare', 'refund/submit', 'refund/cancel']) { assert.ok(allowed(`bills/orders/${id}/${tail}`, 'POST'), tail); assert.equal(allowed(`bills/orders/${id}/${tail}`, 'GET'), false, tail); }
  assert.equal(allowed(`bills/orders/${id}/refund/other`, 'POST'), false);
});
