#!/bin/zsh
# Recreate the throwaway database and seed it end to end (stack must be stopped; takes ~30 s).
cd "$(dirname $0)/../../../../.."
R=design/figcraft/handoff/comparison-20261029/render-live
$R/down.sh --keep-build >/dev/null
$R/setup-db.sh --recreate 2>&1 | tail -1
source $R/env.sh
for m in users data orders extras retime bulk; do npx tsx $R/seed.ts $m 2>&1 | grep -v "bigint\|DEP0\|trace-dep"; done
