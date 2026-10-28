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

## Messenger: not connected
The built-in browser is not signed in to Facebook (`facebook.com/pages/create` shows "Log in"; `developers.facebook.com/apps` shows "Page Not Found"). Creating the Page and Meta app needs the owner to sign in first; nothing was created.

## Running processes (stop when done)
cloudflared quick tunnel and `tools/meta/meta-server.ts`, both started in the background from this session. The Stripe endpoint points at a temporary URL: delete or update it when the tunnel changes.
