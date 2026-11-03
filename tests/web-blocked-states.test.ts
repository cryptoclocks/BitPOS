import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = (p: string) => readFileSync(new URL(`../apps/web/src/components/${p}`, import.meta.url), 'utf8');
// WP2 step 2-3: absent backends must render explicit BLOCKED states, never invented facts.
test('unbuilt features carry BLOCKED markers in Thai and English', () => {
  for (const [file, marker] of [['StockManager.tsx', 'stock-cost-unit'], ['PosReports.tsx', 'exports'], ['OpeningHoursSettings.tsx', 'multi-branch'], ['TableMenu.tsx', 'table-options'], ['Payment.tsx', 'promptpay-card']]) {
    const text = src(file);
    assert.ok(text.includes(`data-blocked="${marker}"`), `${file} ${marker}`);
  }
});
test('the receipt printer is now a real screen: no BLOCKED preview, and it says what is and is not verified', () => {
  assert.ok(!src('Pos.tsx').includes('data-blocked="printer"'));
  assert.match(src('Pos.tsx'), /ThermalPrinterSettings/);
  const ui = src('ThermalPrinterSettings.tsx');
  assert.match(ui, /ไม่ได้ยืนยันว่ากระดาษออกครบ/); assert.match(ui, /does not prove the paper came out/);
});
