<!-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. -->
# BitPOS Living Bill — guide for judges

**Track: Real-World Money.** Built at NEAR HACKATHON, 14 Nov 2026. Network: **NEAR testnet** (test tokens, no real money).

## What it is

BitPOS is a café point of sale that already existed on Solana devnet. For this hackathon we built a NEAR payment
rail for it, the **Living Bill**:

- **The bill is a contract entry.** The server opens it from its own frozen quote (exact total, token, expiry, who
  gets paid). The customer pays it with one `ft_transfer_call`. A wrong amount, an expired or voided bill, a second
  payment or the wrong token **bounces back to the payer by itself** — that is how NEP-141 receivers work.
- **One payment pays everyone.** In one receipt the contract pays the owner, a tax reserve, the staff who are on
  shift (payroll by the cup) and a supplier invoice that collects itself until it is funded. All transfers happen,
  or none.
- **The table device is a witness.** In witness mode the money waits in the contract until the BitPOS Mini at the
  table signs "I showed paid" with a key made on the device. The contract verifies that ed25519 signature. If the
  device never confirms, anyone can send the money back to the payer after the timeout.
- **Nobody needs NEAR.** The customer signs; the café's relayer pays the gas (NEP-366 meta transaction) — and only
  for a payment that is exactly this bill.

The problem: a small café pays tips, tax and suppliers by hand, days after the sale, from one mixed balance. Here
those payments are a side effect of the sale itself, and each one has a transaction link.

## What NEAR does here (concretely)

| NEAR feature | Used for |
|---|---|
| Contract in Rust (`near-sdk` 5.30) + NEP-141 `ft_transfer_call` | Exact-amount bills with automatic bounce |
| Promise batch (many `ft_transfer` actions in one receipt) | All-or-nothing split to up to 10 recipients |
| `env::ed25519_verify` | The witness device's signature is checked on chain, not by our server |
| Meta transactions (NEP-366) | Gasless payment; relayer restricted to "exactly this bill" |
| Function-call access key | The POS server's "cashier key" can only `open_bill`, `void_bill`, `merchant_refund` — it cannot move the shop's money |
| Named sub-accounts | `orbit.bitpos-near.testnet`, `mai.orbit…`, `tax.orbit…` on receipts instead of hex |
| Global contracts | The tUSD demo token is NEAR's global FT contract, used as deployed |
| NEAR Intents (1Click API) | **Preview only**: live dry quotes for paying the bill from Base/Solana/Arbitrum/Ethereum stablecoins. Intents has no testnet, so nothing is executed |
| NEAR AI Cloud | Café CFO: picks one recipe option from a server-built list; the response signature is verified against the attestation report fetched before the call |

## Live on testnet (read-only checks, no setup)

