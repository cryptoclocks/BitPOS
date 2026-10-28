# BitPOS × Muse — for judges

**Meta Global Hackathon 2026 · Startup track · built 26 Oct – 4 Nov 2026**

BitPOS is a point-of-sale system for small Thai cafés. It existed before the hackathon. During the hackathon we gave it a **Meta-native customer layer**: the customer taps a phone at the counter, says yes once in Messenger, gets an offer picked by **Muse Spark**, and pays. Customers can also order by chat or voice, an AI agent can order through a **Model Context Protocol connector**, and the owner sets how far the AI may approve promotions on its own (**Allow All**).

> All payments are **Stripe sandbox · US test merchant · no real money**. The Meta app is in development mode, so Messenger only answers accounts that have a role on the app. The live demo uses the "BitPOS Purple Cafe" demo shop.

## What was built during the hackathon

| Flow | What happens | Where |
|---|---|---|
| **Tap → who are you** | An NTAG 424 DNA sticker produces a one-time SUN URL. The server checks the AES-CMAC and only accepts a higher counter, so copied links are refused. A new customer goes to Messenger (`m.me?ref=`) and consents with one button; a known customer is recognised at once. | `packages/meta-ai/src/ntag424.ts`, `apps/api/src/meta/identity.ts`, migrations 301–302 |
| **Offer on tap** | Muse Spark picks one offer from the owner-approved offers (a server-built enum) and writes a reason without numbers. The server computes every price. | `offer-select.ts`, migration 303 |
| **Pay** | Hosted Stripe Checkout at the server's re-quoted price. PAID comes only from a signed webhook or a server-to-server lookup; stock is taken once. Menu minor units (USD with 4 decimals) are converted exactly to Stripe cents. | `tap-checkout.ts`, `stripe.ts`, migration 304 |
| **Order by chat (Messenger)** | Consented customers type "ขอลาเต้ 1 แก้ว". Muse Spark picks the next step from an enum; the server quotes the price. The customer presses Pay, pays on Stripe Checkout and gets a receipt with a pickup code in Messenger. | `agent.ts`, `agent-orders.ts`, migration 307 |
| **Order by voice (web)** | The same agent on the shop's web page. The browser's own speech recognition (th-TH) turns speech into text, and the server receives text only. | `routes.ts` → `/meta/order` |
| **BitPOS Muse Connector (MCP)** | Tools: `list_menu`, `get_quote`, `complete_checkout` (Stripe Shared Payment Token), `order_status`, `cancel_order` (refund). The agent passes ids only; it never sets a price and never sees a card. | `mcp.ts`, `agent-orders.ts`, migration 306 |
| **Owner approval + Allow All** | Muse Spark drafts a promotion (product, percent and duration from server lists). The owner approves the first one. "Approve + Allow All like this" lets later drafts inside the same bounds apply automatically, up to a daily cap; the owner can stop any offer or revoke at once. Offers are written through the POS's own offer command. | `offer-policy.ts`, migration 308 |
| **Staff view + evidence ledger** | Staff sign in with their POS account (the role is re-checked on every request) and hand paid orders over once. Owners see every model call, tap, Stripe event and promotion decision. | `staff.ts`, `routes.ts`, migration 305 |

## Meta models

- **Muse Spark** (`muse-spark-1.3`, Meta Model API) chooses offers, chat steps and promotion drafts. It always uses structured output against an enum of server-built ids. No model output ever sets a price, quantity of money or payment state.
- Every call is recorded in `meta_ai_invocations`: task, model, outcome, latency, tokens, input and output hashes. The owner's ledger page shows them.
- A per-customer cap on model calls and a deterministic fallback keep the shop working when the model is unavailable.

## Try it

**MCP connector (no account needed):**

```bash
curl -s -X POST https://meta-pay.cashlessthailand.com/meta/mcp/11111111-1111-4111-8111-111111111111 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_menu","arguments":{}}}'
```

- The full agent run (quote → sandbox SPT → pay → status → cancel with refund) is in `tools/meta/mcp-smoke.ts`. It needs a Stripe *test* key to mint a sandbox SPT.
- Staff, owner, Messenger and tap flows are shown in the demo video. Live access can be arranged for judges, because the Meta app is in development mode.

**Tests:** 58 tests against PostgreSQL under row-level security. Models and Stripe are stubbed in tests.

```bash
META_TEST_DATABASE_URL=postgres://… node --import tsx --test tests/meta-*.test.ts
```

## Safety rules the code enforces

1. Prices are server-side integers. The model chooses ids from server enums; its text may not contain digits, currency symbols or links.
2. Payment is proven only by a signature-verified Stripe webhook or a server-to-server Stripe lookup that matches amount, currency and order. Each event takes effect once, and stock is taken once.
3. Identity starts only after the customer consents in Messenger. Customers can leave with "Forget me" or STOP. Staff never see a customer's Messenger id, and message text is not stored.
4. Each tap is single-use: SUN counters only move forward, and tap sessions last 120 s.
5. Promotions: the owner approves first. Allow All is bounded and capped, every automatic approval is listed, and any of them can be stopped at once.
6. Test mode only: live Stripe keys are refused in code. Secrets live outside the repository.

## Honest limits

- **Not a listed Muse connector yet.** Muse connectors need review, and Stripe Shared Payment Tokens are not available in Thailand. The demo therefore plays the agent with our own client and Stripe's sandbox SPT helper, as a US test merchant.
- **Messenger app is in development mode.** Only accounts with a role on the app can chat until Meta reviews it.
- **Stickers.** The live demo used a simulated SUN tap (`tools/meta/sim-tap.ts`, which computes exactly what the chip would), until a physical NTAG 424 sticker is provisioned. Runs that used it are labelled as simulated.
- **Not used:** Muse Image, the camera and vision features in early plans, and anything crypto in the demo.

## What already existed before 26 October

The POS, table QR ordering, Solana devnet payments, the earlier voice copilot, the POS promotion editor and device queue, and the BitPOS device firmware all existed before the hackathon. See [PROVENANCE.md](PROVENANCE.md) and the generated [PROVENANCE_REPORT.md](PROVENANCE_REPORT.md): every new file carries the header `Meta hackathon work (2026-10-26..11-04)`, and every changed pre-existing file is listed with its reason.
