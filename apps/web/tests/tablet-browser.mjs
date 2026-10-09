import assert from 'node:assert/strict';

// Rerunnable UI/IndexedDB contract harness. API fixtures are explicitly not payment,
// database authorization, chain, physical display, or real Android wallet evidence.
// Caller supplies a fresh Playwright-compatible page and running BitPOS web origin.
export default async function tabletBrowserContracts(page, origin) {
  const calls = []; const submissions = new Map(); let submitMode = 'busy'; let sequence = 0;
  const money = { currency: 'USD', decimals: 2, amountMinor: '270' };
  const settlement = { currency: 'USDG', decimals: 6, amountMinor: '2700000', network: 'solana:devnet', mint: 'FIXTURE-mint', tokenProgram: 'FIXTURE-program', genesisHash: 'FIXTURE-genesis', testToken: true, recipient: 'FIXTURE-treasury', sponsor: 'merchant_funded' };
  const authority = { kind: 'versioned', source: { kind: 'register', registerId: 'register-fixture', label: 'FIXTURE counter' }, serving: { kind: 'table', tableId: 'table-fixture', label: 'Table 4' }, target: { deviceId: 'device-a', assignmentGeneration: '9007199254740993' }, pairingGeneration: '9007199254740995' };
  const product = { id: 'coffee-fixture', name: 'กาแฟ', nameEn: 'Coffee fixture', category: 'Coffee', description: 'Browser contract fixture only', imageUrl: null, available: 100, basePrice: money, unitPrice: money, promotion: null };
  const line = { productId: product.id, name: product.name, nameEn: product.nameEn, qty: 1, priceVersion: 'price-fixture', basePrice: money, unitPrice: money, promotion: null };
  const incoming = { id: 'incoming-fixture', version: 1, status: 'AWAITING_WALLET', payer: null, authority: { ...authority, source: { kind: 'device', deviceId: 'device-b', label: 'FIXTURE table clock' }, target: { deviceId: 'device-b', assignmentGeneration: '2' }, pairingGeneration: null }, pricing: { kind: 'versioned', priceVersion: 'price-fixture', lines: [line], total: money }, settlement, quoteExpiresAt: new Date(Date.now() + 300000).toISOString(), paymentUrl: `${origin}/pay/incoming-fixture` };
  const device = { id: 'device-a', label: 'FIXTURE A', tableId: null, tableLabel: null, assignmentGeneration: '9007199254740993', authGeneration: '1', connectionGeneration: '1', revokedAt: null, online: true, lastSeenAt: new Date().toISOString(), screen: { kind: 'idle', screenGeneration: '5', orderId: null, sessionId: null } };
  const register = { id: 'register-fixture', label: 'FIXTURE counter', deviceId: 'device-a', pairingGeneration: '9007199254740995', retiredAt: null, targetOnline: true };
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname.slice(4); const method = request.method(); const body = request.postDataJSON(); calls.push({ path, method, body });
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/session') return reply({ token: 'browser-fixture-session', merchantId: 'fixture-merchant', userId: 'fixture-user', role: 'staff' });
    if (path === '/menu') return reply({ merchant: { name: 'BROWSER CONTRACT FIXTURE' }, products: [product], asOf: new Date().toISOString(), priceValidUntil: new Date(Date.now() + 60000).toISOString(), menuVersion: 'menu-fixture', priceVersion: 'price-fixture', pricingRevision: '1', currency: 'USD', decimals: 2 });
    if (path === '/tables') return reply({ tables: [{ id: 'table-fixture', label: 'Table 4', retiredAt: null }] });
    if (path === '/devices') return reply({ devices: [device] });
    if (path === '/registers') return reply({ registers: [register] });
    if (path === '/customers') return reply({ customers: [{ id: 'customer-fixture', name: 'Returning fixture guest', wallets: [{ address: 'fixture-wallet-address', avatar: '' }] }] });
    if (path.endsWith('/history')) return reply({ orders: [{ ...incoming, authority: { kind: 'legacy', source: { kind: 'legacy_counter', label: 'Legacy counter' }, serving: { kind: 'legacy_unknown', label: 'Unknown historical serving' }, target: { legacyTerminalId: 'terminal-1' } }, pricing: { kind: 'legacy_thb', total: { currency: 'THB', decimals: 2, amountMinor: '9500' }, lines: [{ ...line, unitPrice: { currency: 'THB', decimals: 2, amountMinor: '9500' } }] } }] });
    if (path === '/orders') return reply({ orders: [incoming, ...submissions.values()] });
    if (path.startsWith('/orders/')) return reply(path.endsWith('incoming-fixture') ? incoming : [...submissions.values()].find(order => path.endsWith(order.id)));
    if (path.includes('/submissions/')) return reply({ order: submissions.get(path.split('/').pop()) ?? null });
    if (path.endsWith('/quotes')) return reply({ id: `quote-fixture-${++sequence}`, priceVersion: 'price-fixture', pricingRevision: '1', cartVersion: null, lines: body.items.map(item => ({ ...line, qty: item.qty })), total: { ...money, amountMinor: (270n * BigInt(body.items[0].qty)).toString() }, settlement: { ...settlement, amountMinor: (2700000n * BigInt(body.items[0].qty)).toString() }, quotedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60000).toISOString(), authority, pairingGeneration: register.pairingGeneration, targetOnline: true, targetBusy: false });
    if (path.endsWith('/orders') && method === 'POST') {
      if (submitMode === 'busy' || submitMode === 'stale') return reply({ error: { code: submitMode === 'busy' ? 'DEVICE_BUSY' : 'PRICE_VERSION_CHANGED', message: 'Fixture definite refusal', retryable: true } }, 409);
      const existing = submissions.get(body.idempotencyKey);
      if (existing) return reply(existing);
      const order = { ...incoming, id: 'created-fixture', authority, customerId: body.customerId ?? null, pricing: { kind: 'versioned', priceVersion: body.priceVersion, lines: [line], total: money }, paymentUrl: `${origin}/pay/created-fixture` };
      submissions.set(body.idempotencyKey, order);
      // Simulate committed server outcome with lost response. This does not settle a payment.
      return route.abort('failed');
    }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
  async function login() {
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.invalid'); await page.getByLabel('Password', { exact: true }).fill('browser-only-fixture'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Register', { exact: true }).selectOption(register.id);
  }
  async function waitEnabled(name) { await page.waitForFunction(name => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === name && !button.disabled), name); }
  async function reviewAndConfirm() { await waitEnabled('Review canonical order'); await page.getByRole('button', { name: 'Review canonical order', exact: true }).click(); await waitEnabled('Confirm & submit reviewed order'); await page.getByRole('button', { name: 'Confirm & submit reviewed order', exact: true }).click(); }
  await page.setViewportSize({ width: 1180, height: 900 }); await page.goto(origin); await login();
  await page.waitForFunction(() => { const button = document.querySelector('button[aria-label="Add Coffee fixture"]'); return button && !button.disabled; });
  await page.getByRole('button', { name: 'Add Coffee fixture', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('select[aria-label="Serving place"]').disabled);
  await page.getByLabel('Serving place', { exact: true }).selectOption('table-fixture');
  await page.getByRole('button', { name: /Incoming orders/ }).click(); const countBeforeView = calls.filter(call => call.method !== 'GET').length;
  await page.getByRole('button', { name: /incoming.*Table 4/i }).click();
  assert.equal(calls.filter(call => call.method !== 'GET').length, countBeforeView, 'Viewing incoming must not mutate a route or submit');
  await page.getByRole('button', { name: /^Cart \(/ }).click(); assert.equal(await page.getByLabel('Serving place', { exact: true }).inputValue(), 'table-fixture');
  await page.getByLabel('Customer', { exact: true }).selectOption('customer-fixture'); await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('summary').click(); assert.ok((await page.locator('.history').textContent()).includes('THB 95.00')); assert.equal(await page.getByRole('img', { name: 'Wallet avatar' }).count(), 1);
  await page.getByLabel('Customer', { exact: true }).selectOption('');
  await reviewAndConfirm(); await page.getByText(/DEVICE_BUSY.*Draft retained/).waitFor();
  assert.equal(calls.filter(call => call.path.endsWith('/orders') && call.method === 'POST').length, 1); assert.equal(await page.getByRole('button', { name: 'Confirm & submit reviewed order', exact: true }).count(), 0);
  submitMode = 'stale'; await reviewAndConfirm(); await page.getByText(/PRICE_VERSION_CHANGED.*Draft retained/).waitFor();
  submitMode = 'lost'; await reviewAndConfirm(); await page.getByRole('button', { name: 'Resolve / retry exact submission', exact: true }).waitFor();
  const original = calls.filter(call => call.path.endsWith('/orders') && call.method === 'POST').at(-1).body;
  assert.equal('customerId' in original, false); assert.deepEqual(original.items, [{ productId: product.id, qty: 1 }]);
  const postsBeforeReload = calls.filter(call => call.path.endsWith('/orders') && call.method === 'POST').length;
  await page.reload(); await login(); await page.getByRole('button', { name: /^Cart \(/ }).click(); await page.getByText('Order ID: created-fixture', { exact: true }).waitFor();
  assert.equal(calls.filter(call => call.path.endsWith('/orders') && call.method === 'POST').length, postsBeforeReload, 'Reload resolves committed key through GET, not a replacement submit');
  assert.equal(await page.getByRole('link', { name: 'Open payment page', exact: true }).getAttribute('href'), `${origin}/pay/created-fixture`);
  await page.getByRole('button', { name: 'Setup & registry', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Pair device', exact: true }).count(), 0); assert.equal(await page.getByText('Owner pricing setup / ตั้งค่าราคา').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow workspace must not overflow');
  return { origin: 'browser_http_fixture_contract', physicalMobile: false, livePayment: false, retainedDraftRefusals: ['DEVICE_BUSY', 'PRICE_VERSION_CHANGED'], successfulCreates: submissions.size, originalKey: original.idempotencyKey };
}
