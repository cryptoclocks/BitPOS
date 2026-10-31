#!/usr/bin/env bash
# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
# Repeatable deploy of the PayPal edition (compose project `bitpos-paypal`, infra/paypal/compose.yaml) to the OCI host.
#
#   OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/paypal/deploy-oci.sh            preflight only (default)
#   OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/paypal/deploy-oci.sh --apply    preflight, then deploy
#
# Preflight changes nothing on the host: disk, pinned image, free ports, private env (key names only, never values),
# other stacks running, PayPal migrations in the ledger, and module resolution of this source inside the image.
# --apply uploads the source and the prebuilt web (no tests, no node_modules, no secrets), swaps them in atomically,
# starts/restarts ONLY project bitpos-paypal, checks health and restores the previous source if unhealthy.
# Never touches bitpos-runtime, bitpos-meta, bitpos-staging or ccp containers; never builds images, prunes, `down`s
# another project or uses --remove-orphans. Migrations are applied separately (tools/paypal/migrate-oci.sh, after a
# backup). Refuses --apply before 2026-11-05 09:00 ICT (the Meta hackathon deadline on the same host).
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
cd "$(git rev-parse --show-toplevel)"
POS_ORIGIN=https://paypal-pos.cashlessthailand.com
NOT_BEFORE=1793844000 # 2026-11-05T09:00:00+07:00
SSH=(ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
step(){ printf '\n== %s\n' "$*"; }

step "local checks"
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "hackathon/paypal-2026" ] || { echo "refusing: on $branch, expected hackathon/paypal-2026" >&2; exit 1; }
if [ "$APPLY" = 1 ]; then
  [ "$(date +%s)" -ge "$NOT_BEFORE" ] || { echo "refusing --apply before 2026-11-05 09:00 ICT (Meta deadline on the shared host)" >&2; exit 1; }
  git diff --quiet && git diff --cached --quiet || { echo "refusing --apply with uncommitted changes" >&2; exit 1; }
fi
echo "source $(git rev-parse --short HEAD)$(git diff --quiet || echo '+dirty')"

step "build web for $POS_ORIGIN"
PUBLIC_URL="$POS_ORIGIN" pnpm exec astro build --root apps/web --outDir "$TMP/web" >"$TMP/web-build.log" 2>&1 || { tail -20 "$TMP/web-build.log" >&2; exit 1; }
[ -f "$TMP/web/server/entry.mjs" ] || { echo "web build produced no server/entry.mjs" >&2; exit 1; }

step "pack"
SRC=(apps/api/src apps/worker/src packages/contracts/src packages/domain/src packages/openapi
     tools/paypal/server.ts tools/paypal/worker.ts tools/paypal/oci-preflight.ts tools/paypal/seed-demo.ts
     tsconfig.json package.json)
for p in "${SRC[@]}"; do [ -e "$p" ] || { echo "missing $p" >&2; exit 1; }; done
COPYFILE_DISABLE=1 tar --exclude node_modules --exclude '*.test.ts' --no-xattrs -czf "$TMP/src.tgz" "${SRC[@]}" 2>/dev/null \
  || COPYFILE_DISABLE=1 tar --exclude node_modules --exclude '*.test.ts' -czf "$TMP/src.tgz" "${SRC[@]}"
COPYFILE_DISABLE=1 tar -C "$TMP/web" -czf "$TMP/web.tgz" .
for a in src web; do
  if tar -tzf "$TMP/$a.tgz" | grep -Eiq '(^|/)\.env|\.pem$|\.key$|private|secret'; then echo "refusing: $a archive contains a secret-looking path" >&2; exit 1; fi
done
mkdir "$TMP/scan" && tar -xzf "$TMP/src.tgz" -C "$TMP/scan" && tar -xzf "$TMP/web.tgz" -C "$TMP/scan"
if grep -rEl 'AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|PAYPAL_CLIENT_SECRET=[A-Za-z0-9_-]{10,}|sk_live_|EK[A-Za-z0-9_-]{60,}' "$TMP/scan" >/dev/null; then
  echo "refusing: an archive contains something that looks like a key" >&2; exit 1; fi
