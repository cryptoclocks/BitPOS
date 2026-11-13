# BitPOS — PayPal AI Hackathon entry: Café Copilot + PayPal Checkout

> **This branch (`hackathon/paypal-2026`) is the PayPal AI Hackathon entry.** It is built on the **PayPal developer platform in the free PayPal Sandbox** and uses an **AI model (Google Gemini, function calling)** inside the product. Everything PayPal and Café Copilot was built from 31 Oct 2026; the BitPOS POS underneath existed before (see [provenance](paypal-hackathon/PROVENANCE.md)).

**What it does.** A café owner types what they want to sell, for example *"Sell the 8 croissants left before 4pm, at most 10% off"*. **Café Copilot** (Gemini with six server-side tools) reads stock, sales and shop limits, validates a time-limited offer whose price the server computes, and saves a **draft only**. The owner approves it, the offer appears on the shop's table menu, and customers **pay with PayPal**. The order is marked paid only after the server **captures and verifies the payment with PayPal**.

| PayPal developer platform (Sandbox) | AI in the product |
|---|---|
| **Orders v2 REST API**: create, capture, get; OAuth client credentials; a `PayPal-Request-Id` per operation for idempotent retries ([`client.ts`](apps/api/src/paypal/client.ts), [`checkout.ts`](apps/api/src/paypal/checkout.ts)) | **Google Gemini** `generateContent` with **function calling** (mode `ANY`), at most 6 calls per run, every call and tool result stored as a trace ([`agent.ts`](apps/api/src/paypal/agent.ts)) |
| **JS SDK v6** one-time payment session (`web-sdk/v6/core`, `createPayPalOneTimePaymentSession`) on the customer pay page ([`PayPalPayment.tsx`](apps/web/src/components/paypal/PayPalPayment.tsx)) | Tools: `read_catalog_stock`, `read_recent_sales`, `read_merchant_limits`, `validate_campaign`, `save_campaign_draft`, `ask_owner`; none can publish, charge or refund ([`agent-tools.ts`](apps/api/src/paypal/agent-tools.ts)) |
| Server-side **verification** of order id, purchase unit, `custom_id`, `invoice_id`, payee, currency, amount, a single final capture and the gross amount before PAID ([`verify.ts`](apps/api/src/paypal/verify.ts)) | Owner limits typed in Thai or English (units, percent, end time) are parsed by the server as a second ceiling; prices come from the server, never from the model |
| **Webhooks** with offline signature verification, a durable inbox and re-fetching the order from PayPal ([`webhook.ts`](apps/api/src/paypal/webhook.ts)); reconcile worker for unknown outcomes | The approved limits are enforced by the database (unit cap reserved per order) ([`404_paypal_campaign.sql`](supabase/migrations/404_paypal_campaign.sql)) |

**Project site:** **https://paypal.cashlessthailand.com** (overview, video, flow, proof).

**Try it (hosted, PayPal Sandbox, test money only):** merchant POS **https://paypal-pos.cashlessthailand.com** — press **Owner** under *Quick sign-in*, then open **PayPal · Copilot**. Order and pay as a customer at **[Table 2](https://paypal-pay.cashlessthailand.com/table/yxrYvMgnTEUp6rudweVNqxC-45Ans1jGqhMbAtBsZOk)** (the table screen is simulated on the hosted demo). Step-by-step guide for judges: **[paypal-hackathon/JUDGES.md](paypal-hackathon/JUDGES.md)**.

**Evidence:** a real Sandbox capture end to end in the browser ([browser-e2e.md](paypal-hackathon/evidence/browser-e2e.md)), every real Gemini call ([ai-calls.md](paypal-hackathon/evidence/ai-calls.md)), the hosted deployment and webhook check ([oci-deploy-2026-10-31.md](paypal-hackathon/evidence/oci-deploy-2026-10-31.md)), and 43 PayPal tests (`tests/paypal-*.test.ts`).

---

*The rest of this README describes the original BitPOS (Solana devnet edition) that this entry builds on.*

# BitPOS

**Cafe checkout that connects a Solana payment to a physical BitPOS Mini.**

Built by Natthapong Suwanjit. Merchant tablets create itemized bills; customers scan an order or table QR, order on their own phone and authorize a merchant-sponsored stablecoin transaction on Solana devnet. Finalized on-chain verification updates the bill, inventory and the assigned ESP32 display through a durable outbox.

