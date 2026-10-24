# Demo fee sponsorship — 2026-10-08

Decision: use the approved strict native BitPOS sponsor fallback for the devnet demo. **Kora is not installed, deployed or tested here; do not describe this flow as Kora.**

The bounded documentation evaluation reviewed the official [Kora overview](https://solana.com/docs/tools/kora/getting-started). Kora is a separate JSON-RPC paymaster with configurable program/token/account validation, rate limits and optional token fee payment. Its general fee-abstraction capability does not establish this application's order-specific authorization, quote expiry, durable sponsor budget or Token-2022 USDG compatibility. Adding and validating another operating service is not required to demonstrate the already approved native sponsor path.

## Native policy required before acceptance

- Verify devnet genesis and canonical USDG Token-2022 mint/decimals/extensions before constructing transactions.
- Build server-side from an unexpired canonical order; fixed payer, merchant treasury, amount and unique reference.
- Permit only the constructed transfer and, if policy permits, idempotent recipient ATA creation. No client-selected instructions or arbitrary recipients.
- Reserve durable per-order/day sponsor budget and apply rate limits. Sponsor pays SOL; the dedicated customer-no-sol wallet remains at zero SOL.
- Simulate, validate the exact returned transaction message and both signatures, persist the signed signature before submission, and reconcile uncertain submission without generating a replacement transfer.
- Independently inspect confirmed/finalized chain transactions. Confirmed means confirming; finalized verified settlement alone commits payment, stock and durable outbox.

Implementation and behavioral proof are tracked in `.omp/work/checkpoint.json` and sanitized acceptance evidence. This document records the decision, not a claim that every policy is already verified. Physical Android Phantom scanning/payment is user-deferred; browser/scripted test signers must be labeled.
