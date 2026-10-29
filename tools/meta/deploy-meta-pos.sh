#!/usr/bin/env bash
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# Builds and (re)starts meta-pos (infra/meta/pos-compose.yaml) on the OCI host. Uploads only the POS sources (no
# node_modules, tests, secrets), builds bitpos-meta-pos:<git short sha>, retags :current, restarts the two services
# and checks both answer. It never touches bitpos-runtime or bitpos-meta.
# Usage: OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/meta/deploy-meta-pos.sh
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
cd "$(git rev-parse --show-toplevel)"
SSH=(ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
TAG=$(git rev-parse --short HEAD)$(git diff --quiet -- apps packages || echo dirty)
COPYFILE_DISABLE=1 tar --exclude node_modules --exclude dist --exclude .astro --exclude '*.test.ts' --exclude 'packages/mobile_shared' -czf "$TMP/ctx.tgz" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json apps packages data device/firmware/fonts tools/meta/meta-pos-theme.mjs infra/meta/pos.Dockerfile 2>/dev/null
if tar -tzf "$TMP/ctx.tgz" | grep -Eiq '(^|/)\.env|\.pem$|\.key$|local/private'; then echo "refusing: archive contains a secret-looking path" >&2; exit 1; fi
echo "context $(du -h "$TMP/ctx.tgz" | cut -f1), tag $TAG"
"${SSH[@]}" 'rm -rf ~/bitpos-meta-pos/ctx && mkdir -p ~/bitpos-meta-pos/ctx && tar -xzf - -C ~/bitpos-meta-pos/ctx' < "$TMP/ctx.tgz"
scp -q -i "$OCI_SSH_KEY" infra/meta/pos-compose.yaml "$OCI_HOST:bitpos-meta-pos/compose.yaml"
"${SSH[@]}" "set -e; cd ~/bitpos-meta-pos; docker build -q -f ctx/infra/meta/pos.Dockerfile -t bitpos-meta-pos:$TAG ctx >/dev/null; docker tag bitpos-meta-pos:$TAG bitpos-meta-pos:current
 docker compose -f compose.yaml up -d --force-recreate >/dev/null 2>&1
 for i in \$(seq 1 40); do a=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3011/api/demo-session || true); w=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4331/ || true); [ \"\$w\" = 200 ] && [ \"\$a\" = 200 ] && break; sleep 3; done
 echo \"meta-pos api \$a web \$w (bitpos-meta-pos:$TAG)\""
