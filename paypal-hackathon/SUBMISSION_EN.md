# BitPOS Café Copilot — Devpost submission text (final)

Updated 11 November 2026 for the organizer's note that the entry did not appear to use the PayPal developer platform and an AI model. Every claim below is backed by code on branch `hackathon/paypal-2026` and the files in `paypal-hackathon/evidence/`. Paste each section into the matching Devpost field.

---

## Project name

BitPOS Café Copilot — AI offers, PayPal checkout

## Tagline (≤ 200 characters)

A café POS where a Gemini AI agent drafts bounded offers for surplus stock and customers pay with PayPal (Orders v2 + JS SDK v6, Sandbox), verified on the server.

## Built with

PayPal Orders v2 API · PayPal JavaScript SDK v6 · PayPal Webhooks · PayPal Sandbox · Google Gemini API (function calling) · TypeScript · Node.js · PostgreSQL · Astro · React · Docker · Cloudflare Tunnel · Oracle Cloud · ESP32-S3 (BitPOS Mini)

## Try it out (links)

- Hosted merchant POS (PayPal Sandbox): https://paypal-pos.cashlessthailand.com
- Customer table menu (Table 2): https://paypal-pay.cashlessthailand.com/table/yxrYvMgnTEUp6rudweVNqxC-45Ans1jGqhMbAtBsZOk
- Source code (entry branch): https://github.com/cryptoclocks/BitPOS/tree/hackathon/paypal-2026
- Judge guide: https://github.com/cryptoclocks/BitPOS/blob/hackathon/paypal-2026/paypal-hackathon/JUDGES.md

---

## About the project (story)

### Inspiration

Small cafés end the day with surplus pastries and drinks. Owners know they should run a quick offer, but they have no time to work out a safe discount, update prices and take payment, and handing an AI the power to change prices or move money is not acceptable. We wanted an AI that does the analysis and drafting, while the owner approves and PayPal handles the payment, with the server checking every fact.

### What it does

1. **The owner asks in plain words** (English or Thai): *"Sell the 8 croissants left before 4pm, at most 10% off."*
2. **Café Copilot**, a Google Gemini agent with function calling, uses six server tools:
   - `read_merchant_limits`, `read_catalog_stock` and `read_recent_sales` to read the facts;
   - `validate_campaign`, where the **server** computes the offer price and checks stock, the shop limits and the limits the owner typed;
   - `save_campaign_draft` to save a **draft**;
   - `ask_owner` when the request is unclear.

   The agent has no tool to publish, charge or refund. Every model call and tool result is stored and shown as a trace.
3. **The owner reviews and approves** the draft, then sends it to the shop's screens.
4. **The customer orders at the table** at the offer price and **pays with PayPal** (JavaScript SDK v6 popup, PayPal Sandbox).
5. **The server captures the order and verifies** the order id, `custom_id`, `invoice_id`, payee, currency, exact amount and the single final capture with PayPal before the bill is PAID. Webhooks (signature-verified) and a reconcile worker settle anything the customer's browser misses.
6. **The owner sees the results**:
   - units sold against the approved cap;
   - PayPal gross, fee and net from verified captures;
   - an evidence timeline for each order, from the intent and AI tool calls through approval, PayPal capture and settlement.

### How we built it

