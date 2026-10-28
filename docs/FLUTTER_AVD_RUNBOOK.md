# Flutter AVD suites: how to run them on a clean local stack

Local only. Everything below uses a **disposable** Postgres database (`bitpos_delivery_fixture`, port 55440) and fixture APIs started from `tools/runtime/delivery-fixture-server.ts`. Nothing here touches the OCI server. Status on 2026-10-29: **41 of 42** suites pass; `dispatch-avd-location` needs the real driver app driven by hand (see the end).

## Common setup
- Postgres on `127.0.0.1:55440`; emulator `Pixel_10a` (`emulator-5554`).
- The wrappers hard-code old ports (`55436`/`55446` for the database, a different fixture API port per suite). On a copy of the tree, rewrite the database ports to `55440` with `sed`, and start one fixture API per port a wrapper names:
  `BITPOS_FIXTURE_API_PORT=<port> BITPOS_FIXTURE_AUTH_PORT=<unique> BITPOS_DELIVERY_FIXTURE_DB_PORT=55440 node --import tsx tools/runtime/delivery-fixture-server.ts`
  Do not commit those port rewrites.
- macOS `sed -E` has no `\b`; use `perl -pi -e` for any port remap.
- **Stale listeners:** if another session left servers on a port (3002, 3007, 3016–3023 were occupied by old processes from the main checkout), remap the suite to a free port in the wrapper *and* in the Dart test (`perl -pi -e 's/:3007(?!\d)/:3057/g'`), run, and map back. Never kill processes you did not start.
- OTP verification is throttled (10 per phone per window): `DELETE FROM bitpos.mobile_auth_limits` between runs.
- Fixture rows expire in real time (staff role grants after 1 hour, driver service grants and verification windows). When a suite starts failing with `AUTH_REQUIRED` or `FOOD_SERVICE_UNAVAILABLE`, restage or extend `platform_staff_role_grants.expires_at`, `driver_food_service_grants.valid_until`, `driver_profiles.verified_until` (with `SET LOCAL session_replication_role='replica'` on this disposable database only).

## Per suite
| Suite | Needs |
|---|---|
| `food-realtime` | pass an order id as argument; give that order's `food_shipments.account_id` to the OTP account of `+66900000001`; run with `BITPOS_FIXTURE_AUTH_PORT=55447` |
| `food-navigation` | stage first: `tsx tools/runtime/dispatch-http-smoke.ts --navigation-stage` (needs a fixture API on 3003); then a fixture API with `BITPOS_FOOD_NAVIGATION_FIXTURE=1`, `BITPOS_FOOD_ROUTE_ORIGIN=http://127.0.0.1:3043`, `BITPOS_FOOD_ROUTE_ATTRIBUTION='Synthetic BitPOS route fixture'`, `BITPOS_FOOD_TILE_ORIGIN=http://127.0.0.1:3043`, `BITPOS_FOOD_TILE_ATTRIBUTION='Synthetic BitPOS map tile fixture'` and `tools/runtime/food-navigation-local-provider.ts` on 3043; export `BITPOS_MOBILE_API=http://10.0.2.2:<port>/api/mobile/v1/`. The staged driver's service grant and staff grant must still be live (1 hour) |
| `food-idle`, `food-idle-gps` | `tools/runtime/food-idle-otp-fixture.ts` on 3999 plus a fixture API `--api-only` on 3008 with `BITPOS_FIXTURE_AUTH_PORT=3999`; `food-idle` also needs the standard OTP API (remap 3007) and the `+66900000002` driver's food service grants **disabled** (it starts from "no approved area"); `food-idle-gps` needs a live dispatcher grant with a live session |
| `mobile-push-settings` | argument `customer` or `driver` (add `--thai`); API with `BITPOS_PUSH_ENDPOINT_KEYRING_FILE` pointing at a locally generated keyring `{"active":"k1","keys":{"k1":"<base64 of 32 random bytes>"}}` (keep it out of the repository); port 3019 remapped if occupied |
| `reviews095` | run `reviews095-http-smoke.ts` first (API on 3040); it consumes one eligible order, so delete the rows of `mobile_food_reviews`/`mobile_food_review_commands` before each pair of runs; every branch of an eligible order must be enabled in `marketplace_branches` |
| `settlement-direct-earnings` | stage with `dispatch-http-smoke.ts --settlement088-http --direct` (APIs on 3003 and 3022); every API needs `BITPOS_SETTLEMENT_VERIFIER_DATABASE_URL=postgresql://bitpos_settlement088_fixture@127.0.0.1:55440/bitpos_delivery_fixture` (LOGIN role inside `bitpos_settlement_worker`) |
| `rider-r19-root-chat`, `driver100-history`, `customer-u21/u24`, `merchant-search`, `account-overview` | no extra fixture; run through their wrappers (they set the AVD size); `driver100` accumulates support cases per account, clear them between runs |

## Not reproducible hands-off
`dispatch-avd-location` verifies that background location reaches SQL after the real driver app was run in the foreground with GPS enabled (permission dialogs and a first foreground sample, then HOME and an `adb emu geo fix`). The staging script `dispatch-http-smoke.ts --avd-stage` only prepares the data; the foreground part was done by driving the installed app by hand. It needs a person or an adb-scripted UI walk-through.
