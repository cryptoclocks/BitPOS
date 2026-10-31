# BitPOS × Muse — for judges

**Meta Global Hackathon 2026 · Startup track · built 26 Oct – 4 Nov 2026**

BitPOS is a point-of-sale system for small Thai cafés. It existed before the hackathon. During the hackathon we gave it a **Meta-native customer layer**: the customer taps a phone at the counter, says yes once in Messenger, gets an offer picked by **Muse Spark**, and pays. Customers can also order by chat or voice, an AI agent can order through a **Model Context Protocol connector**, and the owner sets how far the AI may approve promotions on its own (**Allow All**).

> All payments are **Stripe sandbox · US test merchant · no real money**. The Meta app is in development mode, so Messenger only answers accounts that have a role on the app. The live demo uses the **Muse Café** demo shop (fixture menu, tables and accounts).

## What was built during the hackathon

| Flow | What happens | Where |
|---|---|---|
| **Tap → who are you** | An NTAG 424 DNA sticker produces a one-time SUN URL. The server checks the AES-CMAC and only accepts a higher counter, so copied links are refused. A new customer goes to Messenger (`m.me?ref=`) and consents with one button; a known customer is recognised at once. | `packages/meta-ai/src/ntag424.ts`, `apps/api/src/meta/identity.ts`, migrations 301–302 |
| **Offer on tap** | Muse Spark picks one offer from the owner-approved offers (a server-built enum) and writes a reason without numbers. The server computes every price. | `offer-select.ts`, migration 303 |
| **Pay** | Hosted Stripe Checkout at the server's re-quoted price. PAID comes only from a signed webhook or a server-to-server lookup; stock is taken once. Menu minor units (USD with 4 decimals) are converted exactly to Stripe cents. | `tap-checkout.ts`, `stripe.ts`, migration 304 |
| **Order by chat (Messenger)** | Consented customers type "ขอลาเต้ 1 แก้ว". Muse Spark picks the next step from an enum; the server quotes the price. The customer presses Pay, pays on Stripe Checkout and gets a receipt with a pickup code in Messenger. | `agent.ts`, `agent-orders.ts`, migration 307 |
| **Order by voice (web)** | The same agent on the shop's web page. The browser's own speech recognition (th-TH) turns speech into text, and the server receives text only. | `routes.ts` → `/meta/order` |
| **BitPOS Muse Connector (MCP)** | Tools: `list_menu`, `get_quote`, `complete_checkout` (Stripe Shared Payment Token), `pay_with_allowance` (the customer's auto-pay key), `order_status`, `cancel_order` (refund). The agent passes ids only; it never sets a price and never sees a card. | `mcp.ts`, `agent-orders.ts`, migration 306 |
| **Owner approval + Allow All** | Muse Spark drafts a promotion (product, percent and duration from server lists). The owner approves the first one. "Approve + Allow All like this" lets later drafts inside the same bounds apply automatically, up to a daily cap; the owner can stop any offer or revoke at once. Offers are written through the POS's own offer command. | `offer-policy.ts`, migration 308 |
| **Table booking by chat** | "จองโต๊ะ 2 คน 1 ทุ่ม" in Messenger or by voice. Missing date, time or party size is asked back; after a date the chat offers only free times within the shop's opening hours (owner settings: slot length and last booking before closing; closed days refused). A booking holds a table that has a BitPOS device with a sticker only from 5 minutes before to 15 minutes after the booked time; inside that window other customers' taps are refused. Messenger reminds the customer when check-in opens and tells them if it lapses (no-show), and the table is free again. Cancelling frees the time for others. | `reservations.ts`, migrations 309, 324, 325 |
| **Pre-order for a booked table** | Food ordered and paid in chat while holding a booking is tied to it. meta-pos keeps it out of the kitchen queue until the customer taps in at the table; the server refuses kitchen stages and hand-over before that. Shop rule: no refund if the booking lapses or is cancelled; the receipt says so and cancelling asks to confirm. | `reservations.ts` `linkPreorder`, `kitchen.ts`, `MetaOrders.tsx`, migrations 325, 326 |
| **Shop look** | Owners and managers set a cover photo, logo, tagline and theme colour in meta-pos. The customer pages (header, buttons, cover, name) and the Messenger welcome card use them, and the home page shows today's hours from the shop's opening hours. Images are accepted only as JPEG/PNG/WebP, checked by their first bytes. A colour is refused if white text on it would be hard to read (contrast below 4.5). | `look.ts`, migration 327 |
| **Chat cart with tool calling** | In Messenger and on the voice page, Muse Spark edits one stored cart through 8 server tools (get_menu, view_cart, add_item, set_quantity, swap_item, clear_cart, checkout, booking). Arguments are Zod-checked, at most 4 rounds, and any number the model writes is removed; the priced cart card comes from the server. Several items in one sentence also work without the model. | `cart-agent.ts`, `router.invokeTools`, migration 320 |
| **More ways to order** | *What to eat*: Muse Spark suggests up to 3 listed items from time of day, offers and the customer's own past orders. *Photo order*: Muse Spark matches a food photo to a listed item and says when it is unsure. *Live voice*: Muse Voice Transcribe streams the transcript while the customer speaks. *Whole table*: one recording is split by speaker (diarization) into one cart and one payment QR per person. *Tourist mode*: the menu in ja/zh/ko/fr/de/es, names translated once and cached. | `agent.ts`, `live-voice.ts`, `translate.ts`, migration 318 |
| **Promotions customers can see** | *Pair deals*: Muse Spark proposes two items and a 5–20% discount; after owner approval Muse Image draws a labelled AI picture and the cart prices the pair on the server. *Offer banners*: Muse Image adds the offer badge to the real menu photo, shown only after approval and only while the offer is live. A server-made looping animation plays in Messenger, on meta-pay and on the BitPOS Mini. | `combos.ts`, `banners.ts`, `anim.ts`, `gif.ts`, migrations 319, 322 |
| **Owner tools** | *Owner assistant*: Muse Wonder answers questions with 6 read-only, shop-bound tools (sales, top items, busy hours, stock, offers, bookings) and shows the data under each answer. *Count stock*: SAM 3.1 counts items in a shelf photo and draws the boxes; an owner or manager confirms. *Page post drafts*: Muse Image + Muse Spark draft a Facebook Page post; the server adds price and end time, and only the owner presses Post. | `owner-assistant.ts`, `vision.ts`, `social.ts`, migration 321 |
| **BitPOS Mini (device)** | The counter device shows the Stripe QR, the live offer animation and booking states, in English by default with a Thai button. Phones without NFC scan a short-lived "open Messenger" QR on the screen (150 s, at most 5 sessions), which starts the same flow as a tap. | `device/firmware/main/bitpos_meta.c`, migration 323 |
| **AI auto-pay allowance** | In Messenger the customer lets the AI pay for them for 1 day, 1 week, 1 month or 3 months, with a per-order and a total cap, and saves a card once on Stripe Checkout (setup mode). After that, chat orders are paid at once without a Pay button, and the customer's own agent can pay through the connector with a one-time allowance key (`pay_with_allowance`). The server checks the period and both caps with the allowance row locked; every charge sends a receipt with a Stop button; a declined charge falls back to the Pay button. Inside the Muse app each purchase still needs one Allow once (Muse rule). | `autopay.ts`, `cart.ts` `startCartAuto`, migration 328 |
| **Table screen** | A tablet or phone at the table shows the booking state with a live countdown: free / reserved from HH:MM / waiting for check-in (minutes left) / seated. No personal data; the link carries a key derived from the tap master key, and staff open it from their page. | `screen.ts`, migration 311 → `/meta/screen/<tag>` |
| **One shop, two platforms** | The shop's menu, tables and devices are shared with the existing POS. Meta orders live in their own ledgers; `meta_order_feed()` lists all orders with `platform` (pos / meta) and `channel` (tap / chat / mcp), every Meta change to shared stock is recorded in `meta_stock_movements`, and `meta_offer_origin()` marks offers that came from Meta drafts. | migration 310 |
| **Staff view + evidence ledger** | Staff sign in with their POS account (the role is re-checked on every request) and hand paid orders over once. Owners see every model call, tap, Stripe event and promotion decision. | `staff.ts`, `routes.ts`, migration 305 |

## Meta models

- **Muse Spark** (`muse-spark-1.3`, Meta Model API) chooses offers, chat steps, cart tool calls, suggestions, photo matches, pair deals and promotion drafts. It always uses structured output against an enum of server-built ids. No model output ever sets a price, quantity of money or payment state.
- **Muse Wonder** (`muse-wonder-1.0`, falls back to Spark) answers the owner assistant through read-only tools.
- **Muse Image** draws pair-deal pictures, offer banners and post drafts. Every such picture is labelled as AI-made and shown only after owner approval.
- **SAM 3.1** counts stock in a photo; **Muse Voice Transcribe** gives the live transcript and splits a table's order by speaker.
- Every call is recorded in `meta_ai_invocations`: task, model, outcome, latency, tokens, input and output hashes. The owner's ledger page shows them.
- A per-customer cap on model calls and a deterministic fallback keep the shop working when the model is unavailable.

## Try it

**MCP connector (no account needed):**

```bash
curl -s -X POST https://meta-pay.cashlessthailand.com/meta/mcp/11111111-1111-4111-8111-111111111111 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_menu","arguments":{}}}'
```

- The full agent run (quote → sandbox SPT → pay → status → cancel with refund) is in `tools/meta/mcp-smoke.ts`. It needs a Stripe *test* key to mint a sandbox SPT.
- Customer pages, webhooks and the connector run on `meta-pay.cashlessthailand.com`; the staff and owner pages on `meta-pos.cashlessthailand.com`. Both are separate from the existing POS hosts.
- Staff, owner, Messenger and tap flows are shown in the demo video. Live access can be arranged for judges, because the Meta app is in development mode.

**Tests:** 109 tests against PostgreSQL under row-level security (108 pass; the animation test is skipped when the resvg module is not available). Models and Stripe are stubbed in tests.

```bash
META_TEST_DATABASE_URL=postgres://… node --import tsx --test tests/meta-*.test.ts
```

## Safety rules the code enforces

1. Prices are server-side integers. The model chooses ids from server enums; its text may not contain digits, currency symbols or links.
2. Payment is proven only by a signature-verified Stripe webhook, a server-to-server Stripe lookup, or the PaymentIntent the server itself created, each matching amount, currency and order. Each event takes effect once, and stock is taken once.
3. Identity starts only after the customer consents in Messenger. Customers can leave with "Forget me" or STOP. Staff never see a customer's Messenger id, and message text is not stored.
4. Each tap is single-use: SUN counters only move forward, and tap sessions last 120 s.
5. AI auto-pay is the customer's own choice, bounded by time and two caps the server checks under a row lock; it stops at once on request and ends by itself.
6. Promotions: the owner approves first. Allow All is bounded and capped, every automatic approval is listed, and any of them can be stopped at once.
7. Test mode only: live Stripe keys are refused in code. Secrets live outside the repository.

## Honest limits

- **Not a listed Muse connector yet.** Muse connectors need review, and Stripe Shared Payment Tokens are not available in Thailand. The demo therefore plays the agent with our own client and Stripe's sandbox SPT helper, as a US test merchant.
- **Messenger app is in development mode.** Only accounts with a role on the app can chat until Meta reviews it.
- **Stickers.** The live demo used a simulated SUN tap (`tools/meta/sim-tap.ts`, which computes exactly what the chip would), until a physical NTAG 424 sticker is provisioned. Runs that used it are labelled as simulated.
- **Not used:** anything crypto in the Meta demo.
- **Not built:** a mass Messenger broadcast to all customers (it would need Marketing Messages opt-in). Customers get promotions when they tap or scan. Post drafts are not published automatically; only the owner presses Post.
- **Time zone:** bookings use Asia/Bangkok for every shop.

## What already existed before 26 October

The POS, table QR ordering, Solana devnet payments, the earlier voice copilot, the POS promotion editor and device queue, and the BitPOS device firmware all existed before the hackathon. See [PROVENANCE.md](PROVENANCE.md) and the generated [PROVENANCE_REPORT.md](PROVENANCE_REPORT.md): every new file carries the header `Meta hackathon work (2026-10-26..11-04)`, and every changed pre-existing file is listed with its reason.
