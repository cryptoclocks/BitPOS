# Provenance report

Generated from `git diff meta-hackathon-baseline..HEAD` (a73bbac → 961ad94). Regenerate with `npx tsx tools/meta/provenance-report.ts`.

| | Files |
|---|---|
| Added during the hackathon | 64 (5,503 lines) |
| Pre-existing files modified | 2 |
| Deleted | 0 |

## Added files

- `apps/api/src/meta/agent-orders.ts`
- `apps/api/src/meta/agent.ts`
- `apps/api/src/meta/evidence.ts`
- `apps/api/src/meta/identity.ts`
- `apps/api/src/meta/mcp.ts`
- `apps/api/src/meta/messenger.ts`
- `apps/api/src/meta/offer-policy.ts`
- `apps/api/src/meta/offer-select.ts`
- `apps/api/src/meta/promotion-bridge.ts`
- `apps/api/src/meta/routes.ts`
- `apps/api/src/meta/staff.ts`
- `apps/api/src/meta/stripe.ts`
- `apps/api/src/meta/tap-checkout.ts`
- `infra/meta/compose.yaml`
- `meta-hackathon/DEMO_SCRIPT_TH.md`
- `meta-hackathon/JUDGES.md`
- `meta-hackathon/PLAN_TH.md`
- `meta-hackathon/PROVENANCE.md`
- `meta-hackathon/README.md`
- `meta-hackathon/REVIEW_TH.md`
- `meta-hackathon/evidence/2026-10-27-muse-stripe-probe.md`
- `meta-hackathon/evidence/2026-10-27-ntag424-tap.md`
- `meta-hackathon/evidence/2026-10-27-scaffold.md`
- `meta-hackathon/evidence/2026-10-28-allow-all-ledger-voice.md`
- `meta-hackathon/evidence/2026-10-28-mcp-quotes.md`
- `meta-hackathon/evidence/2026-10-28-messenger-agent.md`
- `meta-hackathon/evidence/2026-10-28-oci-meta.md`
- `meta-hackathon/evidence/2026-10-28-offer-on-tap.md`
- `meta-hackathon/evidence/2026-10-28-staff-view.md`
- `meta-hackathon/evidence/2026-10-28-tap-checkout.md`
- `meta-hackathon/evidence/2026-10-28-tap-messenger-session.md`
- `meta-hackathon/evidence/2026-10-28-tunnel-webhooks.md`
- `meta-hackathon/meta-ai.env.example`
- `packages/meta-ai/src/flash-sale.ts`
- `packages/meta-ai/src/ntag424.ts`
- `packages/meta-ai/src/router.ts`
- `packages/meta-ai/src/types.ts`
- `supabase/migrations/300_meta_ai.sql`
- `supabase/migrations/301_meta_tap.sql`
- `supabase/migrations/302_meta_identity.sql`
- `supabase/migrations/303_meta_offers.sql`
- `supabase/migrations/304_meta_stripe.sql`
- `supabase/migrations/305_meta_staff.sql`
- `supabase/migrations/306_meta_agent_orders.sql`
- `supabase/migrations/307_meta_messenger_agent.sql`
- `supabase/migrations/308_meta_offer_policy.sql`
- `tests/meta-agent.test.ts`
- `tests/meta-ai-router.test.ts`
- `tests/meta-flash-sale.test.ts`
- `tests/meta-identity-flow.test.ts`
- `tests/meta-mcp.test.ts`
- `tests/meta-messenger.test.ts`
- `tests/meta-ntag424.test.ts`
- `tests/meta-offer-policy.test.ts`
- `tests/meta-offer.test.ts`
- `tests/meta-staff.test.ts`
- `tests/meta-stripe.test.ts`
- `tools/meta/deploy-oci.sh`
- `tools/meta/mcp-smoke.ts`
- `tools/meta/meta-server.ts`
- `tools/meta/muse-smoke.ts`
- `tools/meta/provenance-report.ts`
- `tools/meta/sim-tap.ts`
- `tools/meta/stripe-smoke.ts`

## Pre-existing files modified (each must be declared in PROVENANCE.md)

- `apps/api/src/index.ts` — declared
- `docs/CHECKPOINT.md` — declared

## Checks

- New files without the hackathon header: none
- Modified files not declared: none
- Deleted pre-existing files: none
