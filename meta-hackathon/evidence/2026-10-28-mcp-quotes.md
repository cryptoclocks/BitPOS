# 2026-10-28 — Canonical quotes and the BitPOS Muse Connector (MCP)

## What was built
- **Migration 306**:
  - `meta_quotes`: server-priced in Stripe minor units, 10-minute validity (the database allows at most 15), quantity 1–10, approved offer id attached.
  - `meta_agent_orders`: one order per quote; statuses PENDING / CONFIRMED / FAILED / REFUNDING / CANCELLED; tracks hand-over.
  - `meta_agent_stripe_events`: webhook dedupe.
  - All three tables use tenant RLS. Inherited orders and payments tables are untouched.
- **`apps/api/src/meta/agent-orders.ts`**:
  - `listMenu` and `createQuote` price from the live catalog, with approved offers and exact conversion to Stripe units.
  - `completeCheckout` runs in three phases, with the Stripe call outside any transaction.
    - CONFIRMED comes only from the server's own PaymentIntent (amount, currency and metadata are checked) or a signed webhook. Stock is taken once.
    - An unknown outcome stays PENDING. A retry repeats the same idempotent request, and the webhook can still confirm it.
  - `cancelOrder` issues a full Stripe refund (idempotent per order) and returns stock only if stock was actually taken. It is refused once staff have handed the order over.
- **`apps/api/src/meta/mcp.ts`**: an MCP server over Streamable HTTP (JSON responses), stateless JSON-RPC 2.0, at `POST /meta/mcp/<merchantId>`.
  - Tools: `list_menu` and `order_status` (read), `get_quote`, `complete_checkout` (sensitive write, SPT), `cancel_order` (write, refund).
  - Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05. Batches are refused.
  - Any browser `Origin` is refused, which covers DNS rebinding. Rate limit: 120 calls per minute per client IP.
  - The agent only ever passes product, quote and order ids, and never sees card data or keys.
- **Stripe webhook**: also confirms agent orders after matching the quote id, amount and currency.
- **Staff view**: lists agent orders labelled "🤖 agent (MCP)". Hand-over is allowed only for CONFIRMED orders, and a refund in progress blocks it.
- **`tools/meta/mcp-smoke.ts`**: plays the agent against a live connector. The sandbox SPT is minted with Stripe's test helper and capped at the quoted total.

## Validation
- Meta tests 48/48. The 5 new MCP tests run on PostgreSQL under RLS with Stripe stubbed:
  - Protocol: initialize, tools/list, notifications, unknown methods, no batches.
  - Pricing:
    - 4-decimal USD is quoted in cents.
    - Forged price arguments are ignored.
    - Quantity, stock, minimum charge and fraction-of-a-cent inputs are refused.
    - Another shop's product is invisible.
  - Charging:
    - One charge per quote; stock is taken once.
    - A declined card gives FAILED.
    - An unknown outcome stays PENDING, then a signed webhook confirms it; a duplicate event is ignored.
    - A forged amount gives MISMATCH.
    - An expired quote is refused.
  - Cancelling: refund plus stock back, idempotent; refused after hand-over.
  - HTTP: POST only, Origin refused, unknown merchant 404, bad protocol version 400.
- `tsc` passes.

## OCI (live, Stripe sandbox "BitPOS Meta US demo", test mode)
- A backup was taken before migration 306: `bitpos-20261028T065126Z.dump` (75,377,026 bytes, archive list verified).
- Migration 306: dry-run first, then applied with a ledger row. Merchants, products, orders, devices, the non-meta ledger and the orders digest are unchanged. The `meta_*` table count went from 17 to 20.
- `list_menu` over the public URL returns Purple Cafe's menu: Latte $4.00 (−20%, payable); the other items are $0.10 and not payable on Stripe.
- `mcp-smoke.ts` run 1:
  - Quote $4.00 → `complete_checkout` returned CONFIRMED, `pi_3UVQj3J3OQ9SsvzG01mfH1Kx`, pickup #6BCC. The retry returned the same order.
  - Stock went from 193 to 192.
  - Stripe's webhook `evt_3UVQj3J3OQ9SsvzG0H9lhawN` arrived and was recorded once.
  - Order #6BCC is left open for the staff hand-over in the demo.
- `mcp-smoke.ts --cancel` run 2:
  - CONFIRMED `pi_3UVQjNJ3OQ9SsvzG1nBnfYHE` → `cancel_order` returned CANCELLED with refund `re_3UVQjNJ3OQ9SsvzG1r4vW7Fs`.
  - Net stock is unchanged (192).

## Not done / honest limits
- Not reviewed or listed in Muse. Real Muse users cannot reach a Thai shop yet: SPT is not available in Thailand, and connectors need Muse review. The demo plays the agent with our own client and Stripe's sandbox SPT helper.
- v1 has no customer login. An order id works as a capability for status and cancel. `my_offers`, which needs the Messenger identity, is not exposed yet.
