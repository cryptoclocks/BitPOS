#!/usr/bin/env bash
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from tools/near/deploy-oci.sh.
# Repeatable deploy of the NEAR edition (compose project `bitpos-near`, infra/near/compose.yaml) to the OCI host.
#
#   OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/near/deploy-oci.sh            preflight only (default)
#   OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/near/deploy-oci.sh --apply    preflight, then deploy
#
# Preflight changes nothing on the host: disk, pinned image, free ports, private env (key names only, never values),
# other stacks running, NEAR migrations in the ledger, and module resolution of this source inside the image.
# --apply uploads the source and the prebuilt web (no tests, no node_modules, no secrets), swaps them in atomically,
# starts/restarts ONLY project bitpos-near, checks health and restores the previous source if unhealthy.
# Never touches bitpos-runtime, bitpos-meta, bitpos-paypal, bitpos-staging or ccp containers; never builds images, prunes, `down`s
# another project or uses --remove-orphans. Migrations are applied separately (tools/near/migrate-oci.sh, after a
# backup). The owner approved the hosted NEAR demo on 14 Nov 2026; the host is shared, so nothing else is touched.
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
cd "$(git rev-parse --show-toplevel)"
POS_ORIGIN=https://near-pos.cashlessthailand.com
SSH=(ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
step(){ printf '\n== %s\n' "$*"; }

step "local checks"
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "hackathon/near-2026" ] || { echo "refusing: on $branch, expected hackathon/near-2026" >&2; exit 1; }
if [ "$APPLY" = 1 ]; then
  git diff --quiet && git diff --cached --quiet || { echo "refusing --apply with uncommitted changes" >&2; exit 1; }
fi
echo "source $(git rev-parse --short HEAD)$(git diff --quiet || echo '+dirty')"

step "build web for $POS_ORIGIN"
PUBLIC_URL="$POS_ORIGIN" pnpm exec astro build --root apps/web --outDir "$TMP/web" >"$TMP/web-build.log" 2>&1 || { tail -20 "$TMP/web-build.log" >&2; exit 1; }
[ -f "$TMP/web/server/entry.mjs" ] || { echo "web build produced no server/entry.mjs" >&2; exit 1; }

step "pack"
SRC=(apps/api/src apps/worker/src packages/contracts/src packages/domain/src packages/openapi
     tools/near/server.ts tools/near/oci-preflight.ts tools/near/seed-demo.ts tools/near/device-credential.ts tools/near/front.ts tools/near/sim-screen.ts
     apps/near-site near-hackathon/near-deployment.json
     tsconfig.json package.json)
for p in "${SRC[@]}"; do [ -e "$p" ] || { echo "missing $p" >&2; exit 1; }; done
COPYFILE_DISABLE=1 tar --exclude node_modules --exclude '*.test.ts' --no-xattrs -czf "$TMP/src.tgz" "${SRC[@]}" 2>/dev/null \
  || COPYFILE_DISABLE=1 tar --exclude node_modules --exclude '*.test.ts' -czf "$TMP/src.tgz" "${SRC[@]}"
COPYFILE_DISABLE=1 tar -C "$TMP/web" -czf "$TMP/web.tgz" .
for a in src web; do
  if tar -tzf "$TMP/$a.tgz" | grep -Eiq '(^|/)\.env|\.pem$|\.key$|private|secret'; then echo "refusing: $a archive contains a secret-looking path" >&2; exit 1; fi
done
mkdir "$TMP/scan" && tar -xzf "$TMP/src.tgz" -C "$TMP/scan" && tar -xzf "$TMP/web.tgz" -C "$TMP/scan"
if grep -rEl 'AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|"private_key"|sk_live_' "$TMP/scan" >/dev/null; then
  echo "refusing: an archive contains something that looks like a key" >&2; exit 1; fi
echo "src $(du -h "$TMP/src.tgz" | cut -f1), web $(du -h "$TMP/web.tgz" | cut -f1)"

step "remote preflight (read-only)"
"${SSH[@]}" 'mkdir -p ~/bitpos-near/preflight && rm -rf ~/bitpos-near/preflight/* && mkdir -p ~/bitpos-near/preflight/src ~/bitpos-near/preflight/web'
"${SSH[@]}" 'tar -xzf - -C ~/bitpos-near/preflight/src 2>/dev/null' <"$TMP/src.tgz"
"${SSH[@]}" 'tar -xzf - -C ~/bitpos-near/preflight/web 2>/dev/null' <"$TMP/web.tgz"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -uo pipefail
fail=0; bad(){ echo "FAIL: $*"; fail=1; }; ok(){ echo "ok:   $*"; }
avail=$(df -BG --output=avail /home | tail -1 | tr -dc 0-9); [ "${avail:-0}" -ge 3 ] && ok "disk ${avail}G free" || bad "disk ${avail}G free (< 3G)"
if docker image inspect bitpos-near-base:pinned >/dev/null 2>&1; then IMG=bitpos-near-base:pinned; ok "pinned image exists"
elif docker image inspect bitpos-runtime:current >/dev/null 2>&1; then IMG=bitpos-runtime:current; ok "runtime image present (will be pinned on --apply)"
else bad "no bitpos-runtime:current image"; IMG=; fi
for port in 3105 3106 4381; do
  holder=$(ss -ltn 2>/dev/null | awk -v p=":$port" '$4 ~ p"$"')
  if [ -z "$holder" ]; then ok "port $port free"
  elif docker ps --filter label=com.docker.compose.project=bitpos-near -q | grep -q .; then ok "port $port held (bitpos-near running)"
  else bad "port $port in use by another process"; fi
