import test from 'node:test';
import assert from 'node:assert/strict';
import {floorLayout} from '../apps/web/src/lib/floor-layout';

// A floor node is at most 145 px wide and about 112 px tall (screen art, label and status).
const NODE_W = 145, NODE_H = 112, CANVAS_W = 540;
function boxes(tables: number, devices: number) {
  const layout = floorLayout(tables, devices), out: Array<{x: number; y: number; kind: string}> = [];
  for (let i = 0; i < tables; i++) { const p = layout.table(i); out.push({x: p.x / 100 * CANVAS_W, y: p.y / 100 * layout.height, kind: 't' + i}); }
  for (let i = 0; i < devices; i++) { const p = layout.device(i); out.push({x: p.x / 100 * CANVAS_W, y: p.y / 100 * layout.height, kind: 'd' + i}); }
  return {layout, out};
}

test('default floor slots never stack, for any realistic table and screen count', () => {
  for (let tables = 0; tables <= 9; tables++) for (let devices = 0; devices <= 30; devices++) {
    const {layout, out} = boxes(tables, devices);
    for (let i = 0; i < out.length; i++) {
      assert.ok(out[i].y > 0 && out[i].y < layout.height, `${out[i].kind} inside the canvas (${tables}t/${devices}d)`);
      for (let j = i + 1; j < out.length; j++) {
        const overlapY = Math.abs(out[i].y - out[j].y) < NODE_H;
        // Columns are 23-27 percent apart; compare on a wide canvas so only vertical stacking is judged.
        const sameColumnBand = Math.abs(out[i].x - out[j].x) < 40;
        assert.ok(!(overlapY && sameColumnBand && out[i].kind[0] === out[j].kind[0]) , `${out[i].kind} and ${out[j].kind} stack (${tables}t/${devices}d)`);
      }
    }
  }
});

test('screens always start below the last table row and the canvas grows with rows', () => {
  for (let tables = 1; tables <= 9; tables++) {
    const layout = floorLayout(tables, 3);
    const lastTable = layout.table(tables - 1).y / 100 * layout.height, firstDevice = layout.device(0).y / 100 * layout.height;
    assert.ok(firstDevice - lastTable >= 60, `${tables} tables leave room above the screens`);
  }
  assert.equal(floorLayout(0, 0).height, 440);
  assert.ok(floorLayout(2, 16).height > floorLayout(2, 6).height);
  assert.equal(floorLayout(2, 18).height - floorLayout(2, 16).height, 0, 'same row count, same height');
  assert.equal(floorLayout(2, 19).height - floorLayout(2, 16).height, 125, 'one more row adds one pitch');
});