## Tried in a cafe

### Watch: order and pay from the table

[![Watch the real table-ordering and payment video](RealUse/media/bitpos_table-preview.jpg)](https://youtu.be/kNcwEB3NNxY)

**[▶ Watch on YouTube — about 61 seconds](https://youtu.be/kNcwEB3NNxY)**

A phone order, USDG payment and the physical BitPOS Mini at the cafe table. Click the preview to watch on YouTube, with English titles and background music.

**Real hardware, a tablet, a phone and a cafe table.** Watch [table ordering and payment](https://youtu.be/kNcwEB3NNxY) or [tablet order to device QR](https://youtu.be/Yy9Dx9Kik-Q). See the [captioned field-trial gallery](RealUse/README.md) for all four recordings, three photos and provenance. The recordings show a devnet trial, not claimed commercial adoption.

## Review the submission

Start with the [English reviewer guide](docs/JUDGE_GUIDE.md), [development history](docs/SOURCE_PROVENANCE.md), [third-party notices](docs/THIRD_PARTY_NOTICES.md) and [submission checklist](docs/SUBMISSION_CHECKLIST.md). Watch the [two-minute English pitch](https://youtu.be/q8YXIrsTWXw) and [combined four-clip cafe demo with music](https://youtu.be/yuSbXrgXSh8). The original individual recordings remain available above.

## Try the application

- Product website: https://bitpos.cashlessthailand.com/
- Merchant POS: https://pos.cashlessthailand.com/
- Table ordering: https://pay.cashlessthailand.com/table/6LSn6twjmnvfGpDwTWm98p8S8o4CQqlZ8CwlK_nk1CY
- English reviewer overview: https://guide.cashlessthailand.com/judges/

The public merchant application intentionally offers Owner, Manager and Staff quick access for evaluation. This is a dedicated **Solana devnet** deployment; do not enter personal information or real funds. USDG here is the Paxos sandbox token, not redeemable money. Mainnet is disabled.

## Latest product updates — 13 October 2026

The submitted competition build and subsequent development have separate evidence. Read the [latest feature and evidence summary](docs/PRODUCT_UPDATES_20261013.md) for deployed extensions. Historical cafe recordings and payment acceptance remain unchanged.

- **AI promotions:** real Gemini drafts, merchant preview/approval, daily campaigns and customer-specific offers. Staff inspect a Mini from the floor plan and choose its promotion. An approved Espresso Deal reached the physical Mini with an authenticated render acknowledgment.
- **Multi-asset devnet payments:** USDG, official Circle devnet USDC and **BitPOS-issued USDT-test**. Server-frozen integer quotes preserve the original bill. USDT-test is not official Tether USDT.
- **Coffee Copilot / x402 V2:** order proposals, reviewed repeat orders and bounded USDC permissions. Actual devnet HTTP settlement and delegated-order evidence are separate from physical microphone/phone testing.
- **Pickup:** staff select an order and mark it ready; fulfillment is separate from payment and notifications retain the assigned device.

![Actual BitPOS Mini promotion screen](docs/media/mini-ai-promotion-20261013.png)

*Physical ESP32 native frame after LCD transfer, not a mockup. Gemini drafted the offer; the photo is an existing menu asset. Sound and optical camera capture are separate evidence.*

These extensions run on the existing OCI deployment. This documentation update does not publish the full post-submission implementation or certify every physical flow. Credentials, signing wallets and private operational evidence are excluded.

## Implemented

- Merchant menu/cart, customer records, deterministic wallet avatars, per-role server authorization.
- Table QR ordering and one BitPOS Mini pairing per tablet register; bills retain their original device and table assignment.
- Merchant-sponsored stablecoin transactions, frozen integer quotes and server verification of mint, recipient, amount, reference and signatures.
- Finalized-only settlement, inventory changes and durable device delivery; replay protection, reconciliation and authenticated render acknowledgments.
- Small-screen ESP-IDF/LVGL firmware, QR payment/order screens, status feedback, product carousel, animation and payment audio.
- English/Thai interfaces and local offline product documentation.

The current customer flow uses an order website and the Phantom in-app provider. AI offers require merchant approval. Native Actions/Blinks integration, loyalty/NFT rewards and full legacy POS feature parity remain planned or incomplete; presentation concepts do not certify runtime support. Browser signing fixtures are explicitly separate from physical Android Phantom testing.

## Why Solana

Low network fees suit small-value orders. Solana's separate fee-payer support lets the merchant sponsor network fees while the customer signs the stablecoin transfer. BitPOS uses its own sponsor adapter for supported devnet assets; Kora is a proposed integration, not a label for the existing adapter. [Official fee-sponsorship guide](https://solana.com/docs/payments/send-payments/payment-processing/fee-abstraction).

## One connected order

```mermaid
flowchart LR
    A[Merchant tablet or guest phone] --> B[Order and frozen quote]
    B --> C[Customer authorizes stablecoin payment]
    S[Merchant fee sponsor] --> C
    C --> D[Solana devnet]
    D --> E[Server verifies finalized payment]
    E --> F[Commit bill and stock]
    F --> G[Durable device outbox]
    G --> H[Assigned BitPOS Mini]
    H --> I[Render acknowledgment]
```

Each order retains its table/device identity. A counter bill goes to its register's paired screen; it is not broadcast to other tables.

## Source map

| Path | Purpose |
| --- | --- |
| `apps/web` | Astro / React merchant and customer interfaces |
| `apps/api` | TypeScript HTTP API, payment builder/verifier and device WebSocket |
| `apps/worker` | Finalization reconciliation and durable delivery |
| `packages` | Shared contracts, money and pricing rules |
| `supabase/migrations` | PostgreSQL tenant isolation and business schema |
| `device/firmware` | Standalone ESP32-S3 / LVGL terminal firmware |
| `infra/oci` | OCI application containers, public proxies and tunnel |
| `tests` | Domain, authorization, payment and recovery checks |
| `team-guide` | Offline HTML product documentation |

## Local setup

Use Node.js 24 and `pnpm@11.19.0`. Run `pnpm install --frozen-lockfile`, create a private `.env` from `.env.example`, configure a dedicated PostgreSQL/Supabase instance, and apply `pnpm db:migrate`. Start `pnpm dev:api`, `pnpm dev:worker` and `pnpm dev:web` in separate terminals. A funded devnet fee sponsor is required for real transactions; secrets and signing wallets are deliberately excluded.

Validation: `pnpm typecheck`, `pnpm test`, `pnpm build`. Some integration tests require an explicitly configured database and `BITPOS_BACKEND_INTEGRATION=1`; skipped tests do not prove integration success. Firmware build and identity-checked USB installation instructions are in `device/firmware/README.md` and `tools/firmware`.

See [OCI deployment](docs/OCI_DEPLOYMENT.md), [source provenance](docs/SOURCE_PROVENANCE.md), [firmware provenance](docs/FIRMWARE_PROVENANCE.json) and [photo credits](docs/CAFE_PHOTO_CREDITS.md). Hardware board/display foundations and brand references were inherited from CryptoClock Pro; the standalone BitPOS lifecycle, checkout, payment reconciliation, table routing and customer interfaces were developed separately. The original CryptoClock workspace is not needed to build this repository.

## Historical deployment acceptance — firmware 0.3.6

Web/API/worker, public proxies and the named tunnel run on OCI against the existing dedicated BitPOS Supabase database. The original cohort used firmware 0.3.6 over authenticated WSS. Latest promotion evidence uses firmware 0.3.9, as documented above. Three fresh sponsored devnet payments finalized while all Mac application services and tunnel connectors were stopped; all three received physical render ACKs. Observed backend-to-render latencies were 404 / 344 / 329 ms (three observations, not a p95 estimate or chain-finalization time). These three observations describe that acceptance cohort, not the total number of trials. Counter/table routing, one settlement per bill, inventory, duplicate submission, restart recovery, audio deduplication and customer Done returning to the table menu were checked. See [deployment acceptance](docs/DEPLOYMENT_ACCEPTANCE.md). The Mac was used as a test client/USB observer, not a server. Physical Android Phantom testing remains separate.

## License

Project-owned source code is licensed under [Apache-2.0](LICENSE), copyright 2026 Natthapong Suwanjit. See [NOTICE](NOTICE) and [third-party notices](docs/THIRD_PARTY_NOTICES.md) for scope and retained upstream terms. Logos, brand artwork and product illustrations are excluded from this source-code grant; trademark rights are not granted. Third-party photos and fonts retain their own licenses.
