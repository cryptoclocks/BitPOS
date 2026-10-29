import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectExport, exportPath, maxExportPages } from '../apps/web/src/lib/report-export';

test('export pages are joined in order with one BOM and a summed row count', async () => {
  const pages = [{ csv: 'h\r\na\r\n', rows: 1, nextCursor: 'c1', filename: 'f.csv' }, { csv: 'b\r\n', rows: 1, nextCursor: 'c2', filename: 'f.csv' }, { csv: 'c\r\n', rows: 1, nextCursor: null, filename: 'f.csv' }];
  const seen: string[] = []; let i = 0;
  const file = await collectExport(async cursor => { seen.push(cursor); return pages[i++]; });
  assert.deepEqual(seen, ['', 'c1', 'c2']);
  assert.equal(file.csv, '﻿h\r\na\r\nb\r\nc\r\n'); assert.equal(file.rows, 3); assert.equal(file.filename, 'f.csv');
});
test('a stuck cursor or an endless export stops instead of looping', async () => {
  await assert.rejects(collectExport(async () => ({ csv: '', rows: 0, nextCursor: 'same', filename: 'f.csv' })), /did not advance/);
  let n = 0;
  await assert.rejects(collectExport(async () => ({ csv: '', rows: 0, nextCursor: 'c' + n++, filename: 'f.csv' })), /too large/);
  assert.equal(n, maxExportPages);
});
test('export request path carries kind, days and cursor only', () => {
  assert.equal(exportPath('net', '2026-10-01', '2026-10-31', ''), '/reports/export?kind=net&from=2026-10-01&to=2026-10-31');
  assert.equal(exportPath('stock', '2026-10-01', '2026-10-31', 'abc'), '/reports/export?kind=stock&from=2026-10-01&to=2026-10-31&cursor=abc');
});
test('reports screen offers the three server exports and keeps the financial/payout export BLOCKED', () => {
  const src = readFileSync(new URL('../apps/web/src/components/PosReports.tsx', import.meta.url), 'utf8');
  for (const kind of ['sales', 'net', 'stock']) assert.ok(src.includes(`'${kind}', text(`), kind);
  assert.ok(src.includes('data-blocked="exports"'));
  assert.ok(!/Stock movement export — BLOCKED/.test(src));
  assert.match(src, /Financial, payout and accounting export — BLOCKED/);
});
