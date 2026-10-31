// Local registry presentation matrix. Reads are intercepted; only the explicit rejected-assignment fixture writes.
import assert from 'node:assert/strict';
import { chromium } from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const origin = process.env.BITPOS_UI_ORIGIN;
const evidence = process.env.BITPOS_UI_EVIDENCE_DIR;
assert.ok(origin, 'BITPOS_UI_ORIGIN is required');
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.ok(evidence, 'BITPOS_UI_EVIDENCE_DIR is required');
const stamp = new Date().toISOString().replaceAll(':', '-');
const capture = join(evidence, `pos-settings-floor-${stamp}`);
await mkdir(capture, { recursive: false });
const manifest = { status: 'RUNNING', fixture: true, origin, capture, scenarios: [], commands: [], sourceHashes: process.env.BITPOS_UI_SOURCE_HASHES?.split(',') ?? [] };
await writeFile(join(capture, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });

const tables = [{ id: '00000000-0000-4000-8000-000000000101', label: 'Window 1', retiredAt: null, occupancy: { active: false } }];
const devices = [{ id: '00000000-0000-4000-8000-000000000201', label: 'Counter Mini', tableId: tables[0].id, tableLabel: tables[0].label, assignmentGeneration: '3', authGeneration: '5', revokedAt: null, online: true, lastSeenAt: '2026-10-25T00:00:00.000Z', connectionGeneration: '5', screen: { kind: 'idle', screenGeneration: '8', orderId: null, sessionId: null } }];
const registers = [{ id: '00000000-0000-4000-8000-000000000301', label: 'Front register', deviceId: devices[0].id, pairingGeneration: '4', retiredAt: null, targetOnline: true }];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const scenario of [
    { language: 'en', width: 1440, state: 'ready' },
    { language: 'th', width: 390, state: 'ready' },
    { language: 'en', width: 1440, state: 'empty' },
    { language: 'th', width: 390, state: 'denied' },
    { language: 'en', width: 390, state: 'assignment-error' },
    { language: 'en', width: 390, state: 'error' },
  ]) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: 1000 } });
    const requests = [];
    await page.goto(origin);
    await page.locator('input[name=email]').fill('merchant@bitpos.invalid');
    await page.locator('input[name=password]').fill('local-fixture-only');
    await page.locator('summary').click();
    await page.locator('input[name=merchantId]').fill('32d7d169-28b8-490a-b773-f81db3f447c4');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) {
        requests.push({ method: request.method(), path });
        if (scenario.state === 'assignment-error' && request.method() === 'PATCH' && path === `/api/devices/${devices[0].id}`) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'GENERATION_CONFLICT', message: 'Fixture assignment conflict', retryable: true } }) });
        return route.abort('blockedbyclient');
      }
      if (!['/api/tables', '/api/devices', '/api/registers'].includes(path)) return route.continue();
      if (scenario.state === 'denied') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ROLE_REQUIRED', message: 'Fixture registry denial', retryable: false } }) });
      if (scenario.state === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REQUEST_FAILED', message: 'Fixture registry unavailable', retryable: true } }) });
      const body = path === '/api/tables' ? { tables: scenario.state === 'empty' ? [] : tables } : path === '/api/devices' ? { devices: scenario.state === 'empty' ? [] : devices } : { registers: scenario.state === 'empty' ? [] : registers };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    if (scenario.language === 'th') await page.getByRole('button', { name: 'Switch to Thai', exact: true }).click();
    await page.getByRole('button', { name: scenario.language === 'th' ? 'ตั้งค่า' : 'Settings', exact: true }).click();
    const registry = page.getByRole('region', { name: scenario.language === 'th' ? 'ทะเบียนโต๊ะและอุปกรณ์' : 'Table and device registry' });
    let callerRecovery;
    if (scenario.state === 'ready') {
      await registry.getByText(scenario.language === 'th' ? 'โต๊ะ จุดขาย และ BitPOS Mini' : 'Tables, registers & BitPOS Mini', { exact: true }).waitFor();
      await registry.locator('summary').filter({ hasText: scenario.language === 'th' ? 'จัดการโต๊ะ' : 'Manage tables' }).click();
      await registry.getByRole('heading', { name: scenario.language === 'th' ? 'จับคู่จุดขาย' : 'Register pairing', exact: true }).waitFor();
      assert.equal(await registry.getByText('Counter Mini', { exact: true }).count() > 0, true);
      if (scenario.language === 'th') {
        await registry.locator('.floor-device').click();
        await registry.getByText('รายการที่เลือก', { exact: true }).waitFor();
        await registry.locator('.floor-inspector label').filter({ hasText: 'โต๊ะที่ให้บริการ' }).waitFor();
        await registry.locator('.floor-inspector .floor-status').filter({ hasText: 'ออนไลน์ · ว่าง' }).waitFor();
        await registry.locator('.floor-help p').filter({ hasText: 'ลากเพื่อจัดผัง หรือใช้ปุ่มลูกศรได้' }).waitFor();
      }
    } else if (scenario.state === 'empty') {
      await registry.locator('summary').filter({ hasText: 'Manage tables' }).click();
      await registry.getByText('No tables yet. Add a table to start arranging your floor.', { exact: true }).waitFor();
      await registry.getByText('No BitPOS Mini yet. Add one before pairing it to a register.', { exact: true }).waitFor();
    } else if (scenario.state === 'assignment-error') {
      await registry.locator('.floor-device').click();
      await registry.locator('.floor-inspector select').selectOption('');
      await registry.getByRole('button', { name: 'Save assignment', exact: true }).click();
      await registry.getByRole('alert').filter({ hasText: 'Fixture assignment conflict' }).waitFor();
    } else {
      await page.getByRole('status').filter({ hasText: 'Reconnecting to POSClock. Please wait.' }).waitFor();
      callerRecovery = 'Existing registry caller renders its truthful reconnecting status for intercepted read refusal.';
    }
    if (scenario.state === 'assignment-error') manifest.commands.push({ scenario: scenario.state, intercepted: requests });
    assert.deepEqual(requests, scenario.state === 'assignment-error' ? [{ method: 'PATCH', path: `/api/devices/${devices[0].id}` }] : [], 'browser smoke permits only its explicit rejected-assignment fixture write');
    const geometry = await registry.evaluate(node => { const box = node.getBoundingClientRect(); return { width: box.width, scrollWidth: node.scrollWidth, overflow: node.scrollWidth > Math.ceil(box.width) }; });
    assert.equal(geometry.overflow, false, `registry horizontal overflow: ${JSON.stringify(geometry)}`);
    const image = join(capture, `settings-floor-${scenario.language}-${scenario.width}-${scenario.state}.png`);
    await page.screenshot({ path: image, fullPage: true });
    manifest.scenarios.push({ ...scenario, ...(callerRecovery ? { callerRecovery } : {}), geometry, image });
    await page.close();
  }
  manifest.status = 'PASS_SCOPED_SETTINGS_FLOOR';
} catch (error) {
  manifest.status = 'FAIL';
  manifest.error = String(error);
  throw error;
} finally {
  await writeFile(join(capture, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify({ capture, status: manifest.status }));
}
