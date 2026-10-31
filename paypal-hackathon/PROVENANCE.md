# BitPOS × PayPal AI Hackathon — provenance

This file tells judges which parts of the `hackathon/paypal-2026` branch were built for the PayPal AI Hackathon (submission period 1 Oct – 12 Nov 2026) and which already existed.

## Baselines

- Tag `paypal-hackathon-baseline` → `9eb34eab9e851bd5e9c061e5357c453eb1366196`: sanitized public BitPOS snapshot pushed on 24 Oct 2026 (shared by the four public hackathon branches).
- **Import commit (31 Oct 2026):** the current BitPOS POS code was copied, as one commit and without merging history, from `codex/bitpos-h2-local-scope-20261027` at `bb176462170bce409cc0973b348de60238ef4d44` (2026-10-31 02:24 +07:00). Paths: `apps/api`, `apps/web`, `apps/worker`, `packages`, `supabase` (migrations up to 176), `tests`, `tools/runtime`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`. Reason: the shared BitPOS database already runs these migrations; PayPal code must run against the same schema. This is pre-existing BitPOS work (also used by other BitPOS entries), **not** PayPal hackathon work.
- Left out of the import: production ops scripts that reach the server over SSH (`backup-bitpos-db.py`, `coffee-copilot-deploy.py`, `coffee-copilot-private-env.ts`, `repair-infra.py`, `try-apps-oci.sh`), `infra/`, mobile apps, design files, docs and media.
- Show the PayPal work only: `git diff --stat <import commit>..hackathon/paypal-2026`.

## Pre-existing functionality (not claimed)

POS and table QR ordering, versioned quotes and stock, promotion drafts with merchant approval and device delivery, Solana devnet payments (USDG/USDC/USDT, x402, delegated payments), the coffee voice copilot, pickup/fulfillment, food delivery and rider tools, BitPOS Mini firmware.

## Built for this hackathon

Conventions: every new file starts with `PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.` New code lives only in `apps/api/src/paypal/`, `apps/worker/src/paypal-*`, `apps/web/src/components/paypal/`, `apps/web/src/lib/paypal-*`, `supabase/migrations/4xx_paypal_*`, `tests/paypal-*`, `tools/paypal/`, `paypal-hackathon/`. Every pre-existing file that is touched is listed below.

| Date | Files | What |
|---|---|---|
| 2026-10-31 | `paypal-hackathon/IMPLEMENTATION_PLAN_TH.md`, `paypal-hackathon/plan/*` | Implementation plan, specs, tests, deploy and daily plan |
| 2026-10-31 | `paypal-hackathon/design/pp-edition/*` (private, not committed) | FigCraft PayPal design edition, see below |
| 2026-10-31 | `tools/paypal/fixture-db.py` | Disposable PostgreSQL for this branch (port 55466), all migrations |
| 2026-10-31 | `tools/paypal/sandbox-lib.ts`, `tools/paypal/sandbox-smoke.ts`, `tools/paypal/sdk-spike/*` | Phase 0 PayPal Sandbox spike tools (Orders v2 create/capture/get, idempotency probes, JS SDK v6 page) |
| 2026-10-31 | `paypal-hackathon/evidence/phase0-*.md` | Phase 0 test baseline and spike record |

### Pre-existing files touched
_(none yet)_

## Development tools disclosure

Planning, code and design work in this branch is assisted by Claude Code (Anthropic) and, earlier, Codex. The in-product AI feature (Café Copilot) uses Google Gemini through the server. Distinguish both in the submission.

---

## Planning-time disclosure (12 Oct 2026, kept for history)


Planning baseline: **12 October 2026 (Asia/Bangkok)**. This file is a disclosure scaffold, not proof of a completed PayPal entry.

## Repository baseline

- Repository: [cryptoclocks/BitPOS](https://github.com/cryptoclocks/BitPOS).
- Observed branch: `codex/bitpos-demo-20261008`.
- Observed HEAD: `a79544fc4d01114188d209d48d371671dcafaa90`.
- The working tree was dirty and had an active OMP owner for `post-submit-20261012`. HEAD does **not** capture all current local work. No source freeze, release tag or public push was performed for this planning task.
- The PayPal submission period started on 1 October 2026. BitPOS's public Git history starts on 7 October, but its CryptoClock/Cashless foundations predate it. Do not describe all source as newly created for PayPal.
- A PayPal planning baseline on 12 October is useful for attribution, but it is not the competition's start date. Preserve both dates and the actual development history.

See [existing provenance](../docs/SOURCE_PROVENANCE.md), [third-party notices](../docs/THIRD_PARTY_NOTICES.md), [license](../LICENSE) and [checkpoint](../docs/CHECKPOINT.md).

## Status at planning time

| Capability | Observed basis | PayPal entry treatment |
|---|---|---|
| Merchant/customer UI, table QR, versioned quotes, stock and device routing | Existing source and prior checkpoint | Reused BitPOS foundation; not a new PayPal feature |
| Sponsored USDG Solana devnet settlement and physical Mini paid display | Prior acceptance recorded in `docs/DEPLOYMENT_ACCEPTANCE.md` / checkpoint | Existing devnet evidence; does not prove any PayPal payment |
| OCI application deployment | Prior checkpoint | Existing infrastructure; not freshly reverified in this task |
| Pickup / firmware 0.3.7 | Active local slice A; review repairs and host/build evidence, fresh review/physical acceptance still pending in checkpoint | Shared work in progress; identify actual author/date/commits when integrated |
| Multi-asset USDC/USDT | Active planned slice B; funding/implementation acceptance incomplete | Not a prerequisite for PayPal; do not claim all assets are live |
| AI Promotions | Approved shared slice C; checkpoint reports missing actual provider/model/budget configuration | Reuse implementation when verified; no claim of a working model today |
| PayPal create/capture/webhook/reconciliation | Not implemented or tested by this planning task | New proposed integration |
| PayPal-based campaign outcome | Proposed | New feature requiring actual verified sandbox data |
| Bounded surplus/time-limited stock campaign, AI tool trace and evidence trace | Proposed in strategy revision on 12 October | New planned scope; no implementation, user validation or waste-reduction proof yet |
| Full legacy 25-page POS parity | Existing provenance explicitly says incomplete | Keep the gap disclosed; this plan does not certify parity |
| New `PayPal/` package | Created in this task | Planning and submission preparation only |

## Evidence to add during development

| Work item | Commit / diff | Test evidence | Claim allowed today |
|---|---|---|---|
| PayPal quote + provider ledger | Pending | Pending | Planned |
| Server create/capture verification | Pending | Pending sandbox transaction | Planned |
| Verified webhook inbox + recovery | Pending | Pending authentic sandbox event and failure checks | Planned |
| Real AI draft + merchant approval | Pending; disclose shared slice C work | Pending provider/model/config + reviewed output | Planned |
| Offer-to-capture attribution/outcome | Pending | Pending computed aggregates | Planned |
| Approved quantity/time/discount envelope and typed AI tools | Pending | Pending concurrency/policy/tool-trace tests | Planned |
| Merchant discovery and manual/rules/AI comparison | Pending | Pending consented formative observations and full samples | Planned |
| PayPal Mini display / browser terminal | Pending | Pending simulator and separate physical evidence | Planned |
| English judge setup + video | Pending | Pending fresh run and public YouTube URL | Draft only |

Update this table with actual commits, timestamps and redacted evidence paths. Work already shared with Crypto World's Fair must be disclosed as shared work, even if created within PayPal's calendar window. Do not invent exclusivity, a previous submission acceptance, or a permission to enter both events.

Before submission, record an immutable entry tag/commit, a clean reproducible build, the inherited-versus-added diff and all material third-party/AI/media attribution. Keep private payment payloads, credentials, customer data and device backups outside Git. Sandbox transaction evidence and simulator fixtures must remain distinguishable from live-money and physical-device evidence.

The owner requested a strategy aiming for an 80% chance of winning. That probability is not established. The revised strategy, internal review score and usability targets must not be represented as measured win probabilities or achieved results.

## PayPal design edition (FigCraft) — 31 October 2026

- Built `paypal-hackathon/design/pp-edition/BitPOS-PayPal-Platform-UI.figcraft` from the Solana master `design/figcraft/BitPOS-Platform-UI.figcraft` (SHA-256 `1d606e2a…c33145`, unchanged) with `build/build_pp_edition.py`.
- Inherited (pre-existing BitPOS design, re-themed): 167 frames themed only, 46 frames with payment content rewritten from Solana devnet to PayPal Sandbox. New for this hackathon: 67 frames (PPN-01…64, 2 Thai variants, directory N09). Removed: 11 Solana-only or third-party-reference frames, 1 merged.
- Every frame carries an `INHERITED · …` or `NEW · PayPal edition` badge. All data is sample data; PayPal windows are schematics, not PayPal UI.
- Produced by Claude Code subagents (inventory analyst, product designer, builder, three SVG screen designers, independent QA) under orchestrator review; process in `design/pp-edition/PROCESS_TH.md`, QA in `design/pp-edition/reports/qa-review.md`.
- This is design work, not evidence of a working PayPal integration. Not committed yet (derived from the private master).
