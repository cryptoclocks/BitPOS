// Actual components, isolated local HTTP fixtures. No DB/provider/publication/payment operations.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import esbuild from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';

const root = process.cwd(), port = Number(process.env.BITPOS_PRICING_UI_PORT ?? 4497);
assert.ok([4497, 4498].includes(port), 'Isolated loopback ports only');
const origin = `http://127.0.0.1:${port}`, task = join(root, '.omp/work/h2-merchant-pricing-20261026');
const run = join(task, 'evidence', `pricing-offer-ui-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
const scratch = await mkdtemp(join(tmpdir(), 'pricing-offer-'));
await mkdir(join(run, 'screens'), { recursive: true });
const sources = ['apps/web/src/components/PricingSettings.tsx', 'apps/web/src/components/ProductOfferEditor.tsx', 'apps/web/src/styles/merchant-pricing-offer.css', 'tools/runtime/h2-merchant-pricing-offer-ui-smoke.mjs'];
const receipt = { status: 'RUNNING', fixture: 'LOCAL HTTP COMPONENT FIXTURE', sources: {}, checks: [], screens: [], limits: ['Controlled component HTTP responses prove presentation, navigation, callbacks and request payloads only.', 'Not backend authorization, persisted publication, payment, stock, provider, full P06/P07 CRUD or shared POS-shell fidelity.'] };
for (const source of sources) receipt.sources[source] = createHash('sha256').update(await readFile(join(root, source))).digest('hex');
const product = { id: 'coffee-1', name: 'ลาเต้เย็น', nameEn: 'Iced oat latte', imageUrl: null, category: 'Coffee', description: '', unitPrice: null, basePrice: { currency: 'USD', decimals: 4, amountMinor: '125000' }, promotion: null, available: 4 };
const pricing = { revision: '7', configured: true, priceVersion: 'price-v7', catalogCurrency: 'USD', decimals: 4, provenance: { kind: 'owner_configured' }, prices: [{ productId: product.id, unitMinor: '125000' }], settlement: { network: 'localnet', mint: 'MINT_LOCAL_ONLY', tokenProgram: 'TOKEN_LOCAL_ONLY', genesisHash: 'GENESIS_LOCAL_ONLY', asset: 'USDG', decimals: 6, quotePolicy: 'USD_FIXED4_TO_USDG_1_TO_1' } };
const baseOffer = { productId: product.id, priceVersion: 'price-v7', asOf: '2030-01-01T00:00:00.000Z', offer: null, active: false, effective: { basePrice: product.basePrice, unitPrice: product.basePrice, promotion: null } };
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import PricingSettings from ${JSON.stringify(resolve(root, sources[0]))};import ProductOfferEditor from ${JSON.stringify(resolve(root, sources[1]))};
import ${JSON.stringify(resolve(root, 'apps/web/src/styles/app.css'))};import ${JSON.stringify(resolve(root, sources[2]))};
const q=new URLSearchParams(location.search),kind=q.get('kind'),lang=q.get('lang')==='th'?'th':'en';window.fixtureStats={saved:0,closed:0};
function App(){const [token,setToken]=useState('fixture-token'),[owner,setOwner]=useState('owner-1'),[visible,setVisible]=useState(true);window.fixtureControls={setToken,setOwner,hide:()=>setVisible(false)};return <main className="h2-pricing-fixture"><header>LOCAL HTTP FIXTURE · no publication/payment authority</header>{visible&&(kind==='pricing'?<PricingSettings session={{token,merchantId:'merchant-1',userId:owner,role:'owner'}} products={q.get('empty')?[]:[${JSON.stringify(product)}]} language={lang} saved={()=>window.fixtureStats.saved++}/>:<ProductOfferEditor product={${JSON.stringify(product)}} token={token} language={lang} onSaved={()=>window.fixtureStats.saved++} onClose={()=>window.fixtureStats.closed++}/>)}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
let fixture, server, browser;
const send = (res, status, body) => { if (!res.destroyed) res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
function reset(options = {}) { fixture = { getMode: 'ready', writeMode: 'ready', gets: 0, writes: [], holds: [], usdg: false, active: false, ...options }; fixture.written = new Promise(resolve => { fixture.onWrite = resolve; }); }
function release() { const holds = fixture.holds.splice(0); for (const fn of holds) fn(); }
function priceView() { return fixture.usdg ? { ...pricing, catalogCurrency: 'USDG', decimals: 6, prices: [{ productId: product.id, unitMinor: '1234567' }] } : pricing; }
function offerView() { return fixture.active ? { ...baseOffer, active: true, offer: { priceVersion: 'price-v7', revision: '3', enabled: true, basePriceMinor: '125000', currentPriceMinor: '112500', expiresAt: '2099-01-01T00:00:00.000Z', discount: { kind: 'percent', percent: 10 } } } : baseOffer; }
try {
 await writeFile(join(scratch, 'entry.tsx'), entry);
 await writeFile(join(scratch, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>.h2-pricing-fixture{padding:24px;background:#f8f5fc;min-height:100vh}.h2-pricing-fixture>header{max-width:1180px;margin:auto;padding:12px 20px;border-radius:14px;background:#fff;color:#64188a;font:600 12px Inter,sans-serif}@media(max-width:760px){.h2-pricing-fixture{padding:8px}}</style><div id="root"></div><script type="module" src="/bundle.js"></script>');
 await esbuild.build({ absWorkingDir: root, nodePaths: [join(root, 'node_modules/.pnpm/react@19.2.3/node_modules'), join(root, 'node_modules/.pnpm/react-dom@19.2.3_react@19.2.3/node_modules')], entryPoints: [join(scratch, 'entry.tsx')], bundle: true, format: 'esm', platform: 'browser', outfile: join(scratch, 'bundle.js'), jsx: 'automatic', loader: { '.svg': 'file' }, external: ['/fonts/*'], logLevel: 'silent' });
 reset();
 server = createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith('/api/')) {
   if (req.method === 'GET') {
    fixture.gets++;
    const value = path === '/api/settings/pricing' ? priceView() : offerView();
    const mode = fixture.getMode;
    if (mode === 'hold') return void fixture.holds.push(() => send(res, 200, value));
    if (mode === 'denied') return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Fixture denied', retryable: false } });
    if (mode === 'error') return send(res, 503, { error: { code: 'REQUEST_FAILED', message: 'Fixture unavailable', retryable: true } });
    return send(res, 200, value);
   }
   let body = ''; for await (const part of req) body += part;
   const command = JSON.parse(body); fixture.writes.push({ method: req.method, path, body: command }); fixture.onWrite();
   if (fixture.writeMode === 'conflict') return send(res, 409, { error: { code: 'GENERATION_CONFLICT', message: 'Fixture conflict', retryable: true } });
   const respond = () => {
    if (path.endsWith('/offer')) {
     const previous = offerView();
     return send(res, 200, { ...baseOffer, active: command.enabled, offer: { ...(previous.offer ?? {}), ...command, revision: '4', discount: command.discount ?? previous.offer?.discount, expiresAt: command.expiresAt ?? previous.offer?.expiresAt } });
    }
    if (fixture.writeMode === 'refresh-error') fixture.getMode = 'error';
    send(res, 200, priceView());
   };
   if (fixture.writeMode === 'hold') return void fixture.holds.push(respond);
   return respond();
  }
  const file = path === '/' ? join(scratch, 'index.html') : path.startsWith('/fonts/') ? join(root, 'apps/web/public', path) : join(scratch, path.slice(1));
  if (!file.startsWith(scratch + '/') && !file.startsWith(join(root, 'apps/web/public/fonts/'))) return res.writeHead(403).end();
  const type = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }[extname(file)] ?? 'text/html';
  createReadStream(file).once('open', () => res.writeHead(200, { 'content-type': type })).on('error', () => res.writeHead(404).end()).pipe(res);
 });
 await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', ok); });
 const { chromium } = await import(join(root, '.omp/work/h2-parallel-consent-20261025/browser-toolchain/node_modules/playwright/index.mjs'));
 browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 async function scenario(name, kind, options, check, capture = false) {
  reset(options); const width = options.width ?? 390, lang = options.lang ?? 'en';
  const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Asia/Bangkok' });
  const page = await context.newPage(); page.setDefaultTimeout(7000); const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
   await page.goto(`${origin}/?kind=${kind}&lang=${lang}${options.empty ? '&empty=1' : ''}`);
   const region = page.locator(kind === 'pricing' ? '.pricing-settings' : '.offer-editor');
   await region.waitFor(); await check(page, region);
   assert.deepEqual(errors, [], 'no uncaught browser errors');
   await page.evaluate(async () => { await document.fonts.load('14px Inter'); await document.fonts.load('14px "Noto Sans Thai"'); await document.fonts.ready; await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))); });
   let geometry;
   if (await region.count()) {
    geometry = await region.evaluate(node => { const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }; return { bounds: rect(node), primary: rect(node.querySelector('.pricing-card,.offer-card')), aside: rect(node.querySelector('.pricing-aside,.offer-aside')), overflow: node.scrollWidth > Math.ceil(node.getBoundingClientRect().width), actions: [...node.querySelectorAll('button')].map(rect), fonts: [...document.fonts].map(f => ({ family: f.family, status: f.status })) }; });
    assert.equal(geometry.overflow, false); assert.ok(geometry.actions.every(a => a.height >= 48));
    assert.ok(geometry.fonts.some(f => f.family === 'Inter' && f.status === 'loaded'));
    assert.ok(geometry.fonts.some(f => f.family === 'Noto Sans Thai' && f.status === 'loaded'));
    if (capture) { const path = join(run, 'screens', `${name}.png`); await page.screenshot({ path, fullPage: true }); receipt.screens.push(path); }
   }
   receipt.checks.push({ name, kind, width, lang, status: 'PASS', geometry, writes: fixture.writes });
  } catch (error) { receipt.checks.push({ name, status: 'FAIL', error: String(error) }); throw error; }
  finally { release(); await context.close(); }
 }
 const priceInput = region => region.locator('.pricing-grid input');
 const savePrice = region => region.getByRole('button', { name: /Save menu prices|บันทึกราคาเมนู/ });
 async function readyPrice(region) { await priceInput(region).waitFor(); }
 async function acknowledge(region) { await region.locator('.notice input[type=checkbox]').check(); }
 const saveOffer = region => region.getByRole('button', { name: /Save & enable offer|บันทึกและเปิดข้อเสนอ/ });
 async function readyOffer(page) { await page.getByLabel(/Discount amount|จำนวนส่วนลด/).waitFor(); }
 async function fillOffer(page, kind = 'amount', value = '1.2500', expiry = '2099-01-01T01:00') {
  await page.getByLabel(/Discount kind|ประเภทส่วนลด/).selectOption(kind);
  await page.getByLabel(kind === 'amount' ? /Discount amount|จำนวนส่วนลด/ : /Discount percent|ส่วนลดเปอร์เซ็นต์/).fill(value);
  await page.getByLabel(/Expires at|หมดอายุ/).fill(expiry);
 }
 for (const kind of ['pricing', 'offer']) for (const lang of ['en', 'th']) for (const width of [1440, 390]) {
  await scenario(`${kind}-${lang}-${width}`, kind, { lang, width }, async (page, region) => {
   if (kind === 'pricing') { await readyPrice(region); assert.equal(await savePrice(region).isDisabled(), true); assert.equal(await region.locator('.notice input').isChecked(), false); }
   else await readyOffer(page);
   const primary = await region.locator('.pricing-card,.offer-card').boundingBox(), aside = await region.locator('.pricing-aside,.offer-aside').boundingBox();
   assert.ok(width > 760 ? aside.x > primary.x + primary.width : aside.y > primary.y + primary.height - 1, 'desktop columns / compact stacking');
  }, true);
 }
 await scenario('pricing-empty', 'pricing', { empty: true }, async (page, region) => { await page.getByText('No menu items to price').waitFor(); assert.equal(await region.locator('form').count(), 0); assert.equal(fixture.writes.length, 0); });
 for (const kind of ['pricing', 'offer']) {
  await scenario(`${kind}-loading`, kind, { getMode: 'hold' }, async (page, region) => {
   await region.getByRole('status').filter({ hasText: /Loading/ }).waitFor(); assert.equal(fixture.writes.length, 0); fixture.getMode = 'ready'; release();
   if (kind === 'pricing') await readyPrice(region); else await readyOffer(page);
  });
  for (const getMode of ['denied', 'error']) await scenario(`${kind}-${getMode}-recovery`, kind, { getMode, lang: 'th' }, async (page, region) => {
   await region.getByRole('alert').waitFor(); assert.equal(await region.locator('form').count(), 0); assert.equal(fixture.writes.length, 0);
   fixture.getMode = 'ready'; await region.getByRole('button', { name: /โหลด|ลองโหลด/ }).click();
   if (kind === 'pricing') await readyPrice(region); else await readyOffer(page);
  }, getMode === 'denied');
 }
 await scenario('pricing-usd-four-decimals-and-payload', 'pricing', {}, async (page, region) => {
  await readyPrice(region); await acknowledge(region); await priceInput(region).fill('12.34567'); await savePrice(region).click();
  await region.getByRole('alert').waitFor(); assert.equal(fixture.writes.length, 0);
  await priceInput(region).fill('12.5000'); await savePrice(region).press('Enter');
  await page.waitForFunction(() => window.fixtureStats.saved === 1);
  assert.deepEqual(fixture.writes, [{ method: 'PUT', path: '/api/settings/pricing', body: { expectedRevision: '7', catalogCurrency: 'USD', catalogDecimals: 4, provenance: { kind: 'owner_configured' }, prices: [{ productId: 'coffee-1', unitMinor: '125000' }], settlement: { asset: 'USDG', network: 'localnet', mint: 'MINT_LOCAL_ONLY', tokenProgram: 'TOKEN_LOCAL_ONLY', decimals: 6, quotePolicy: 'USD_FIXED4_TO_USDG_1_TO_1' } } }]);
 });
 await scenario('pricing-usdg-six-decimals', 'pricing', { usdg: true }, async (page, region) => {
  await readyPrice(region); assert.equal(await priceInput(region).inputValue(), '1.234567'); await acknowledge(region); await savePrice(region).click();
  await page.waitForFunction(() => window.fixtureStats.saved === 1); const body = fixture.writes[0].body;
  assert.equal(body.prices[0].unitMinor, '1234567'); assert.equal(body.catalogDecimals, 6); assert.equal(body.settlement.quotePolicy, 'USDG_RAW_IDENTITY');
 });
 await scenario('pricing-single-inflight-write', 'pricing', { writeMode: 'hold' }, async (page, region) => {
  await readyPrice(region); await acknowledge(region); await region.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await page.waitForFunction(() => document.querySelector('.pricing-settings button:not(.secondary)').disabled);
  await fixture.written; assert.equal(fixture.writes.length, 1); fixture.writeMode = 'ready'; release(); await page.waitForFunction(() => window.fixtureStats.saved === 1);
 });
 await scenario('pricing-conflict-keeps-draft', 'pricing', { writeMode: 'conflict' }, async (page, region) => {
  await readyPrice(region); await priceInput(region).fill('9.9999'); await acknowledge(region); await savePrice(region).click();
  await region.getByRole('alert').waitFor(); assert.equal(await priceInput(region).inputValue(), '9.9999'); assert.equal(fixture.writes.length, 1);
 });
 await scenario('pricing-confirmed-save-refresh-failure', 'pricing', { writeMode: 'refresh-error' }, async (page, region) => {
  await readyPrice(region); await acknowledge(region); await savePrice(region).click(); await page.waitForFunction(() => window.fixtureStats.saved === 1);
  await region.getByRole('alert').waitFor(); assert.equal(await savePrice(region).isDisabled(), true); assert.equal(fixture.writes.length, 1);
  fixture.getMode = 'ready'; await region.getByRole('button', { name: /Reload saved prices/ }).click(); await readyPrice(region);
  assert.equal(await region.locator('.notice input').isChecked(), false);
 });
 await scenario('pricing-token-refresh-keeps-draft', 'pricing', {}, async (page, region) => {
  await readyPrice(region); await priceInput(region).fill('9.1234'); await page.evaluate(() => window.fixtureControls.setToken('fixture-token-2'));
  await page.waitForResponse(res => res.url().endsWith('/api/settings/pricing')); await page.waitForTimeout(30);
  assert.equal(await priceInput(region).inputValue(), '9.1234');
 });
 await scenario('pricing-token-rotation-during-publish-requires-read', 'pricing', { writeMode: 'hold' }, async (page, region) => {
  await readyPrice(region); await acknowledge(region); await savePrice(region).click(); await fixture.written;
  const gets = fixture.gets; await page.evaluate(() => window.fixtureControls.setToken('fixture-token-2')); await page.waitForTimeout(30);
  assert.equal(fixture.gets, gets, 'credential rotation must not race a new GET against the unresolved PUT');
  assert.equal(await savePrice(region).isDisabled(), true);
  await region.locator('form').evaluate(form => form.requestSubmit()); assert.equal(fixture.writes.length, 1);
  fixture.writeMode = 'ready'; release(); await region.getByRole('alert').waitFor();
  assert.equal(await savePrice(region).isDisabled(), true); assert.equal(await page.evaluate(() => window.fixtureStats.saved), 0);
  await region.getByRole('button', { name: 'Reload saved prices', exact: true }).click(); await readyPrice(region);
  assert.equal(await region.locator('.notice input').isChecked(), false); assert.equal(fixture.writes.length, 1);
 });
 await scenario('pricing-retired-load-cannot-replace-new-owner', 'pricing', { getMode: 'hold' }, async (page, region) => {
  await region.getByRole('status').filter({ hasText: /Loading/ }).waitFor();
  fixture.usdg = true; fixture.getMode = 'ready'; await page.evaluate(() => window.fixtureControls.setOwner('owner-2'));
  await readyPrice(region); assert.equal(await priceInput(region).inputValue(), '1.234567'); release(); await page.waitForTimeout(30);
  assert.equal(await priceInput(region).inputValue(), '1.234567'); assert.equal(fixture.writes.length, 0);
 });
 await scenario('offer-retired-load-cannot-replace-new-credential', 'offer', { getMode: 'hold', active: true }, async (page, region) => {
  await region.getByRole('status').filter({ hasText: /Loading/ }).waitFor();
  fixture.active = false; fixture.getMode = 'ready'; await page.evaluate(() => window.fixtureControls.setToken('fixture-token-2'));
  await readyOffer(page); release(); await page.waitForTimeout(30);
  assert.equal(await page.getByLabel('Discount amount').inputValue(), ''); assert.equal(fixture.writes.length, 0);
 });
 await scenario('offer-invalid-expiry-percent-and-payload', 'offer', {}, async (page, region) => {
  await readyOffer(page); await fillOffer(page, 'percent', '10', '2029-01-01T01:00'); await saveOffer(region).click();
  await region.getByRole('alert').waitFor(); assert.equal(fixture.writes.length, 0);
  await fillOffer(page, 'percent', '100'); assert.equal(await saveOffer(region).isDisabled(), true);
  await fillOffer(page, 'percent', '10'); await saveOffer(region).press('Enter'); await page.waitForFunction(() => window.fixtureStats.saved === 1);
  assert.deepEqual(fixture.writes, [{ method: 'PUT', path: '/api/products/coffee-1/offer', body: { priceVersion: 'price-v7', expectedRevision: '0', enabled: true, basePriceMinor: '125000', currentPriceMinor: '112500', expiresAt: '2098-12-31T18:00:00.000Z', discount: { kind: 'percent', percent: 10 } } }]);
  await page.getByLabel('Discount percent (%)').fill('20'); assert.equal(await region.getByRole('status').count(), 0, 'editing retires Saved feedback');
 });
 await scenario('offer-single-inflight-write', 'offer', { writeMode: 'hold' }, async (page, region) => {
  await readyOffer(page); await fillOffer(page); await region.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await page.waitForFunction(() => document.querySelector('.offer-editor button:not(.secondary)').disabled);
  await fixture.written; assert.equal(fixture.writes.length, 1); fixture.writeMode = 'ready'; release(); await page.waitForFunction(() => window.fixtureStats.saved === 1);
 });
 await scenario('offer-conflict-retains-draft-and-explicit-reload', 'offer', { writeMode: 'conflict' }, async (page, region) => {
  await readyOffer(page); await fillOffer(page); await saveOffer(region).click(); await region.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Discount amount').inputValue(), '1.2500'); assert.equal(fixture.writes.length, 1);
  await region.getByRole('button', { name: 'Reload offer', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.offer-editor input[inputmode="decimal"]').value === '');
 });
 await scenario('offer-disable-and-close-callbacks', 'offer', { active: true }, async (page, region) => {
  await region.getByRole('button', { name: 'Disable offer' }).click(); await page.waitForFunction(() => window.fixtureStats.saved === 1);
  assert.deepEqual(fixture.writes, [{ method: 'PATCH', path: '/api/products/coffee-1/offer', body: { priceVersion: 'price-v7', expectedRevision: '3', enabled: false } }]);
  await region.getByRole('button', { name: 'Close offer editor' }).click(); assert.equal(await page.evaluate(() => window.fixtureStats.closed), 1);
 });
 for (const kind of ['pricing', 'offer']) await scenario(`${kind}-retired-write-no-callback`, kind, { writeMode: 'hold' }, async (page, region) => {
  if (kind === 'pricing') { await readyPrice(region); await acknowledge(region); await savePrice(region).click(); }
  else { await readyOffer(page); await fillOffer(page); await saveOffer(region).click(); }
  await fixture.written; assert.equal(fixture.writes.length, 1); await page.evaluate(() => window.fixtureControls.hide()); release(); await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.fixtureStats.saved), 0);
 });
 receipt.status = 'PASS_LOCAL_COMPONENT_FIXTURES';
} catch (error) { receipt.status = 'FAIL'; receipt.error = String(error); process.exitCode = 1; }
finally { release(); if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); } await writeFile(join(run, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); await rm(scratch, { recursive: true, force: true }); console.log(JSON.stringify({ run, status: receipt.status, checks: receipt.checks.length })); }