echo "src $(du -h "$TMP/src.tgz" | cut -f1), web $(du -h "$TMP/web.tgz" | cut -f1)"

step "remote preflight (read-only)"
"${SSH[@]}" 'mkdir -p ~/bitpos-paypal/preflight && rm -rf ~/bitpos-paypal/preflight/* && mkdir -p ~/bitpos-paypal/preflight/src ~/bitpos-paypal/preflight/web'
"${SSH[@]}" 'tar -xzf - -C ~/bitpos-paypal/preflight/src 2>/dev/null' <"$TMP/src.tgz"
"${SSH[@]}" 'tar -xzf - -C ~/bitpos-paypal/preflight/web 2>/dev/null' <"$TMP/web.tgz"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -uo pipefail
fail=0; bad(){ echo "FAIL: $*"; fail=1; }; ok(){ echo "ok:   $*"; }
avail=$(df -BG --output=avail /home | tail -1 | tr -dc 0-9); [ "${avail:-0}" -ge 3 ] && ok "disk ${avail}G free" || bad "disk ${avail}G free (< 3G)"
if docker image inspect bitpos-paypal-base:pinned >/dev/null 2>&1; then IMG=bitpos-paypal-base:pinned; ok "pinned image exists"
elif docker image inspect bitpos-runtime:current >/dev/null 2>&1; then IMG=bitpos-runtime:current; ok "runtime image present (will be pinned on --apply)"
else bad "no bitpos-runtime:current image"; IMG=; fi
for port in 3103 4361; do
  holder=$(ss -ltn 2>/dev/null | awk -v p=":$port" '$4 ~ p"$"')
  if [ -z "$holder" ]; then ok "port $port free"
  elif docker ps --filter label=com.docker.compose.project=bitpos-paypal -q | grep -q .; then ok "port $port held (bitpos-paypal running)"
  else bad "port $port in use by another process"; fi
done
ENVF=~/bitpos-private/paypal/paypal.env
if [ -f "$ENVF" ]; then
  mode=$(stat -c %a "$ENVF"); [ "$mode" = 600 ] && ok "paypal.env mode 600" || bad "paypal.env mode $mode (want 600)"
  for k in PAYPAL_ENVIRONMENT PAYPAL_API_BASE_URL PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET PAYPAL_MERCHANT_ID PUBLIC_URL BITPOS_CUSTOMER_PUBLIC_URL; do
    grep -Eq "^$k=.+" "$ENVF" && ok "paypal.env has $k" || bad "paypal.env missing $k"; done
  grep -Eq '^PAYPAL_ENVIRONMENT=sandbox$' "$ENVF" && ok "PayPal Sandbox only" || bad "PAYPAL_ENVIRONMENT must be sandbox"
  grep -Eq '^PAYPAL_WEBHOOK_ID=.+' "$ENVF" && ok "webhook id set" || echo "note: PAYPAL_WEBHOOK_ID not set yet (register the webhook after the first deploy)"
  if grep -Eq '^BITPOS_AI_(PROVIDER_URL|MODEL)=' "$ENVF"; then
    for k in BITPOS_AI_PROVIDER_URL BITPOS_AI_MODEL; do
      a=$(grep -E "^$k=" "$ENVF" | cut -d= -f2-); b=$(grep -E "^$k=" ~/bitpos-private/runtime.env | cut -d= -f2-)
      [ "$a" = "$b" ] && ok "$k matches runtime.env" || bad "$k differs from runtime.env (the runtime worker would block Copilot draft jobs)"; done
  fi
else bad "missing $ENVF"; fi
m=$(grep -E '^BITPOS_AI_MODEL=' ~/bitpos-private/runtime.env | cut -d= -f2-); echo "info: runtime AI model: ${m:-not configured} (Café Copilot and its copy use this configuration)"
for c in bitpos-runtime-api-1 bitpos-runtime-worker-1 bitpos-runtime-web-1 bitpos-meta-meta-1 bitpos-staging-db-1; do
  s=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing); echo "info: $c $s"; done
