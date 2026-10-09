# BitPOS Tablet and exact-order checkout

This source slice implements the responsive Tablet workspace against the coordinator's table-authority contract. It has **not** been built, tested, deployed or exercised by this isolated writer. Parent integration must supply the shared contracts and backend migration/API, then verify the actual application. Historical THB orders and the old paid30 evidence remain their original records, not evidence for this changed build.

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

- USD / 2 decimals: `USD_CENTS_TO_USDG_1_TO_1`; each USD cent becomes exactly 10,000 USDG raw units. This is a merchant denomination policy, not market FX or redemption.
- USDG / 6 decimals: `USDG_RAW_IDENTITY`; raw units settle unchanged.

Decimal strings never pass through Number/parseFloat. Excess fractional digits, exponent notation, negative/zero and unsupported settlement/storage overflow are refused. Demo configuration must be explicitly checked and labeled. Changing currency clears inputs instead of converting or guessing prices. Publish creates an immutable version; old history/orders stay frozen. Treasury remains a separate owner-only server setting; no customer wallet is used as merchant treasury.

### Existing bounded product offers

Owner/manager offer controls remain below menu cards, including sold-out items; staff have none. Offers GET/PUT/PATCH use `/products/:id/offer`, exact `priceVersion` and expected offer revision. Amount discounts are entered in the active catalog currency (USD2/USDG6); whole-percent reduction floors in integer minor units, leaving a positive price. The editor retains edits/revision on failure and offers **Reload latest (replace edits)**. It cannot reactivate an old offer on a numerically equal new price version.

Menu lease expiry hides promotion and effective estimate together, falls back to the same-currency base estimate and refreshes with one request in flight/coalesced retries. It never changes quantities, customer, pending key or committed order. Quote/order prices come from the backend canonical engine, not this display/preview arithmetic.

## Exact-order checkout and Phantom

Public checkout/terminal show the versioned Money/legacy pricing discriminant, every frozen unit/line total and canonical settlement. Approval/receipt trust includes test USDG, `solana:devnet`, mint, token program, genesis, recipient and merchant-funded sponsor. Network fees still exist. A wallet signature or submit callback never sets PAID; only authoritative server finalized polling does. CONFIRMING is explicitly not finalized.

Existing Wallet Standard devnet-capability discovery and injected `window.phantom.solana` / `window.solana.isPhantom` adapters preserve exact challenge bytes and legacy/versioned serialized transaction signing. `Open in Phantom / เปิดใน Phantom` uses the current exact order URL, including query parameters, in the official Phantom browse link. Refresh/rejection/backend errors remain visible. This is an order web checkout, **not a native Blink/Actions implementation**, and no AI changes were added.

The public Phantom PNG is copied unmodified from the read-only presentation asset into the owned web public folder. Source: [official Phantom brand introduction/press kit](https://phantom.com/learn/blog/introducing-phantom-s-new-brand-identity), downloaded 2026-10-08 from `https://cdn.sanity.io/files/3nm6d03a/production/5e73f0ad2d621b5ed6ca3c66aad2b70686f8a00e.zip`. Phantom trademark; no affiliation or endorsement. Presentation files were not edited.

### Explicit browser wallet fixture

Automation may install `window.__BITPOS_TEST_WALLET__` with `{isBitPOSTestFixture:true, connect, signMessage, signTransaction}` before page startup; no signer/key is bundled. Discovery requires localhost/127.0.0.1 **and** `?testWallet=1`. Connected fixture identity is visibly labeled `TEST WALLET FIXTURE — browser automation only, not a real mobile test`.

Selectors: `Connect TEST WALLET FIXTURE (not mobile)`, `Sign verification message / ยืนยัน wallet`, `Sign & submit payment / จ่าย test USDG`, `Open in Phantom / เปิดใน Phantom`. Binding requires a server-verified signed nonce challenge. Transaction submission persists/settles through the backend; no client RPC broadcast or client-paid callback. Physical Android Phantom scanning/payment remains explicitly user-deferred, not passed.

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

No builds/tests/browser/runtime verification or deployment/provisioning/transactions were run in this isolated assignment. Shared contracts/API/migration integration and final changed-source verification belong to the coordinator. Complete Thai translation of customer/registry/treasury/system copy remains a parity gap (menu/cart bilingual selection preserved). Full original 25-screen analytics/inventory/reports/shift/printing/void/refund, cash/PromptPay/Stripe, loyalty/NFT/AI/Actions, USDC/USDT/mainnet, Grab/hotspot/home notifications and OTA rollout remain roadmap; no unsupported live feature is promised here.
