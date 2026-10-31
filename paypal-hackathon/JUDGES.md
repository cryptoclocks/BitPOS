<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# BitPOS × PayPal — guide for judges

**BitPOS PayPal edition** is a café point of sale where an AI agent (Café Copilot) helps the owner sell surplus stock with a time-limited offer, and customers pay at the table with **PayPal**. The money path is deterministic and server-verified. The AI can only read, check and save a draft.

> Everything runs on the **PayPal Sandbox** (test money). The demo café, menu and prices are sample data, not a real shop.

## 1. Try it (about 5 minutes)

| | |
|---|---|
| Merchant POS | `https://paypal-pos.cashlessthailand.com` (hosted since 31 Oct 2026) |
| Sign-in | **Quick sign-in** buttons on the login page: **Owner**, **Manager**, **Staff** (no password needed) |
| Customer table link | in the Devpost **Testing instructions** (opens the table menu of "Table 2") |
| PayPal buyer | your own PayPal **Sandbox** personal account, or the sandbox buyer given in the testing instructions |

1. **Owner: ask Copilot.**
   - Press **Owner** under quick sign-in, then open **PayPal · Copilot**.
   - Try **Staff** too: staff can see the tab, but drafting and approving are refused ("Owner or manager only"; the server enforces it).
   - Type, for example, *"Sell 12 iced lattes before 10pm, max 15% off"*, then press **Draft with Copilot**.
   - You see each tool step: shop limits → stock → recent sales → validation → draft.
   - If the model proposes something outside the limits, the server rejects it, and you can watch the model correct itself. **Details (trace)** shows every model call and tool result.
2. **Owner: approve.**
   - Check the draft: the price is computed by the server, plus max units, units per order, end time and the AI's reason.
   - **Approve → Confirm approval**, then **Send to all screens**.
   - The AI cannot do these steps; there is no tool for them.
3. **Customer: order at the table.**
   - Open the table link. The offer shows as "−15% · daily offer" at the discounted price.
   - Add it to the cart, review, then **confirm order and pay**.
4. **Customer: pay with PayPal.**
   - **Pay with PayPal** opens the PayPal window (JS SDK v6). Approve with a sandbox buyer.
   - The page says **Paid with PayPal** only after the server has captured the order and verified it with PayPal.
5. **Owner: results and evidence.**
   - **Campaign results**: units sold / reserved / left, plus PayPal gross / fee / net from verified captures.
   - **Evidence**: the order's timeline from intent → AI tools → approval → screen → quote → PayPal order → capture → settlement.
   - **Ledger**: every PayPal payment and what verified it.

## 2. What to look for

**PayPal (Orders v2, intent CAPTURE, JS SDK v6)**
- The browser never sends an amount. The PayPal order is created from the bill's frozen server quote, in integer cents.
  - `custom_id` = `bitpos:v1:<merchant>:<order>:<checkout>`
  - `invoice_id` is unique per checkout
  - payee is the shop's sandbox business account
- `onApprove` from the SDK is only a trigger; it is not proof of payment. The server captures, then checks these facts before marking the bill PAID:
  - order id
  - one purchase unit
  - reference id, custom id, invoice id
  - payee
  - currency and amount
  - a single, final capture
  - gross amount, not net

  Any mismatch blocks settlement for staff review, never auto-resolved (`apps/api/src/paypal/verify.ts`).
- **Idempotent and crash-safe.**
  - Each create and each capture keeps its own `PayPal-Request-Id`, reused on every retry.
  - A timeout or 5xx is "outcome unknown". The bill stays protected and the worker asks PayPal again; it never assumes failure.
  - Settlement happens once, in one database transaction (`supabase/migrations/402_paypal_settlement.sql`).
  - A late or duplicate payment is kept as RECOVERY, never dropped.
- **Webhooks.**
  - Offline signature verification (`webhook-verify.ts`).
  - A durable inbox, deduplicated by event id.
  - The event body is never trusted for money: the handler re-fetches the order or capture from PayPal.
- **Edge cases handled:**
  - cancel
  - declined instrument (the buyer can approve again)
  - PENDING review
  - voided PayPal order (the bill gets a fresh order)
  - quote expiry before capture
  - refunds and reversals as separate ledger events
  - an outcome unknown for 30+ minutes, shown as "needs review" while still protected

