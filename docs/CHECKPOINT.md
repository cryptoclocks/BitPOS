# Planning checkpoint — 2026-10-07

## User decisions

- Plan phases before application implementation.
- Create standalone `Desktop/BitPOS` repository.
- GitHub destination must use logged-in `cryptoclocks`, not the source repository owner.
- Extract all existing POS UI/features and a separate store firmware derived from CryptoClock Pro. Keep store firmware in `device/firmware/` inside BitPOS; legacy/home CryptoClock connects through an optional adapter.
- Keep USDG/Solana, PromptPay, loyalty/NFT, AI and other discussed features in the phased scope.
- Create an offline website inside BitPOS explaining the entire product, diagrams and phases to hackathon teammates; no hosting/deployment requested.
- Make the guide purple, reuse the existing BitPOS product illustration and create BitPosClock screen mockups using the explicitly named `CryptoClockPro/resources/design-system/reference/SKILL.md`.
- Add a product-value section explaining merchant/Solana benefits and why the plan selects the CryptoClock Pro 3.5-inch touchscreen base and USDG.
- Create separate devnet wallets for every test role, keep the keys on this Mac, acquire free devnet SOL/test assets and distribute enough resources for experiments.

## Completed locally

- Created 19 unique role wallets in `/Users/cryptoclock/Desktop/BitPOS-Devnet-Private`, outside the repo, with Solana JSON keypairs and base58 import files. Verified key/import/address agreement and private directory/file permissions 700/600. Original wallets were not reused.
- Added `tools/devnet/` for idempotent setup, cluster validation, SOL funding/distribution, official Paxos devnet USDG faucet requests, public snapshot export, live transfer/sponsorship smoke checks and verification. Fixed RPC/genesis checks to devnet; journal signatures before broadcasting and refuse blind smoke resubmission. No BitPOS program was deployed.
- Added an offline public-only wallet dashboard at `devnet/index.html`, linked from the team guide and README, plus `DEVNET_WALLETS_TH.md`. Dashboard browser QA passed at desktop/390px with 19 cards, zero failed resources, zero external requests and no horizontal overflow. Handbook QA still passes its 16 sections/25 POS features/12 payment fixtures.
- Inspected official devnet USDG mint `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7`: Token-2022, 6 decimals; transfer fee is 0 and transfer hook inactive at inspection time. Funding snapshots use actual confirmed token-account balances, not API request acknowledgments.
- Received and verified **100 Paxos USDG test tokens in every one of the 19 wallets, 1,900 total**, via permissionless sandbox requests spaced at least 61 seconds. Token accounts match the canonical devnet mint/program and their role owners. No mock USDG was issued. The `customer-no-sol` wallet has 100 USDG and intentionally zero native SOL.
- Inspected 23 PoW specs in the cookbook-linked faucet program on devnet; no funded, net-positive pool at practical difficulty was available. Public RPC airdrop failed/internal error then 429; alternate free providers/faucets either depend on the same exhausted/rate-limited faucet, are paused or require human authentication/eligibility. No CPU mining or paid SOL purchase was performed.
- Inspected POS source in two local checkouts, feature groups and storage/checkout behavior.
- Verified active GitHub login is `cryptoclocks`.
- Initialized new local repository on `main`.
- Created private GitHub repository `https://github.com/cryptoclocks/BitPOS` and pushed the planning commit to `main` successfully.
- Wrote phased plan, source audit, architecture and work instructions.
- Recorded selected source hashes without copying application code or credentials.
- Inspected firmware CMake/components, partition table, event/bootstrap dependencies and OTA runbook; added Phase 1B, firmware extraction plan and target directory README.
- Read-only OCI audit completed on 2026-10-07: ARM64/4 CPUs, about 10.17 GiB RAM available and 31.98 GiB disk available; two healthy Supabase stacks plus rehearsal services. Docker build cache is zero; five unreferenced dangling candidates have only about 317 kB combined unique size. See `OCI_PREFLIGHT_TH.md` and local evidence under `Desktop/OCI`.
- Created `team-guide/` offline handbook and `START-HERE.html`: now 16 sections, interactive architecture, 25 POS features, 8 phases, 5 SVG collectible concepts, payment/reward simulations, campaign calculator, local Thai fonts and print support. This is documentation/fixture UI, not application implementation.
- Added `#benefits` as chapter 02 with four rationale cards, a value-loop infographic and pilot metrics: merchant value, Solana ecosystem value, dedicated CryptoClock Pro 3.5-inch screen base and USDG choice. Hardware stays optional; USD/THB quotes/off-ramp costs are distinguished from the dollar peg; no inferred sales lift or prize advantage is presented as proven. Official issuer/Solana/listing sources linked and documented in `PRODUCT_VALUE_TH.md`.
- After the value-section change, existing handbook browser QA passed with 16 sections and no external requests, failed resources or page errors. Reviewed the new desktop section and mobile device/USDG cards; chapter numbers run 01–16 and mobile body has no horizontal overflow. Refreshed the offline ZIP for team handoff.
- Applied the purple palette across handbook/diagrams/SVG downloads, added the verified legacy BitPOS illustration and its provenance, and built `team-guide/clock/`: an offline 18-screen BitPosClock gallery with triggers/contracts/phase mapping, individual 480×320 PNGs and overview/contact sheets. Design follows the requested skill with purple overriding its default teal. See `BITPOSCLOCK_DESIGN_TH.md`.
- Local Chrome browser QA passed: all 18 PNGs render at 480×320 with no text/card overflow; gallery selection/filters/keyboard/deep links/handbook navigation and 390/320 responsive layouts work; handbook 12 payment fixture scenarios, diagram/export, POS filters, campaign math, search/menu and print layout pass. Offline `file://` contexts observed zero external requests, failed resources or page errors. These are browser checks, not live chain/hardware checks.
- Team handoff ZIP is generated with `python3 tools/package-team-guide.py` at `artifacts/team-guide/BitPOS-Team-Guide.zip` (ignored output). It contains local HTML/fonts/assets, mockups and documentation; the user can unzip and double-click `START-HERE.html`. QA outputs live under `artifacts/team-guide/`; build dependencies are only needed to regenerate them.

