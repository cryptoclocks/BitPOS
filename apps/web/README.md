# BitPOS Tablet and exact-order checkout

This source slice implements the responsive Tablet workspace against the coordinator's table-authority contract. It has **not** been built, tested, deployed or exercised by this isolated writer. Parent integration must supply the shared contracts and backend migration/API, then verify the actual application. Historical THB orders and the old paid30 evidence remain their original records, not evidence for this changed build.

## Post-submission C: merchant-approved Promotions

The Promotions workspace is an independent Menu/Cart/Incoming/Settings sibling, preserving the existing cart, customer card, 50-line / 100-per-item limits, bilingual menus, frozen bills and Android Phantom checkout. It implements the coordinator's promotion contracts; none of these changes authorize mainnet or autonomous publishing.

- **Generate:** choose Daily, Customer or From order, allowed in-stock catalog products, an intent, exact minimum unit price, discount cap and time window. Daily supplies shop timezone and 4–8-week aggregate context. Customer requires an explicitly selected shop profile, open table and actual recipient; From order requires the original verified PAID order and excludes its existing products. Neither mode auto-selects a recipient or treats staff recognition as wallet proof. Confirm the relationship separately; changed occupancy/recipient data invalidates confirmation. Durable jobs are polled by server job ID. Fixture provenance is labeled; absent provider configuration disables generation in both languages.
- **Preview & edit:** the 480×320 preview uses the actual product photograph and server-calculated Money. Editing, refreshing the price/stock preview, explicitly reviewing it and approving are separate versioned commands. Changed prices/stock require a fresh preview and renewed review. None of these actions publishes, activates discounts or creates an order/payment. Audience-less historical campaigns remain read-only.
- **Publication:** Daily requires explicit confirmation of **all** listed devices, including busy/offline/unsupported screens, and freezes every assignment/auth/screen fence. A changed list or fence invalidates that confirmation. Customer/From order publish only to the recipient's originally bound device and table visit; no screen selector or implicit replacement is available. The command is `confirmTargets: true` plus `targets[]`, not the obsolete single-target API. Staff can view drafts and explicitly publish approved campaigns, but cannot generate/edit/preview/approve/revoke.
- **Lifecycle:** `playlistTargets` supplies independent QUEUED, DEFERRED_BUSY, DEFERRED_OFFLINE, UNSUPPORTED, DELIVERED, RENDERED, TARGET_CHANGED, EXPIRED and REVOKED results. Delivered is not rendered; one device ACK cannot mark the others rendered. Payment/pickup retain priority. Revocation addresses only the campaign and its original targets, without retargeting or changing frozen bills/catalog prices.
- **Unknown outcomes:** IndexedDB commits the merchant/user command before transmission. Lost responses preserve its exact method/path/payload/version/idempotency key across reload, even when current device fences have changed. Only explicit exact retry resolves it; polling/reload must not automatically resend or reconstruct a target batch.

`apps/web/tests/promotions-browser.mjs` retains its default async `(page, origin)` export and returns labeled fixture checks plus request/replay evidence. It exercises the real hydrated workspace with controlled scoped daily/customer/from-order HTTP fixtures, changed-price review, explicit ALL/original-device confirmation, frozen fences/list changes, lost-response reload replay, partial per-device statuses, one-ACK-not-all, recipient/role controls, provider configuration and 390px layout. It does **not** prove backend eligibility, actual AI, chain settlement, firmware rendering, physical ACK or Android hardware. Obsolete opaque-offer guest fixtures are removed; current public/private eligibility remains the responsibility of the existing actual HTTP guards.

### Floor-plan promotion editing

Promotions defaults to the same merchant-local `bitpos-floor-v1` layout used by Settings. Inspection is a separate typed mode: table/device selection, keyboard navigation and the accessible list never assign devices or save new positions. Desktop uses a side inspector; mobile uses a modal bottom sheet with contained keyboard focus, Escape and focus return. All action targets are at least 44px.

The selected-device projection comes from `GET /promotions/devices/:deviceId`, including canonical eligible playlist, approved content revision, per-device delivery state and provider provenance. Eligible/queued/delivered is not rendered; shared campaign previews are not composed device screenshots.