**AI agent (Gemini function calling)**
- Six tools only: `read_catalog_stock`, `read_recent_sales`, `read_merchant_limits`, `validate_campaign`, `save_campaign_draft`, `ask_owner`. None can publish, choose screens, charge or refund (`apps/api/src/paypal/agent-tools.ts`).
- Function calling runs in mode ANY: the model must call a tool every turn and asks questions only through `ask_owner`. This keeps small models such as `gemini-2.5-flash-lite` on the plan.
- Limits the owner typed are parsed by the server, in Thai and English: units, percent and end time, e.g. "ลดไม่เกิน 10%", "15% off", "before 5pm". They act as a second ceiling on top of the shop limits (max 20%, 50 units, 4 per order, 24 h).
- Every price comes from the existing promotion price function.
- At most 6 model calls per run. Every call and tool result is stored as a trace, and runs are capped per day.
- Prompt-injection text inside product names or the owner message is treated as data. Tested with a scripted model.
- The approved limits are enforced **by the database**: a trigger reserves campaign units when an order takes the offer price, so the cap holds under concurrent orders.
- There is a **rules-only form** baseline (no AI) for comparison and fallback.

## 3. Proof

- **Tests: 43 PayPal tests** (`tests/paypal-*.test.ts`). Unit tests cover the client, verification and webhook signatures. Integration tests run on a disposable PostgreSQL:
  - checkout and capture replays
  - unknown outcomes
  - a cross-bill PayPal order
  - overlapping and permanently refused captures
  - voided orders
  - review escalation
  - webhooks
  - the Copilot cap under orders
  - the agent refusing injected or out-of-limit proposals
- **Real sandbox and real model runs** (`evidence/`):
  - the Sandbox spike;
  - real Gemini runs (`ai-calls.md`), with every call listed;
  - a full browser run, Copilot draft → approve → table order → PayPal popup → SETTLED (`browser-e2e.md`).
- **Code review:** three review rounds on the PayPal code. Every finding was fixed, and the bugs got regression tests (commit history).

## 4. Run it locally (optional)

Requires Node 24, pnpm and PostgreSQL 17.

1. Create PayPal Sandbox REST credentials for a **US** sandbox business account. Thai sandbox merchants are declined at buyer approval.
2. Put them in `~/.bitpos-paypal/paypal-sandbox.env`. See `paypal.env.example` for the key names.
3. Copy `paypal-hackathon/local.env.example` to `.env` and fill in your user name and an `APP_SECRET`.
4. Run these from the repository root:

   ```bash
   pnpm install
   ```

   ```bash
   python3 -I tools/paypal/fixture-db.py up
   ```

   ```bash
   pnpm exec tsx tools/paypal/seed-demo.ts shop
   ```

   ```bash
   BITPOS_BACKEND_INTEGRATION=1 pnpm exec tsx --test tests/paypal-*.test.ts
   ```

The local preview uses `tools/paypal/dev-api.ts` (API on 3061), `dev-auth.ts` (local sign-in stub for the fixture) and `dev-worker.ts`, plus `astro dev --root apps/web --port 4361` with `BITPOS_WEB_API_ORIGIN=http://127.0.0.1:3061`. Optional: set a Gemini key in `~/.bitpos-paypal/gemini.env` for Café Copilot; without it, use the rules form.

## 5. New vs existing

BitPOS existed before this hackathon. Inherited parts:
- POS
- table ordering
- screens
- the promotion generator
- Solana devnet payments

Everything PayPal and Café Copilot was built from 31 Oct 2026 for this entry. [`PROVENANCE.md`](PROVENANCE.md) lists every new file and every pre-existing file that was touched, with dates.

New code:
- `apps/api/src/paypal/`
- `apps/web/src/components/paypal/`
- `supabase/migrations/400`–`405`
- `tools/paypal/`
- `tests/paypal-*`

## 6. Limitations (honest list)

- **Sandbox only.** Live mode is refused in code.
- **The demo merchant is a US sandbox business.** The Thai sandbox merchant was declined by PayPal at approval ("to comply with international regulations").
- **Screens.** Table orders need the shop's screen (a BitPOS Mini) to be online. If the Mini is offline, the table menu refuses new bills (`DEVICE_OFFLINE`) instead of taking an order nobody sees.
- **AI quota.** Café Copilot shares a small daily Gemini free-tier quota with the other BitPOS AI features. When it is used up, the rules form still works.
- **Hidden quote anchor.** The core schema prices every order against a Solana test asset. The PayPal shop keeps it hidden as a quote anchor; customers of this shop only see PayPal.
