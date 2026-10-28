#!/usr/bin/env bash
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# Repeatable deploy of the /meta-only container (compose project `bitpos-meta`, infra/meta/compose.yaml).
# Uploads the /meta source subset (no tests, no node_modules, no secrets), swaps it in atomically, restarts
# only the bitpos-meta container and checks it answers. It never touches the bitpos-runtime containers.
# Database migrations are NOT applied here: back up first, then apply 3xx migrations by hand (see
# meta-hackathon/evidence/*-oci-*.md); the script lists meta migrations missing from the ledger.
# Usage: OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/meta/deploy-oci.sh
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
cd "$(git rev-parse --show-toplevel)"
SSH=(ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
COPYFILE_DISABLE=1 tar --exclude node_modules --exclude '*.test.ts' --no-xattrs -czf "$TMP/meta-src.tgz" \
  apps/api/src apps/web/public/images/menu packages/contracts/src packages/domain/src packages/meta-ai/src packages/openapi tools/meta tsconfig.json package.json 2>/dev/null \
  || COPYFILE_DISABLE=1 tar --exclude node_modules --exclude '*.test.ts' -czf "$TMP/meta-src.tgz" \
  apps/api/src apps/web/public/images/menu packages/contracts/src packages/domain/src packages/meta-ai/src packages/openapi tools/meta tsconfig.json package.json
if tar -tzf "$TMP/meta-src.tgz" | grep -Eiq '(^|/)\.env|\.pem$|\.key$|private'; then echo "refusing: archive contains a secret-looking path" >&2; exit 1; fi
echo "source $(git rev-parse --short HEAD)$(git diff --quiet || echo '+dirty'), $(du -h "$TMP/meta-src.tgz" | cut -f1)"
"${SSH[@]}" 'set -e; rm -rf ~/bitpos-meta/src.new; mkdir -p ~/bitpos-meta/src.new; tar -xzf - -C ~/bitpos-meta/src.new 2>/dev/null' < "$TMP/meta-src.tgz"
scp -q -i "$OCI_SSH_KEY" infra/meta/compose.yaml "$OCI_HOST:bitpos-meta/compose.yaml"
"${SSH[@]}" 'set -e; cd ~/bitpos-meta; rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src
 docker compose -f compose.yaml up -d >/dev/null 2>&1; docker restart bitpos-meta-meta-1 >/dev/null
 for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3102/meta/staff || true); [ "$c" = 200 ] && break; sleep 2; done
 echo "health /meta/staff: $c"; docker logs --tail 5 bitpos-meta-meta-1 2>&1 | grep "meta-only server" | tail -1
 [ "$c" = 200 ] || { echo "unhealthy: restoring previous source"; rm -rf src; mv src.old src; docker restart bitpos-meta-meta-1 >/dev/null; exit 1; }'
missing=$(for f in supabase/migrations/3[0-9][0-9]_*.sql; do n=$(basename "$f"); "${SSH[@]}" "docker exec bitpos-staging-db-1 psql -U postgres -Atc \"SELECT 1 FROM public.bitpos_migrations WHERE name='$n'\"" | grep -q 1 || echo "$n"; done)
[ -z "$missing" ] && echo "meta migrations: all applied" || { echo "meta migrations NOT applied (back up, then apply by hand):"; echo "$missing"; }
