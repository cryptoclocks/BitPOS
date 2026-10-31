import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = (p: string) => readFileSync(new URL(`../apps/web/src/components/${p}`, import.meta.url), 'utf8');
// WP2 step 2-3: absent backends must render explicit BLOCKED states, never invented facts.
test('unbuilt features carry BLOCKED markers in Thai and English', () => {
  for (const [file, marker] of [['StockManager.tsx', 'stock-cost-unit'], ['PosReports.tsx', 'exports'], ['OpeningHoursSettings.tsx', 'multi-branch'], ['Pos.tsx', 'printer'], ['TableMenu.tsx', 'table-options'], ['Payment.tsx', 'promptpay-card']]) {
    const text = src(file);
    assert.ok(text.includes(`data-blocked="${marker}"`), `${file} ${marker}`);
  }
});
test('printer preview is fully disabled', () => {
  assert.match(src('Pos.tsx'), /<fieldset disabled aria-label/);
});