done
ENVF=~/bitpos-private/near/near.env
if [ -f "$ENVF" ]; then
  [ "$(stat -c %a "$ENVF")" = 600 ] && ok "near.env mode 600" || bad "near.env mode not 600"
  for k in NEAR_NETWORK NEAR_BILLS_CONTRACT NEAR_RELAYER_ACCOUNT NEAR_DEMO_WALLETS NEAR_AI_AGENT_ACCOUNT PUBLIC_URL BITPOS_CUSTOMER_PUBLIC_URL BITPOS_DEMO_PUBLIC_ORIGIN; do
    grep -Eq "^$k=.+" "$ENVF" && ok "near.env has $k" || bad "near.env missing $k"; done
  grep -Eq '^NEAR_NETWORK=testnet$' "$ENVF" && ok "NEAR testnet only" || bad "NEAR_NETWORK must be testnet"
else bad "missing $ENVF"; fi
K=~/bitpos-private/near/testnet/keys
for f in relayer.bitpos-near.testnet orbit.bitpos-near.testnet.cashier agent.bitpos-near.testnet.pass alice.bitpos-near.testnet bob.bitpos-near.testnet tusd.bitpos-near.testnet; do
  [ -f "$K/$f.json" ] && [ "$(stat -c %a "$K/$f.json")" = 644 -o "$(stat -c %a "$K/$f.json")" = 640 -o "$(stat -c %a "$K/$f.json")" = 600 ] && ok "key $f" || bad "missing key $f"; done
DL=~/bitpos-private/near/demo-login-near.json
[ -f "$DL" ] && ok "demo-login-near.json present" || bad "missing $DL (run tools/near/create-demo-staff.sh on the host)"
for c in bitpos-runtime-api-1 bitpos-runtime-web-1 bitpos-paypal-api-1 bitpos-meta-meta-1 bitpos-staging-db-1; do
  s=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing); echo "info: $c $s"; done
for n in 500_near_merchant 501_near_ledger 502_near_settlement 503_near_cfo; do
  docker exec bitpos-staging-db-1 psql -U postgres -Atc "SELECT 1 FROM public.bitpos_migrations WHERE name='$n.sql'" | grep -q 1 && ok "migration $n" || bad "migration $n not applied (tools/near/migrate-oci.sh)"; done
if [ -n "$IMG" ]; then
  out=$(docker run --rm --network none -u 1001:1001 -v ~/bitpos-near/preflight/src:/app/near-src:ro -v ~/bitpos-near/preflight/web:/app/near-web:ro -w /app/near-src "$IMG" \
    node --import tsx tools/near/oci-preflight.ts /app/near-src /app/near-web 2>&1 | tail -1)
  echo "$out" | grep -q '"missing":\[\]' && ok "modules resolve in image: $out" || bad "modules: $out"
fi
exit $fail
REMOTE
pre=$?
if [ "$pre" != 0 ]; then echo "preflight failed" >&2; exit 1; fi
if [ "$APPLY" != 1 ]; then echo; echo "preflight passed; nothing changed. Re-run with --apply to deploy."; exit 0; fi

step "deploy (bitpos-near only)"
scp -q -i "$OCI_SSH_KEY" infra/near/compose.yaml "$OCI_HOST:bitpos-near/compose.yaml"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/bitpos-near
docker image inspect bitpos-near-base:pinned >/dev/null 2>&1 || { docker tag bitpos-runtime:current bitpos-near-base:pinned; echo "pinned $(docker image inspect -f '{{.Id}}' bitpos-near-base:pinned | cut -c1-19)"; }
before=$(docker ps --format '{{.Names}} {{.Status}}' | grep -v '^bitpos-near-' | sort)
rm -rf src.old web.old; [ -d src ] && mv src src.old; [ -d web ] && mv web web.old
mv preflight/src src; mv preflight/web web
install -d -m 700 ~/bitpos-private/near/sim-screen
docker compose -p bitpos-near -f compose.yaml up -d >/dev/null
docker compose -p bitpos-near -f compose.yaml restart >/dev/null
health(){ a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3106/api/pay/xxxxxxxxxxxxxxxxxxxxxxxx/near || true)
          w=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3105/ || true)
          s=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: near.cashlessthailand.com' http://127.0.0.1:3105/ || true); }
for i in $(seq 1 30); do health; [ "$a" = 404 ] && [ "$w" = 200 ] && [ "$s" = 200 ] && break; sleep 2; done
echo "health: api pay-status $a (want 404), front→web / $w (want 200), front→site / $s (want 200)"
if [ "$a" != 404 ] || [ "$w" != 200 ] || [ "$s" != 200 ]; then
  echo "unhealthy: restoring previous source"; docker compose -p bitpos-near -f compose.yaml logs --tail 30 2>&1 | tail -30
  rm -rf src web; [ -d src.old ] && mv src.old src; [ -d web.old ] && mv web.old web
  if [ -d src ]; then docker compose -p bitpos-near -f compose.yaml restart >/dev/null; else docker compose -p bitpos-near -f compose.yaml stop >/dev/null; fi
  exit 1
fi
after=$(docker ps --format '{{.Names}} {{.Status}}' | grep -v '^bitpos-near-' | sort)
[ "$(echo "$before" | cut -d' ' -f1)" = "$(echo "$after" | cut -d' ' -f1)" ] && echo "other stacks: unchanged" || { echo "WARNING: other running containers changed:"; diff <(echo "$before") <(echo "$after") || true; }
docker compose -p bitpos-near -f compose.yaml ps --format '{{.Name}} {{.Status}}'
REMOTE
echo; echo "deployed $(git rev-parse --short HEAD). Next: tunnel hostnames near / near-pos / near-pay → http://127.0.0.1:3105 (Cloudflare dashboard)."
