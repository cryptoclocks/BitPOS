#!/bin/zsh
set -eu
export PATH="/Users/cryptoclock/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
APP='/Users/cryptoclock/Desktop/BitPOS'
H="$APP/.omp"
OMP='/Users/cryptoclock/.local/bin/omp'
cd "$APP"
for f in config.yml foreman.py loop/mission-loop.js work/mission.md work/checkpoint.json skills/omp-pstack-bitpos/SKILL.md vendor/pstack/PIN.json; do
  [[ -s "$H/$f" ]] || { print -u2 "Missing BitPOS harness file: $f"; exit 1; }
done
"$OMP" models openai-codex --json | /usr/bin/python3 -c 'import json,sys; x=json.load(sys.stdin); rows=x.get("models",[]) if isinstance(x,dict) else x; sys.exit(0 if any(r.get("provider")=="openai-codex" and r.get("id")=="gpt-6.1-sol" for r in rows) else 1)'
[[ "$("$OMP" config get tools.approvalMode)" == 'yolo' ]] || exit 1
[[ "$("$OMP" config get task.isolation.enabled)" == 'true' ]] || exit 1
[[ "$("$OMP" config get task.isolation.apply)" == 'false' ]] || exit 1
[[ "$("$OMP" config get retry.modelFallback)" == 'false' ]] || exit 1
if [[ "${1:-}" == '--check' ]]; then
  print 'BitPOS native harness preflight passed. No model inference or product operation started.'
  exit 0
fi
[[ -z "${1:-}" || "${1:-}" == '--continue' ]] || { print -u2 'Usage: run-visible.command [--check|--continue]'; exit 1; }
[[ -t 0 && -t 1 ]] || { print -u2 'Open this launcher in Terminal for visible omp UI.'; exit 1; }
LOCK="$H/work/visible-run.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  print -u2 'A BitPOS launcher lock exists. Inspect its owner; do not start a second writer.'
  exit 1
fi
print -r -- "$$" > "$LOCK/pid"
cleanup() { rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT
export BITPOS_HARNESS_ROOT="$APP"
export BITPOS_RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
export PI_BROWSER_RELAY=1
export PI_BROWSER_CMUX=0
mission_args=(--goal 'Implement and verify the approved BitPOS payment and physical-screen demo. Read .omp/work/mission.md and checkpoint, preserve the incomplete scaffold, verify native isolation, delegate bounded POS/backend/firmware tasks, integrate serially, test through the harness and obtain fresh independent Sol high review. Physical Android Phantom scanning/payment is explicitly deferred. Complete only when foreman gate passes. Keep work visible and checkpoint every slice.')
if [[ "${1:-}" == '--continue' ]]; then
  sid="$(/usr/bin/python3 -c 'import json; print(json.load(open(".omp/work/loop/runtime-ready.json"))["session_id"])')"
  mission_args=(--resume "$sid")
fi
print 'BitPOS | Sol 6.1 low implements | isolated native tasks | Sol 6.1 high reviews'
print 'Physical Android Phantom scanning/payment deferred; devnet and hardware checks active.'
/usr/bin/caffeinate -i "$OMP" --cwd "$APP" --model openai-codex/gpt-6.1-sol --models openai-codex/gpt-6.1-sol --thinking low --service-tier none --approval-mode yolo --no-prewalk --no-extensions --extension "$H/loop/mission-loop.js" --no-title --config "$H/config.yml" --session-dir "$H/work/sessions" --append-system-prompt "$H/work/mission.md" "${mission_args[@]}"
