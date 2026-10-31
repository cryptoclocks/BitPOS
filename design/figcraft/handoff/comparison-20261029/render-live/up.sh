#!/bin/zsh
# Start fake auth, the real API and the built web app (detached). Run setup-db.sh and `tsx seed.ts users` first.
# Pass --build to rebuild apps/web into the private outDir apps/web/dist-render-live (deleted by down.sh).
cd "$(dirname $0)/../../../../.."
R=design/figcraft/handoff/comparison-20261029/render-live
source $R/env.sh
LOG=${RENDER_LOG_DIR:-${TMPDIR:-/tmp}/bitpos-render-live}; mkdir -p $LOG
if [ "$1" = "--build" ] || [ ! -f apps/web/dist-render-live/server/entry.mjs ]; then
  (cd apps/web && npx astro build --root . --outDir "$PWD/dist-render-live" >$LOG/build.log 2>&1) || { echo "web build failed, see $LOG/build.log"; exit 1; }
fi
pkill -f "$R/fake-auth.mjs" 2>/dev/null; pkill -f "$R/api-main.ts" 2>/dev/null; pkill -f "dist-render-live/server/entry.mjs" 2>/dev/null; sleep 0.5
nohup node $R/fake-auth.mjs >$LOG/auth.log 2>&1 &
nohup node --import tsx $R/api-main.ts >$LOG/api.log 2>&1 &
HOST=127.0.0.1 PORT=$RENDER_WEB_PORT nohup node apps/web/dist-render-live/server/entry.mjs >$LOG/web.log 2>&1 &
if [ "$1" = "--worker" ] || [ "$2" = "--worker" ]; then nohup node --import tsx apps/worker/src/index.ts >$LOG/worker.log 2>&1 & fi
for i in {1..40}; do curl -fs -o /dev/null http://127.0.0.1:$RENDER_API_PORT/api/menu -w '' ; [ $? -ne 7 ] && break; sleep 0.5; done
echo "stack up: web http://127.0.0.1:$RENDER_WEB_PORT api :$RENDER_API_PORT auth :$RENDER_AUTH_PORT (logs $LOG)"
