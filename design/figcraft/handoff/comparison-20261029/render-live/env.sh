# Source me. Local throwaway stack only: fixture Postgres 55440 / database bitpos_render_fixture.
export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
export DATABASE_URL='postgresql://bitpos_app@127.0.0.1:55440/bitpos_render_fixture'
export ADMIN_DATABASE_URL='postgresql://cryptoclock@127.0.0.1:55440/bitpos_render_fixture'
export RENDER_API_PORT=3081 RENDER_AUTH_PORT=3091 RENDER_WEB_PORT=4482
export AUTH_URL="http://127.0.0.1:$RENDER_AUTH_PORT" AUTH_ANON_KEY='local-test-only-anon' APP_SECRET='local-test-only-secret-0123456789abcdef'
export PUBLIC_URL="http://127.0.0.1:$RENDER_WEB_PORT" SOLANA_RPC='https://api.devnet.solana.com'
export DEVNET_PRIVATE_DIR="${TMPDIR:-/tmp}/bitpos-render-empty-devnet"; mkdir -p "$DEVNET_PRIVATE_DIR"
export BITPOS_BACKEND_INTEGRATION=1 BITPOS_MOBILE_ENABLED=1 BITPOS_BIND_HOST=127.0.0.1 DOTENV_CONFIG_PATH=/dev/null
export BITPOS_WEB_API_ORIGIN="http://127.0.0.1:$RENDER_API_PORT"
