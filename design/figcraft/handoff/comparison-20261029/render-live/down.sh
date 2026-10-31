#!/bin/zsh
# Stop every harness process and delete the private web build. The database bitpos_render_fixture is kept.
cd "$(dirname $0)/../../../../.."
R=design/figcraft/handoff/comparison-20261029/render-live
pkill -f "$R/fake-auth.mjs"; pkill -f "$R/api-main.ts"; pkill -f "dist-render-live/server/entry.mjs"; pkill -f "apps/worker/src/index.ts"
[ "$1" = "--keep-build" ] || rm -rf apps/web/dist-render-live
echo stopped
