# BitPOS × NEAR HACKATHON — provenance

This file tells judges which parts of the `hackathon/near-2026` branch were built for NEAR HACKATHON
(window: announcement 19 Oct 2026 → 14 Nov 2026, 23:59 UTC) and which already existed.

## Baseline

- Tag `near-hackathon-baseline` → `b770ab2ca21bed1338808342c05981925827a1b8` (31 Oct 2026): the current BitPOS
  point of sale, imported as one commit from the project's main development line. It has **no NEAR code**.
- Everything NEAR is in the commits after that tag, all dated 14 Nov 2026.
- Show only the NEAR work: `git diff --stat near-hackathon-baseline..hackathon/near-2026`

## Pre-existing functionality (not claimed)

BitPOS existed before this hackathon as a café point of sale on **Solana devnet**: POS and table QR ordering,
versioned server-side quotes and stock, promotions with merchant approval, device (BitPOS Mini) events over a
durable outbox, Solana payments (USDG/USDC/USDT, sponsored fees, x402, delegated payments), a coffee voice copilot,
pickup/fulfilment, food delivery tools, role enforcement (owner/manager/staff) and Thai/English pages. The same
product was also entered, with separate branches and separate work, in a PayPal hackathon (`hackathon/paypal-2026`:
PayPal Sandbox rail and an AI offer copilot) and a Meta hackathon (`hackathon/meta-2026`: Messenger ordering, NFC tap
identity, Stripe test payments). None of that code is in this branch, and none of it is claimed here.

What the NEAR work reuses from the baseline, unchanged: orders, the frozen server quote, stock reservation, the
settlement publisher, sessions and roles, the web shell and the firmware's board/display layer.

Patterns reused from our own earlier editions (ideas and a few adapted tool files, no shared runtime code):
the "second payment rail beside Solana" structure and the disposable-database tool from the PayPal edition
(`tools/near/fixture-db.py`, `seed-demo.ts`, `dev-api.ts`, `dev-auth.ts` say so in their headers); the "second
firmware product in the same tree" mechanism from the Meta edition.

## Built for this hackathon

Convention: every new file starts with `NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.`
New code lives only in `contracts/near-bills/`, `apps/api/src/near/`, `apps/web/src/components/near/`,
`apps/web/src/lib/near-*`, `apps/web/src/pages/near-terminal/`, `apps/web/src/styles/near.css`,
`supabase/migrations/5xx_near_*`, `tests/near-*`, `tests/fixtures/near-*`, `tools/near/`,
`tools/firmware/{build-near.sh,near-host-test/}`, `device/firmware/main/bitpos_near*`,
`device/firmware/{sdkconfig.near,main/Kconfig.projbuild}`, `design/figcraft-near/` and `near-hackathon/`.

