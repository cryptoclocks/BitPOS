#!/bin/bash
# LOCAL-ONLY: start/stop/status of the hand-try stack. See docs/TRY_APPS_LOCAL_TH.md.
cd "$(dirname "$0")/../.."
LOG="${BITPOS_TRY_LOG_DIR:-$HOME/.local/share/bitpos-try-fixture}"; mkdir -p "$LOG"
case "$1" in
 start) pgrep -f "tools/runtime/try-apps-server.ts" >/dev/null || (nohup pnpm exec tsx tools/runtime/try-apps-server.ts >> "$LOG/api.log" 2>&1 &)
        pgrep -f "apps/worker/src/index.ts" >/dev/null || (nohup tools/runtime/try-apps-worker.sh >> "$LOG/worker.log" 2>&1 &)
        echo "started; logs in $LOG";;
 stop)  pkill -f "tools/runtime/try-apps-server.ts"; pkill -f "tools/runtime/try-apps-worker.sh"; pkill -f "apps/worker/src/index.ts"; echo stopped;;
 status) lsof -iTCP:3043 -sTCP:LISTEN | tail -1; pgrep -fl "apps/worker/src/index.ts";;
 *) echo "usage: $0 start|stop|status"; exit 1;;
esac
