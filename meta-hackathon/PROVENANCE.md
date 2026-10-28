# Meta Hackathon Provenance (Oct 26 – Nov 4, 2026)

This file tells judges exactly which parts of this repository were built during the Meta Global Hackathon, and which parts already existed.

## Baseline (pre-hackathon)

- Tag `meta-hackathon-baseline` → commit `9eb34eab9e851bd5e9c061e5357c453eb1366196`.
- Pushed to `github.com/cryptoclocks/BitPOS` as branch `hackathon/meta-2026` on **2026-10-24**, two days before the hackathon started.
- Show everything built during the hackathon with: `git diff --stat meta-hackathon-baseline..hackathon/meta-2026`

### Pre-hackathon functionality (NOT claimed as hackathon work)
POS and table QR ordering, Solana devnet / x402 / delegated payments, the earlier voice ordering copilot, AI promotion drafts with merchant approval, the device promotion queue and render ACK, pickup fulfillment notices, BitPOS Mini ESP32-S3 firmware, and migrations `001`–`137`.

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
| 2026-10-29 | `supabase/migrations/312_meta_page_reassign.sql`, `313_meta_cart_orders.sql`, `tools/meta/seed-muse-cafe.sql`, `tools/meta/create-demo-staff.sh`, `apps/api/src/meta/{ui,shop,pos,cart}.ts`, page shell/context in `routes.ts`, cart listing in `staff.ts`, cart branch in `tap-checkout.ts`, `tools/meta/meta-server.ts`, `infra/meta/compose.yaml`, `tests/meta-shop.test.ts` | Separate Meta demo shop Muse Café; meta-pay shop at the host root (menu, cart, Stripe Checkout, receipt, short QR link) and meta-pos staff pages (overview, counter sale with Stripe QR, kitchen, bookings, menu and stock, customers, connector, reports, settings, order detail with refund) built from design/figcraft-meta; every page has an onward button. Purple Cafe rows are not changed except its Messenger Page row, which is retired (not deleted) |
| 2026-10-29 | `design/figcraft-meta/` (generator `source/build_meta_ui.py`, `source/diff_vs_sol.py`, `BitPOS-Muse-UI.figcraft`, previews, handoff and reports) | Separate Meta FigCraft design: 82 screens for meta-pay, Messenger, meta-pos, BitPOS Mini and the table screen, Meta-blue theme, Stripe only. The SVG-import approach follows the pre-existing `design/figcraft/source/build_ui.py`; menu photos and logo are the pre-existing `design/figcraft/assets/`. `design/figcraft/` itself is not modified |
| 2026-10-29 | `supabase/migrations/311_meta_table_screen.sql`, `apps/api/src/meta/screen.ts`, `tableScreen`/`screenTags` in `reservations.ts`, screen route, staff links and `/meta/order` rate limit in `routes.ts`, `tools/meta/screen-url.ts`, tests in `tests/meta-reservations.test.ts` | Table screen with booking countdown (browser page at the table, no firmware change); per-address cap on voice/web ordering |
| 2026-10-29 | `supabase/migrations/310_meta_platform_feed.sql`, stock movement rows in `agent-orders.ts`/`tap-checkout.ts`, assertions in `tests/meta-mcp.test.ts`/`tests/meta-identity-flow.test.ts` | Platform labelling for a shop shared with the POS: Meta stock movements, a platform/channel order feed and offer origin (inherited orders/offers only read) |
| 2026-10-29 | host split and `/meta/images/menu` in `routes.ts`, card/receipt image URLs in `agent.ts`/`agent-orders.ts`, `tools/meta/deploy-oci.sh`, `infra/meta/compose.yaml`, `tests/meta-hosts.test.ts` | Own hostnames meta-pay (customers) / meta-pos (staff); serves the existing menu photos (inherited `apps/web/public/images/menu`, read only, shipped unchanged) from the /meta container |
| 2026-10-29 | `supabase/migrations/309_meta_table_reservations.sql`, `apps/api/src/meta/reservations.ts`, booking in `agent.ts`/`identity.ts`/`messenger.ts`/`routes.ts`, sweeper in `tools/meta/meta-server.ts`, `tests/meta-reservations.test.ts` | Table booking by chat with ask-back, tap check-in window, no-show lapse with Messenger notice, other customers' taps refused while held, staff booking list |
| 2026-10-29 | `apps/api/src/meta/{messenger,agent,agent-orders,identity,routes}.ts`, `tools/meta/messenger-profile.ts`, `tests/meta-agent.test.ts` | Messenger visuals: menu card carousel with one-tap Order (no model call), quote cards, Messenger receipt template with text fallback, My orders, persistent menu like a LINE rich menu |
| 2026-10-28 | `/meta/staff/ledger`, `/meta/order` (voice/web ordering) and chat labels in `routes.ts`/`staff.ts`/`agent.ts`; `tools/meta/{deploy-oci.sh,provenance-report.ts}`; `meta-hackathon/{JUDGES.md,PROVENANCE_REPORT.md}` | Evidence ledger, browser-speech ordering on the same agent, repeatable deploy, provenance check, judge README |
| 2026-10-28 | `supabase/migrations/308_meta_offer_policy.sql`, `apps/api/src/meta/offer-policy.ts`, owner pages in `routes.ts`, `tests/meta-offer-policy.test.ts` | Promotion drafts by Muse Spark, owner approval and Allow All policies; offers written through the inherited `productOffer()` |
| 2026-10-28 | `supabase/migrations/307_meta_messenger_agent.sql`, `apps/api/src/meta/agent.ts`, chat checkout/receipt in `agent-orders.ts`, chat events in `messenger.ts`/`identity.ts`, `agent_order` task in `packages/meta-ai`, `tests/meta-agent.test.ts` | Ordering by chat in Messenger: Muse Spark picks a step from an enum, server-priced quote, Stripe Checkout, Messenger receipt; per-customer model-call cap |
| 2026-10-28 | `supabase/migrations/306_meta_agent_orders.sql`, `apps/api/src/meta/{agent-orders,mcp}.ts`, refunds + unit conversion in `stripe.ts`, agent orders in `tap-checkout.ts`/`staff.ts`/`routes.ts`, `tests/meta-mcp.test.ts`, `tools/meta/mcp-smoke.ts` | Canonical server quotes and the BitPOS Muse Connector (MCP): menu, quote, SPT checkout, status, cancel with refund |
| 2026-10-28 | `supabase/migrations/305_meta_staff.sql`, `apps/api/src/meta/staff.ts`, staff routes in `routes.ts`, `tests/meta-staff.test.ts` | Staff view of tap orders: POS-account sign-in, role re-checked per request, one-time hand-over, pickup code |
| 2026-10-28 | `tools/meta/sim-tap.ts`, `infra/meta/compose.yaml` | Simulated SUN tap link for a registered tag (labelled as not physical); separate `/meta` compose project on the OCI host reusing the existing runtime image |
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
