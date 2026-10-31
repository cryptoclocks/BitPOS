import test from 'node:test';
import assert from 'node:assert/strict';
import { planFoodBatchRoute } from '../packages/domain/src/food-batch-route';

test('finds the shortest order independent of input order and labels distance as straight-line', () => {
  const pickup = { latitudeE7: 0, longitudeE7: 0 };
  const stops = [{ shipmentId: 'far', latitudeE7: 0, longitudeE7: 200000 }, { shipmentId: 'near', latitudeE7: 0, longitudeE7: 100000 }, { shipmentId: 'middle', latitudeE7: 0, longitudeE7: 150000 }];
  const result = planFoodBatchRoute(pickup, stops);
  assert.deepEqual(result.shipmentIds, ['near', 'middle', 'far']);
  assert.ok(result.straightLineMetres > 2200 && result.straightLineMetres < 2300);
  assert.deepEqual(planFoodBatchRoute(pickup, [...stops].reverse()), result);
});

test('ties are deterministic and invalid, duplicate or excessive stops fail closed', () => {
  const p = { latitudeE7: 0, longitudeE7: 0 };
  const a = { ...p, shipmentId: 'a' }, b = { ...p, shipmentId: 'b' };
  assert.deepEqual(planFoodBatchRoute(p, [b, a]).shipmentIds, ['a', 'b']);
  for (const stops of [[], [a, a], [a, b, { ...a, shipmentId: 'c' }, { ...a, shipmentId: 'd' }], [{ ...a, latitudeE7: NaN }], [{ ...a, longitudeE7: 1800000001 }]]) {
    assert.throws(() => planFoodBatchRoute(p, stops), /INVALID_BATCH_ROUTE/);
  }
});