for n in 400_paypal_merchant 401_paypal_ledger 402_paypal_settlement 403_paypal_webhooks 404_paypal_campaign 405_paypal_agent_trace; do
  docker exec bitpos-staging-db-1 psql -U postgres -Atc "SELECT 1 FROM public.bitpos_migrations WHERE name='$n.sql'" | grep -q 1 && ok "migration $n" || bad "migration $n not applied (tools/paypal/migrate-oci.sh)"; done
if [ -n "$IMG" ]; then
  out=$(docker run --rm --network none -u 1001:1001 -v ~/bitpos-paypal/preflight/src:/app/paypal-src:ro -v ~/bitpos-paypal/preflight/web:/app/paypal-web:ro -w /app/paypal-src "$IMG" \
    node --import tsx tools/paypal/oci-preflight.ts /app/paypal-src /app/paypal-web 2>&1 | tail -1)
  echo "$out" | grep -q '"missing":\[\]' && ok "modules resolve in image: $out" || bad "modules: $out"
fi
exit $fail
REMOTE
pre=$?
if [ "$pre" != 0 ]; then echo "preflight failed" >&2; exit 1; fi
if [ "$APPLY" != 1 ]; then echo; echo "preflight passed; nothing changed. Re-run with --apply to deploy."; exit 0; fi

step "deploy (bitpos-paypal only)"
scp -q -i "$OCI_SSH_KEY" infra/paypal/compose.yaml "$OCI_HOST:bitpos-paypal/compose.yaml"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/bitpos-paypal
docker image inspect bitpos-paypal-base:pinned >/dev/null 2>&1 || { docker tag bitpos-runtime:current bitpos-paypal-base:pinned; echo "pinned $(docker image inspect -f '{{.Id}}' bitpos-paypal-base:pinned | cut -c1-19)"; }
before=$(docker ps --format '{{.Names}} {{.Status}}' | grep -v '^bitpos-paypal-' | sort)
rm -rf src.old web.old; [ -d src ] && mv src src.old; [ -d web ] && mv web web.old
mv preflight/src src; mv preflight/web web
docker compose -p bitpos-paypal -f compose.yaml up -d >/dev/null
docker compose -p bitpos-paypal -f compose.yaml restart >/dev/null
health(){ a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3103/api/pay/xxxxxxxxxxxxxxxxxxxxxxxx/paypal || true)
          w=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4361/ || true)
          h=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3103/paypal/webhooks || true); }
for i in $(seq 1 30); do health; [ "$a" = 404 ] && [ "$w" = 200 ] && break; sleep 2; done
echo "health: api pay-status $a (want 404), web / $w (want 200), webhook POST $h (want 400, or 503 before the webhook id is set)"
if [ "$a" != 404 ] || [ "$w" != 200 ]; then
  echo "unhealthy: restoring previous source"; docker compose -p bitpos-paypal -f compose.yaml logs --tail 20 2>&1 | tail -20
  rm -rf src web; [ -d src.old ] && mv src.old src; [ -d web.old ] && mv web.old web
  if [ -d src ]; then docker compose -p bitpos-paypal -f compose.yaml restart >/dev/null; else docker compose -p bitpos-paypal -f compose.yaml stop >/dev/null; fi
  exit 1
fi
after=$(docker ps --format '{{.Names}} {{.Status}}' | grep -v '^bitpos-paypal-' | sort)
[ "$(echo "$before" | cut -d' ' -f1)" = "$(echo "$after" | cut -d' ' -f1)" ] && echo "other stacks: unchanged" || { echo "WARNING: other running containers changed:"; diff <(echo "$before") <(echo "$after") || true; }
docker compose -p bitpos-paypal -f compose.yaml ps --format '{{.Name}} {{.Status}}'
REMOTE
echo; echo "deployed $(git rev-parse --short HEAD). Next: tunnel hostnames (Cloudflare dashboard), demo owner, seed, webhook (see paypal-hackathon/DEPLOY_OCI.md)."
