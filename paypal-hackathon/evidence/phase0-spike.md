<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# Phase 0 — PayPal Sandbox spike

Status (31 Oct 2026, 16:10): **first real PayPal Sandbox capture verified on the server** (US sandbox merchant). Idempotency and duplicate-invoice behaviour confirmed. JS SDK v6 popup flow verified end to end (owner click → PayPal popup → onApprove → server capture + verify).

## Done

| Item | Result |
|---|---|
| Import current POS (D1) | 314 files from h2 `bb176462` staged (5 production SSH/ops scripts left out). Not committed. |
| Private docs (D7) | `paypal-hackathon/.gitignore` keeps strategy, research, setup handoff, video receipt, design and media private |
| Disposable DB | `tools/paypal/fixture-db.py` — own cluster on 127.0.0.1:55466, 174 migrations applied |
| Tests | see [phase0-test-baseline.md](phase0-test-baseline.md) |
| Private env | `~/.bitpos-paypal/paypal-sandbox.env` created (chmod 600, values empty) |
| Spike tools | `tools/paypal/sandbox-lib.ts`, `sandbox-smoke.ts` (CLI), `sdk-spike/server.ts` + `index.html` (JS SDK v6 page on 127.0.0.1:4329); typecheck clean; refuses non-sandbox URLs and empty credentials |

## Still to run (needs the owner)

1. Fill `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (app "BitPOS AI Hackathon 2026", Sandbox) and `PAYPAL_MERCHANT_ID` (sandbox business account ID) in `~/.bitpos-paypal/paypal-sandbox.env`.
2. Have a sandbox **personal** (buyer) account ready; approve payments in the browser yourself.
3. Then: `pnpm exec tsx tools/paypal/sandbox-smoke.ts create` → approve → `capture <id>` → `get <id>` → `idem <id>`, and the SDK page.

## Run log

| Time (ICT, 31 Oct) | Step | Result |
|---|---|---|
| ~15:40 | Save credentials (`set-credentials.ts --secret-stdin`, clipboard cleared) | OAuth OK, app `APP-7CU08328NX781191N`, token 32400 s, 19 scopes |
| ~15:41 | create USD 4.50 → `5VC91595PD777380B` | HTTP 200 (not 201), status `PAYER_ACTION_REQUIRED`, payee `YL65Q7MRPFC34`, custom/invoice ids echoed |
| ~15:50 | create USD 4.50 → `9YT040400W673894D` | same as above |
| ~15:55 | buyer approval with a **TH** sandbox personal account + card | PayPal page: "To comply with international regulations, this transaction has been declined." Order stays `PAYER_ACTION_REQUIRED` (no money moved) |

| ~16:20 | create USD 4.50 → `9LK52492HK050250K`; approval with a **US** sandbox personal account | Same decline page ("To comply with international regulations…"); order stays unapproved |
| ~16:35 | Owner created a US sandbox Business account + app "BitPOS PayPal Cafe US" (`APP-0BX14139X6341923V`); credentials stored privately (TH app copy kept as `paypal-sandbox.th-app.env`) | OAuth OK, 31 scopes |
| ~16:40 | create USD 4.50 → `9GA10264K77259045`, payee `7W75A4XNV2GZ4` | HTTP 200, `PAYER_ACTION_REQUIRED` |
| ~16:42 | Approved with the US sandbox buyer | order `APPROVED` (no money yet) |
| 16:04 UTC | **capture** (`PayPal-Request-Id` = stored capture id) | HTTP 201, order `COMPLETED`, capture `3NJ75207B63619939` `COMPLETED`, USD 4.50, `final_capture` true, gross 4.50 / fee 0.65 / net 3.85, custom_id + invoice_id echoed on the capture → **server verify 9/9 PASS** |
| ~16:45 | GET order + GET `/v2/payments/captures/{id}` | same facts, verify PASS |
| ~16:46 | S-02 create replay (same request id) after capture | HTTP 422 `ORDER_ALREADY_CAPTURED` (not the order body) |
| ~16:46 | S-03 capture replay (same request id) | HTTP 201, same capture id — no second capture |
| ~16:47 | S-04 capture with a **new** request id | HTTP 201, order `COMPLETED`, still exactly **1** capture (checked via GET) — no error, no second charge |
| ~16:50 | new order with the **same invoice_id** (`8KM46435KC381573L`): create OK, buyer approved, capture | HTTP 422 `UNPROCESSABLE_ENTITY` / `DUPLICATE_INVOICE_ID`, no capture |
| ~16:55 | JS SDK v6 page (127.0.0.1:4329) | `createInstance({clientId, components:['paypal-payments']})` OK, `isEligible('paypal')` = true; only host loaded: `www.sandbox.paypal.com`; `session.start()` opens a popup (Claude's click was blocked by the pane; owner click pending) |

| ~17:00 | SDK v6 page: owner clicked **Pay with PayPal** → popup → Pay | create `90K42085R55109128`; `onApprove` data = `{orderId, payerId, fundingSource:"paypal"}`; server capture HTTP 201 → capture `60868501X2803334W` `COMPLETED`, verify PASS; page showed paid from the **server** response. A second click created `3WL95950YL966723K`, left unapproved (expires, no money) |

Phase 0 gate: **PASSED** — a real sandbox capture reaches `COMPLETED` and is verified by the server, both from the CLI and from the JS SDK v6 popup. Spike server stopped.

Finding F1 (revised 16:20): the decline also happens with a US buyer, so the blocker is the **TH sandbox business (merchant) account**, not domestic TH→TH only. Public reports point to Thailand KYB/KYC rules; there is no PayPal-documented sandbox fix. Decision proposed: run the demo merchant on a **US sandbox business account** with its own sandbox app; state in the submission that the Thai merchant path is not verified in sandbox.

Earlier hypothesis: Finding F1 (to confirm with a non-TH buyer): PayPal does not allow domestic Thailand-to-Thailand payments; both default sandbox accounts are TH. Next: pay with a sandbox **personal account in another country (e.g. US)**. Product impact: a Thai café on PayPal can be paid by foreign (tourist/online) buyers, not by Thai PayPal buyers — the story and judge setup must say so; otherwise the demo merchant must be a non-TH sandbox business.

## Questions the spike must answer (fill in after running)

| # | Question | Answer |
|---|---|---|
| Q1 | Capture status | TH merchant: buyer approval itself is declined (F1). **US merchant: `COMPLETED`** immediately |
| Q2 | Create replay | After capture: 422 `ORDER_ALREADY_CAPTURED`. (Replay before approval not yet probed.) Reconcile must treat it as "look up the stored order id" |
| Q3 | Capture replay, same id | 201 with the same capture — safe |
| Q4 | Capture again, new id | **No error**: 201 returning the existing single capture. Plan 01 §5 assumed a 422 `ORDER_ALREADY_CAPTURED`; treat a 201 as "already captured" and verify the capture id |
| Q5 | Duplicate invoice_id | Create is accepted; **capture fails** 422 `DUPLICATE_INVOICE_ID` — a real second guard against double payment |
| Q6 | SDK v6 with clientId | Yes — init, eligibility, popup and onApprove work without a client token; popups must start from a real user click |
| Q7 | SDK hosts | Page load: `www.sandbox.paypal.com` only; popup host also `www.sandbox.paypal.com` |
| Q8 | Gross/fee/net | Present: 4.50 / 0.65 / 3.85 (fee shown so outcome can show gross vs net) |
