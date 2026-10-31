<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# Browser end-to-end run (local preview, PayPal Sandbox)

31 Oct 2026, ~20:50–21:00 ICT. Local fixture database, US sandbox merchant, real Gemini and real PayPal Sandbox.
Web 127.0.0.1:4361, API 3061, preview worker, sign-in stub `tools/paypal/dev-auth.ts`.

| # | Who | Step | Result |
|---|---|---|---|
| 1 | Owner | Sign in, open **PayPal · Copilot** | Workspace and recent campaigns shown |
| 2 | Owner | "Sell 12 cold brews before 10pm, max 15% off" → Draft with Copilot | Run `a003cdc9` DRAFTED; one `END_TOO_LATE` self-corrected; USD 4.50 → 3.83, 12 units, 4 per order |
| 3 | Owner | Approve → Confirm approval | Envelope `760d40fa` APPROVED v1 |
| 4 | Owner | Send to all screens (2) | Targets created; both fixture screens report `UNSUPPORTED` (no firmware connected) — the offer still applies to table orders |
| 5 | Customer | Table 2 menu | Cold brew shows "-15% · daily offer", USD 3.83 (was 4.50) |
| 6 | Customer | Add 1 → review → confirm | Order `6dc84408` AWAITING_WALLET; 1 campaign unit RESERVED |
| 7 | Customer | Pay with PayPal (popup, US sandbox buyer) | PayPal order `3C1324558H601882J` → capture `92B156007J967394K` COMPLETED, gross 3.83 / fee 0.62 / net 3.21, verified via capture response |
| 8 | System | Settlement | Order PAID, settlement SETTLED, unit CONSUMED |
| 9 | Owner | Campaign results + Evidence | 1/12 sold, USD 3.83 gross; evidence timeline intent → tools → approved → published → order → units → paypal_order → capture → settled → screen outbox |

## Bugs found by this run (fixed)

- No way to reopen a draft or stop a live offer after a reload → recent-campaigns list (API + UI).
- Campaign results returned 500 before the first sale: report formatter used the PayPal request-amount check, which rejects 0 → separate report formatter; dead in-transaction fallback query removed. Regression assertions added to `tests/paypal-copilot.test.ts`.
- Leftover Solana copy on PayPal pages: POS footer "Solana Devnet", table menu badge "Devnet", review hint about test assets and network fee.

## Known, not changed

- Fixture screens have no device capabilities, so screen delivery shows `UNSUPPORTED`; a real BitPOS Mini is needed to show the offer on a screen.
