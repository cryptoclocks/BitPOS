# 2026-10-28 — Stripe checkout for the offer shown on a tap

## Design
- The inherited `orders`/payments tables settle only Solana transfers (`settle_verified_attempt`); there is no fiat rail. Tap purchases therefore use their own ledger, `meta_tap_orders` (migration `304_meta_stripe.sql`), instead of altering inherited payment schema.
- `apps/api/src/meta/tap-checkout.ts`, three phases with no Stripe call inside a transaction:
  1. In the shop's RLS transaction: find the customer's last bound tap and its offer, **re-quote from the catalog** (the same approved offer must still be active; price is today's server price), refuse sold-out, non-THB/USD or ended offers, and insert one order row (one open or paid order per tap).
  2. Create a hosted Stripe Checkout Session (`createCheckoutSession`, idempotency key per order, metadata on the session and the PaymentIntent).
  3. Store the session id/URL on the row.
- PAID only from: a Stripe-signed `payment_intent.succeeded` webhook (`/meta/stripe/webhook`, event-id ledger), or a server-to-server Checkout Session lookup when the customer returns (`/meta/paid`). Amount and currency must equal the row. Stock is decremented once in the same transaction; if stock had run out, the payment stands and `stock_short` flags it for staff.
- Routes: `/meta/offer-page` (offer with a Pay button), `POST /meta/checkout` (same-origin only, 303 to Stripe), `/meta/paid`, `/meta/stripe/webhook`. CSP `form-action` allows `checkout.stripe.com`. Payments are off unless Stripe **test** keys are configured.

## Validation
- `tests/meta-stripe.test.ts` +1: Checkout Session request carries the canonical amount, metadata and idempotency key; refuses mismatched amount, live mode and a non-Stripe URL; lookup reports paid only when `complete`+`paid` with a PaymentIntent.
- `tests/meta-identity-flow.test.ts` +2 on disposable PostgreSQL under RLS: price changed from ฿52 to ฿50 after the offer was shown, and checkout charged ฿50; second start reuses the session (one Stripe create); no cookie means no checkout; the return page alone stays `CREATED`; wrong-amount webhook = `MISMATCH`, no stock change; forged signature refused; good webhook = `PAID`, stock 3→2; same event = `DUPLICATE_EVENT`; another event = `ALREADY_PAID`; late lookup agrees and changes nothing; a paid tap cannot be paid again. Lookup-only path: `PAID` with `paid_source=lookup`, and `stock_short=true` when stock was 0. Ran 3 times: 6/6 each.
- All meta tests 39/39 with the database; `npx tsc --noEmit` pass.

## Live Stripe sandbox ("BitPOS Meta US demo", US, test mode)
`npx tsx tools/meta/stripe-smoke.ts`: a real Checkout Session created through `createCheckoutSession` in **THB 52.00** (US-country sandbox presenting THB), and the server lookup matched the order id. The hosted page showed "BitPOS Meta US demo · Sandbox · THB 52.00".

Not completed: paying on the hosted page. Automated typing into the hidden browser pane was garbled (duplicated text), so the attempt was stopped and the tab closed without submitting. To finish by hand: open a session URL, pay with Stripe test card 4242 4242 4242 4242, any future expiry, any CVC, and keep "Save my information" unchecked. Webhooks against real Stripe also still need a public URL or the Stripe CLI.

## Found and fixed
Test fixtures reused Stripe PaymentIntent ids across runs, which the unique constraint correctly refused; ids are now unique per run.
