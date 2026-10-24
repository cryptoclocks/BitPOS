import assert from 'node:assert/strict';

// Rerunnable Playwright-compatible contracts against the actual hydrated web.
// HTTP/provider/job/delivery fixtures only: no model, backend eligibility, chain,
// physical screen ACK, Android hardware or deployment evidence is asserted.
// Caller supplies a fresh page and a running loopback web origin.
export default async function promotionsBrowserContracts(page, origin, screenshotDirectory = '') {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Fixtures must stay local');
  const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const productId = id(1), originalProductId = id(6), tableId = id(7), customerId = id(8), visitId = id(9), orderId = id(10);
  const expiry = () => new Date(Date.now() + 3600000).toISOString();
  const money = { currency: 'USD', decimals: 2, amountMinor: '300' };
  const product = { id: productId, name: 'ลาเต้ทดสอบ', nameEn: 'Fixture latte', category: 'Coffee', description: 'Local product photograph · HTTP fixture', imageUrl: '/images/menu/latte.jpg', basePrice: money, unitPrice: money, available: 20, promotion: null };
  const originalProduct = { ...product, id: originalProductId, name: 'เอสเปรสโซทดสอบ', nameEn: 'Fixture espresso', imageUrl: '/images/menu/espresso.jpg' };
  let priceVersion = id(4), discounted = { ...money, amountMinor: '270' };
  const menu = () => ({ merchant: { name: 'PROMOTION DOM FIXTURE' }, products: [product, originalProduct], asOf: new Date().toISOString(), priceValidUntil: new Date(Date.now() + 60000).toISOString(), menuVersion: 'fixture-menu', priceVersion, pricingRevision: '1', currency: 'USD', decimals: 2 });
  let role = 'owner', configured = true, losePublish = true, loseDerive = true;
  let devices = [
    { deviceId: id(30), label: 'FIXTURE original screen', tableId, tableLabel: 'FIXTURE Table 4', online: true, busy: false, capable: true, assignmentGeneration: '5', authGeneration: '2', screenGeneration: '8' },
    { deviceId: id(31), label: 'FIXTURE busy counter', tableId: null, tableLabel: null, online: true, busy: true, capable: true, assignmentGeneration: '1', authGeneration: '1', screenGeneration: '3' },
    { deviceId: id(32), label: 'FIXTURE offline screen', tableId: id(33), tableLabel: 'FIXTURE Table 5', online: false, busy: false, capable: true, assignmentGeneration: '1', authGeneration: '1', screenGeneration: '1' },
    { deviceId: id(34), label: 'FIXTURE unsupported screen', tableId: null, tableLabel: null, online: true, busy: false, capable: false, assignmentGeneration: '1', authGeneration: '1', screenGeneration: '1' },
  ];
  let recipients = {
    tables: [{ id: tableId, label: 'FIXTURE Table 4', generation: '3', active: true, guests: [{ visitId, recipientId: id(11), customerId: null, recognition: 'guest', orderId, deviceId: devices[0].deviceId }] }],
    customers: [{ id: customerId, name: 'FIXTURE customer profile' }, { id: id(13), name: 'FIXTURE other profile' }],
    orders: [{ id: orderId, tableId, occupancyGeneration: '3', recipientVisitId: visitId, targetDeviceId: devices[0].deviceId, items: [{ productId: originalProductId, quantity: 1 }] }],
  };
  const originalOrderFixture = structuredClone(recipients.orders[0]);
  const scope = audience => audience === 'daily' ? {
    audience, minimumUnitMinor: '200', context: { kind: 'daily', timezone: 'Asia/Bangkok', lookbackWeeks: 6, from: '2026-09-01T00:00:00.000Z', until: '2026-10-13T00:00:00.000Z', weekday: 2, verifiedPaidOrderCount: 0, sparseHistory: true, basis: 'stock_first_sparse_history', buckets: [] },
  } : {
    audience, minimumUnitMinor: '200', context: { kind: audience, items: audience === 'customer' ? [{ productId: originalProductId, quantity: 2, lastPurchasedDaysAgo: 7 }] : [], currentOrderItems: audience === 'from_order' ? recipients.orders[0].items : [], historyIncluded: audience === 'customer', historyBasis: audience === 'customer' ? 'staff_confirmed_profile' : 'current_order_only' },
    binding: { tableId, occupancyId: id(14), occupancyGeneration: recipients.tables[0].generation, recipientId: id(11), recipientVisitId: visitId, targetDeviceId: devices[0].deviceId, assignmentGeneration: devices[0].assignmentGeneration, authGeneration: devices[0].authGeneration, customerId: audience === 'customer' ? customerId : null, customerAuthSessionId: null, sourceOrderId: audience === 'from_order' ? recipients.orders[0].id : null, originBasis: audience === 'customer' ? 'staff_recognition' : 'private_paid_visit', excludedProductIds: audience === 'from_order' ? [originalProductId] : [] },
  };
  const audiences = ['daily', 'customer', 'from_order'];
  const campaigns = new Map(audiences.map((audience, index) => {
    const campaignId = id(2 + index * 10);
    return [campaignId, { id: campaignId, version: 1, state: 'DRAFT', productId, headline: `FIXTURE ${audience} campaign`, copy: 'Controlled HTTP fixture, not real AI', rationale: 'Fixture rationale', discountPercent: 10, maxDiscountPercent: 15, basePrice: money, unitPrice: discounted, priceVersion, stockSnapshot: 20, startsAt: new Date().toISOString(), expiresAt: expiry(), imageUrl: product.imageUrl, previewUrl: product.imageUrl, assetBlocker: null, provenance: { kind: 'fixture_provider', provider: 'HTTP FIXTURE ONLY', model: 'no-real-model', requestId: `fixture-${audience}`, jobId: `fixture-job-${audience}` }, targets: [], playlistTargets: [], scope: scope(audience) }];
  }));
  const dailyId = id(2), calls = [], committed = new Map(), jobs = new Map();
  const fences = items => items.map(({ deviceId, assignmentGeneration, authGeneration, screenGeneration }) => ({ deviceId, assignmentGeneration, authGeneration, screenGeneration }));
  const mutationCalls = suffix => calls.filter(call => call.method !== 'GET' && call.path.endsWith(suffix));
  const publishCount = () => mutationCalls('/publish').length;
  let publicationCommits = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice(4), method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    calls.push({ path, method, body });
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const refusal = code => reply({ error: { code, message: 'Explicit HTTP fixture refusal', retryable: false } }, 409);
    if (path === '/demo-session') return reply({ enabled: false });
    if (path === '/session') return reply({ token: 'FIXTURE-no-credential', merchantId: 'fixture-merchant', userId: `fixture-${role}`, role });
    if (path === '/menu') return reply(menu());
    if (path === '/tables') return reply({ tables: [{ id: tableId, label: 'FIXTURE Table 4', retiredAt: null, occupancy: { active: true, generation: '3' } }] });
    if (path === '/devices') return reply({ devices: devices.map(device => ({ id: device.deviceId, label: device.label, tableId: device.tableId, tableLabel: device.tableLabel, assignmentGeneration: device.assignmentGeneration, authGeneration: device.authGeneration, revokedAt: null, online: device.online, lastSeenAt: null, connectionGeneration: 'fixture-connection', screen: { kind: 'idle', screenGeneration: device.screenGeneration, orderId: null, sessionId: null } })) });
    if (['/registers', '/orders', '/customers'].includes(path)) return reply({ [path.slice(1)]: [] });
    if (path === '/promotions/recipients') return reply(recipients);
    if (path === '/promotions' && method === 'GET') return reply({ provider: { configured, blocker: configured ? null : 'Fixture provider configuration absent' }, jobs: [...jobs.values()], campaigns: [...campaigns.values()], devices });
    if (path.startsWith('/promotions/devices/') && method === 'GET') {
      const device = devices.find(item => item.deviceId === path.split('/').at(-1));
      assert.ok(device, 'Only known fixture devices may be inspected');
      return reply({ device, playlist: { generation: 'fixture-playlist', occupancyGeneration: device.tableId ? '3' : null, tableId: device.tableId, state: 'CURRENT', items: [] }, campaigns: [campaigns.get(dailyId)] });
    }
    if (path.startsWith('/promotions/jobs/') && method === 'GET') {
      const job = jobs.get(path.split('/').at(-1)); assert.ok(job, 'Only known durable jobs may be polled');
      job.state = 'SUCCEEDED'; job.campaignId = [...campaigns.values()].find(campaign => campaign.provenance.jobId === job.id).id;
      return reply({ job });
    }
    assert.ok(path.startsWith('/promotions/') && method !== 'GET', `Unexpected fixture request ${method} ${path}`);
    assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/i);
    const prior = committed.get(body.idempotencyKey);
    if (prior) {
      assert.deepEqual({ path, method, body }, prior.command, 'Durable replay must retain path, method and the entire saved payload/key');
      return reply(prior.result);
    }
    const remember = result => { committed.set(body.idempotencyKey, structuredClone({ command: { path, method, body }, result })); return result; };
    if (path === '/promotions/generate') {
      assert.ok(['owner', 'manager'].includes(role)); assert.equal(configured, true);
      assert.deepEqual(body.productIds, [productId]); assert.equal(body.maxDiscountPercent, 15); assert.equal(body.minimumUnitMinor, body.audience === 'daily' ? '255' : '281');
      assert.ok(audiences.includes(body.audience));
      if (body.audience === 'daily') {
        assert.deepEqual(body.daily, { timezone: 'Asia/Bangkok', lookbackWeeks: 6 }); assert.equal(body.personal, undefined);
      } else {
        assert.equal(body.daily, undefined);
        assert.deepEqual(body.personal, { tableId, occupancyGeneration: recipients.tables[0].generation, recipientVisitId: visitId, confirmRecipient: true, ...(body.audience === 'customer' ? { customerId } : { sourceOrderId: recipients.orders[0].id }) });
      }
      const campaign = [...campaigns.values()].find(item => item.scope.audience === body.audience);
      assert.equal(campaign.playlistTargets.length, 0, 'Generation creates no delivery targets');
      campaign.scope = scope(body.audience);
      const job = { id: campaign.provenance.jobId, state: 'QUEUED', blocker: null, campaignId: null, createdAt: new Date().toISOString(), provenance: campaign.provenance };
      jobs.set(job.id, job); return reply(remember({ job }));
    }
    const campaignId = path.split('/')[2], campaign = campaigns.get(campaignId);
    assert.ok(campaign); assert.equal(body.expectedVersion, campaign.version, 'Fresh mutations use the observed version');
    let next;
    if (path.endsWith('/publish')) {
      assert.ok(['owner', 'manager', 'staff'].includes(role)); assert.equal(method, 'POST'); assert.equal(campaign.state, 'APPROVED');
      assert.deepEqual(Object.keys(body).sort(), ['confirmTargets', 'expectedVersion', 'idempotencyKey', 'targets']);
      assert.equal(body.confirmTargets, true);
      const binding = campaign.scope.binding;
      const required = binding ? devices.filter(device => device.deviceId === binding.targetDeviceId) : devices;
      if (binding) {
        assert.equal(required.length, 1); assert.equal(required[0].tableId, binding.tableId);
        assert.equal(required[0].assignmentGeneration, binding.assignmentGeneration); assert.equal(required[0].authGeneration, binding.authGeneration);
      }
      assert.deepEqual(body.targets, fences(required), 'Daily freezes ALL fences; personal sends ONLY to the original bound device');
      const playlistTargets = required.map((device, index) => ({ id: id(100 + publicationCommits * 10 + index), campaignId, campaignVersion: campaign.version, deviceId: device.deviceId, audience: binding ? 'personal' : 'daily', state: !device.online ? 'DEFERRED_OFFLINE' : !device.capable ? 'UNSUPPORTED' : device.busy ? 'DEFERRED_BUSY' : 'DELIVERED', failure: null, renderedAt: null }));
      next = { ...campaign, version: campaign.version + 1, playlistTargets };
      publicationCommits += 1;
    } else {
      assert.ok(['owner', 'manager'].includes(role), 'Staff cannot generate/edit/preview/approve/revoke');
      if (path.endsWith('/revoke')) next = { ...campaign, version: campaign.version + 1, state: 'REVOKED', playlistTargets: campaign.playlistTargets.map(target => ({ ...target, state: 'REVOKED' })) };
      else {
        assert.equal(campaign.state, 'DRAFT');
        if (path.endsWith('/approve')) {
          if (campaign.priceVersion !== priceVersion || campaign.basePrice.amountMinor !== product.basePrice.amountMinor || campaign.stockSnapshot !== product.available) return refusal('PROMOTION_REVIEW_REQUIRED');
          next = { ...campaign, version: campaign.version + 1, state: 'APPROVED' };
        } else if (path.endsWith('/preview')) next = { ...campaign, version: campaign.version + 1, basePrice: product.basePrice, unitPrice: discounted, priceVersion, stockSnapshot: product.available };
        else if (path.endsWith('/derive')) {
          assert.equal(method, 'POST'); assert.equal(body.confirmScope, true);
          next = { ...campaign, version: campaign.version + 1, state: 'DRAFT', startsAt: new Date().toISOString(), expiresAt: expiry() };
        }
        else {
          assert.equal(method, 'PATCH'); assert.equal(path, `/promotions/${campaignId}`);
          const { expectedVersion, idempotencyKey, ...edit } = body;
          next = { ...campaign, ...edit, version: campaign.version + 1 };
        }
      }
    }
    campaigns.set(campaignId, next); const result = remember({ campaign: next });
    if (path.endsWith('/derive') && loseDerive) { loseDerive = false; return route.abort('failed'); }
    if (path.endsWith('/publish') && losePublish) { losePublish = false; return route.abort('failed'); }
    return reply(result);
  });

  const workspace = page.getByRole('main', { name: 'Promotions workspace', exact: true });
  const generation = workspace.getByRole('region', { name: 'Generate promotion', exact: true });
  // <section aria-label> maps to region; scope queries to avoid publication/review checkboxes.
  const publication = workspace.getByRole('region', { name: 'Select screen and confirm', exact: true });
  const delivery = workspace.getByRole('region', { name: 'Promotion delivery lifecycle', exact: true });
  const generate = generation.getByRole('button', { name: 'Create AI draft', exact: true });
  const review = workspace.locator('.promotion-approval input[type="checkbox"]');
  const approve = workspace.getByRole('button', { name: 'Approve draft · do not send', exact: true });
  const confirm = publication.getByRole('checkbox');
  const send = publication.getByRole('button', { name: /^Confirm & send/ });
  const idle = () => page.waitForFunction(() => {
    const refresh = document.querySelector('[aria-label="Promotions workspace"] header button');
    const library = document.querySelector('.promotion-library-item');
    const pending = document.querySelector('.promotion-pending button');
    const generate = document.querySelector('[aria-label="Generate promotion"] button:last-child');
    const review = document.querySelector('#campaign-review button');
    return refresh instanceof HTMLButtonElement && !refresh.disabled &&
      ((library instanceof HTMLButtonElement && !library.disabled) || (pending instanceof HTMLButtonElement && !pending.disabled) || (generate instanceof HTMLButtonElement && !generate.disabled) || (review instanceof HTMLButtonElement && !review.disabled));
  });
  const signIn = async () => {
    await page.getByLabel('Email', { exact: true }).fill('promotion-fixture@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fixture-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Promotions', exact: true }).click();
    await workspace.locator('.promotion-library-item').first().waitFor(); await idle();
  };
  const selectCampaign = async campaignId => {
    await idle();
    if (!await workspace.locator('.promotion-library-item').count()) {
      await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click();
      await workspace.locator('.promotion-library-item').first().waitFor();
    }
    await workspace.locator('.promotion-library-item').filter({ has: page.getByText(campaigns.get(campaignId).headline, { exact: true }) }).click();
    await publication.waitFor();
  };
  const refresh = async () => {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/promotions' && value.request().method() === 'GET');
    await workspace.getByRole('button', { name: 'Refresh promotions', exact: true }).click(); await response; await idle();
  };
  const command = async (button, path, method = 'POST') => {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api${path}` && value.request().method() === method);
    await button.click(); const result = await response; await idle(); return result.status();
  };
  const approveDraft = async campaignId => {
    await selectCampaign(campaignId);
    assert.equal(await approve.isEnabled(), false, 'Approval requires a fresh preview and explicit review');
    assert.equal(await command(workspace.getByRole('button', { name: 'Refresh preview, price & stock', exact: true }), `/promotions/${campaignId}/preview`), 200);
    assert.equal(await review.isChecked(), false); assert.equal(await approve.isEnabled(), false);
    await review.check(); assert.equal(await command(approve, `/promotions/${campaignId}/approve`), 200);
    assert.equal(await confirm.isChecked(), false); assert.equal(await send.isEnabled(), false, 'Approval never implies publication confirmation');
  };
  const deliveryStates = () => delivery.locator('[data-promotion-state]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-promotion-state')));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin); await signIn();
  const library = workspace.getByRole('region', { name: 'Campaign library', exact: true });
  await library.getByLabel('Search campaigns', { exact: true }).fill('daily');
  assert.equal(await library.locator('.promotion-library-item').count(), 1, 'P33 search narrows the rendered campaign library');
  await library.getByLabel('Search campaigns', { exact: true }).fill('');
  await library.getByRole('button', { name: 'Drafts', exact: true }).click();
  assert.equal(await library.locator('.promotion-library-item').count(), 3, 'P33 draft filter exposes only draft campaigns');
  await library.getByRole('button', { name: 'All', exact: true }).click();
  await selectCampaign(dailyId);
  await workspace.getByText('Campaign draft review', { exact: false }).waitFor();
  assert.equal(await library.count(), 0, 'P34 review hides the P33 library instead of stacking it below the active screen');
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click();
  await library.waitFor(); assert.equal(await library.getByLabel('Search campaigns', { exact: true }).inputValue(), '');
  await library.getByRole('button', { name: /Create promotion/ }).click();
  assert.equal(await library.count(), 0, 'P33 create hides the library while the creation screen is active');
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click(); await library.waitFor();
  await library.getByRole('button', { name: /Create promotion/ }).click();
  const floor = workspace.getByRole('region', { name: 'Promotion floor', exact: true });
  await floor.getByLabel('Select device: FIXTURE original screen', { exact: true }).click();
  const inspection = workspace.getByRole('complementary', { name: 'FIXTURE original screen', exact: true });
  await inspection.getByRole('button', { name: 'Refresh device playlist', exact: true }).waitFor();
  await inspection.getByText('Campaign details & scheduled items', { exact: true }).click();
  await inspection.getByRole('button', { name: 'Open campaign', exact: true }).click();
  await workspace.getByRole('heading', { name: campaigns.get(dailyId).headline, exact: true }).waitFor();
  assert.equal(await floor.count(), 0, 'Floor-origin Open campaign exits inspection before mounting P34');
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click(); await library.waitFor();
  await library.getByRole('button', { name: /Create promotion/ }).click();
  await floor.getByLabel('Select device: FIXTURE original screen', { exact: true }).click();
  await inspection.getByText('Campaign details & scheduled items', { exact: true }).click();
  await inspection.getByRole('button', { name: 'Edit as new draft', exact: true }).click();
  await workspace.getByRole('radio', { name: 'All campaign devices', exact: true }).check();
  await workspace.getByRole('checkbox', { name: 'I confirm this draft scope. Creating does not approve or send.', exact: true }).check();
  const derive = workspace.getByRole('button', { name: 'Create editable draft · do not send', exact: true });
  await derive.click(); await workspace.getByRole('alert').first().waitFor();
  const deriveCalls = () => mutationCalls('/derive');
  assert.equal(deriveCalls().length, 1, 'Ambiguous floor derive is saved exactly once and not automatically resent');
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click(); await library.waitFor();
  const resolve = workspace.getByRole('button', { name: 'Resolve / retry exact action', exact: true });
  await resolve.waitFor();
  await resolve.click();
  await workspace.getByRole('heading', { name: campaigns.get(dailyId).headline, exact: true }).waitFor();
  assert.equal(deriveCalls().length, 2, 'Visible recovery replays the exact retained floor derive once');
  assert.deepEqual(deriveCalls()[1], deriveCalls()[0], 'Floor recovery preserves the original derive method, path, payload and key');
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click(); await library.waitFor();
  await library.locator('.promotion-library-item').filter({ has: page.getByText(campaigns.get(dailyId).headline, { exact: true }) }).click();
  await workspace.getByText('Campaign draft review', { exact: false }).waitFor();
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/terra-pos-campaign-p34-desktop-correction-medium-20261024.png`, fullPage: true });
  const image = workspace.locator('.promotion-preview img');
  await image.waitFor(); assert.equal(await image.getAttribute('src'), '/images/menu/latte.jpg');
  assert.equal(await image.getAttribute('width'), '480'); assert.equal(await image.getAttribute('height'), '320');
  await page.waitForFunction(() => { const image = document.querySelector('.promotion-preview img'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; });
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click(); await library.waitFor();
  await library.getByRole('button', { name: /Create promotion/ }).click();
  await generation.locator(`input[name="productIds"][value="${productId}"]`).check();
  await generation.locator('[name="goal"]').fill('Fixture surplus goal'); await generation.locator('[name="minimumPrice"]').fill('2.55');
  assert.equal(await generate.isEnabled(), true, 'A configured owner can request a draft after choosing explicit inputs');
  assert.equal(await command(generate, '/promotions/generate'), 200);
  await workspace.locator('.promotion-job button:visible').first().waitFor();
  assert.ok(calls.some(call => call.path === '/promotions/jobs/fixture-job-daily'), 'Queued generation is polled through its durable job endpoint');
  assert.equal(publishCount(), 0); assert.equal(mutationCalls('/approve').length, 0);
  await workspace.locator('.promotion-job button:visible').first().click();
  await workspace.getByLabel('Headline', { exact: true }).fill('FIXTURE merchant edited daily');
  assert.equal(await command(workspace.getByRole('button', { name: 'Save draft · no publication', exact: true }), `/promotions/${dailyId}`, 'PATCH'), 200);
  const preview = workspace.getByRole('button', { name: 'Refresh preview, price & stock', exact: true });
  await command(preview, `/promotions/${dailyId}/preview`); await review.check();
  product.basePrice = { ...money, amountMinor: '330' }; product.unitPrice = product.basePrice; product.available = 18;
  priceVersion = id(5); discounted = { ...money, amountMinor: '297' };
  assert.equal(await command(approve, `/promotions/${dailyId}/approve`), 409);
  await workspace.getByRole('alert').waitFor();
  assert.equal(await approve.isEnabled(), false); assert.equal(await review.isChecked(), false, 'Changed canonical price/stock forces fresh review');
  assert.equal(publishCount(), 0, 'Generation/edit/preview/rejected approval never publish');
  await approveDraft(dailyId); assert.equal(publishCount(), 0);
  assert.equal(await publication.getByRole('combobox').count(), 0, 'Daily has no choose-one recipient selector');
  assert.equal(await publication.locator('.promotion-device-list li').count(), devices.length);
  await confirm.check(); assert.equal(await send.isEnabled(), true);
  for (const field of ['assignmentGeneration', 'authGeneration', 'screenGeneration']) {
    devices = devices.map((device, index) => index ? device : { ...device, [field]: String(BigInt(device[field]) + 1n) });
    await refresh(); assert.equal(await send.isEnabled(), false, `${field} change invalidates frozen confirmation`);
    assert.equal(publishCount(), 0); await confirm.uncheck(); await confirm.check(); assert.equal(await send.isEnabled(), true);
  }
  devices = [...devices, { ...devices[1], deviceId: id(35), label: 'FIXTURE added counter', busy: false }];
  await refresh(); assert.equal(await send.isEnabled(), false, 'New device cannot silently enter a confirmed batch');
  await confirm.uncheck(); await confirm.check();
  const frozenTargets = structuredClone(fences(devices));
  await send.click(); await workspace.getByRole('button', { name: 'Resolve / retry exact action', exact: true }).waitFor(); await idle();
  const original = structuredClone(mutationCalls('/publish')[0]);
  assert.deepEqual(original.body.targets, frozenTargets);
  await refresh(); assert.equal(publishCount(), 1, 'Polling an unknown outcome never automatically resends');
  await page.reload(); await signIn();
  await workspace.getByRole('button', { name: 'Resolve / retry exact action', exact: true }).waitFor();
  assert.equal(publishCount(), 1, 'Reload never automatically resends the durable command');
  // Change current fences after the lost response: replay must still use the OLD
  // committed batch/key/version, never reconstruct recipients from the fresh list.
  devices = devices.map((device, index) => index ? device : { ...device, screenGeneration: String(BigInt(device.screenGeneration) + 1n) });
  assert.equal(await command(workspace.getByRole('button', { name: 'Resolve / retry exact action', exact: true }), `/promotions/${dailyId}/publish`), 200);
  assert.deepEqual(mutationCalls('/publish')[1], original, 'Lost-response reload replays exact method/path/payload/key');
  await selectCampaign(dailyId);
  campaigns.set(dailyId, { ...campaigns.get(dailyId), expiresAt: new Date(Date.now() - 1000).toISOString() });
  await refresh(); assert.equal(await send.isEnabled(), false, 'Expired campaigns cannot publish');
  campaigns.set(dailyId, { ...campaigns.get(dailyId), expiresAt: expiry() }); await refresh();
  page.once('dialog', dialog => dialog.accept());
  assert.equal(await command(workspace.getByRole('button', { name: 'Revoke this campaign and its original targets', exact: true }), `/promotions/${dailyId}/revoke`), 200);
  assert.equal(await delivery.locator('[data-promotion-state]').count(), 0, 'Revoke clears the selected draft rather than implying a rendered delivery state');

  for (const [index, audience] of ['customer', 'from_order'].entries()) {
    if (index) {
      await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click();
      await library.waitFor();
    }
    await library.getByRole('button', { name: /Create promotion/ }).click();
    const campaignId = id(12 + index * 10), before = publishCount(), generationsBefore = mutationCalls('/generate').length;
    if (audience === 'from_order') {
      // A separate eligible PAID-order fixture in the new occupancy, never a
      // mutation/retarget of the old order's immutable generation.
      recipients = { ...recipients, orders: [{ ...originalOrderFixture, id: id(16), occupancyGeneration: recipients.tables[0].generation }] };
      await refresh();
    }
    await generation.getByRole('button', { name: audience === 'customer' ? 'Customer' : 'From order', exact: true }).click();
    const relationship = generation.locator('.promotion-recipient input[type="checkbox"]');
    assert.equal(await relationship.isChecked(), false);
    if (audience === 'customer') {
      const profile = generation.locator('.promotion-recipient select').nth(0);
      const table = generation.locator('.promotion-recipient select').nth(1);
      const recipient = generation.locator('.promotion-recipient select').nth(2);
      assert.equal(await profile.inputValue(), ''); assert.equal(await table.inputValue(), ''); assert.equal(await recipient.inputValue(), '');
      await generation.getByLabel('Search customers', { exact: true }).fill('customer profile');
      await profile.locator(`option[value="${customerId}"]`).waitFor({state:'attached'}); await profile.selectOption(customerId);
      await table.selectOption(tableId); assert.equal(await recipient.inputValue(), '', 'Selecting a table never selects its first guest');
      await recipient.selectOption(visitId);
    } else {
      const originalOrder = generation.locator('.promotion-recipient select').first();
      assert.equal(await originalOrder.inputValue(), '', 'No original order is auto-selected'); await originalOrder.selectOption(recipients.orders[0].id);
      assert.equal(await generation.locator(`input[name="productIds"][value="${originalProductId}"]`).isDisabled(), true, 'Original order product cannot be suggested again');
    }
    await generation.locator(`input[name="productIds"][value="${productId}"]`).check();
    await generation.locator('[name="goal"]').fill('Fixture recipient goal');
    assert.equal(await generate.isEnabled(), false, 'Recipient selection is not explicit relationship confirmation');
    assert.equal(mutationCalls('/generate').length, generationsBefore);
    await relationship.check();
    if (audience === 'customer') {
      recipients = { ...recipients, tables: [{ ...recipients.tables[0], generation: '4' }], orders: [] };
      await refresh();
      await page.waitForFunction(() => document.querySelector('.promotion-recipient input[type="checkbox"]')?.checked === false);
      assert.equal(await generate.isEnabled(), false, 'Changed occupancy invalidates recipient confirmation'); await relationship.check();
    }
    assert.equal(await command(generate, '/promotions/generate'), 200);
    assert.equal(publishCount(), before, 'Personal generation sends nothing');
    await approveDraft(campaignId);
    assert.equal(await publication.getByRole('combobox').count(), 0, 'Personal campaigns have no retarget selector');
    assert.equal(await publication.locator('.promotion-device-list li').count(), 1);
    await confirm.check();
    const originalDevice = structuredClone(devices[0]);
    // Offer an alternate screen at the same table while the original binding has
    // changed. The UI must refuse, not silently choose this otherwise-ready device.
    devices = devices.map((device, i) => i === 0 ? { ...device, assignmentGeneration: String(BigInt(device.assignmentGeneration) + 1n) } : i === 1 ? { ...device, tableId, tableLabel: 'FIXTURE Table 4', busy: false } : device);
    await refresh(); assert.equal(await send.isEnabled(), false); assert.equal(publishCount(), before);
    await confirm.uncheck(); assert.equal(await confirm.isEnabled(), false, 'No valid bound original device means no replacement confirmation');
    devices = devices.map((device, i) => i ? device : originalDevice); await refresh();
    assert.equal(await confirm.isChecked(), false); assert.equal(await send.isEnabled(), false);
    await confirm.check(); assert.equal(await command(send, `/promotions/${campaignId}/publish`), 200);
    assert.deepEqual(mutationCalls('/publish').at(-1).body.targets, fences([originalDevice]));
    assert.deepEqual(await deliveryStates(), ['DELIVERED']); assert.equal(publishCount(), before + 1);
  }

  await page.getByRole('button', { name: 'Log out', exact: true }).click(); role = 'staff';
  campaigns.set(dailyId, { ...campaigns.get(dailyId), state: 'DRAFT', version: campaigns.get(dailyId).version + 1, playlistTargets: [] });
  await signIn(); await selectCampaign(dailyId);
  assert.equal(await generation.count(), 0); assert.equal(await workspace.getByLabel('Headline', { exact: true }).count(), 0);
  assert.equal(await approve.count(), 0); assert.equal(await workspace.getByRole('button', { name: /^Revoke this campaign/ }).count(), 0);
  assert.equal(await send.isEnabled(), false, 'View-only draft controls do not grant Staff management rights');
  const staffBefore = calls.filter(call => call.method !== 'GET' && call.path.startsWith('/promotions/')).length;
  await refresh(); assert.equal(calls.filter(call => call.method !== 'GET' && call.path.startsWith('/promotions/')).length, staffBefore, 'Viewing/refreshing never mutates campaigns');
  campaigns.set(dailyId, { ...campaigns.get(dailyId), state: 'APPROVED', version: campaigns.get(dailyId).version + 1 }); await refresh();
  await workspace.getByRole('button', { name: 'Reload latest · replace edits', exact: true }).click();
  assert.equal(await confirm.isChecked(), false); assert.equal(await send.isEnabled(), false);
  await confirm.check(); assert.equal(await command(send, `/promotions/${dailyId}/publish`), 200, 'Staff can explicitly publish an approved batch');
  assert.equal(calls.filter(call => call.method !== 'GET' && call.path.startsWith('/promotions/')).length, staffBefore + 1, 'Staff sends only the approved publication command');
  await page.getByRole('button', { name: 'Log out', exact: true }).click(); role = 'owner'; configured = false;
  await signIn(); await library.getByRole('button', { name: /Create promotion/ }).click();
  assert.equal(await generate.isEnabled(), false, 'Absent provider configuration disables generation');
  await workspace.getByRole('button', { name: 'Back to campaign library', exact: true }).click(); await library.waitFor();
  await page.getByRole('button', { name: 'Switch to Thai', exact: true }).click();
  assert.equal(await workspace.getByLabel('ค้นหารายการ', { exact: true }).count(), 1, 'P33 search label follows the active Thai locale');
  await workspace.getByLabel('ค้นหารายการ', { exact: true }).fill('ไม่มีแคมเปญนี้');
  await workspace.getByText('ไม่พบรายการที่ตรงกับการค้นหา', { exact: true }).waitFor();
  await workspace.getByLabel('ค้นหารายการ', { exact: true }).fill('');
  for (const width of [768, 820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await library.locator('.promotion-library-item').evaluateAll(items => items.map(item => {
      const box = item.getBoundingClientRect(); return [box.left, box.right];
    }));
    assert.ok(bounds.every(([left, right]) => left >= 0 && right <= width), `${width}px campaign cards remain fully visible`);
    assert.equal(await library.locator('.promotion-library-columns').isVisible(), false, `${width}px uses the compact campaign-card header`);
  }
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/terra-pos-campaign-p33-mobile-th-correction-medium-20261024.png`, fullPage: true });
  await library.locator('.promotion-library-item').first().click();
  await workspace.getByRole('heading', { name: 'ตรวจร่างแคมเปญ', exact: true }).waitFor();
  const reviewBounds = await workspace.locator('.promotion-review-preview').boundingBox();
  assert.ok(reviewBounds && reviewBounds.x >= 0 && reviewBounds.x + reviewBounds.width <= 390, '390px selected Thai P34 preview stays within the review viewport');
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/terra-pos-campaign-p34-mobile-th-correction-medium-20261024.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px workspace has no horizontal overflow');
  assert.equal(calls.filter(call => /\/products\/.*\/offer/.test(call.path) && call.method !== 'GET').length, 0, 'No global offer mutation');
  assert.equal(calls.filter(call => /\/quotes$|\/orders$|\/pay\//.test(call.path) && call.method !== 'GET').length, 0, 'Campaign actions never create quotes/orders/payments');
  return {
    fixture: true, actualProvider: false, actualAndroid: false, actualBackendEligibility: false, actualPhysicalACK: false,
    checks: ['P33 active library search/filter and P34 review/back navigation', 'P33 create/back navigation', 'desktop and compact P34 review grouping', '390/768/820 campaign card visibility and compact headers', 'daily/customer/from_order scoped audiences', 'generation/edit/preview never publish', 'changed canonical price/stock forces explicit renewed review', 'daily explicit frozen assignment/auth/screen fences', 'personal explicit recipient and original-device-only publication', 'no auto-selected customer/table/guest/order', 'occupancy change invalidates recipient confirmation', 'original order products excluded', 'lost-response exact outbound replay command', 'staff access limits', 'provider disabled in EN/TH', 'campaign actions never create quotes/orders/payments'],
    evidence: { generationAudiences: mutationCalls('/generate').map(call => call.body.audience), lostResponseRequest: original, replayRequest: mutationCalls('/publish')[1], publicationRequests: publishCount() },
  };
}
