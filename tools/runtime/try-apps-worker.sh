#!/bin/bash
# LOCAL-ONLY worker for the hand-try stack (bitpos_try_fixture). See docs/TRY_APPS_LOCAL_TH.md.
cd "$(dirname "$0")/../.."
export DOTENV_CONFIG_PATH=/dev/null DATABASE_URL='postgresql://bitpos_app@127.0.0.1:55440/bitpos_try_fixture' ADMIN_DATABASE_URL='postgresql://cryptoclock@127.0.0.1:55440/bitpos_try_fixture' AUTH_URL='http://127.0.0.1:3044' AUTH_ANON_KEY='fixture-no-provider-key' APP_SECRET='try-apps-fixture-only-not-a-real-secret-00000' PUBLIC_URL='http://127.0.0.1:4321' SOLANA_RPC='https://api.devnet.solana.com' DEVNET_PRIVATE_DIR='/tmp/bitpos-try-no-wallets' BITPOS_MOBILE_ENABLED=1
exec pnpm exec tsx apps/worker/src/index.ts