Editing a published campaign creates a new source-versioned draft. Explicitly choose all original campaign devices or the selected table's original device before manual derivation or AI regeneration. Manual drafts inherit actual source provenance without creating an artificial AI job. Regeneration creates a new bounded provider job, never approves or sends. Personal campaigns retain the original recipient/device binding. Table-local daily price authority is server/SQL-scoped and excluded from public counter/other-table prices. Draft creation, preview and approval leave existing publication unchanged; explicit send replaces only the confirmed original target set. Canonical table clear retains its durable exact-key recovery.

`apps/web/tests/promotion-floor-browser.mjs` exports `(page, origin, screenshotDirectory)`. Coordinator QA exercised the actual hydrated HTTP-fixture UI in EN/TH at 1365/820/390px, including scope replay, stale guards, modal focus, canonical clear and Settings layout reuse. Backend disposable-tenant HTTP/SQL guards separately exercise scoped financial authority. Actual Gemini regeneration attempted once returned `PROVIDER_REJECTED`; no generated draft or retry is claimed. Physical Mini/Android and deployment are not established by these browser fixtures.

Coordinator rerun, after integration and serving the current web on a loopback origin (from the repository root; this creates its own headless browser and closes only that browser):

```sh
BITPOS_BROWSER_ORIGIN=http://127.0.0.1:4327 node --input-type=module -e '
import { chromium } from "./local/toolchains/browser-contract/node_modules/playwright/index.mjs";
import run from "./apps/web/tests/promotions-browser.mjs";
const browser = await chromium.launch({ executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", headless: true });
try { const page = await browser.newPage(); console.log(JSON.stringify(await run(page, process.env.BITPOS_BROWSER_ORIGIN), null, 2)); }
finally { await browser.close(); }
'
```

The existing receipt/screenshot runner is also callable as `node .omp/work/post-submit-20261012/promotions-browser-smoke.mjs`; it imports this same export, pins origin `http://127.0.0.1:4333`, and writes its existing evidence paths. Its historical `promotions-browser-scoped-mobile.png` filename now captures the final Thai merchant workspace, not obsolete guest-scope evidence. Use a freshly served current build, not an old listener, for either invocation. Commands are instructions for the coordinator, **not checks exercised by this writer**; no tests/builds/browser/lint/formatters/provider calls/migrations/transactions/deployment were run for this cutover.

## Merchant workspace

Sign in uses the current same-merchant bearer session, held only in memory. `/session` supplies authenticated `userId`, `merchantId` and role. The stable register chooser is populated from authenticated `/registers`, not a client tenant claim. Only its selected ID is remembered in localStorage, keyed by merchant/user; the server reauthorizes every request.

Landscape shows the licensed-photo/text menu beside a persistent cart, canonical review and customer card. Portrait/narrow widths use Menu/Cart tabs with a fixed cart affordance. Incoming and Setup are independent views: selecting another order fetches its detail only; it does not change the draft, pair target or display. Controls have a minimum 44px target and keyboard focus. Menu/category/search and English/Thai primary names are retained. Existing local menu JPEGs are untouched; absent imagery remains a text card.

### Counter order lifecycle

1. Select an authorized register and explicit Counter, Takeaway or active serving table. Paired target readiness is shown separately. Unpaired/offline/busy/stale registry or unconfigured prices block fresh submit; no broadcast, queue or fallback device.
2. Add/edit up to 50 distinct lines, quantity 1–100. Removing a line uses zero locally and omits it from the request. Each edit commits the durable draft before publishing the new UI state. Estimate is never payment authority.
3. **Review canonical order** POSTs only IDs/quantities, optional customer ID and serving selection to `/registers/:id/quotes`. The review shows every frozen unit/line total, canonical Money total, settlement trust, price version, expiry and source/serving/display target. No stock reservation is claimed at review.
4. **Confirm & submit reviewed order** explicitly commits the exact request, quote and one key to IndexedDB *before* POST `/registers/:id/orders`. Editing invalidates the review. Expiry/price version/pairing/assignment/menu validity gates confirmation; server validation remains authoritative. There is no silent reprice-and-submit.
5. Definite busy/offline/price/stock/quote/routing refusal retains quantities, customer ID and serving choice but requires fresh Review and explicit Confirm. Network timeout, service/proxy failure and lost reply are unknown outcomes, not proof of refusal: controls stay locked to the persisted exact request/key. **Resolve / retry exact submission** resends that same request; it never generates a replacement key.
6. Reload signs out. After the same authenticated merchant/user/register returns, the journal restores the draft. A pending key is first resolved by GET `/registers/:id/submissions/:key`; a committed result restores that exact order. A missing result remains unresolved until explicit exact retry. A previously reviewed draft cannot inherit confirmation across reload.

