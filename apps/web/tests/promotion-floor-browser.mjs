import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Drives the actual hydrated UI. All HTTP/provider/ACK data below are explicitly
// fixtures, not backend discount authority, real AI, phone, chain or screen proof.
// Caller supplies a fresh Playwright page and running local web; no real API egress.
export default async function promotionFloorBrowser(page, origin, screenshotDirectory = '.omp/work/promotion-floor-browser') {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  // Exercise the actual Astro allowlist, not the intercepted successful routes.
  // These methods/near-matches must be refused locally before any upstream call.
  for (const [method, path, status] of [
    ['GET', '/api/promotions/fixture-source/derive', 405],
    ['PATCH', '/api/promotions/devices/fixture-device', 405],
    ['PATCH', '/api/promotions/recipients', 405],
    ['GET', '/api/promotions/devices/fixture-device/derive', 404],
    ['POST', '/api/promotions/fixture-source/derive/more', 404],
  ]) {
    const response = await page.request.fetch(new URL(path, origin).href, { method, headers: { origin: new URL(origin).origin, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { data: {} }) });
    assert.equal(response.status(), status, `Actual proxy refuses ${method} ${path} before forwarding`);
  }
  const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tableId = id(1), secondTableId = id(2), productId = id(3), sourceId = id(4), excludedId = id(5), personalId = id(6);
  const merchantId = 'floor-http-fixture', userId = 'floor-fixture-owner';
  const money = { currency: 'USD', decimals: 2, amountMinor: '300' };
  const start = new Date(Date.now() - 60000).toISOString(), expiry = new Date(Date.now() + 3600000).toISOString();
  const product = { id: productId, name: 'ลาเต้ทดสอบ', nameEn: 'HTTP fixture latte', category: 'Coffee', description: 'HTTP fixture only', imageUrl: '/images/menu/latte.jpg', basePrice: money, unitPrice: money, available: 20, promotion: null };
  const tables = [tableId, secondTableId].map((value, index) => ({ id: value, label: `FIXTURE table ${index + 1}`, retiredAt: null, occupancy: { generation: '7', active: true, joined: true, openedAt: start, lastActivityAt: start, timeoutMinutes: 120 } }));
  let promotionDevices = [
    { deviceId: id(10), label: 'FIXTURE available', tableId, tableLabel: tables[0].label, online: true, busy: false, capable: true, assignmentGeneration: '2', authGeneration: '3', screenGeneration: '4' },
    { deviceId: id(11), label: 'FIXTURE pickup busy', tableId, tableLabel: tables[0].label, online: true, busy: true, capable: true, assignmentGeneration: '2', authGeneration: '3', screenGeneration: '4' },
    { deviceId: id(12), label: 'FIXTURE offline', tableId: secondTableId, tableLabel: tables[1].label, online: false, busy: false, capable: true, assignmentGeneration: '2', authGeneration: '3', screenGeneration: '4' },
    { deviceId: id(13), label: 'FIXTURE unsupported counter', tableId: null, tableLabel: null, online: true, busy: false, capable: false, assignmentGeneration: '2', authGeneration: '3', screenGeneration: '4' },
  ];
  // Registry screen idle deliberately does not reveal pickup-busy. UI must use
  // the canonical promotion busy projection instead of inferring availability.
  const registryDevices = () => promotionDevices.map(d => ({ id: d.deviceId, label: d.label, tableId: d.tableId, tableLabel: d.tableLabel, assignmentGeneration: d.assignmentGeneration, authGeneration: d.authGeneration, revokedAt: null, online: d.online, lastSeenAt: start, connectionGeneration: '1', screen: { kind: 'idle', screenGeneration: d.screenGeneration, orderId: null, sessionId: null } }));
  const daily = { audience: 'daily', minimumUnitMinor: '200', origin: 'generated', priceAuthority: 'public', context: { kind: 'daily', timezone: 'Asia/Bangkok', lookbackWeeks: 6, from: start, until: expiry, weekday: 2, verifiedPaidOrderCount: 0, sparseHistory: true, basis: 'stock_first_sparse_history', buckets: [] } };
  const provenance = { kind: 'fixture_provider', provider: 'HTTP FIXTURE', model: 'no-real-ai', requestId: 'fixture-request-original', jobId: 'fixture-job-original' };
  const makeCampaign = (campaignId, headline) => ({ id: campaignId, version: 4, approvedVersion: 3, state: 'APPROVED', productId, headline, copy: 'Fixture copy, not live AI', rationale: 'HTTP fixture', discountPercent: 10, maxDiscountPercent: 20, basePrice: money, unitPrice: { ...money, amountMinor: '270' }, priceVersion: id(7), stockSnapshot: 20, startsAt: start, expiresAt: expiry, imageUrl: product.imageUrl, previewUrl: product.imageUrl, assetBlocker: null, provenance: { ...provenance }, targets: [], scope: structuredClone(daily), playlistTargets: [] });
  const source = makeCampaign(sourceId, 'FIXTURE shared daily');
  source.playlistTargets = promotionDevices.map((d, index) => ({ id: id(30 + index), campaignId: sourceId, campaignVersion: 3, deviceId: d.deviceId, audience: 'daily', state: index === 1 ? 'DEFERRED_BUSY' : index === 2 ? 'DEFERRED_OFFLINE' : index === 3 ? 'UNSUPPORTED' : 'RENDERED', failure: null, renderedAt: index === 0 ? start : null }));
  const excluded = makeCampaign(excludedId, 'FIXTURE historical rendered, NOT current');
  excluded.playlistTargets = [{ ...source.playlistTargets[0], id: id(35), campaignId: excludedId }];
  excluded.state = 'EXPIRED'; // Historical RENDERED receipt cannot make an expired campaign live.
  const personal = makeCampaign(personalId, 'FIXTURE queued personal');
  personal.scope = { audience: 'customer', minimumUnitMinor: '200', origin: 'generated', priceAuthority: 'personal', context: { kind: 'customer', items: [], currentOrderItems: [], historyIncluded: false, historyBasis: 'current_order_only' }, binding: { tableId, occupancyId: id(50), occupancyGeneration: '7', recipientId: id(51), recipientVisitId: id(52), targetDeviceId: promotionDevices[0].deviceId, assignmentGeneration: '2', authGeneration: '3', customerId: id(53), customerAuthSessionId: null, sourceOrderId: null, originBasis: 'staff_recognition', excludedProductIds: [] } };
  personal.playlistTargets = [{ ...source.playlistTargets[0], id: id(36), campaignId: personalId, audience: 'personal', state: 'QUEUED', renderedAt: null }];
  const future = makeCampaign(id(8), 'FIXTURE future daily queued');
  future.startsAt = new Date(Date.now() + 1800000).toISOString();
  future.playlistTargets = source.playlistTargets.map(t => ({ ...t, id: id(60 + promotionDevices.findIndex(d => d.deviceId === t.deviceId)), campaignId: future.id, state: t.state === 'RENDERED' ? 'QUEUED' : t.state, renderedAt: null }));
  const campaigns = new Map([source, excluded, personal, future].map(c => [c.id, c]));
  const jobs = new Map(), committed = new Map(), calls = [], clearCommitted = new Map();
  let projectionDown = false, loseDerive = true, loseClear = true, deriveSerial = 0;
  const fences = ds => ds.map(({ deviceId, assignmentGeneration, authGeneration, screenGeneration }) => ({ deviceId, assignmentGeneration, authGeneration, screenGeneration }));
  const mutations = () => calls.filter(c => c.method !== 'GET' && c.path !== '/session');
  const sourceSnapshot = structuredClone(source);
  const playlist = device => ({ generation: '12', occupancyGeneration: tables.find(t => t.id === device.tableId)?.occupancy.generation ?? null, tableId: device.tableId, state: 'CURRENT', items: device.deviceId === promotionDevices[0].deviceId ? [{ targetId: source.playlistTargets[0].id, campaignId: sourceId, campaignVersion: 3, audience: 'daily', productId, headline: 'FIXTURE canonical eligible item', copy: 'Authoritative playlist only', unitPrice: source.unitPrice, basePrice: money, discountPercent: 10, startsAt: start, expiresAt: expiry, image: null, menuUrl: null }] : [] });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice(4), method = request.method(), body = method === 'GET' ? null : request.postDataJSON();
    calls.push({ path, method, body });
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/demo-session') return reply({ enabled: false });
    if (path === '/session') return reply({ token: 'HTTP-FIXTURE-NO-SECRET', merchantId, userId, role: 'owner' });
    if (path === '/menu') return reply({ merchant: { name: 'FLOOR HTTP FIXTURE' }, products: [product], asOf: new Date().toISOString(), priceValidUntil: expiry, menuVersion: 'fixture-menu', priceVersion: id(7), pricingRevision: '1', currency: 'USD', decimals: 2 });
    if (path === '/tables' && method === 'GET') return reply({ tables });
    if (path === '/devices' && method === 'GET') return reply({ devices: registryDevices() });
    if (['/registers', '/orders', '/customers'].includes(path) && method === 'GET') return reply({ [path.slice(1)]: [] });
    if (path === '/settings/collection' && method === 'GET') return reply({counterEnabled:false,version:1});
    if (path === '/settings/pricing' && method === 'GET') return reply({revision:'1',configured:true,priceVersion:id(7),catalogCurrency:'USD',decimals:2,provenance:{kind:'demo_configured',label:'Floor HTTP fixture'},prices:[{productId,unitMinor:'300'}],settlement:{network:'solana:devnet',mint:'FIXTURE-mint',tokenProgram:'FIXTURE-program',decimals:6,genesisHash:'FIXTURE-genesis',quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
    if (path === '/promotions/recipients') return reply({ tables: [], customers: [], orders: [] });
    if (path === '/promotions' && method === 'GET') return reply({ provider: { configured: true, blocker: null }, jobs: [...jobs.values()], campaigns: [...campaigns.values()], devices: promotionDevices });
    if (path.startsWith('/promotions/devices/') && method === 'GET') {
      if (projectionDown) return reply({ error: { code: 'HTTP_FIXTURE_OFFLINE', message: 'Fixture inspection unavailable', retryable: true } }, 503);
      const device = promotionDevices.find(d => d.deviceId === path.split('/').at(-1)); assert.ok(device);
      // Same public shape as the API: live approved revision receipts for this device,
      // independently bounded from its canonical playlist; unpublished placement is not delivery.
      const current = playlist(device), liveStates = ['QUEUED', 'DEFERRED_BUSY', 'DEFERRED_OFFLINE', 'DELIVERED', 'RENDERED', 'UNSUPPORTED'];
      const receipts = [...campaigns.values()].flatMap(c => c.state === 'APPROVED' && Date.parse(c.expiresAt) > Date.now() ? (c.playlistTargets ?? []).filter(t => t.deviceId === device.deviceId && t.campaignVersion === c.approvedVersion && liveStates.includes(t.state)).map(t => ({ campaign: c, receipt: t })) : []);
      receipts.sort((a, b) => Number(current.items.some(i => i.targetId === b.receipt.id)) - Number(current.items.some(i => i.targetId === a.receipt.id)) || b.receipt.id.localeCompare(a.receipt.id));
      const bounded = receipts.slice(0, 100), ids = new Set(bounded.map(({ campaign }) => campaign.id));
      return reply({ device, playlist: current, campaigns: [...campaigns.values()].filter(c => ids.has(c.id)).map(c => ({ ...c, targets: c.targets.filter(t => t.targetDeviceId === device.deviceId), playlistTargets: bounded.filter(({ campaign }) => campaign.id === c.id).map(({ receipt }) => receipt) })) });
    }
    if (path.startsWith('/promotions/jobs/') && method === 'GET') {
      const job = jobs.get(path.split('/').at(-1)); assert.ok(job); job.state = 'SUCCEEDED'; return reply({ job });
    }
    if (method === 'GET' && campaigns.has(path.split('/').at(-1))) return reply({ campaign: campaigns.get(path.split('/').at(-1)) });
    if (path.endsWith('/clear') && path.startsWith('/tables/') && method === 'POST') {
      const prior = clearCommitted.get(body.idempotencyKey);
      if (prior) { assert.deepEqual({ path, method, body }, prior.command); return reply(prior.result); }
      const table = tables.find(t => t.id === path.split('/')[2]); assert.ok(table);
      assert.deepEqual(Object.keys(body).sort(), ['confirmClear', 'expectedGeneration', 'idempotencyKey']); assert.equal(body.confirmClear, true); assert.equal(body.expectedGeneration, table.occupancy.generation);
      table.occupancy.generation = String(BigInt(table.occupancy.generation) + 1n); table.occupancy.active = false;
      personal.state = 'REVOKED'; personal.playlistTargets[0].state = 'REVOKED';
      const result = { cleared: true, tableId: table.id, occupancy: table.occupancy };
      clearCommitted.set(body.idempotencyKey, structuredClone({ command: { path, method, body }, result }));
      if (loseClear) { loseClear = false; return route.abort('failed'); }
      return reply(result);
    }
    assert.ok(path.startsWith('/promotions/') && method !== 'GET', `Unexpected HTTP fixture route ${method} ${path}`);
    assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/i);
    const prior = committed.get(body.idempotencyKey);
    if (prior) { assert.deepEqual({ path, method, body }, prior.command, 'Replay keeps the entire saved request, even after current fences/version change'); return reply(prior.result); }
    const campaign = campaigns.get(path.split('/')[2]); assert.ok(campaign); assert.equal(body.expectedVersion, campaign.version);
    let result;
    if (path.endsWith('/derive')) {
      assert.deepEqual(Object.keys(body).sort(), ['confirmScope', 'device', 'expectedVersion', 'idempotencyKey', 'mode', 'scope']);
      assert.equal(body.confirmScope, true); assert.ok(['all_campaign_devices', 'this_table'].includes(body.scope)); assert.ok(['edit', 'regenerate'].includes(body.mode));
      const device = promotionDevices.find(d => d.deviceId === body.device.deviceId); assert.deepEqual(body.device, fences([device])[0]);
      const targets = body.scope === 'this_table' ? promotionDevices.filter(d => d.deviceId === device.deviceId) : promotionDevices.filter(d => campaign.playlistTargets.some(t => t.deviceId === d.deviceId));
      const derived = { ...structuredClone(campaign), id: id(100 + ++deriveSerial), version: 1, approvedVersion: null, state: 'DRAFT', headline: `FIXTURE derived ${deriveSerial}`, playlistTargets: [], scope: { ...structuredClone(daily), origin: body.mode === 'edit' ? 'manual_derived' : 'ai_regenerated', priceAuthority: body.scope === 'this_table' ? 'table' : 'public', pricePresentation: 'inherited_source', placement: { kind: body.scope === 'this_table' ? 'table' : 'campaign_devices', sourceCampaignId: campaign.id, sourceVersion: campaign.version, deviceIds: targets.map(d => d.deviceId), priceAuthority: body.scope === 'this_table' ? 'table' : 'public', ...(body.scope === 'this_table' ? { tableId: device.tableId } : {}) } } };
      if (body.mode === 'regenerate') {
        const jobId = id(200 + deriveSerial); derived.provenance = { ...provenance, requestId: `fixture-regenerate-${deriveSerial}`, jobId };
        const job = { id: jobId, state: 'QUEUED', campaignId: derived.id, blocker: null, createdAt: start, provenance: derived.provenance }; jobs.set(jobId, job); result = { job };
      } else { assert.deepEqual(derived.provenance, campaign.provenance); result = { campaign: derived }; }
      campaigns.set(derived.id, derived);
    } else if (path.endsWith('/publish')) {
      assert.equal(campaign.state, 'APPROVED'); assert.equal(body.confirmTargets, true);
      const targets = promotionDevices.filter(d => campaign.scope.placement.deviceIds.includes(d.deviceId)); assert.deepEqual(body.targets, fences(targets));
      campaign.playlistTargets = targets.map((d, index) => ({ id: id(300 + index), campaignId: campaign.id, campaignVersion: campaign.approvedVersion, deviceId: d.deviceId, audience: 'daily', state: d.busy ? 'DEFERRED_BUSY' : 'DELIVERED', failure: null, renderedAt: null })); campaign.version += 1; result = { campaign };
    } else {
      assert.notEqual(campaign.id, sourceId, 'Original inspected source is never patched, previewed or approved by the derivation flow'); assert.equal(campaign.state, 'DRAFT');
      if (method === 'PATCH') { const { expectedVersion, idempotencyKey, ...edit } = body; Object.assign(campaign, edit); }
      campaign.version += 1;
      if (path.endsWith('/approve')) { campaign.state = 'APPROVED'; campaign.approvedVersion = campaign.version; }
      result = { campaign };
    }
    committed.set(body.idempotencyKey, structuredClone({ command: { path, method, body }, result }));
    if (path.endsWith('/derive') && loseDerive) { loseDerive = false; return route.abort('failed'); }
    return reply(result);
  });
  await page.addInitScript(({ merchantId, tableId, deviceId }) => {
    const key = 'bitpos-floor-v1:' + merchantId;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ ['t:' + tableId]: { x: 28, y: 36 }, ['d:' + deviceId]: { x: 43, y: 55 } }));
  }, { merchantId, tableId, deviceId: promotionDevices[0].deviceId });
  const workspace = page.getByRole('main', { name: 'Promotions workspace', exact: true });
  const inspector = workspace.locator('.promotion-floor-inspector');
  const floor = workspace.locator('.floor-inspect');
  const close = async () => { await inspector.getByRole('button', { name: 'Close inspection', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.promotion-floor-inspector')?.open); };
  const login = async () => {
    await page.getByLabel('Email', { exact: true }).fill('floor-fixture@example.invalid'); await page.getByLabel('Password', { exact: true }).fill('fixture-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Promotions', exact: true }).click();
    await workspace.locator('.promotion-library-item').first().waitFor();
  };
  const ready = async () => page.waitForFunction(() => {
    const button = document.querySelector('[data-inspection-campaign] button'); return button instanceof HTMLButtonElement && !button.disabled;
  });
  const selectDevice = async () => { await floor.getByRole('button', { name: 'Select device: FIXTURE available', exact: true }).click(); await inspector.locator('[data-current-target]').waitFor(); await ready(); };
  const waitCommand = async (button, path, method = 'POST') => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api' + path && r.request().method() === method);
    await button.click(); await response;
    await page.waitForFunction(() => { const button = document.querySelector('[aria-label="Promotions workspace"] header button'); return button instanceof HTMLButtonElement && !button.disabled; });
  };
  await page.setViewportSize({ width: 1365, height: 1000 }); await page.goto(origin); await login();
  assert.equal(await inspector.getAttribute('open'), null, 'Floor starts unselected');
  const layoutKey = 'bitpos-floor-v1:' + merchantId;
  const savedLayout = await page.evaluate(key => localStorage.getItem(key), layoutKey);
  const initialMutations = mutations().length;
  const firstDevice = floor.getByRole('button', { name: 'Select device: FIXTURE available', exact: true });
  await firstDevice.focus(); await firstDevice.press('ArrowRight'); await firstDevice.press('Enter'); await ready();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), layoutKey), savedLayout, 'Inspect arrow/click/keyboard never persists a layout');
  assert.equal(mutations().length, initialMutations, 'Selecting never assigns, clears, derives, approves or publishes');
  assert.equal(await inspector.locator('[data-current-target]').count(), 1, 'Only canonical playlist items are current, not all eligible-looking receipts');
  assert.match(await inspector.locator('[data-current-target]').textContent(), /canonical eligible item/);
  assert.equal(await inspector.locator('[data-current-target]').filter({ hasText: excluded.headline }).count(), 0);
  assert.match(await inspector.locator(`[data-inspection-campaign="${sourceId}"]`).textContent(), /Command version 4.*Approved content 3/s);
  assert.match(await inspector.locator(`[data-inspection-campaign="${personalId}"]`).textContent(), /Personal.*Queued/s);
  assert.equal(await inspector.locator(`[data-inspection-campaign="${excludedId}"]`).count(), 0, 'Historical rendered receipts do not establish live device association');
  assert.match(await inspector.locator(`[data-inspection-campaign="${future.id}"]`).textContent(), /APPROVED.*Queued/s);
  assert.equal(await inspector.locator('[data-current-target]').filter({ hasText: future.headline }).count(), 0, 'Future preview never becomes current from a queued receipt');
  await inspector.locator(`[data-inspection-campaign="${personalId}"]`).getByRole('button', { name: 'Edit as new draft', exact: true }).click();
  const personalScope = inspector.getByRole('region', { name: 'Choose draft scope', exact: true });
  assert.equal(await personalScope.getByRole('radio', { name: 'All campaign devices', exact: true }).isEnabled(), false, 'Personal drafts cannot become shared campaigns');
  assert.equal(await personalScope.getByRole('radio', { name: 'New draft for the original recipient here', exact: true }).isEnabled(), true);
  assert.equal(await personalScope.locator('input:checked').count(), 0, 'Original-recipient scope still needs an explicit selection');
  await personalScope.getByRole('radio', { name: 'New draft for the original recipient here', exact: true }).check();
  assert.match(await personalScope.textContent(), /Not a table-wide offer/);
  await personalScope.getByRole('button', { name: 'Cancel scope selection', exact: true }).click();
  await close(); assert.equal(await firstDevice.evaluate(node => node === document.activeElement), true, 'Closing returns focus to initiating node');
  const point = await firstDevice.boundingBox(); assert.ok(point);
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down(); await page.mouse.move(point.x + point.width / 2 + 12, point.y + point.height / 2 + 8, { steps: 3 }); await page.mouse.up();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), layoutKey), savedLayout, 'Inspection pointer movement never drags or stages assignment');
  assert.equal(mutations().length, initialMutations); await close();
  await floor.getByRole('button', { name: 'Select table: FIXTURE table 1', exact: true }).click();
  assert.equal(await inspector.locator('.promotion-table-device').count(), 2, 'Both actual devices remain independently selectable');
  assert.equal(await inspector.locator('[data-inspection-campaign]').count(), 0, 'A table never silently selects its first device or recipient');
  assert.equal(await inspector.locator('input[name="derive-scope"]').count(), 0);
  await close(); await floor.getByRole('button', { name: 'Accessible list', exact: true }).click();
  assert.match(await floor.getByRole('button', { name: 'Select device: FIXTURE pickup busy', exact: true }).textContent(), /Busy · deferred/);
  assert.match(await floor.getByRole('button', { name: 'Select device: FIXTURE offline', exact: true }).textContent(), /Offline · deferred/);
  assert.match(await floor.getByRole('button', { name: 'Select device: FIXTURE unsupported counter', exact: true }).textContent(), /Unsupported/);
  await floor.getByRole('button', { name: 'Select device: FIXTURE available', exact: true }).focus(); await page.keyboard.press('Space'); await ready();
  assert.equal(mutations().length, initialMutations, 'List/Space selection remains read-only');
  const card = inspector.locator(`[data-inspection-campaign="${sourceId}"]`);
  await card.getByRole('button', { name: 'Edit as new draft', exact: true }).click();
  const scopeRegion = inspector.getByRole('region', { name: 'Choose draft scope', exact: true });
  const create = scopeRegion.getByRole('button', { name: 'Create editable draft · do not send', exact: true });
  assert.equal(await scopeRegion.locator('input:checked').count(), 0); assert.equal(await create.isEnabled(), false);
  await scopeRegion.getByRole('radio', { name: 'All campaign devices', exact: true }).check(); await scopeRegion.getByRole('checkbox').check();
  source.version += 1;
  await inspector.getByRole('button', { name: 'Refresh device playlist', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.promotion-derive')?.textContent.includes('Source version or routing changed'));
  assert.equal(await create.isEnabled(), false, 'Changed source version invalidates confirmed derivation');
  await card.getByRole('button', { name: 'Edit as new draft', exact: true }).click();
  await scopeRegion.getByRole('radio', { name: 'Fork a draft for this table only', exact: true }).check(); await scopeRegion.getByRole('checkbox').check();
  await create.click(); await inspector.getByRole('button', { name: 'Resolve / retry exact action', exact: true }).waitFor();
  const originalDerive = structuredClone(mutations().find(c => c.path.endsWith('/derive')));
  assert.equal(originalDerive.body.scope, 'this_table'); assert.equal(originalDerive.body.mode, 'edit'); assert.equal(originalDerive.body.expectedVersion, 5);
  assert.equal(mutations().filter(c => c.path.endsWith('/derive')).length, 1);
  assert.deepEqual(source.provenance, sourceSnapshot.provenance); assert.equal(source.state, 'APPROVED'); assert.deepEqual(source.playlistTargets, sourceSnapshot.playlistTargets);
  await page.reload(); await login();
  assert.equal(mutations().filter(c => c.path.endsWith('/derive')).length, 1, 'Reload does not resend a derivation');
  source.version += 1; promotionDevices = promotionDevices.map(d => ({ ...d, screenGeneration: '5' }));
  await waitCommand(workspace.getByRole('button', { name: 'Resolve / retry exact action', exact: true }), originalDerive.path);
  assert.deepEqual(mutations().filter(c => c.path.endsWith('/derive'))[1], originalDerive, 'Recovery uses saved source version and original routing fences');
  const derived = [...campaigns.values()].find(c => c.scope.origin === 'manual_derived'); assert.ok(derived);
  await selectDevice();
  const editor = inspector.getByRole('region', { name: 'Preview and edit promotion', exact: true });
  await page.waitForFunction(() => { const input = document.querySelector('[aria-label="Preview and edit promotion"] input'); return input instanceof HTMLInputElement && !input.matches(':disabled'); });
  assert.equal(await editor.getByLabel('Headline', { exact: true }).isEnabled(), true);
  await editor.getByLabel('Headline', { exact: true }).fill('FIXTURE explicit table draft edit');
  page.once('dialog', dialog => dialog.dismiss()); await card.getByRole('button', { name: 'Open campaign', exact: true }).click();
  assert.equal(await editor.getByLabel('Headline', { exact: true }).inputValue(), 'FIXTURE explicit table draft edit', 'Dismissed discard preserves dirty editor');
  await close(); await floor.getByRole('button', { name: 'Select table: FIXTURE table 2', exact: true }).click();
  assert.equal(await inspector.getByLabel('Headline', { exact: true }).inputValue(), 'FIXTURE explicit table draft edit', 'Entity selection does not discard or auto-select a campaign');
  await close(); await selectDevice();
  await waitCommand(editor.getByRole('button', { name: 'Save draft · no publication', exact: true }), `/promotions/${derived.id}`, 'PATCH');
  await waitCommand(editor.getByRole('button', { name: 'Refresh preview, price & stock', exact: true }), `/promotions/${derived.id}/preview`);
  assert.equal(await editor.getByRole('button', { name: 'Approve draft · do not send', exact: true }).isEnabled(), false);
  await editor.locator('.promotion-approval input').check();
  await waitCommand(editor.getByRole('button', { name: 'Approve draft · do not send', exact: true }), `/promotions/${derived.id}/approve`);
  const publication = inspector.getByRole('region', { name: 'Select screen and confirm', exact: true });
  assert.equal(await publication.locator('li').count(), 1, 'Table publication preserves the selected original device only, not other table or global devices');
  const send = publication.getByRole('button', { name: 'Confirm & send to this table only', exact: true });
  assert.equal(await send.isEnabled(), false); await publication.getByRole('checkbox').check();
  promotionDevices = promotionDevices.map((d, index) => index === 0 ? { ...d, screenGeneration: '6' } : d);
  await waitCommand(workspace.getByRole('button', { name: 'Refresh promotions', exact: true }), '/promotions', 'GET');
  assert.equal(await send.isEnabled(), false, 'Changed device fences invalidate publication confirmation');
  await publication.getByRole('checkbox').uncheck(); await publication.getByRole('checkbox').check(); await waitCommand(send, `/promotions/${derived.id}/publish`);
  assert.deepEqual(mutations().find(c => c.path.endsWith('/publish')).body.targets.map(t => t.deviceId), [id(10)]);
  assert.equal(derived.playlistTargets[0].campaignVersion, derived.approvedVersion); assert.equal(derived.version, derived.approvedVersion + 1);
  assert.equal(await inspector.locator('[data-current-target]').count(), 1, 'A publish receipt never manufactures another current playlist item');
  assert.equal(mutations().some(c => c.method === 'PATCH' && c.path === `/promotions/${sourceId}`), false, 'Source campaign remains immutable');
  await inspector.getByRole('button', { name: 'Refresh device playlist', exact: true }).click(); await ready();
  const tableDerivedCard = inspector.locator(`[data-inspection-campaign="${derived.id}"]`);
  await tableDerivedCard.getByRole('button', { name: 'Edit as new draft', exact: true }).click();
  assert.equal(await scopeRegion.getByRole('radio', { name: 'All campaign devices', exact: true }).isEnabled(), false, 'Already-table-local sources cannot widen their scope');
  assert.equal(await scopeRegion.locator('input:checked').count(), 0);
  await scopeRegion.getByRole('button', { name: 'Cancel scope selection', exact: true }).click();
  await card.getByRole('button', { name: 'AI regenerate', exact: true }).click();
  await scopeRegion.getByRole('radio', { name: 'All campaign devices', exact: true }).check(); await scopeRegion.getByRole('checkbox').check();
  const publishBeforeAI = mutations().filter(c => c.path.endsWith('/publish')).length;
  await waitCommand(scopeRegion.getByRole('button', { name: 'Start AI draft job · do not send', exact: true }), `/promotions/${sourceId}/derive`);
  await inspector.getByRole('region', { name: 'Requested draft job', exact: true }).getByRole('button', { name: 'Open draft', exact: true }).waitFor();
  assert.equal(mutations().filter(c => c.path.endsWith('/publish')).length, publishBeforeAI, 'Durable AI jobs never autopublish');
  const regenerated = [...campaigns.values()].find(c => c.scope.origin === 'ai_regenerated'); assert.ok(regenerated); assert.equal(regenerated.scope.placement.kind, 'campaign_devices');
  await inspector.getByRole('region', { name: 'Requested draft job', exact: true }).getByRole('button', { name: 'Open draft', exact: true }).click();
  projectionDown = true;
  await page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/api/promotions/devices/') && r.status() === 503);
  await inspector.getByText(/Status not current. Retained data/).waitFor();
  assert.equal(await card.getByRole('button', { name: 'Edit as new draft', exact: true }).isEnabled(), false, 'Unavailable projection blocks new derivation');
  assert.equal(await inspector.locator('[data-current-target]').count(), 1, 'Polling failure retains clearly labelled last-known canonical records');
  assert.equal(await editor.getByLabel('Headline', { exact: true }).isEnabled(), false, 'Stale canonical inspection also blocks draft mutation controls');
  projectionDown = false; await inspector.getByRole('button', { name: 'Refresh device playlist', exact: true }).click(); await ready();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.promotion-floor-inspector')?.matches(':modal'));
  await page.waitForFunction(() => { const input = document.querySelector('[aria-label="Preview and edit promotion"] input'); return input instanceof HTMLInputElement && !input.matches(':disabled'); });
  await editor.getByLabel('Headline', { exact: true }).focus();
  for (let index = 0; index < 45; index += 1) {
    await page.keyboard.press('Tab');
    assert.equal(await inspector.evaluate(node => node.contains(document.activeElement)), true, 'Native sheet traps focus including editor fields: ' + JSON.stringify(await page.evaluate(() => ({active:{tag:document.activeElement?.tagName,id:document.activeElement?.id,class:document.activeElement?.className}, modal:document.querySelector('.promotion-floor-inspector')?.matches(':modal'), focusable:[...document.querySelectorAll('.promotion-floor-inspector button, .promotion-floor-inspector input, .promotion-floor-inspector select, .promotion-floor-inspector textarea, .promotion-floor-inspector a[href], .promotion-floor-inspector [tabindex]')].filter(e=>e.tabIndex>=0&&!e.matches(':disabled')&&e.getClientRects().length>0).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,60),closedDetails:!!e.closest('details:not([open])')}))}))));
  }
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.promotion-floor-inspector')?.open);
  assert.equal(await floor.getByRole('button', { name: 'Select device: FIXTURE available', exact: true }).evaluate(node => document.activeElement === node), true);
  const screenshots = []; await mkdir(screenshotDirectory, { recursive: true });
  for (const viewport of [{ width: 1365, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const language of ['en', 'th']) {
      if (await inspector.getAttribute('open') !== null) {
        await inspector.locator('.promotion-inspector-heading button').click(); await page.waitForFunction(() => !document.querySelector('.promotion-floor-inspector')?.open);
      }
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== language) await page.getByRole('button', { name: language === 'th' ? 'Switch to Thai' : 'เปลี่ยนเป็นภาษาอังกฤษ', exact: true }).click();
      await floor.getByRole('button', { name: language === 'th' ? 'ผังร้าน' : 'Floor plan', exact: true }).click();
      const deviceButton = floor.getByRole('button', { name: language === 'th' ? 'เลือกเครื่อง: FIXTURE available' : 'Select device: FIXTURE available', exact: true });
      await deviceButton.click(); await inspector.locator('[data-current-target]').waitFor();
      await inspector.evaluate(node => { node.scrollTop = 0; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${language} ${viewport.width}px has no page overflow`);
      const undersized = await workspace.locator('.floor-view-toggle button,.floor-node,.floor-entity-list button,.promotion-inspector-heading button,.promotion-floor-inspector button,.promotion-floor-inspector select,.promotion-confirm,.promotion-derive label').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ text: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })).filter(rect => rect.width < 44 || rect.height < 44));
      assert.deepEqual(undersized, [], 'Inspection/list/confirmation hit areas meet 44px');
      const path = join(screenshotDirectory, `promotion-floor-${viewport.width}-${language}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    }
  }
  await inspector.locator('.promotion-inspector-heading button').click();
  await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ', exact: true }).click(); await page.setViewportSize({ width: 1365, height: 1000 });
  await floor.getByRole('button', { name: 'Select table: FIXTURE table 1', exact: true }).click();
  const clear = inspector.getByRole('region', { name: 'Clear table', exact: true });
  assert.equal(await workspace.locator('.table-clear-controls').count(), 1, 'Only one live canonical clear control/journal owner');
  await clear.getByRole('button', { name: 'Clear table', exact: true }).click(); assert.equal(mutations().filter(c => c.path.endsWith('/clear')).length, 0, 'First clear step only asks for confirmation');
  await clear.getByRole('button', { name: 'Confirm clear', exact: true }).click(); await clear.getByRole('button', { name: 'Check saved clear', exact: true }).waitFor();
  const savedClear = structuredClone(mutations().find(c => c.path.endsWith('/clear')));
  assert.equal(savedClear.path, `/tables/${tableId}/clear`);
  await page.reload(); await login(); await inspector.getByRole('button', { name: 'Check saved clear', exact: true }).waitFor();
  assert.equal(mutations().filter(c => c.path.endsWith('/clear')).length, 1, 'Recovered clear never auto-resends');
  await floor.getByRole('button', { name: 'Select table: FIXTURE table 2', exact: true }).click();
  assert.match(await clear.textContent(), /Saved target: FIXTURE table 1/, 'Recovery stays pinned despite selecting another table');
  await waitCommand(clear.getByRole('button', { name: 'Check saved clear', exact: true }), savedClear.path);
  assert.deepEqual(mutations().filter(c => c.path.endsWith('/clear'))[1], savedClear); assert.equal(tables[0].occupancy.generation, '8');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `bitpos-table-clear:${merchantId}:${userId}`), null);
  await workspace.locator('.promotion-library-item').filter({ has: page.getByText(derived.headline, { exact: true }) }).click();
  await publication.getByRole('checkbox').check();
  const beforeClearFences = structuredClone(fences(promotionDevices)), beforeClearVersion = derived.version;
  await clear.getByRole('button', { name: 'Clear table', exact: true }).click();
  await waitCommand(clear.getByRole('button', { name: 'Confirm clear', exact: true }), `/tables/${secondTableId}/clear`);
  await page.waitForFunction(() => { const checkbox = document.querySelector('.promotion-floor-inspector .promotion-confirm input'); return checkbox instanceof HTMLInputElement && !checkbox.checked; });
  assert.equal(await publication.getByRole('checkbox').isChecked(), false, 'Canonical clear invalidates publication confirmation even without a fence/version change');
  assert.deepEqual(fences(promotionDevices), beforeClearFences); assert.equal(derived.version, beforeClearVersion);
  assert.equal(tables[0].occupancy.generation, '8'); assert.equal(tables[1].occupancy.generation, '8');
  assert.equal(mutations().some(c => /^\/devices\//.test(c.path) || /\/products\/.*\/offer|\/orders$|\/quotes$|\/pay\//.test(c.path)), false, 'Floor actions never assign devices, change global product offers, create bills or pay');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), layoutKey), savedLayout);
  await close();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Device and table registry', exact: true });
  await settings.locator('.floor-node[aria-label="Move POSClock: FIXTURE available"]').waitFor();
  assert.equal(await settings.locator('.floor-node[aria-label="Move POSClock: FIXTURE available"]').evaluate(node => node.style.left), '43%', 'Settings reads the identical saved floor layout');
  assert.equal(await settings.locator('.floor-node[aria-label="Move table: FIXTURE table 1"]').evaluate(node => node.style.top), '36%');
  await page.unroute('**/api/**');
  return { origin: 'actual_hydrated_browser_http_fixture', realProvider: false, physicalAndroid: false, physicalACK: false, canonicalProjectionOnly: true, exactDeriveReplay: true, explicitDraftScopes: ['this_table', 'all_campaign_devices'], tablePublicationDeviceIds: [id(10)], exactClearReplay: true, sharedLayout: true, screenshots, viewports: [1365, 820, 390], languages: ['en', 'th'] };
}
