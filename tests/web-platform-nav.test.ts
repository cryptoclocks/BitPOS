import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { platformNav } from '../apps/web/src/lib/platform-nav';

test('every menu entry is a real page and appears once', () => {
  const hrefs = platformNav.map(item => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const item of platformNav) {
    assert.ok(item.title[0] && item.title[1], `${item.href} needs both languages`);
    assert.ok(existsSync(item.href === '/platform' ? 'apps/web/src/pages/platform/index.astro' : `apps/web/src/pages${item.href}.astro`), `${item.href} is missing`);
  }
});
test('every operator page uses the shared sidebar and no private menu', () => {
  for (const file of ['Hub', 'FoodDispatch', 'Drivers', 'FoodIncidents', 'Support', 'Reviews', 'DriverEarnings', 'FoodCancellationReviews', 'Rides']) {
    const source = readFileSync(`apps/web/src/components/Platform${file}.tsx`, 'utf8');
    assert.ok(source.includes('<PlatformSidebar'), `${file} must render PlatformSidebar`);
    assert.ok(!source.includes('<aside className="dispatch-sidebar">'), `${file} must not keep its own sidebar`);
  }
});