- **PayPal developer platform (Sandbox):**
  - Orders v2 REST: create, capture and get, with OAuth client credentials and a `PayPal-Request-Id` per operation so retries never create a second order or capture.
  - JS SDK v6 (`createPayPalOneTimePaymentSession`) on the customer pay page.
  - Webhooks (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.*`) with offline signature verification and a durable inbox.
  - The Sandbox business account is the payee.
- **AI:**
  - Google Gemini `generateContent` with function declarations, function-calling mode ANY, at most 6 model calls per run and a daily cap.
  - The shop's existing Gemini promotion generator writes the offer's headline and copy.
  - Owner limits are parsed by the server as a second ceiling.
  - Tests use a scripted model; real Gemini runs are logged in `evidence/ai-calls.md`.
- **Money safety in the database (PostgreSQL):**
  - Integer cents throughout.
  - One live checkout per bill, settlement in one transaction, late or duplicate payments kept for review instead of dropped.
  - The approved unit cap is enforced by a trigger, so it holds under concurrent orders.
- **Stack:**
  - TypeScript on Node.js, an Astro + React web app, a worker for reconcile and webhooks.
  - Deployed with Docker on Oracle Cloud behind a Cloudflare tunnel.
  - 43 automated PayPal tests.

### Challenges we ran into

- **Thai sandbox merchant:** a Thailand sandbox business account was declined at buyer approval ("to comply with international regulations"), so the demo shop uses a US Sandbox business account.
- **Outcomes that are unknown, not failed:** a timeout during capture can still mean money moved. Such checkouts stay "checking" and keep the bill protected until PayPal answers. We also had to separate temporary refusals (another capture in flight) from permanent ones.
- **A smaller model on the hosted demo:** it sometimes replied with an empty turn or with reasoning text instead of a tool call. Switching function calling to mode ANY and adding an `ask_owner` tool made it reliable.
- **Limits the owner actually types:** phrases such as "12 iced lattes", "ลด 10%", "by 15%" and "10 เปอร์เซ็นต์" all needed parsing, and "by 15%" must never be read as 3 pm.

### Accomplishments that we're proud of

- **A real PayPal Sandbox payment, end to end in the browser:**
  1. Copilot (real Gemini) drafts the offer.
  2. The owner approves and publishes it.
  3. The customer orders at the table at the offer price.
  4. PayPal popup.
  5. The server captures: COMPLETED, USD 3.83, fee 0.62, net 3.21.
  6. The bill is SETTLED and the offer's unit is consumed.

  Recorded in `evidence/browser-e2e.md`.
- **An AI that cannot overspend:** the model only proposes. The server computes prices, enforces limits, and the database caps units.
- **Hosted:** the deployment has quick sign-in for judges and a registered, signature-verified PayPal webhook.

### What we learned

- Proof of payment must come from PayPal on the server, never from the browser callback.
- Idempotency keys plus a durable state machine make retries and crashes safe.
- The best place for an AI agent in commerce is analysis and drafting, with people approving and PayPal moving the money.

### What's next for BitPOS Café Copilot

- PayPal refunds from the owner screen.
- More payment methods eligible through the JS SDK.
- Multi-product offers.
- Live mode after a security review.
- Copilot explaining campaign results in plain words from verified numbers.

---

## Prior work and what is new (disclosure)

- BitPOS existed before this hackathon: a café POS with table QR ordering, a promotion approval flow, BitPOS Mini screens and Solana devnet payments.
- **New for this hackathon, from 31 October 2026:**
  - all PayPal integration: `apps/api/src/paypal/`, `apps/web/src/components/paypal/`, migrations `400`–`405`;
  - Café Copilot (the Gemini agent, tools, limits, traces);
  - the hosted PayPal edition;
  - the tests in `tests/paypal-*`.
- Every new file and every changed existing file is listed in `paypal-hackathon/PROVENANCE.md`.
- **AI used in the product:** Google Gemini (function calling) for Café Copilot, and the existing Gemini promotion copy generator.
- **AI used to develop it:** coding assistants (Claude Code, Codex). These are separate from the product's AI.

## Testing instructions (for judges)

1. Open https://paypal-pos.cashlessthailand.com and press **Owner** under *Quick sign-in*. No password is needed.
2. Open **PayPal · Copilot** and press **Draft with Copilot** on an example request. You will see each AI tool step and the server-computed price. Press **Approve** to approve the draft, then send it to the screens.
3. Open the **Ledger** tab and **Settings → Payment account** to see the PayPal Sandbox payee and webhook status.
4. **Customer: order at the table and pay.** Open https://paypal-pay.cashlessthailand.com/table/yxrYvMgnTEUp6rudweVNqxC-45Ans1jGqhMbAtBsZOk, add an item, press **Confirm order & pay**, then **Pay with PayPal** and approve with a PayPal **Sandbox** personal account (create one free at developer.paypal.com). The page shows paid only after the server captures and verifies the payment. Everything is test money. The table's screen on the hosted demo is a **simulated** BitPOS Mini (labelled "simulated"); it never handles money.
5. Full guide, code map and evidence: `paypal-hackathon/JUDGES.md` on the entry branch.

## Video

Public YouTube, under 3 minutes, English narration, showing the real flow:
- the Copilot draft and its tool trace;
- owner approval;
- the table offer;
- the PayPal Sandbox popup and the verified capture;
- the results and evidence.
