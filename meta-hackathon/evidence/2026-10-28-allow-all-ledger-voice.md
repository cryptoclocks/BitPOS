# 2026-10-28 — Allow All live test, evidence ledger, voice/web ordering, judge docs

## Owner approval + Allow All (live on OCI, run by Claude in the app browser at the owner's request)
- I signed in through the owner demo quick sign-in on `/meta/staff`, then opened `/meta/staff/offers`.
- **Draft 1 (Muse Spark call 1).** Croissant −20%, 8 h, with a reason containing no digits. I approved it with **Allow All** for the Bakery category at 3 per day.
  - Allow All policy shown: Bakery, at most 20%, at most 8 h, 0/3 used today.
  - Inherited `versioned_product_offers` revision 1 (1000 → 800); audit `product.offer.enable`.
- **Stop.** Revision 2 (disabled); audit `product.offer.disable`.
- **Draft 2 (Muse Spark call 2).** Croissant −20%, 8 h, inside the policy, so it was approved automatically: draft `APPLIED` with `approval_kind=policy`, revision 3, audit `product.offer.enable`, policy now 1/3 today.
- **Clean-up.** The offer was stopped and Allow All revoked, leaving no active policy. Purple Cafe's offers are back to Latte only, for the Solana stream.
- Muse Spark usage for this test: 2 `promotion_copy` calls (1084/277 and 1084/316 tokens, 2.3–2.6 s). OCI total so far: 4 calls.

## New since the previous commit
- **`/meta/staff/ledger`** (owner and manager): AI calls (task, model, outcome, latency, tokens), taps, Stripe events (tap and agent) and promotion decisions for the last 24 hours. No customer identity is shown.
  - Live: 4 Muse Spark calls, 2 taps, 4 Stripe events and 2 decisions, all matching the database.
- **`/meta/order`**: voice or typed ordering for signed-in customers.
  - The browser's speech recognition (`th-TH`) fills the box, so the server receives text only.
  - The CSP allows only the per-request nonce script.
  - It uses the same `planChatOrder` agent, chat quote, Stripe Checkout and Messenger receipt as the chat. It is linked from the welcome, known-tap and offer pages.
  - Live: `/meta/order` without a session returns 401.
- **Staff list labels**: chat orders now show "💬 chat (Messenger / voice)" and MCP orders "🤖 agent (MCP)". Before this fix, #C923 was wrongly shown as MCP.
- **`tools/meta/deploy-oci.sh`**: repeatable deploy.
  - Uploads the source subset, refuses secret-looking paths, swaps the source atomically, restarts only `bitpos-meta`, and checks health, rolling back if unhealthy.
  - Lists meta migrations missing from the ledger. First run: health 200 and "meta migrations: all applied".
- **`tools/meta/provenance-report.ts`** and **`meta-hackathon/PROVENANCE_REPORT.md`**: every new file has the hackathon header, and the only modified pre-existing files are `apps/api/src/index.ts` and `docs/CHECKPOINT.md`, both declared.
- **Documents**:
  - `meta-hackathon/JUDGES.md` (English): what was built, how to try it, safety rules, honest limits.
  - `DEMO_SCRIPT_TH.md` v3 now matches the real flows.
  - `PLAN_TH.md` gains a status table (real migration numbers and URLs).
  - Provider names that should not appear were removed from the hackathon docs.
- **Tests**: meta 58/58, passing twice in a row. New: web order page (session, nonce CSP, cross-origin refused, quote and Checkout) and ledger (owner 200, staff 403). `tsc` passes.
