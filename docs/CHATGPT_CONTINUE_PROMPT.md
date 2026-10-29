# Prompt to continue BitPOS work (paste into ChatGPT/Codex with repo access)

You are continuing work in the git worktree `/Users/cryptoclock/.codex/worktrees/bitpos-h2-parallel/BitPOS` (branch from `codex/bitpos-demo-20261008`). Do not touch the MAIN checkout `/Users/cryptoclock/Desktop/BitPOS` except read-only. Nothing is committed yet; commit only if the owner asks. Never push, deploy, apply migrations to any real database, use real money, or commit secrets/keys/customer data. Solana stays devnet.

Read first: `AGENTS.md`, `docs/CHECKPOINT.md` (bottom sections are the newest), `.omp/work/h2-merchant-pricing-20261026/DIRECT_SESSION_PLAN_TH.md`, `.../DS58/handoff.md`.

Keep going without asking questions. Choose conservative defaults, record each decision in `docs/CHECKPOINT.md`, and report failures honestly.

## How to verify (all local, disposable)
- Own Postgres cluster: `/private/tmp/claude-501/-Users-cryptoclock-Desktop-BitPOS/0de6e500-7531-468f-b336-fb0d510839df/scratchpad/food/data` (port 55440, db `bitpos_delivery_fixture`, migrations 001-148 applied). Start: `LC_ALL=en_US.UTF-8 /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D <that dir> -o "-h 127.0.0.1 -k /tmp -p 55440" start`; env in `.../scratchpad/foodenv.sh`. If the scratchpad is gone, rebuild with `.omp/work/h2-merchant-pricing-20261026/DS57/apply-food-fixture.ts` (+ `--rest`, then migrations 143-148, enable `usdc-devnet` in `payment_assets`).
- Backend tests: `pnpm exec tsx --test --test-concurrency=1 tests/<file>.test.ts` with `BITPOS_BACKEND_INTEGRATION=1` (ride tests share one active fare row, so never run them in parallel).
- Flutter: `flutter test` in `apps/mobile-customer`, `apps/mobile-driver`, `packages/mobile_shared` (last: 297 / 244 / 178 pass). Contracts: `pnpm exec tsx tools/runtime/generate-mobile-contracts.ts --check`. Types: `pnpm exec tsc --noEmit -p .` (only pre-existing missing-playwright-path errors).
- AVD journeys (Pixel_10a, own fixture API on 3043 with `--import <scratchpad>/keepalive.mjs`): `tools/runtime/ride-joined-avd-smoke.ts`, `group-joined-avd-smoke.ts`, food journey scripts `food-joined-ui-smoke.ts` with `BITPOS_OWN_FOOD_FIXTURE=1`.

## Remaining work, in this order
1. Verify `backend-daily-catalog` and `backend-usdg-playlist` using the firmware consumer build recipe at the end of `docs/CHECKPOINT.md` (they were interrupted).
2. Investigate the pre-existing flaky race in `tests/backend-device-notify.test.ts` ("notification claim refresh ... obsolete metadata", fails ~half the runs even on HEAD's devices.ts). Fix in `apps/api/src/devices.ts` if the cause is a real race; do not weaken the test.
3. Group orders: delivery serving from a locked group (per-member, no parent payment); then recommendations ("order again" derived from the member's own paid orders, read-only).
4. Rides: staff screens for fare publication and incident review (platform administrator/support), retention/privacy policy for incident text (propose a default and document it), driver location during a trip (opt-in, short retention), route provider interface (keep estimator as fallback).
5. Notifications: only with an explicit account/device binding and customer opt-in (see AGENTS.md); no provider keys in the repo.
6. Items that need owner decisions or money movement stay CLOSED: ride payment/earnings, per-child parent payments, admission of coupon/schedule/refund migrations (096-137 candidates), wallet flows DS29/DS30. Document, do not build.
7. Finish with a regression pass (per-file loop over `tests/*.test.ts`), update `docs/CHECKPOINT.md` and `DS58/handoff.md`, and list what is still not done.

## Owner decisions (approved 2026-10-27) — do not ask again
1. Migrations 096-137 (coupon, schedule, refund candidates): stay CLOSED. Document each as "not supported / not admitted" in `docs/CHECKPOINT.md`; do not apply or build them (money-adjacent; the missing-feature record satisfies the no-silent-removal rule).
2. Physical-device runs: not in this round. Use emulator/fixture evidence and label every affected item "not verified on a physical device".
3. Production: you MUST NOT push, deploy, or run migrations against the OCI Supabase stack or any real database. Stop at local commits; the owner will push/deploy later.
4. Commits: allowed. Commit in coherent groups per DS package only after its tests pass. End messages with `Co-Authored-By` for the tool you run as. Never push. Never commit secrets, keys, customer data or scratchpad files.
5. Already-fixed defaults stay: rides closed until an admin publishes a fare; incident review is a note only; groups hold selections only (no price/payment); product delete = soft archive.
6. `backend-promotions-lifecycle` needs Pillow + a font; do not install anything. Skip it and record "skipped: missing PIL/font" in the checkpoint and the DS58 handoff.
7. If a step is blocked, record it in `docs/CHECKPOINT.md` and move to the next item; DS58 whole-scope acceptance is the LAST step and must list every closed/unsupported/unverified item explicitly.
8. Solana: devnet only, forever for this project. Do not plan or build mainnet migration.
