<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# Phase 0 — test baseline after importing h2 (31 Oct 2026)

Code: import of `codex/bitpos-h2-local-scope-20261027` at `bb176462` (no PayPal code yet). DB: disposable PostgreSQL 17 at 127.0.0.1:55466 (`tools/paypal/fixture-db.py up`, all 174 migrations, 029 history assertion skipped for the empty DB). No real database, keys or wallets.

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `pnpm test` (unit; integration gated off) | 693 | 484 | 0 | 209 |
| `BITPOS_BACKEND_INTEGRATION=1` | 693 | 664 | 27 | 2 |

`pnpm typecheck`: 7 errors, all in imported files (`apps/api/src/catalog-edit.ts` ×3 `image_url`, `tests/backend-product-images.test.ts` ×1, `tools/runtime/merchant-rider-summary-http.ts` ×2 and `preparation137-smoke.ts` ×1 need a local playwright toolchain).

These 27 integration failures exist before any PayPal change (fresh fixture: missing worker roles/data that the shared DB has). They are **not fixed here**; they are the regression baseline — after PayPal changes the same run must show no new failures.

```
coupon quote is admitted to checkout with the discounted canonical total, pays only that amount and is consumed once
checkout refuses stale, released, other-account, platform-funded and non-coupon-bound coupon quotes with no order or redemption
unpaid coupon order closure releases the hold and quota; a closed order stays released and cannot be re-bound
refund obligation for a coupon order equals the discounted amount actually paid; refund does not restore coupon quota
zero-payable coupon orders stay refused (no payment-free completion path exists)
published daily catalog reaches production Mini consumer on reconnect and CART; expiry restores base without personal/global relabeling
internal heartbeat and screen data cannot be called by anonymous clients
inventory: ledgered receive/adjust with optimistic stock, idempotency, reserved-stock floor, tenant and role fences
coupon route: server-computed discounted quote, idempotent replay, typed refusals, and the discounted quote becomes the order
coupon route refusals: platform-funded and zero-payable return configuration errors and leave no hold
schedule routes: only bookable published slots are listed; holds are server-bound, idempotent and capacity-safe; a coupon quote can also be scheduled
an inconsistent reservation counter is clamped, audited, and no longer blocks expiry
actual licensed photo preview exists before publish, exact bounded RGB565 SHA/480x320 PNG, edit invalidates old artifact
image snapshot changes require a freshly rendered merchant preview before approval/publication
unknown outcome keeps the exact prepared bytes, refuses a replacement signing and never reports funding or success
recording unknown is exact-once per version: stale and repeated calls change nothing, restart replays find the same journal
only the refund worker role can reach the journal; app and unrelated roles are refused
merchant setup is role fenced, bounded to 3 slots, honest about terms
points are debited once, never negative; vouchers are single-use, account/merchant bound, and priced only by the coupon quote path
a held slot is admitted to checkout, bound once, paid, and released to the kitchen exactly once after the server release time
unpaid expiry, late payment and merchant rejection cancel the booking and free capacity; nothing becomes due
scheduled checkout fails closed for expired holds, other accounts and orders without hold context; due-work lane is wired
settlement facts are invoker-only and unavailable to browser roles
statement from the real own-account snapshot has exact totals, scoped rows, deterministic CSV and replays identically
authenticated USDG playlist and attached reconnect snapshots reach the production Mini consumer without currency substitution; expiry restores base
worker finds only actionable merchant IDs despite ordinary cross-tenant RLS, without exposing payment rows
terminal SDK cleanup preserves unknown signed recovery and immutable financial history
```