IndexedDB records are keyed by merchant/user/register, contain no bearer token, wallet signing key or contact text, and use transactional revision compare-and-swap to reject a stale tab overwriting another tab's pending submission. Invalid/unavailable storage fails closed; nothing is submitted until durable save succeeds. Customer IDs and quote/routing snapshots are private browser data, not public screen data. Browser storage is not server authority. The journal has no offline ordering queue or automatic resubmit loop.

Committed orders use frozen names, currencies, units, totals, recipient, source/serving/target and generations. Order polling ignores regressing versions. The exact order QR/payment link remains independent of current pairing. **Done · dismiss original display receipt** calls the source-specific register order dismissal endpoint with the original target's current screen generation and exact order version. It releases only after backend real paid render ACK or safely reconciled expiry; refusal retains the receipt. `New cart (does not cancel this order)` clears only this browser workspace; it does not cancel/reserve/release the old device order, and the next submit remains blocked while the target is busy.

### Incoming and customers

Incoming list/detail show immutable serving label, register/device/legacy source, original display target, status, created time when supplied, and currency-tagged total. No detail viewing invokes a display command. Owner/manager recovery acknowledgment calls the audited server route; the copy explicitly distinguishes acknowledgment from paid/refunded and the server must reconcile ambiguous attempts first.

Guest is the default and requires no contact. Optional contact create/edit, server-wallet deterministic avatar and merchant customer history remain available. Editing contact neither binds a wallet nor proves payment. The existing order customer selector is frozen while contact edits/history remain available. History expands every frozen line, unit and line total, including explicit `Historical THB` records, never THB relabeled as USD.

## Setup and registry

All roles can view friendly device/table/register state and target readiness. Owner/manager can create tables, devices and stable registers; rename/retire tables; assign device tables; Pair/Unpair/Replace. Mutation requests echo the displayed exact decimal-string assignment or pairing generation. Conflict errors keep the unsaved choice, offer explicit reload and never silently retry with a new generation. Unique register/device pairing and tenant authorization are backend rules, not implied by hiding controls. Re-pair copy explicitly says only new orders move; old bills remain on the captured target.

Owner-only credential issue/rotate returns a one-time private value in a password field with private copy/clear controls. It is not logged, stored in the journal, returned by lists or included in public order views. Revoke credential/device controls call owner-only API paths. Physical credential provisioning is coordinator-owned and is not performed by this web UI.

Owner-only pricing setup loads `/settings/pricing`, including the runtime-pinned devnet mint/program/genesis. Empty setup lists products with blank inputs; no presentation/THB/FX/default prices are invented. A complete publish requires positive exact integer prices, expected pricing revision and explicit policy acceptance:

- USD / 4 decimals for new configured prices: `USD_FIXED4_TO_USDG_1_TO_1`; each 0.0001 USD becomes exactly 100 six-decimal token units. USD 0.10 less 15% is USD 0.085, settling 85,000 raw units. Display trims trailing zeros, retaining at least two decimal places. Historical USD / 2-decimal versions keep `USD_CENTS_TO_USDG_1_TO_1` and their original amounts. Merchant asset policies remain cent-based configuration; each new quote freezes its exact scale-aware ratio. This is a denomination policy, not market FX or redemption.
- USDG / 6 decimals: `USDG_RAW_IDENTITY`; raw units settle unchanged.

Decimal strings never pass through Number/parseFloat. Excess fractional digits, exponent notation, negative/zero and unsupported settlement/storage overflow are refused. Demo configuration must be explicitly checked and labeled. Changing currency clears inputs instead of converting or guessing prices. Publish creates an immutable version; old history/orders stay frozen. Treasury remains a separate owner-only server setting; no customer wallet is used as merchant treasury.

### Existing bounded product offers

