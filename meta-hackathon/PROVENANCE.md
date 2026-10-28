# Meta Hackathon Provenance (Oct 26 – Nov 4, 2026)

This file tells judges exactly which parts of this repository were built during the Meta Global Hackathon, and which parts already existed.

## Baseline (pre-hackathon)

- Tag `meta-hackathon-baseline` → commit `9eb34eab9e851bd5e9c061e5357c453eb1366196`.
- Pushed to `github.com/cryptoclocks/BitPOS` as branch `hackathon/meta-2026` on **2026-10-24**, two days before the hackathon started.
- Show everything built during the hackathon with: `git diff --stat meta-hackathon-baseline..hackathon/meta-2026`

### Pre-hackathon functionality (NOT claimed as hackathon work)
POS and table QR ordering, Solana devnet / x402 / delegated payments, the voice ordering copilot (Gemini-based), AI promotion drafts with merchant approval, the device promotion queue and render ACK, pickup fulfillment notices, BitPOS Mini ESP32-S3 firmware, and migrations `001`–`137`.

## Built during the hackathon

Conventions: every new file starts with `Meta hackathon work (2026-10-26..11-04)`. New code lives only in these paths:
`packages/meta-ai/`, `apps/api/src/meta/`, `apps/web/src/components/meta/`, `apps/web/src/pages/meta/`, `apps/worker/src/meta-*`, `supabase/migrations/3xx_*`, `tests/meta-*`, `tools/meta/`, `meta-hackathon/`.

| Date | Files | What |
|---|---|---|
| 2026-10-27 | `packages/meta-ai/src/{types,router,flash-sale}.ts` | Meta model router across Meta Model API, Baseten, Modal and self-hosted open-weight nodes (fallback, circuit breaker, schema validation, evidence records); deterministic flash-sale leash |
| 2026-10-27 | `apps/api/src/meta/promotion-bridge.ts` | Adapter that lets the Meta router act as a provider for the pre-existing promotion pipeline |
| 2026-10-27 | `supabase/migrations/300_meta_ai.sql` | Agent policies, vision observations, agent runs, model invocation ledger |
| 2026-10-27 | `tests/meta-ai-router.test.ts`, `tests/meta-flash-sale.test.ts` | 14 tests |
| 2026-10-27 | `meta-hackathon/*` | Plan, review, demo script, this file |
| 2026-10-27 | `apps/api/src/meta/stripe.ts`, `tests/meta-stripe.test.ts` | Stripe sandbox agent payment: charge a Shared Payment Token for the canonical quote (idempotent, response must match amount/currency/checkout, live mode refused), Stripe webhook signature verification, paid-fact extraction; 6 tests |
| 2026-10-27 | `packages/meta-ai/src/ntag424.ts`, `tests/meta-ntag424.test.ts` | NTAG 424 DNA SUN verification (AES-CMAC, PICCData decryption, per-sticker key derivation); NXP and RFC 4493 vectors |
| 2026-10-27 | `supabase/migrations/301_meta_tap.sql` | Sticker registry, replay-safe counter advance, single-use 120 s tap sessions |
| 2026-10-28 | `tools/meta/meta-server.ts`; Messenger optional in `routes.ts` | /meta-only server for a temporary public tunnel; real Stripe sandbox webhook delivered and applied |
| 2026-10-28 | `supabase/migrations/304_meta_stripe.sql`, `apps/api/src/meta/tap-checkout.ts`, Checkout functions in `apps/api/src/meta/stripe.ts`, checkout routes in `routes.ts`, tests | Pay for the tapped offer with Stripe Checkout (test mode): re-quoted price, own ledger (inherited orders untouched), PAID only from signed webhook or server lookup, stock taken once |
| 2026-10-28 | `supabase/migrations/303_meta_offers.sql`, `apps/api/src/meta/{offer-select,evidence}.ts`, `tests/meta-offer.test.ts`, `tools/meta/muse-smoke.ts`; offer flow in `identity.ts`/`routes.ts`; `offer_selection` task in `packages/meta-ai` | Muse Spark picks one approved offer per tap (enum only, deterministic fallback), invocation ledger, shown in Messenger and on the web page |
| 2026-10-28 | `supabase/migrations/302_meta_identity.sql`, `apps/api/src/meta/{messenger,identity,routes}.ts`, `tests/meta-{messenger,identity-flow}.test.ts` | Tap route, Messenger consent identity, single-use sign-in links, customer web sessions; 7 tests incl. end-to-end on PostgreSQL |
| 2026-10-27 | `tools/meta/stripe-smoke.ts` | Stripe test-mode probe (account country, card charge, agent shared-payment-token charge); refuses non-test keys |

## Pre-existing files modified during the hackathon

Every line changed in a pre-existing file is listed here with the reason.

| File | Change | Reason |
|---|---|---|
| `docs/CHECKPOINT.md` | Prepended a dated Meta hackathon section | Project rule: every work session updates the checkpoint |
| `apps/api/src/index.ts` | Import `serveMeta`/`metaRouteDepsFromEnv`; build `metaDeps` once (passing the existing `effectiveMenu` for offers); call `serveMeta` first in the request chain (3 lines) | Mount the `/meta/` routes; returns false for every other path, so existing routes are unchanged |

## Tools used
- Meta models: list each model and provider exactly as recorded in `meta_ai_invocations` (fill in after the first live calls).
- AI coding assistants used to write code: list them here.
