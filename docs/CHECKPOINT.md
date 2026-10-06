# Planning checkpoint — 2026-10-07

## User decisions

- Plan phases before application implementation.
- Create standalone `Desktop/BitPOS` repository.
- GitHub destination must use logged-in `cryptoclocks`, not the source repository owner.
- Extract all existing POS UI/features; CryptoClock connects through an adapter.
- Keep USDG/Solana, PromptPay, loyalty/NFT, AI and other discussed features in the phased scope.

## Completed locally

- Inspected POS source in two local checkouts, feature groups and storage/checkout behavior.
- Verified active GitHub login is `cryptoclocks`.
- Initialized new local repository on `main`.
- Wrote phased plan, source audit, architecture and work instructions.
- Recorded selected source hashes without copying application code or credentials.

## Limitations and remaining checks

- Source remote fetch failed with available account; remote freshness remains unknown.
- Candidate tracked snapshot: `/private/tmp/cashless-bilingual-push`, HEAD `ac673c3`; primary Desktop checkout POS paths are untracked.
- No POS runtime tests performed this round; no application implementation yet.
- No Supabase/OCI live topology inspected, no schema/auth migration or production change.
- No hardware/payment/AI/reward functionality implemented in this repository yet.
- GitHub create/push result must be checked in actual Git/CLI state; this checkpoint is not proof of a remote push.

## Next implementation work: Phase 1

1. Preserve chosen source snapshot in an extraction record; compare the two local POS versions.
2. Extract all 25 POS screens, reports, CSS, domain/service tests and their minimal Thai/English dependencies into this repo.
3. Replace website layout and app namespaces; keep a safe isolated demo adapter.
4. Run existing meaningful domain tests and role/language/page smoke checks; mark parity gaps explicitly.
5. Record new baseline and then move to Supabase schema/order lifecycle.

Do not start by rewriting every framework or deploying production. Do not reset source working trees to resolve unavailable source GitHub access.