| Files | What |
|---|---|
| `contracts/near-bills/` | Rust contract (near-sdk 5.30): exact-amount bills paid by `ft_transfer_call`, automatic bounce of anything else, witness escrow released by an ed25519 device signature (`env::ed25519_verify`), refund after a timeout, one batched receipt that pays every recipient or none, NEP-297 events. 14 unit tests. `release/` holds the deployed build. |
| `tools/near/{lib,accounts,setup,e2e-chain}.ts` | Testnet accounts (keys outside the repository), deployment, the tUSD test token from NEAR's global FT contract, and a script that runs four real payment cases on testnet. |
| `apps/api/src/near/{chain,config,money,recipe,verify}.ts` | The only file that talks to NEAR (`chain.ts`), testnet-only config, exact integer money, the split recipe, and the pure verifier (delegate must be exactly this bill; bill on chain must equal the frozen row). |
| `apps/api/src/near/{bills,routes,reconcile}.ts`, `supabase/migrations/500–502` | Customer payment: open the bill from the frozen quote, gasless relay (NEP-366), settlement only from the contract's final state, reconcile lane, ledger tables and the settlement routine. |
| `apps/api/src/near/device.ts` | Witness device protocol (state, register, ack). |
| `apps/api/src/near/merchant.ts` | Merchant hub routes: recipe, team and shifts, suppliers and invoices, ledger, CSV, evidence, devices, refund/retry. |
| `apps/api/src/near/intents.ts` | Cross-chain **preview** through NEAR Intents 1Click (`dry:true` quotes only; nothing executed). |
| `apps/api/src/near/cfo.ts`, `supabase/migrations/503_near_cfo.sql` | Café CFO on NEAR AI Cloud: option picked from a server-built list, response signature verified against the attestation report fetched before the call; labelled sample mode without a key. |
| `tests/near-*.test.ts`, `tests/near-fixture.ts`, `tests/fixtures/near-tx-*.json` | 25 tests: units against real testnet transaction results, and integration on PostgreSQL through the tenant path with an in-memory contract stand-in. |
| `tools/near/{fixture-db.py,seed-demo.ts,dev-api.ts,dev-auth.ts,e2e-api.ts}` | Disposable database (port 55477), the demo shop "Orbit Café", local preview servers, and an end-to-end run through the server code on testnet. |
| `device/firmware/main/bitpos_near*.{c,h}`, `sdkconfig.near`, `Kconfig.projbuild`, `tools/firmware/{build-near.sh,near-host-test/}` | BitPOS Mini firmware product `near` (`bitpos_terminal_near` 0.5.0-near): reads the bill from NEAR RPC itself, signs the witness message with a key made on the device. Builds; host tests pass; **not flashed, not run on hardware**. |
| `apps/web/src/components/near/*`, `lib/near-*`, `pages/near-terminal/`, `styles/near.css` | Merchant hub, customer pay page, simulated witness screen. |
| `design/figcraft-near/` | FigCraft document (35 frames) built by script, with route checks. |
| `near-hackathon/` | Plan, owner to-do, judge guide, evidence, this file. |

## Pre-existing files touched

| File | Change |
|---|---|
| `apps/api/src/index.ts` | Mounts `serveNear` in the server chain and `/api/near/*` for signed-in staff. |
| `apps/api/src/orders.ts` | `publishSettlementRow` extracted from `settleAttempt`, body unchanged, so both rails publish through the same code. |
| `apps/api/src/demo-auth.ts` | A separately opted-in demo shop for this edition (`BITPOS_DEMO_SHOP=near` or its own public origin). |
| `apps/api/src/table-ordering.ts` | Table entry payload adds `nearShop`. |
| `apps/worker/src/index.ts` | Adds the NEAR reconcile lane when NEAR is configured. |
| `apps/web/src/lib/api-routes.ts` | Allow-lists the NEAR routes in the web proxy. |
| `apps/web/src/components/Pos.tsx`, `apps/web/src/pages/pay/[accessToken].astro` and related web files | NEAR tab and NEAR pay page wiring (listed in the web commit message). |
| `device/firmware/{CMakeLists.txt,main/CMakeLists.txt,main/main.c,README.md}` | `BITPOS_PRODUCT=near` build branch, three new sources (empty unless the product is selected), the `bitpos_near_main()` hook, a README section. The standard product builds unchanged (verified by a full build). |
| `package.json`, `pnpm-lock.yaml` | `near-api-js` 7.5.3, `borsh` 2 and the wallet connector. |
| SQL function `bitpos.unpaid_order_safe` (from migration 055) | Rebuilt in `501_near_ledger.sql`: base body unchanged, plus "not safe while the contract holds the money"; keeps the PayPal edition's clauses when that edition shares the database. |
| SQL trigger on `payment_attempts` | `near_block_solana_attempt`: one order, one payment channel. |

## Third-party code and services

- `near-sdk`, `near-api-js`, `borsh`, `@noble/curves`, `@hot-labs/near-connect` (their own licences, via package managers).
- TweetNaCl (public domain) — the Ed25519/SHA-512 code in `device/firmware/main/bitpos_near_ed25519.c` is derived from it; see `docs/THIRD_PARTY_NOTICES.md`.
- NEAR global fungible-token contract `ft.globals.primitives.testnet` (used as deployed, for the tUSD test token).
- NEAR testnet RPC providers (FastNEAR, dRPC), NEAR Intents 1Click API (dry quotes), NEAR AI Cloud (optional).

## Tools disclosure

Code, tests, documents and design files in this branch were written with AI coding assistance (Claude Code),
directed and reviewed by the builder. Commits carry a `Co-Authored-By` trailer.