| | |
|---|---|
| Bills contract | [`bills.bitpos-near.testnet`](https://testnet.nearblocks.io/address/bills.bitpos-near.testnet) — build hash in `near-hackathon/near-deployment.json` matches `contracts/near-bills/release/near_bills.wasm` |
| Test token | `tusd.bitpos-near.testnet` (6 decimals) · Circle testnet USDC is also allow-listed |
| Demo shop | `orbit.bitpos-near.testnet` |
| One payment, four recipients | [transaction](https://testnet.nearblocks.io/txns/AZBjrRxtFupDW2Driq7w6ynEwiLE7EBuLDNkjBhwNHGG) — 5.00 tUSD in; owner 3.55, tips 0.50, tax 0.35, supplier 0.60 out, relayed gaslessly |
| 1 unit short → bounced | [transaction](https://testnet.nearblocks.io/txns/ijqwH8aghLYGyQfSvenBGdSjHs7TW5H4qXj8zk3Yjn4) |
| Witness escrow → device signature → split | [paid into escrow](https://testnet.nearblocks.io/txns/AjUpBfaxTaKZZeQSAStsnyAzZY3sb5uqrLagNuZ8AA5h), [`device_ack`](https://testnet.nearblocks.io/txns/DVJMGYTKwfJXc9o2TXJkksWXv8ZdUJySyabEGef6N81a) |
| No witness → refund after timeout | [`reclaim`](https://testnet.nearblocks.io/txns/GU4iWXzn7KzNGEMbkzL8dNgLNr5WK6Smymf5CUrqsjjs) |
| Through the POS server code | `near-hackathon/evidence/e2e-api-*.json` (instant and witness mode, with links) |

```bash
near contract call-function as-read-only bills.bitpos-near.testnet get_config json-args '{}' network-config testnet now
```

## Run it (do X — see Y)

Needs: Node 24+, pnpm, PostgreSQL 17 (`brew install postgresql@17`). Rust is **not** needed (a release build of the
contract is committed). Nothing here uses real money.

### A. Tests only — no NEAR account, about 2 minutes

```bash
pnpm install
python3 -I tools/near/fixture-db.py up            # disposable PostgreSQL on 127.0.0.1:55477, all migrations
sed -e "s/<you>/$USER/g" -e "s/^APP_SECRET=.*/APP_SECRET=$(openssl rand -hex 24)/" near-hackathon/local.env.example > .env
set -a; . ./.env; set +a
BITPOS_BACKEND_INTEGRATION=1 pnpm exec tsx --test --test-concurrency=1 tests/near-*.test.ts
```

See: `pass 25`, `fail 0`. The unit tests check the verifier against real testnet transaction results
(`tests/fixtures/near-tx-*.json`); the integration tests run real bills through PostgreSQL as the application role,
with an in-memory stand-in for the contract. No model or chain call is made.

```bash
cd contracts/near-bills && cargo test              # optional, needs Rust: 14 contract tests
bash tools/firmware/near-host-test/run.sh          # optional: firmware crypto + parser, 69 checks
```

### B. The contract on testnet with your own accounts — about 5 minutes

```bash
pnpm exec tsx tools/near/accounts.ts root <your-name>.testnet    # free testnet account from the faucet; key saved in ~/.bitpos-near
NEAR_ROOT=<your-name>.testnet pnpm exec tsx tools/near/setup.ts   # creates sub-accounts, deploys the contract + tUSD, registers the demo shop
pnpm exec tsx tools/near/e2e-chain.ts                              # four real cases; prints explorer links
```

See: `ALL PASSED` and a new file in `near-hackathon/evidence/`. Case A pays four recipients in one transaction;
case B bounces; case C refuses a forged device signature then accepts the real one; case D refunds after 30 s.

### C. The whole product locally

```bash
pnpm exec tsx tools/near/seed-demo.ts shop        # demo shop "Orbit Café"
pnpm exec tsx tools/near/dev-auth.ts &            # local sign-in stub
pnpm exec tsx tools/near/dev-api.ts &             # API on 127.0.0.1:3001 (+ NEAR reconcile lane)
pnpm dev:web                                      # web on http://127.0.0.1:4321
```

<!-- UI-STEPS -->

## What to look for in the code

- `contracts/near-bills/src/lib.rs` — about 400 lines. `ft_on_transfer` returns the full amount for anything that
  is not exactly an open bill; `payout` builds one promise with N transfers and a callback; `device_ack` verifies
  the witness signature; `reclaim` refunds after the window.
- `apps/api/src/near/verify.ts` — pure checks: `refuseDelegate` (the relayer pays gas only for exactly this bill),
  `verifyChainBill` (the bill on chain must equal the frozen server row field by field).
- `apps/api/src/near/bills.ts` — `advanceBill` is the single place an order becomes PAID, and only from the
  contract's state read at **final** finality. A wallet's answer, a browser callback or a relayer result is never
  proof of payment. No database lock is held across a chain call.
- `supabase/migrations/502_near_settlement.sql` — marking PAID, consuming stock, marking payouts and funding
  supplier invoices happen in one transaction, once, however many times it is replayed.
- `device/firmware/main/bitpos_near.c` — the device reads `get_bill` from NEAR RPC itself; it signs only when the
  chain says `Escrow` and names its own key.

## New vs existing

See [PROVENANCE.md](PROVENANCE.md). In short: the POS, quotes, stock, roles and the Solana rail existed; everything
under a `near` name was built for this hackathon. `git diff --stat near-hackathon-baseline..HEAD` shows it.

## Limits (honest list)

- **Testnet only.** Mainnet is refused in code and in the schema.
- **NEAR Intents is a preview.** Dry quotes show real mainnet prices; no cross-chain payment is executed.
- **Firmware not run on hardware.** The `near` firmware builds and its crypto/parser pass host tests, and its
  signature vector is accepted by the contract's unit test — but it has not been flashed to a BitPOS Mini. The
  simulated screen in the browser runs the same protocol, including its own chain check and signature.
- **Café CFO verification is partial.** We verify the response signature and that its signer is named in the
  attestation report fetched before the call. We do not verify the TEE hardware quote inside that report.
  Without an API key the CFO runs in a labelled sample mode and calls no model.
- **One alternative rail per shop.** An order is protected against "NEAR and Solana at once"; a shop that enabled
  both NEAR and PayPal on one database is not handled.
- **Refunds after settlement** are not on chain: once the split is paid out, a refund is a merchant decision
  outside this contract.
- The demo wallets ("Demo wallet (testnet)") are testnet accounts whose keys the server holds so a judge without
  a wallet can pay; a real wallet uses the same contract path.
- Menu, prices, staff and supplier of "Orbit Café" are sample data.
