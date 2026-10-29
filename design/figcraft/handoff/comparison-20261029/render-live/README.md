# Live render harness (real API, real database, real pages)

Renders the built `apps/web` against the real `apps/api` and a real Postgres, not `render/mock-api.mjs`. Everything is local and throwaway: no production credentials, no OCI, no mobile apps, no shared database contents.

| Piece | Where |
|---|---|
| Postgres | fixture cluster `127.0.0.1:55440`, **new database `bitpos_render_fixture`** (all 172 migrations; `029` needs 3 synthetic Gemini-start rows, seeded as in `docs/RUNBOOK_BACKUP_RESTORE_TH.md`) |
| Auth | `fake-auth.mjs` on `:3091` stands in for the Supabase `/token` call used by `POST /api/session`; only the throwaway password `render-local-only` works. The real sign-in form and real session rows are used. |
| API | `api-main.ts` starts `apps/api` `server` on `:3081` (the API itself hard-codes 3001) |
| Web | `astro build` of `apps/web` into private `apps/web/dist-render-live` (`PUBLIC_URL=http://127.0.0.1:4482` baked), served on `127.0.0.1:4482`; deleted by `down.sh` |
| Worker | not started (it would expire the seeded unpaid bills and call devnet RPC); `up.sh --worker` starts it |

Accounts (password `render-local-only`): `owner@`, `manager@`, `staff@render.invalid` (merchant `7e0d0c0e-0000-4000-8000-00000000f001`), and `bulk@render.invalid` (second merchant `...f002` with 230 paid orders today).

Seed (`seed.ts`, written through the real domain/API handlers): 8 products in 4 categories (4 with synthetic gradient photos uploaded through the product-image path, one low-stock), published USD prices, stock receipt + adjustment, 2 suppliers, customers, a table with a table-screen device and entry token, a counter register, 13 orders (paid x3, preparing x2, ready x2, collected x3, awaiting x2, expired x1), 2 reward slots, 3 promotion campaigns (draft / approved / revoked; model output is a labelled **fixture provider**, not a real model). Not seeded: delivery/app-pickup orders (created only by the mobile app), a wallet provider, refunds, platform operator data. Orders are paid by SQL (`status='PAID'`), never by a chain transaction.

## Run

```
design/figcraft/handoff/comparison-20261029/render-live/run-all.sh          # recreate DB, seed, build, start, capture everything, stop
design/figcraft/handoff/comparison-20261029/render-live/run-all.sh --keep-up
```

Step by step:

```
R=design/figcraft/handoff/comparison-20261029/render-live
$R/seed-all.sh                    # drop/create bitpos_render_fixture, apply migrations, seed (users data orders extras retime bulk)
$R/up.sh --build                  # fake auth + API + web (logs in $TMPDIR/bitpos-render-live)
source $R/env.sh
node $R/overview-audit.mjs        # Overview vs SQL, Asia/Bangkok and America/New_York browsers, main + 230-order merchant
node $R/capture-flows.mjs kanban,product,sidebar,promo,export
node $R/capture-pay.mjs           # bills (awaiting/expired/paid), pay menu, table flow, paid, order again
node $R/capture-pos.mjs [P01,P04] # P01-P38, 1440 + 390, EN + TH
$R/down.sh                        # stop everything, delete dist-render-live
```

Re-time the orders around Bangkok midnight with `npx tsx $R/seed.ts retime` (the audit does it). Screenshots go to `shots/` (untracked, `*.png` ignored). Results: `flows-result-*.json`, `pay-result.json`, `overview-audit-*.json`, `logs/`.

Browser: Playwright from `/Users/cryptoclock/Desktop/BitPOS/local/toolchains/browser-contract`, Chrome at `/Applications/Google Chrome.app`.
