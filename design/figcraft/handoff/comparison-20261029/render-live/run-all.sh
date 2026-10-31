#!/bin/zsh
# Full repeatable run: recreate + seed DB, build + start the stack, run every capture/audit, stop everything and delete the private build.
# usage: run-all.sh [--keep-up]
cd "$(dirname $0)/../../../../.."
R=design/figcraft/handoff/comparison-20261029/render-live
$R/seed-all.sh || exit 1
source $R/env.sh
$R/up.sh --build || exit 1
mkdir -p $R/logs
node $R/overview-audit.mjs   2>&1 | grep -v "bigint\|DEP0\|trace-dep" | tee $R/logs/overview-audit.log
node $R/capture-flows.mjs kanban,product,sidebar,promo,export 2>&1 | grep -v "bigint\|DEP0\|trace-dep" | tee $R/logs/flows.log
node $R/capture-pay.mjs      2>&1 | grep -v "bigint\|DEP0\|trace-dep\|CART TEXT" | tee $R/logs/pay.log
node $R/capture-pos.mjs      2>&1 | grep -v "bigint\|DEP0\|trace-dep" | tee $R/logs/pos.log
[ "$1" = "--keep-up" ] || $R/down.sh
