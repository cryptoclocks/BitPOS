import assert from 'node:assert/strict';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

// Labeled HTTP/wallet fixture against the real checkout DOM. No chain RPC,
// usable signer, real payment, physical Android, or sponsor funding proof.
// Caller supplies a fresh Playwright-compatible page and running web origin.
export default async function assetBrowserContracts(page, origin, onReceipt) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Fixture must stay local');
  const token = 'asset-browser-fixture', calls = [], committed = new Map();
  const requestedUrls = [];
  page.on('request', request => requestedUrls.push(request.url()));
  const money = { currency: 'USD', decimals: 2, amountMinor: '125' };
  const options = [
    ['usdg-devnet', 'USDG', 'USDG issuer devnet test', '1250000', '10000'],
    ['usdc-devnet', 'USDC', 'USDC issuer devnet test', '2500000', '20000'],
    ['usdt-test-devnet', 'USDT', 'USDT test (BitPOS-issued)', '3750000', '30000'],
  ].map(([assetId, symbol, displayLabel, amountMinor, numerator]) => {
    const asset = { assetId, symbol, displayLabel, cluster: 'devnet', genesisHash: 'FIXTURE-genesis', mint: `FIXTURE-${assetId}-mint`, tokenProgram: 'FIXTURE-program', decimals: 6, instructionPolicy: symbol === 'USDG' ? 'token2022_zero_fee' : 'spl_checked', issuerTestAsset: symbol !== 'USDT' };
    return { asset, settlement: { currency: symbol, decimals: 6, amountMinor, network: 'solana:devnet', genesisHash: asset.genesisHash, mint: asset.mint, tokenProgram: asset.tokenProgram, testToken: true, recipient: 'FIXTURE-recipient', sponsor: 'merchant_funded', assetId, displayLabel, denominationPolicy: { id: `FIXTURE-${symbol}-denomination`, numerator, denominator: '1' } } };
  });
  let selectedAssetId = options[0].asset.assetId, canChange = true, loseAsset = true, loseSubmit = true, mismatchMint = false;
  let order = { id: 'FIXTURE-asset-order', version: 4, status: 'AWAITING_PAYMENT', payer: null, authority: { kind: 'versioned', source: { kind: 'register', registerId: 'FIXTURE-register', label: 'FIXTURE register' }, serving: { kind: 'counter', label: 'FIXTURE counter' }, target: { deviceId: 'FIXTURE-device', assignmentGeneration: '1' }, pairingGeneration: '1' }, pricing: { kind: 'versioned', priceVersion: 'FIXTURE-price', total: money, lines: [{ productId: 'FIXTURE-coffee', name: 'กาแฟทดสอบ', nameEn: 'Espresso', qty: 1, priceVersion: 'FIXTURE-price', basePrice: money, unitPrice: money, promotion: null }] }, settlement: options[0].settlement, quoteExpiresAt: new Date(Date.now() + 600000).toISOString(), paymentUrl: `${origin}/pay/${token}` };
  const originalPricing = JSON.stringify(order.pricing);
  const address = SystemProgram.programId.toBase58();
  const transaction = new Transaction({ feePayer: new PublicKey(address), recentBlockhash: address }).add(SystemProgram.transfer({ fromPubkey: new PublicKey(address), toPubkey: new PublicKey(address), lamports: 0 }));
  const base64 = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = method === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, method, body });
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path.endsWith('/events')) return route.abort('failed');
    if (path === `/api/pay/${token}`) return reply({...order,customerContext:{merchantId:'00000000-0000-4000-8000-000000000001',menuUrl:`/pay/${token}/menu`}});
    if (path.endsWith('/assets')) return reply({ selectedAssetId, canChange, assets: mismatchMint ? options.map(option => ({ ...option, settlement: { ...option.settlement, mint: 'FIXTURE-wrong-mint-with-same-symbol' } })) : options });
    if (path.endsWith('/asset')) {
      if (committed.has(body.idempotencyKey)) return reply({ ...committed.get(body.idempotencyKey), replayed: true });
      assert.equal(canChange, true, 'No asset POST while outstanding attempt');
      assert.equal(body.expectedVersion, order.version, 'Fresh selection uses observed order version');
      const option = options.find(item => item.asset.assetId === body.assetId); assert.ok(option);
      selectedAssetId = body.assetId; order = { ...order, version: order.version + 1, settlement: option.settlement };
      const result = { order, replayed: false }; committed.set(body.idempotencyKey, result);
      if (loseAsset) { loseAsset = false; return route.abort('failed'); }
      return reply(result);
    }
    if (path.endsWith('/attempt')) { assert.equal(body.address, address); canChange = false; return reply({ id: 'FIXTURE-attempt', base64 }); }
    if (path.endsWith('/submit')) {
      assert.equal(body.attemptId, 'FIXTURE-attempt'); assert.equal(typeof body.base64, 'string');
      if (loseSubmit) { loseSubmit = false; return route.abort('failed'); }
      order = { ...order, version: order.version + 1, status: 'CONFIRMING', paymentSignature: 'FIXTURE-signature' };
      return reply({ signature: 'FIXTURE-signature', status: 'CONFIRMING' });
    }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/pay/${token}?fixture=asset-contract`);
  const select = page.getByLabel('Choose payment asset', { exact: false });
  const waitForAssetSelection = expected => page.waitForFunction(value => {
    const element = document.querySelector('#payment-asset');
    return element instanceof HTMLSelectElement && !element.disabled && element.options.length === 3 && element.value === value;
  }, expected);
  await waitForAssetSelection('usdg-devnet');
  assert.equal(await select.locator('option').count(), 3, 'Only server-authorized options');
  assert.match(await select.locator('option[value="usdt-test-devnet"]').textContent(), /BitPOS-issued.*USDT 3\.750000/);
  const browse = page.getByRole('link', { name: 'Pay with Phantom', exact: true });
  const browseUrl = new URL(await browse.getAttribute('href'));
  assert.equal(decodeURIComponent(browseUrl.pathname.slice('/ul/browse/'.length)), `${origin}/pay/${token}?fixture=asset-contract`, 'Android browse keeps exact order and query');
  assert.equal(browseUrl.searchParams.get('ref'), new URL(origin).origin);
  canChange = false; await page.reload();
  await page.waitForFunction(() => document.querySelector('#payment-asset')?.value === 'usdg-devnet');
  assert.equal(await select.isDisabled(), true, 'Server canChange=false independently locks asset selection');
  assert.equal(calls.filter(call => call.path.endsWith('/asset')).length, 0);
  canChange = true; mismatchMint = true; await page.reload();
  await page.waitForFunction(() => {
    const element = document.querySelector('#payment-asset');
    return element instanceof HTMLSelectElement && element.disabled && element.options.length === 1 && document.querySelector('.checkout-assets [role="alert"]') !== null;
  });
  assert.equal(await select.isDisabled(), true, 'Same symbol with a different mint is never authorized');
  assert.equal(await browse.getAttribute('aria-disabled'), 'true');
  mismatchMint = false; await page.reload();
  await waitForAssetSelection('usdg-devnet');
  await select.selectOption('usdc-devnet');
  await page.getByRole('button', { name: 'Retry saved asset selection', exact: true }).waitFor();
  const firstSelection = calls.filter(call => call.path.endsWith('/asset')).at(-1).body;
  assert.equal(firstSelection.expectedVersion, 4);
  assert.equal(await select.isDisabled(), true, 'Unknown quote outcome locks further selection');
  assert.equal(await browse.getAttribute('aria-disabled'), 'true', 'Unknown quote outcome locks payment');
  await page.reload();
  await page.getByRole('button', { name: 'Retry saved asset selection', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.checkout-total strong')?.textContent.includes('2.50 USDC'));
  await waitForAssetSelection('usdc-devnet');
  assert.deepEqual(calls.filter(call => call.path.endsWith('/asset')).at(-1).body, firstSelection, 'Retry after reload keeps exact key AND old expectedVersion');
  assert.equal(JSON.stringify(order.pricing), originalPricing, 'Payment selection never rewrites bill evidence');
  await select.selectOption('usdt-test-devnet');
  await page.waitForFunction(() => document.querySelector('.checkout-total strong')?.textContent.includes('3.75 USDT'));
  await waitForAssetSelection('usdt-test-devnet');
  assert.notEqual(calls.filter(call => call.path.endsWith('/asset')).at(-1).body.idempotencyKey, firstSelection.idempotencyKey, 'New intentional choice gets a new key');
  assert.match(await page.locator('.checkout-assets').textContent(), /30000\/1.*not market FX/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow checkout does not overflow');

  // Late-injected, visibly labeled Phantom provider: exercise direct legacy
  // signTransaction (not signAndSend); the unsigned bytes have no usable signer.
  await page.evaluate(address => {
    window.__fixtureCalls = { connect: 0, sign: 0 };
    window.phantom = { solana: { isPhantom: true, isBitPOSTestFixture: true,
      async connect() { window.__fixtureCalls.connect++; return { publicKey: { toString: () => address } }; },
      async signMessage() { throw new Error('Unexpected signMessage in checkout fixture'); },
      async signTransaction(transaction) { window.__fixtureCalls.sign++; await new Promise(resolve => { window.__releaseFixtureSign = resolve; }); return transaction; },
    } };
    window.dispatchEvent(new Event('focus'));
  }, address);
  await page.getByRole('button', { name: 'Pay 3.75 USDT', exact: true }).click();
  await page.waitForFunction(() => window.__fixtureCalls?.sign === 1 && typeof window.__releaseFixtureSign === 'function');
  assert.equal(await select.isDisabled(), true, 'Signing locks asset changes');
  await page.getByText('TEST WALLET FIXTURE — browser automation only, not a real mobile test', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__fixtureCalls), { connect: 1, sign: 1 }, 'Direct provider signs once, without broadcasting');
  await page.evaluate(() => window.__releaseFixtureSign());
  await page.getByRole('button', { name: 'Check payment', exact: true }).waitFor();
  assert.equal(await select.isDisabled(), true, 'Persisted signed payment locks selection after unknown submit');
  const signed = await page.evaluate(token => JSON.parse(localStorage.getItem('bitpos-signed-payment:' + token)), token);
  assert.equal(signed.attemptId, 'FIXTURE-attempt');
  await page.reload();
  await page.getByRole('button', { name: 'Check payment', exact: true }).click();
  await page.getByRole('region', { name: 'Payment progress', exact: true }).getByText('Confirming', { exact: true }).waitFor();
  assert.equal(await select.isDisabled(), true, 'Submitted/confirming payment keeps asset locked');
  const submissions = calls.filter(call => call.path.endsWith('/submit'));
  assert.deepEqual(submissions[1].body, submissions[0].body, 'Saved signature retry preserves exact bytes and attempt');
  assert.equal(calls.filter(call => call.path.endsWith('/attempt')).length, 1, 'Recovery never creates another attempt');
  assert.equal(calls.filter(call => call.path.endsWith('/asset')).length, 3, 'Pending payment never sends another asset quote');
  order = { ...order, version: order.version + 1, status: 'PAID' };
  await page.reload();
  await page.getByRole('heading', { name: 'Payment received', exact: true }).waitFor();
  assert.match(await page.locator('.checkout-total').textContent(), /Amount paid.*3\.75 USDT/);
  assert.equal(await page.locator('#payment-asset').count(), 0, 'Receipt cannot change asset');
  await page.locator('.checkout-details > summary').click();
  assert.match(await page.getByRole('region', { name: 'Settlement trust', exact: true }).textContent(), /USDT 3\.750000.*BitPOS-issued/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Receipt details do not overflow');
  if(onReceipt)await onReceipt(page);
  assert.equal(requestedUrls.some(url => new URL(url).origin !== new URL(origin).origin || /balance|rpc/.test(new URL(url).pathname)), false, 'No external chain RPC or invented browser balance helper');
  const { assetId, displayLabel, denominationPolicy, ...historicalUSDG } = options[0].settlement;
  order = { ...order, version: order.version + 1, settlement: historicalUSDG };
  await page.goto(`${origin}/terminal/${token}`);
  await page.getByRole('region', { name: 'Order bill', exact: true }).waitFor();
  assert.match(await page.locator('.settlement-total').textContent(), /USDG 1[.]250000/, 'Historical frozen USDG receipt remains USDG without asset metadata');
  return { origin: 'browser_http_wallet_fixture_contract', physicalAndroid: false, livePayment: false, authorizedOptions: 3, exactAssetReplayAfterReload: true, signingAndSavedPaymentLock: true, signOnlyPhantomProvider: true, actualReceiptCurrency: 'USDT', noBalanceRpc: true, narrowOverflow: false };
}
