# 2026-10-28 — Public tunnel and real Stripe webhook

## Setup (this Mac only; the OCI actual-use stack and its named tunnel were not touched)
- `cloudflared` 2026.10.5 installed with Homebrew (owner approved). Quick tunnel: `cloudflared tunnel --url http://127.0.0.1:3101` → `https://himself-flower-aug-discuss.trycloudflare.com` (temporary; changes on every run).
- `tools/meta/meta-server.ts`: serves only `/meta/*` (everything else 404), against the disposable PostgreSQL (`127.0.0.1:55433`, refuses non-local DB URLs), application queries as `bitpos_app` under RLS, Muse Spark offers on. Config only in `~/.bitpos-meta/meta-server.env` (600): generated tap master key and Messenger verify token, Stripe sandbox test key and webhook secret, Meta API key.
- Code: Messenger is now optional in `metaRouteDepsFromEnv`. Without it the Messenger webhook answers 503 and the Stripe routes still work.

## Checks from the public internet
| Request | Result |
|---|---|
| `GET /meta/offer-page` (no cookie) | 401 |
| `GET /api/menu` | 404 (rest of the API not exposed) |
| `POST /meta/stripe/webhook` with a forged signature | 400 `WEBHOOK_INVALID` |

## Real Stripe webhook delivery (sandbox "BitPOS Meta US demo")
- Endpoint `we_1UVKemJ3OQ9SsvzGzGkWPwHL` → `/meta/stripe/webhook`, event `payment_intent.succeeded`, livemode false; signing secret stored only in the private env file.
- One tap order seeded in the disposable DB (`9d6046e8-…`, THB 50.00, stock 4). Sandbox PaymentIntent `pi_3UVKfXJ3OQ9SsvzG1xwMDCwO` (THB 5000 minor, `pm_card_visa`, metadata = that order) → `succeeded`.
- Stripe delivered `evt_3UVKfXJ3OQ9SsvzG1foEZYGT` through the tunnel; Stripe reports `pending_webhooks = 0`.
- Database after delivery: order `PAID`, `paid_source=webhook`, payment intent recorded, stock 4 → 3, one row in `meta_stripe_events`, `stock_short=false`.

## Messenger: connected and tested live (update, same day)
- After the owner signed in to Facebook, the Page "Bitpos Muse Demo" (`1359946487210863`) and a Meta app (development mode) were created. The owner entered the passwords and connected the Page; I never entered a password.
- The webhook was set server to server through the Graph API (`POST /{app}/subscriptions`, fields `messages`, `messaging_postbacks`, `messaging_referrals`; `POST /{page}/subscribed_apps`). Meta's verification GET returned 200. The Page has a Get Started button and a greeting that says it is a hackathon test page. The app secret and the Page token are stored only in the private env file.
- In the disposable DB, merchant A points at the real Page and the fixture Page `100000000001` is retired. **This must be reversed before running the integration tests.**
- Tag `demo-01` (random UID, merchant A) was registered. Taps were made with `tools/meta/sim-tap.ts` (simulated SUN; anyone holding the master key can mint one, so this is not a physical sticker).

| Time (ICT) | Event | Result |
|---|---|---|
| 12:12 | tap, counter 1 | 303 → `m.me/1359946487210863?ref=…`. The owner opened Messenger, but no webhook event came back |
| 12:14 | same URL again | 409 (replay refused) |
| 12:16 | tap, counter 2 | 303 → m.me |
| 12:17:23 | Messenger POST (referral) | 200, signature verified |
| 12:17:32 | Messenger POST (consent accepted) | 200. `meta_customer_links` row (consent `bitpos-meta-offers-v1`, not revoked); tap session counter 2 `bound_at` 12:17:32 |
| 12:17:39 | magic link `GET /meta/login` | 200 "เชื่อมต่อแล้ว ✓" page with the Forget me button, session cookie set |

- Four `GET /` 404s at 12:17:36 were link-preview fetches. Nothing outside `/meta` is served.
- **Offer not shown:** `meta_offer_impressions` is empty for `demo-01`. No merchant in the disposable DB has an active price version (`merchant_pricing` is empty), so `approvedOffers` has no candidates and no offer is invented. The offer and checkout path is covered by the integration tests with a stub menu, and by the OCI stack once the owner approves a real promotion.

## Running processes (stop when done)
cloudflared quick tunnel and `tools/meta/meta-server.ts`, both started in the background from this session. The Stripe endpoint points at a temporary URL: delete or update it when the tunnel changes.