## Limitations and remaining checks

- Source remote fetch failed with available account; remote freshness remains unknown.
- Candidate tracked snapshot: `/private/tmp/cashless-bilingual-push`, HEAD `ac673c3`; primary Desktop checkout POS paths are untracked.
- No POS runtime tests performed this round; no application implementation yet.
- OCI capacity and Docker/Supabase runtime topology inspected; BitPOS data/Auth boundary and backup/restore remain unverified. No schema/auth migration, cleanup, restart, deployment or production configuration change performed.
- No hardware/payment/AI/reward functionality implemented in this repository yet.
- Devnet reserve received 10 SOL. Distributed starter funds to 17 recipient roles; reserve retains 9.31995 SOL and customer-no-sol intentionally remains zero. Four live devnet USDG transfer/refund transactions confirmed, including sponsored payment/refund with a zero-SOL customer; token round trips restored all 19 wallets to 100 USDG each (1,900 total). Fees plus distribution cost 0.00005 SOL; total remains 9.99995. Starter verification passed unique keys/imports, 700/600 permissions, SOL and USDG targets. Full 16 SOL profile has not been filled. These are wallet transfer tests, not Kora/POS/NFT/hardware validation. Updated local handbook payment plan with Solana Pay, Kora sponsorship policy, Kit/Wallet Standard, conditional Commerce Kit evaluation and Surfpool tests; no new payment runtime installed. Handbook offline browser QA passes 16 sections, 25 POS features and 12 fixture scenarios, zero external requests/errors and mobile overflow.

## Next implementation work: Phase 1

1. Preserve chosen source snapshot in an extraction record; compare the two local POS versions.
2. Extract all 25 POS screens, reports, CSS, domain/service tests and their minimal Thai/English dependencies into this repo.
3. Replace website layout and app namespaces; keep a safe isolated demo adapter.
4. Run existing meaningful domain tests and role/language/page smoke checks; mark parity gaps explicitly.
5. Extract store firmware per `FIRMWARE_EXTRACTION_TH.md`; isolate BitPOS product/config/OTA and replace original catalog readiness. Build and validate on a dedicated test device when that work begins.
6. Record POS/firmware baselines and then move to Supabase schema/order lifecycle and payment events.

Do not start by rewriting every framework or deploying production. Do not reset source working trees to resolve unavailable source GitHub access.
