import assert from 'node:assert/strict';

// Browser-only HTTP fixtures. These verify user controls and emitted requests,
// not real RBAC, provisioning, payment, database uniqueness or deployed prices.
export default async function setupBrowserContracts(page, origin) {
  const requests = []; let configured = false; let revision = '0';
  const register = { id: 'register-fixture', label: 'Fixture counter', deviceId: 'device-a', pairingGeneration: '9007199254740997', retiredAt: null, targetOnline: true };
  const devices = ['a', 'c'].map((suffix, index) => ({ id: `device-${suffix}`, label: `Fixture ${suffix.toUpperCase()}`, tableId: null, tableLabel: null, assignmentGeneration: index ? '4' : '9007199254740999', authGeneration: '1', revokedAt: null, online: true, lastSeenAt: new Date().toISOString(), connectionGeneration: '1', screen: { kind: 'idle', screenGeneration: '1', orderId: null, sessionId: null } }));
  const product = { id: 'product-fixture', name: 'กาแฟ', nameEn: 'Fixture coffee', category: '', description: '', imageUrl: null, available: 100, basePrice: null, unitPrice: null, promotion: null };
  const settlement = { asset: 'USDG', network: 'solana:devnet', mint: 'FIXTURE-mint', tokenProgram: 'FIXTURE-program', genesisHash: 'FIXTURE-genesis', decimals: 6, quotePolicy: null };
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname.slice(4); const method = request.method(); const body = request.postDataJSON(); requests.push({ path, method, body });
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/session') return reply({ token: 'fixture-session', merchantId: 'fixture-merchant', userId: 'fixture-owner', role: 'owner' });
    if (path === '/menu') return reply({ merchant: { name: 'SETUP BROWSER FIXTURE' }, products: [product], asOf: new Date().toISOString(), priceValidUntil: new Date(Date.now() + 60000).toISOString(), menuVersion: 'fixture-menu', priceVersion: configured ? 'fixture-version' : null, pricingRevision: revision, currency: configured ? 'USDG' : null, decimals: configured ? 6 : null });
    if (path === '/tables') return reply({ tables: [{ id: 'table-fixture', label: 'Fixture table', retiredAt: null }] });
    if (path === '/devices' && method === 'GET') return reply({ devices });
    if (path === '/registers') return reply({ registers: [register] });
    if (path === '/orders') return reply({ orders: [] });
    if (path === '/customers') return reply({ customers: [] });
    if (path === '/settings/pricing' && method === 'GET') return reply({ configured, revision, priceVersion: configured ? 'fixture-version' : null, catalogCurrency: configured ? 'USDG' : null, decimals: configured ? 6 : null, provenance: configured ? { kind: 'demo_configured', label: 'BROWSER TEST ONLY' } : null, prices: configured ? [{ productId: product.id, unitMinor: '1000001' }] : [], settlement });
    if (path === '/settings/pricing' && method === 'PUT') { configured = true; revision = '1'; return reply({ revision }); }
    if (path.endsWith('/pairing')) {
      if (body.expectedPairingGeneration !== register.pairingGeneration) return reply({ error: { code: 'PAIRING_CHANGED', message: 'Fixture generation conflict', retryable: true } }, 409);
      register.deviceId = body.deviceId; register.pairingGeneration = (BigInt(register.pairingGeneration) + 1n).toString(); return reply({ registerId: register.id, ...register });
    }
    if (path === '/devices/device-a' && method === 'PATCH') { assert.equal(body.expectedAssignmentGeneration, '9007199254740999'); devices[0].tableId = body.tableId; devices[0].assignmentGeneration = '9007199254741000'; return reply(devices[0]); }
    if (path === '/devices/device-a/credential' && method === 'POST') return reply({ deviceId: 'device-a', deviceToken: 'BROWSER-FIXTURE-NOT-A-CREDENTIAL', authGeneration: '2' });
    if (path === '/devices/device-a/credential' && method === 'DELETE') return reply({ revoked: true });
    throw new Error(`Unexpected setup fixture request ${method} ${path}`);
  });
  await page.setViewportSize({ width: 1180, height: 900 }); await page.goto(origin);
  await page.getByLabel('Email', { exact: true }).fill('owner@example.invalid'); await page.getByLabel('Password', { exact: true }).fill('browser-fixture'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Register', { exact: true }).selectOption(register.id);
  await page.getByRole('button', { name: 'Setup & registry', exact: true }).click();
  const pricing = page.getByRole('region', { name: 'Owner pricing setup', exact: true });
  await pricing.getByText(/Setup required: new checkout disabled/).waitFor();
  assert.equal(await pricing.getByRole('button', { name: 'Publish complete price version', exact: true }).isEnabled(), false);
  await pricing.getByLabel('Catalog currency', { exact: true }).selectOption('USDG');
  await pricing.getByRole('textbox', { name: 'Price for Fixture coffee', exact: true }).fill('1.000001');
  await pricing.getByLabel('Explicit demo catalog', { exact: true }).check(); await pricing.getByLabel('Demo provenance label', { exact: true }).fill('BROWSER TEST ONLY');
  await pricing.getByLabel('I explicitly accept this denomination policy and devnet asset.', { exact: true }).check();
  await pricing.getByRole('button', { name: 'Publish complete price version', exact: true }).click();
  await pricing.getByText(/Immutable catalog published/).waitFor();
  const published = requests.find(request => request.path === '/settings/pricing' && request.method === 'PUT').body;
  assert.deepEqual(published.prices, [{ productId: product.id, unitMinor: '1000001' }]); assert.equal(published.expectedRevision, '0'); assert.equal(published.settlement.quotePolicy, 'USDG_RAW_IDENTITY'); assert.equal(published.settlement.mint, 'FIXTURE-mint'); assert.equal('genesisHash' in published.settlement, false);
  const registry = page.getByRole('region', { name: 'Device and table registry', exact: true });
  await registry.getByLabel('New display target', { exact: true }).selectOption('device-c'); await registry.getByRole('button', { name: 'Replace / save pairing', exact: true }).click();
  await registry.getByText(/Current: Fixture C/).waitFor(); const paired = requests.find(request => request.path.endsWith('/pairing')).body; assert.deepEqual(paired, { deviceId: 'device-c', expectedPairingGeneration: '9007199254740997' });
  const deviceForm = registry.locator('form.registry-row').filter({ has: page.locator('input[name="label"][value="Fixture A"]') });
  await deviceForm.getByLabel('Assigned table', { exact: true }).selectOption('table-fixture'); await deviceForm.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await registry.getByText(/Assignment 9007199254741000/).waitFor();
  const refreshedDeviceForm = registry.locator('form.registry-row').filter({ has: page.locator('input[name="label"][value="Fixture A"]') });
  await refreshedDeviceForm.getByRole('button', { name: 'Issue / rotate credential', exact: true }).click(); await registry.getByRole('region', { name: 'One-time device credential' }).waitFor();
  await registry.getByRole('button', { name: 'Clear credential', exact: true }).click(); assert.equal(await registry.getByLabel('Private device credential', { exact: true }).count(), 0);
  await registry.getByLabel('New display target', { exact: true }).selectOption(''); await registry.getByRole('button', { name: 'Unpair device', exact: true }).click(); await registry.getByText(/Current: Unpaired/).waitFor();
  assert.equal(requests.filter(request => request.path.endsWith('/orders') && request.method === 'POST').length, 0, 'Setup cannot create or move a bill');
  return { origin: 'browser_http_fixture_contract', configuredPrice: published, pairRequests: requests.filter(request => request.path.endsWith('/pairing')).map(request => request.body), provisioningPerformed: false, livePayment: false };
}