Owner/manager offer controls remain below menu cards, including sold-out items; staff have none. Offers GET/PUT/PATCH use `/products/:id/offer`, exact `priceVersion` and expected offer revision. Amount discounts are entered in the active catalog currency (USD4, historical USD2, or USDG6); whole-percent reduction floors in integer minor units, leaving a positive price. The editor retains edits/revision on failure and offers **Reload latest (replace edits)**. It cannot reactivate an old offer on a numerically equal new price version.

Menu lease expiry hides promotion and effective estimate together, falls back to the same-currency base estimate and refreshes with one request in flight/coalesced retries. It never changes quantities, customer, pending key or committed order. Quote/order prices come from the backend canonical engine, not this display/preview arithmetic.

## Exact-order checkout and Phantom

Public checkout/terminal show the versioned Money/legacy pricing discriminant, every frozen unit/line total and canonical settlement. Receipt payment amount and currency come from the actual server settlement; original bill/line currencies remain unchanged. Approval/receipt trust includes the frozen asset display label, `solana:devnet`, asset ID (when present), exact mint, token program, genesis, denomination policy, recipient and merchant-funded sponsor. All assets are test tokens, not redeemable money. Historical USDG settlements without new metadata remain readable as USDG. Network fees still exist. A wallet signature or submit callback never sets PAID; only authoritative server finalized polling does. CONFIRMING is explicitly not finalized.

Existing Wallet Standard devnet-capability discovery and injected `window.phantom.solana` / `window.solana.isPhantom` adapters preserve exact challenge bytes and legacy/versioned serialized transaction signing. `Open in Phantom / เปิดใน Phantom` uses the current exact order URL, including query parameters, in the official Phantom browse link. Refresh/rejection/backend errors remain visible. This is an order web checkout, **not a native Blink/Actions implementation**, and no AI changes were added.

### Server-authorized payment assets

Checkout reads `GET /api/pay/:token/assets` and renders only its authorized options and exact server-calculated amounts. The browser checks descriptor/settlement identity (asset ID, currency, mint, program, genesis, decimals and label), not a symbol-only mint claim. Test USDT is visibly `USDT test (BitPOS-issued)`, never described as Tether-issued. Rational denomination is displayed as exact bill-minor-unit to token-raw-unit arithmetic, not market FX. The catalog and owner pricing setup remain USD/USDG; this adds settlement choice, not new catalog currencies, swaps or bridges.

Choosing an asset persists `{assetId, expectedVersion, idempotencyKey}` before `POST /api/pay/:token/asset`. A lost reply, timeout or 5xx keeps that exact request across reload; **Retry saved asset selection** resends the same key and old expectedVersion even if polling already observed a newer order version. No replacement quote/payment can start until the selection is resolved. A definite 4xx refusal clears the request (except an idempotency conflict, which requires recovery); storage corruption/unavailability fails closed. Selection never rewrites the original bill. Replayed OrderView results cannot regress a newer observed order version.

Asset switching is disabled during wallet preparation/signing/submission, submitted/confirming state, any locally persisted signed payment, unknown selection outcome, or server `canChange=false`. Server enforcement remains authoritative across tabs and other clients. Existing direct Phantom and Wallet Standard flows remain sign-only: token-account/balance checks and fee sponsorship are server-owned. No local balance helper, browser RPC send or SOL top-up requirement is introduced. Physical Android Phantom remains deferred.

`apps/web/tests/assets-browser.mjs` follows the existing page/origin harness convention. It is a labeled HTTP and unsigned-wallet fixture covering three server amounts, distinct BitPOS test label, mismatched descriptor mint rejection, independent server change lock, unknown response plus reload exact key/version replay, direct late-injected Phantom sign-only flow, pending signature lock/retry, actual receipt currency, historical USDG and 390px overflow. The coordinator's initial actual Brave run failed with `0 !== 3` because readiness accepted a missing selector before hydration. Readiness now requires the real enabled selector, all three authorized options and the expected selected asset; signing waits for the provider's pending sign operation rather than button wording. The coordinator's repaired actual Brave fixture smoke passed the reported three-asset, exact unknown-response/reload replay, signing/saved-payment lock, sign-only provider, USDT receipt, historical USDG and narrow-layout guards with no horizontal overflow. The initial failed run remains a failure; no third-run result or USDT screenshot inspection is inferred. This is browser fixture evidence only, not a real payment, funded token, chain verifier, sponsor, Android phone or physical display proof.


