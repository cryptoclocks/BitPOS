# 2026-10-28 — Ordering by chat in Messenger (Muse Spark agent)

## What was built
- **Migration 307**:
  - Chat quotes and orders carry the customer's consent link. Every chat quote must have one; MCP quotes have none.
  - Agent orders gain `stripe_checkout_id`/`checkout_url` and the confirmation source `lookup`.
- **Parser** (`messenger.ts`): turns chat text (≤300 characters, never stored) and `BITPOS_AGENT_PAY:<quoteId>` postbacks into events. Echo messages are ignored, and stop words still disconnect the customer.
- **Gate** (`identity.ts`): only a customer with an active consent link reaches the agent. Anyone else gets "tap your phone on the device first", and no model is called.
- **`agent.ts`**:
  - Muse Spark picks one step from a server-built enum: quote a listed product (with quantity), show the menu, or help.
  - Replies must not contain digits, prices, currency symbols or links. Unsafe replies are replaced with fixed text.
  - The server prices the quote and adds the total and the offer percentage itself.
  - **Credit guard:** at most 10 model calls per customer per hour. Above that, or if the model fails, a free matcher looks for menu names in the message.
- **`agent-orders.ts`**:
  - `startAgentCheckout`: one hosted Stripe Checkout per chat quote, only for the customer who owns the quote. Chat quotes cannot be paid through the MCP SPT path, so a quote can never be paid twice.
  - `reconcileAgentCheckout`: return page that confirms by asking Stripe server to server.
  - `agentReceipt`: a Messenger receipt with the pickup code, sent once by whichever path confirmed the order first.
- **Routes**: the agent runs after the webhook transaction commits, the Stripe webhook triggers the receipt, and `GET /meta/agent/paid?o=`.

## Validation (no Meta API credit used)
- Meta tests 53/53, passing twice in a row on the persistent test DB. The 5 new agent tests use a stub model and stub Stripe:
  - Parser events.
  - Only consented customers reach the agent; a duplicate delivery is ignored.
  - The model's enum choice is used; unsafe replies are replaced; model failure falls back.
  - Quote and checkout:
    - The quote is $4.00 from the server.
    - The MCP SPT path refuses chat quotes, and another customer cannot pay the quote.
    - One Checkout is created per quote.
    - A signed webhook gives PAID and exactly one receipt, and stock is taken once.
  - The credit guard caps model calls.
  - The return page confirms by lookup exactly once, and an unpaid session stays PENDING.
- Earlier tests were made safe to re-run: unique stub ids, and the staff test uses its own shop each run.
- `tsc` passes.

## OCI deploy and live test
- Backup `bitpos-20261028T112442Z.dump` (75,394,178 bytes, archive list verified). Migration 307: dry-run, then applied; the before/after digests are identical.
- **Incident and fix:**
  - A command I issued to disable Muse was rejected by the owner in the UI, but its remote part had already run. The OCI env had the `META_AI_*` keys renamed, so offers fell back to the deterministic choice from about 11:10 to 11:43 UTC.
  - I restored the keys. The log shows `offers muse spark` again. The local env file was not changed.
- **Live chat order** (owner's account, ICT):

| Time | Request | Result |
|---|---|---|
| 18:50:43 | Messenger POST with the text "ขอลาเต้ 1 แก้ว" | 200 in 4.1 s. Muse Spark `agent_order`: 1 call, 360 input / 255 output tokens, 3.2 s. A chat quote of $4.00 was created |
| 18:50:52 | Messenger POST (Pay postback) | 200. Agent order #C923 created and its Stripe Checkout sent |
| 18:51:07 | Stripe webhook | `payment_intent.succeeded` `evt_3UVVNkJ3OQ9SsvzG1nkK4lNG`. Order CONFIRMED (`webhook`), `pi_3UVVNkJ3OQ9SsvzG1GRJcu6E`, 400 usd, stock 192 → 191. Receipt sent with no send error |
| 18:51:07 | `GET /meta/agent/paid` | 200, "Paid ✓", pickup code |

- The owner confirmed the receipt in Messenger (text): "จ่ายแล้ว ✓ 🥛 ลาเต้ ×1 · $4.00 / รหัสรับสินค้า #C923 รับที่เคาน์เตอร์ได้เลยค่ะ / Paid — pickup code #C923. Stripe sandbox, test mode."
- Muse usage on OCI so far: 2 calls in total (one offer selection, one chat order).
