# 2026-10-27 — Muse and Stripe feasibility probe

## Muse (built-in browser, from Thailand)
- `muse.ai` and `platform.muse.ai` load from Thailand. Sign-in was not attempted.
- Connector guidelines (`platform.muse.ai/docs`): connectors must complete checkout inside Muse (a link to an external checkout does not qualify); payment tools are "sensitive writes" that need Allow once on every use; review needs business verification, a test account, and a description of testing without real charges; connector data may not be used for unrelated profiles or advertising.

## Stripe agent payments (docs.stripe.com, public preview)
- Agents pay sellers with a Shared Payment Token (SPT); the seller charges it with a PaymentIntent (`payment_method_data[shared_payment_granted_token]`).
- Sandbox test helper `POST /v1/test_helpers/shared_payment/granted_tokens` grants an SPT from `pm_card_visa`.
- SPT supported countries: US, Canada and listed European countries. Thailand is not listed.

## Not yet run
`tools/meta/stripe-smoke.ts` needs a test key in `~/.bitpos-meta/stripe-test.env`. Checked locally: it refuses a missing file and a non-test key.

## Country
- Test mode exists for every Stripe account country; only SPT (agent payments) is limited to US/Canada/Europe.
- Stripe support: a live account's country cannot change after activation. A sandbox created with "Create an account from scratch" can have its own country set under Business settings > Account details. Plan: a US-country sandbox for the agent-payment demo, labelled as such.

## Stripe module
`apps/api/src/meta/stripe.ts` + `tests/meta-stripe.test.ts`: `npx tsx --test tests/meta-*.test.ts` → 20/20 pass; `npx tsc --noEmit` → pass. No call to Stripe has been made yet.

## US sandbox (created 2026-10-27 in the built-in browser, at the user's request)
- Stripe account "CryptoClock" (live country Thailand, THB) → new sandbox **"BitPOS Meta US demo"** (`acct_1UVDEKJ3OQ9SsvzG`), created with "Copy live account to sandbox" turned off.
- Business settings > Account details > Country changed from Thailand to **United States** and saved; still shows United States after reload.
- The live account was not changed. The page says phone verification is needed only to process payments *from the Dashboard*; API test charges are expected to work without it (to be confirmed by the probe).

## Probe results against the US sandbox (2026-10-27, test mode, no real money)
`npx tsx tools/meta/stripe-smoke.ts` (key read from `~/.bitpos-meta/stripe-test.env`, output redacted):
- `GET /v1/account` → country `US`, default currency `usd`, livemode false.
- Card PaymentIntent (`pm_card_visa`, automatic payment methods, no redirects) → `succeeded`, 500 usd. (The first attempt with `payment_method_types` was refused by Stripe as no longer supported; the script was fixed.)
- SPT test helper → `shared_payment.granted_token` issued.
- SPT charged through `apps/api/src/meta/stripe.ts` → `SUCCEEDED`; retried with the same checkout id → the same PaymentIntent (no double charge).

Abuse checks with the same module (scratch script, not committed):
| Case | Result |
|---|---|
| Agent token capped at $5, quote $6 | FAILED, no PaymentIntent |
| Token used once at $5 | SUCCEEDED |
| Same token, new checkout | FAILED, no PaymentIntent (SPT is single-use) |
| Token backed by `pm_card_chargeDeclined` | FAILED `generic_decline` |

Conclusion: an agent-style payment (Shared Payment Token, the mechanism Muse uses through Link) works end-to-end in a US-country Stripe sandbox. Not covered yet: webhooks against real Stripe (needs a webhook endpoint or `stripe listen`), and an actual Muse agent.
