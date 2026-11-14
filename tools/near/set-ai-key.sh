#!/usr/bin/env bash
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Installs a NEAR AI Cloud API key for the Café CFO and the AI spending-pass agent without ever printing it.
# Copy the key in your browser, then run (macOS):   bash tools/near/set-ai-key.sh
# It reads the clipboard, checks the key against NEAR AI (prints only "ok" and how many models it can see), writes
# NEAR_AI_API_KEY to this checkout's .env (git-ignored) and to the hosted demo's private env, restarts only the
# bitpos-near api container, then clears the clipboard. The key never goes to the repository, the chat or a log.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
KEY=$(pbpaste | tr -d '[:space:]')
[[ "$KEY" =~ ^[A-Za-z0-9._-]{20,300}$ ]] || { echo "The clipboard does not hold a NEAR AI key. Copy the key, then run this again." >&2; exit 1; }
MODEL=${NEAR_AI_MODEL:-z-ai/glm-5.3-flash}
models=$(curl -s --max-time 20 -H "Authorization: Bearer $KEY" https://cloud-api.near.ai/v1/models | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); ids=[m.get("id") for m in d.get("data",[])]; print(len(ids), "yes" if sys.argv[1] in ids else "no")
except Exception: print("0 no")' "$MODEL")
set -- $models
[ "$1" -gt 0 ] || { echo "NEAR AI did not accept this key (no models listed). Nothing was saved." >&2; exit 1; }
echo "ok: the key works ($1 models visible; $MODEL listed: $2)"
[ "$2" = yes ] || { echo "models this key can use (pick one and set NEAR_AI_MODEL in .env / near.env):"; curl -s --max-time 20 -H "Authorization: Bearer $KEY" https://cloud-api.near.ai/v1/models | python3 -c 'import json,sys;[print("  "+m["id"]) for m in json.load(sys.stdin).get("data",[])[:12]]'; }
# local checkout
touch .env; chmod 600 .env
grep -v '^NEAR_AI_API_KEY=' .env > .env.tmp || true; printf 'NEAR_AI_API_KEY=%s\n' "$KEY" >> .env.tmp; mv .env.tmp .env; chmod 600 .env
echo "saved to .env (git-ignored)"
# hosted demo (set OCI_HOST and OCI_SSH_KEY to update it too)
if [ -n "${OCI_HOST:-}" ] && [ -n "${OCI_SSH_KEY:-}" ]; then
  printf '%s' "$KEY" | ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST" 'set -e; read -r K || true; F=~/bitpos-private/near/near.env
    grep -v "^NEAR_AI_API_KEY=" "$F" > "$F.tmp" || true; printf "NEAR_AI_API_KEY=%s\n" "$K" >> "$F.tmp"; mv "$F.tmp" "$F"; chmod 600 "$F"
    cd ~/bitpos-near && docker compose -p bitpos-near -f compose.yaml up -d --force-recreate api >/dev/null 2>&1; echo "hosted demo: key saved, api restarted"'
fi
printf '' | pbcopy; echo "clipboard cleared"