The public Phantom PNG is copied unmodified from the read-only presentation asset into the owned web public folder. Source: [official Phantom brand introduction/press kit](https://phantom.com/learn/blog/introducing-phantom-s-new-brand-identity), downloaded 2026-10-08 from `https://cdn.sanity.io/files/3nm6d03a/production/5e73f0ad2d621b5ed6ca3c66aad2b70686f8a00e.zip`. Phantom trademark; no affiliation or endorsement. Presentation files were not edited.

### Explicit browser wallet fixture

Automation may install `window.__BITPOS_TEST_WALLET__` with `{isBitPOSTestFixture:true, connect, signMessage, signTransaction}` before page startup; no signer/key is bundled. Discovery requires localhost/127.0.0.1 **and** `?testWallet=1`. Connected fixture identity is visibly labeled `TEST WALLET FIXTURE — browser automation only, not a real mobile test`.

Current checkout selectors include `Choose payment asset`, `Retry saved asset selection`, `Pay <server amount> <currency>`, `Check payment`, and `Pay with Phantom`. Binding requires a server-verified signed nonce challenge. Transaction submission persists/settles through the backend; no client RPC broadcast or client-paid callback. Physical Android Phantom scanning/payment remains explicitly user-deferred, not passed.

## Runtime and parent validation

Astro standalone Node adapter is coordinator-owned. Built proxy allowlists exact methods/paths for registry/pricing/quote/order/submission/dismissal, customers/offers and payment, forwards only authorization/content-type, retains query parameters and sends no cookies/env/arbitrary target. Old operational POST `/orders` is removed; historical GET remains. Deploy only adapter output and public client assets, never the repo/private data. Public routes remain `/`, `/pay/:accessToken`, `/terminal/:accessToken`; browser terminal is not physical ACK evidence.

After sequential integration, parent should run:

```sh
pnpm exec tsx --test --test-concurrency=1 tests/web-counter.test.ts tests/web-menu.test.ts tests/web-wallet.test.ts
pnpm typecheck
pnpm build
```

Authored (not executed) tests cover exact price parsing, 50/100 bounds, stale/expired review, guest request omission, scoped durable unknown-outcome restoration/corruption refusal, definite refusal draft retention, Money/history/trust rendering, structured-vs-ambiguous HTTP errors, offer revision/currency/lease/coalescing, and preserved wallet challenge/provider/fixture/avatar behavior.

`apps/web/tests/tablet-browser.mjs` and `setup-browser.mjs` export rerunnable functions taking a fresh Playwright-compatible page and running web origin. They intercept HTTP with labeled fixtures to exercise real DOM and IndexedDB: independent incoming view, customer wallet/history, busy/stale review refusal, lost committed response+reload key lookup without replacement submit, role surfaces, no setup bill creation, owner exact USDG input/policy publish, generation-safe replacement/assignment/unpair and one-time credential clearing. They are **not** payment authority, DB uniqueness/RBAC, provisioning, real mobile or hardware proof.

Parent must also exercise actual API authorization and tenant errors, generation conflicts, prices/offer expiry during review/submit, storage failure and concurrent tabs, offline targets, native QR/payment/provider behavior, real sponsor/verifier and actual physical paid render ACK. Use the actual configured catalog in live scripts, not test fixture prices. Existing runtime browser helpers outside this worker's ownership need the coordinated register → Review → Confirm and Money caller cutover.

## Honest remaining product boundaries

The isolated writer ran no builds/tests/browser checks or deployment/provisioning/transactions. The coordinator subsequently reported a passing repaired actual Brave browser fixture smoke; this does not establish actual chain settlement or physical-wallet behavior. Shared contracts/API/migration integration and final changed-source verification belong to the coordinator. Complete Thai translation of customer/registry/treasury/system copy remains a parity gap (menu/cart bilingual selection preserved). Full original 25-screen analytics/inventory/reports/shift/printing/void/refund, cash/PromptPay/Stripe, loyalty/NFT/AI/Actions, mainnet, Grab/hotspot/home notifications and OTA rollout remain roadmap. Slice B web asset selection was prepared in an isolated checkout and integrated into shared web source only after coordinator authorization; deployment, funded USDC/USDT and physical wallet proof are not claimed here.
