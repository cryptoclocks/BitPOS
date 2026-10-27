import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { platformDestinations } from '../apps/web/src/lib/platform-hub';

test('every linked destination is a real page and every unlinked one states what it needs', () => {
  for (const item of platformDestinations) {
    if (item.href) assert.ok(existsSync(`apps/web/src/pages${item.href}.astro`), `${item.id} links to a missing page ${item.href}`);
    else assert.ok(item.needs && item.needs[0] && item.needs[1], `${item.id} must explain what it needs`);
  }
});
test('OP01-OP16 are all present exactly once', () => {
  const ids = platformDestinations.map(d => d.id).filter(id => id.startsWith('OP'));
  assert.deepEqual(ids, Array.from({ length: 16 }, (_, n) => `OP${String(n + 1).padStart(2, '0')}`));
});
