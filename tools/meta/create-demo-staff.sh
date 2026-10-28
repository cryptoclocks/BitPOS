#!/usr/bin/env bash
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# Creates the three demo staff accounts of the Meta demo shop (Muse Café): owner, manager, staff, with
# @muse-cafe.test addresses and random passwords. Runs ON the OCI host. The service key is read from the private
# runtime env and never printed; the passwords go only to ~/bitpos-private/meta/demo-login-meta.json (mode 600),
# which the staff page's quick sign-in reads. Idempotent: if that file exists, nothing is created.
# Usage (on the host): bash create-demo-staff.sh
set -euo pipefail
OUT=~/bitpos-private/meta/demo-login-meta.json
MERCHANT=33333333-3333-4333-8333-333333333333
[ -e "$OUT" ] && { echo "exists: $OUT (nothing created)"; exit 0; }
AUTH=$(grep -E '^META_AUTH_URL=' ~/bitpos-private/meta/meta.env | cut -d= -f2-)
KEY=$(grep -E '^AUTH_SERVICE_KEY=' ~/bitpos-private/runtime.env | cut -d= -f2-)
umask 077; TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
echo '[]' > "$TMP"
for ROLE in owner manager staff; do
  EMAIL="$ROLE@muse-cafe.test"; PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  ID=$(curl -fsS -X POST "$AUTH/admin/users" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true,\"user_metadata\":{\"demo\":\"meta-muse-cafe\"}}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  docker exec bitpos-staging-db-1 psql -U postgres -v ON_ERROR_STOP=1 -qc "INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES('$ID','$MERCHANT','$ROLE') ON CONFLICT DO NOTHING"
  python3 - "$TMP" "$EMAIL" "$PASS" "$ROLE" <<'EOF'
import json,sys
p,email,pw,role=sys.argv[1:];d=json.load(open(p));d.append({'email':email,'password':pw,'role':role});json.dump(d,open(p,'w'))
EOF
  echo "created $ROLE ($EMAIL)"
done
install -m 600 "$TMP" "$OUT"; echo "wrote $OUT"
