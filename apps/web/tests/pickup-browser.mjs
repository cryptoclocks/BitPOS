import assert from 'node:assert/strict';

// Caller supplies a fresh Playwright-compatible page and a running BitPOS web origin.
// HTTP fixtures exercise the actual UI, not database authorization, payment proof,
// physical screens, audio, or an Android wallet. No real transactions are submitted.
export default async function pickupBrowserContracts(page, origin) {
  const calls = [], committed = new Map();
  let loseFulfillment = true, loseResend = true;
  const money = { currency: 'USD', decimals: 2, amountMinor: '270' };
  const authority = { kind: 'versioned', source: { kind: 'register', registerId: 'fixture-register', label: 'FIXTURE counter' }, serving: { kind: 'table', tableId: 'fixture-table', label: 'FIXTURE Table 4' }, target: { deviceId: 'fixture-device', assignmentGeneration: '5' }, pairingGeneration: '3' };
  let device = { id: 'fixture-device', label: 'FIXTURE screen A', tableId: 'fixture-table', tableLabel: 'FIXTURE Table 4', assignmentGeneration: '5', authGeneration: '1', connectionGeneration: '1', revokedAt: null, online: true, lastSeenAt: new Date().toISOString(), screen: { kind: 'idle', screenGeneration: '8', orderId: null, sessionId: null } };
  const wrongTableDevice = { ...device, id: 'fixture-wrong-table', label: 'FIXTURE wrong table', tableId: 'fixture-other-table', tableLabel: 'FIXTURE Table 8' };
  let paid = { id: 'paid-fixture-order', version: 9, status: 'PAID', payer: null, authority, pricing: { kind: 'versioned', priceVersion: 'fixture-price', total: money, lines: [{ productId: 'fixture-coffee', name: 'กาแฟทดสอบ', nameEn: 'Fixture coffee', qty: 1, priceVersion: 'fixture-price', basePrice: money, unitPrice: money, promotion: null }] }, settlement: { currency: 'USDG', decimals: 6, amountMinor: '2700000', network: 'solana:devnet', mint: 'FIXTURE-mint', tokenProgram: 'FIXTURE-program', genesisHash: 'FIXTURE-genesis', testToken: true, recipient: 'FIXTURE-recipient', sponsor: 'merchant_funded' }, quoteExpiresAt: new Date(Date.now() + 60000).toISOString(), paymentUrl: `${origin}/pay/paid-fixture-order`, fulfillment: { status: 'RECEIVED', version: 4, notification: null, target: null } };
  const unpaid = { ...paid, id: 'unpaid-fixture-order', status: 'AWAITING_PAYMENT', fulfillment: { ...paid.fulfillment, version: 0 } };
  const noFulfillment = { ...paid, id: 'legacy-fixture-order', fulfillment: undefined };
  const replyNotice = state => ({ id: 'fixture-notice', state, targetDeviceId: device.id, assignmentGeneration: device.assignmentGeneration, expiresAt: new Date(Date.now() + 120000).toISOString() });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice(4), method = request.method(), body = request.postDataJSON();
    calls.push({ path, method, body });
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/demo-session') return reply({ enabled: false });
    if (path === '/session') return reply({ token: 'FIXTURE-only-session', merchantId: 'fixture-merchant', userId: 'fixture-staff', role: 'staff' });
    if (path === '/menu') return reply({ merchant: { name: 'PICKUP BROWSER FIXTURE' }, products: [], asOf: new Date().toISOString(), priceValidUntil: new Date(Date.now() + 60000).toISOString(), menuVersion: 'fixture-menu', priceVersion: 'fixture-price', pricingRevision: '1', currency: 'USD', decimals: 2 });
    if (path === '/devices') return reply({ devices: [device, wrongTableDevice] });
    if (path === '/tables') return reply({ tables: [{ id: 'fixture-table', label: 'FIXTURE Table 4', retiredAt: null }] });
    if (path === '/registers') return reply({ registers: [] });
    if (path === '/customers') return reply({ customers: [] });
    if (path === '/orders') return reply({ orders: [paid, unpaid, noFulfillment] });
    if (path === `/orders/${paid.id}` && method === 'GET') return reply(paid);
    if (path === `/orders/${unpaid.id}` && method === 'GET') return reply(unpaid);
    if (path === `/orders/${noFulfillment.id}` && method === 'GET') return reply(noFulfillment);
    if (path === `/orders/${paid.id}/fulfillment` || path === `/orders/${paid.id}/notification/retry`) {
      if (committed.has(body.idempotencyKey)) return reply(committed.get(body.idempotencyKey));
      assert.equal(body.expectedVersion, paid.fulfillment.version, 'Expected version must be fulfillment version, not financial version');
      if (path.endsWith('/fulfillment')) {
        const next = { RECEIVED: 'PREPARING', PREPARING: 'READY', READY: 'COLLECTED' }[paid.fulfillment.status];
        assert.equal(body.status, next, 'Only sequential kitchen transitions');
        paid = { ...paid, fulfillment: { ...paid.fulfillment, status: body.status, version: paid.fulfillment.version + 1, notification: body.status === 'READY' ? replyNotice('PENDING') : body.status === 'COLLECTED' ? { ...paid.fulfillment.notification, state: 'CANCELED' } : null, target: body.status === 'READY' ? { deviceId: device.id, label: device.label, assignmentGeneration: device.assignmentGeneration, tableLabel: device.tableLabel } : paid.fulfillment.target } };
        committed.set(body.idempotencyKey, paid);
        if (loseFulfillment) { loseFulfillment = false; return route.abort('failed'); }
      } else {
        assert.equal(body.confirmTarget, true);
        assert.equal(body.targetDeviceId, device.id);
        assert.equal(body.assignmentGeneration, device.assignmentGeneration);
        paid = { ...paid, fulfillment: { ...paid.fulfillment, version: paid.fulfillment.version + 1, notification: replyNotice('PENDING'), target: { deviceId: device.id, label: device.label, assignmentGeneration: device.assignmentGeneration, tableLabel: device.tableLabel } } };
        committed.set(body.idempotencyKey, paid);
        if (loseResend) { loseResend = false; return route.abort('failed'); }
      }
      return reply(paid);
    }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(origin);
  await page.getByLabel('Email', { exact: true }).fill('pickup-fixture@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('browser-fixture-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /Incoming orders/ }).click();
  const browser = page.getByRole('region', { name: 'Order list', exact: true });
  const paymentFilters = page.getByRole('navigation', { name: 'Order status filters', exact: true });
  const kitchenFilters = page.getByRole('navigation', { name: 'Fulfillment filters', exact: true });
  const detail = page.getByRole('region', { name: 'Order details', exact: true });
  const refresh = async () => { const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/orders'); await browser.getByRole('button', { name: 'Refresh', exact: true }).click(); await result; };
  const mutations = () => calls.filter(call => call.method === 'POST' && call.path.startsWith('/orders/'));
  await page.getByRole('button', { name: 'View order paid-fix', exact: true }).waitFor();
  await paymentFilters.getByRole('button', { name: /^Paid/ }).click();
  await kitchenFilters.getByRole('button', { name: /^Ready for pickup/ }).click();
  assert.equal(await browser.locator('.incoming-row').count(), 0, 'Kitchen filter intersects payment filter');
  await kitchenFilters.getByRole('button', { name: /^Received/ }).click();
  assert.equal(await browser.locator('.incoming-row').count(), 1, 'Paid+received excludes unpaid and missing fulfillment');
  await browser.getByRole('button', { name: 'View order paid-fix', exact: true }).click();
  await detail.getByRole('button', { name: 'Start preparing', exact: true }).click();
  await detail.getByRole('button', { name: 'Retry exact action', exact: true }).waitFor();
  const first = mutations().at(-1).body;
  assert.equal(first.expectedVersion, 4);
  await detail.getByRole('button', { name: 'Retry exact action', exact: true }).click();
  await detail.getByRole('button', { name: 'Ready · call for pickup', exact: true }).waitFor();
  assert.deepEqual(mutations().at(-1).body, first, 'Lost-response retry retains the exact key and payload');
  await detail.getByRole('button', { name: 'Ready · call for pickup', exact: true }).click();
  await detail.locator('.notification-status').getByText('Pending · waiting for an idle screen', { exact: true }).waitFor();
  assert.notEqual(mutations().at(-1).body.idempotencyKey, first.idempotencyKey, 'A new transition has a new key');
  assert.equal(mutations().at(-1).body.expectedVersion, 5);
  await page.screenshot({path:'.omp/work/post-submit-20261012/evidence/pickup-browser-ready-desktop.png',fullPage:true});
  await detail.locator('.pickup-resend summary').click();
  const targetSelect = detail.getByLabel('Choose target screen', { exact: true });
  const confirm = detail.getByRole('checkbox', { name: 'I confirm the selected screen is the correct target for this order.', exact: true });
  const resend = detail.getByRole('button', { name: 'Confirm & resend pickup notice', exact: true });
  assert.equal(await targetSelect.inputValue(), '', 'No implicit target selection');
  assert.equal(await resend.isEnabled(), false);
  assert.equal(await targetSelect.locator('option[value="fixture-wrong-table"]').count(), 0, 'Other serving tables cannot be selected');
  const noticeLabels = { DELIVERED: 'Delivered to screen', RENDERED: 'Rendered on screen', ACKNOWLEDGED: 'Guest acknowledged', EXPIRED: 'Notice expired', CANCELED: 'Notice canceled', UNSUPPORTED: 'Screen does not support pickup notices', TARGET_CHANGED: 'Target changed · confirmation required' };
  const beforeNotices = mutations().length;
  for (const [state, label] of Object.entries(noticeLabels)) {
    paid = { ...paid, fulfillment: { ...paid.fulfillment, notification: { ...paid.fulfillment.notification, state } } };
    await refresh(); await detail.locator('.notification-status').getByText(label, { exact: true }).waitFor();
    assert.equal(await detail.locator('.kitchen-status').textContent(), 'Ready for pickup', 'Notice lifecycle never collects an order');
  }
  assert.equal(mutations().length, beforeNotices, 'Notice updates never automatically resend or retarget');
  await targetSelect.selectOption(device.id);
  assert.equal(await resend.isEnabled(), false, 'Selection is not confirmation');
  await confirm.check(); assert.equal(await resend.isEnabled(), true);
  device = { ...device, assignmentGeneration: '6', online: false, screen: { ...device.screen, kind: 'order', orderId: 'fixture-busy-order' } };
  await detail.getByRole('button', { name: 'Refresh target screens', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pickup-resend select')?.value === '');
  assert.equal(await confirm.isChecked(), false, 'Changed generation revokes old confirmation');
  assert.equal(await resend.isEnabled(), false);
  assert.equal(mutations().length, beforeNotices, 'Assignment change does not create a resend');
  await targetSelect.selectOption(device.id); await confirm.check(); await resend.click();
  await detail.getByRole('button', { name: 'Retry exact action', exact: true }).waitFor();
  const originalResend = mutations().at(-1).body;
  assert.deepEqual({ ...originalResend, idempotencyKey: 'checked-separately' }, { expectedVersion: 6, idempotencyKey: 'checked-separately', targetDeviceId: device.id, assignmentGeneration: '6', confirmTarget: true });
  await detail.getByRole('button', { name: 'Retry exact action', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.incoming-detail .fulfillment-pending'));
  assert.deepEqual(mutations().at(-1).body, originalResend, 'Explicit resend lost-response retry keeps its key and confirmed target');
  await detail.getByRole('button', { name: 'Mark collected', exact: true }).click();
  await detail.locator('.kitchen-status').getByText('Collected', { exact: true }).waitFor();
  assert.equal(await detail.getByRole('button', { name: 'Mark collected', exact: true }).count(), 0);
  assert.equal(await detail.locator('.pickup-resend').count(), 0);
  assert.equal(paid.version, 9, 'Kitchen updates leave financial evidence unchanged');
  await detail.getByRole('button', { name: 'Close order details', exact: true }).click();
  await paymentFilters.getByRole('button', { name: /^Awaiting payment/ }).click();
  await kitchenFilters.getByRole('button', { name: /^Received/ }).click();
  await browser.getByRole('button', { name: 'View order unpaid-f', exact: true }).click();
  assert.equal(await detail.locator('.fulfillment-primary').count(), 0, 'Unpaid order cannot advance fulfillment');
  await page.getByRole('button', { name: 'Switch to Thai', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile details have no horizontal overflow');
  return { origin: 'browser_http_fixture_contract', physicalMobile: false, livePayment: false, fulfillmentPosts: mutations().filter(call => call.path.endsWith('/fulfillment')).length, resendPosts: mutations().filter(call => call.path.endsWith('/notification/retry')).length, noticeStates: Object.keys(noticeLabels), staffActions: true, noAutomaticRetarget: true };
}
