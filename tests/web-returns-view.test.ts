import test from 'node:test';
import assert from 'node:assert/strict';
import { filterReturns, isOpenReturn } from '../apps/web/src/lib/returns-view';
import type { ReturnRow } from '../apps/web/src/lib/returns-view';

const row = (caseId: string, orderId: string, stage: ReturnRow['stage'], reason = 'Spilled'): ReturnRow => ({ caseId, orderId, reason, requestedAt: '2026-10-28T00:00:00Z', receivedAt: null, resolvedAt: null, condition: null, amount: null, refund: stage === 'REFUNDED' ? 'REFUNDED' : 'NONE', stage });

test('open means anything short of a finalized refund; the filter and search combine', () => {
  const rows = [row('aaaa1111', '11111111-0000-0000-0000-000000000000', 'REFUNDED'), row('bbbb2222', '22222222-0000-0000-0000-000000000000', 'REQUESTED', 'Missing item'), row('cccc3333', '33333333-0000-0000-0000-000000000000', 'REFUNDING')];
  assert.deepEqual(rows.map(isOpenReturn), [false, true, true]);
  assert.equal(filterReturns(rows, 'all', '').length, 3);
  assert.deepEqual(filterReturns(rows, 'open', '').map(r => r.caseId), ['bbbb2222', 'cccc3333']);
  assert.deepEqual(filterReturns(rows, 'refunded', '').map(r => r.caseId), ['aaaa1111']);
  assert.deepEqual(filterReturns(rows, 'all', '2222').map(r => r.caseId), ['bbbb2222'], 'matches the short order reference');
  assert.deepEqual(filterReturns(rows, 'all', 'MISSING').map(r => r.caseId), ['bbbb2222'], 'reason search ignores case');
  assert.deepEqual(filterReturns(rows, 'refunded', 'missing'), [], 'filter and search both apply');
});
