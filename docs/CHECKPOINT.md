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

## Completed locally

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

## Next implementation work: Phase 1

1. Preserve chosen source snapshot in an extraction record; compare the two local POS versions.
2. Extract all 25 POS screens, reports, CSS, domain/service tests and their minimal Thai/English dependencies into this repo.
3. Replace website layout and app namespaces; keep a safe isolated demo adapter.
4. Run existing meaningful domain tests and role/language/page smoke checks; mark parity gaps explicitly.
5. Extract store firmware per `FIRMWARE_EXTRACTION_TH.md`; isolate BitPOS product/config/OTA and replace original catalog readiness. Build and validate on a dedicated test device when that work begins.
6. Record POS/firmware baselines and then move to Supabase schema/order lifecycle and payment events.

Do not start by rewriting every framework or deploying production. Do not reset source working trees to resolve unavailable source GitHub access.
