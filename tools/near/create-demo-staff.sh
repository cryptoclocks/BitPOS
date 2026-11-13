#!/usr/bin/env bash
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from tools/near/create-demo-staff.sh.
# Creates the demo accounts of the NEAR demo shop (Orbit Café, merchant 4e454152-…) for judges:
# owner, manager and staff (@orbit-cafe.test). Runs ON the OCI host:
#   ssh -i <key> <host> 'bash -s' < tools/near/create-demo-staff.sh
# The auth service key is read from the private runtime env and never printed. Random passwords go only to
# ~/bitpos-private/near/demo-login-near.json (mode 600), which the POS quick sign-in reads (infra/near/compose.yaml).
# Idempotent: roles already in that file are kept; an owner created earlier (demo-owner.json) is reused, not recreated.
# Run it after `seed-demo.ts shop` (the members rows need the shop).
set -euo pipefail
DIR=~/bitpos-private/near; OUT=$DIR/demo-login-near.json; OLD_OWNER=$DIR/demo-owner.json
MERCHANT=4e454152-4e45-4152-8e45-415200000001
AUTH=$(grep -E '^AUTH_URL=' ~/bitpos-private/runtime.env | cut -d= -f2-)
KEY=$(grep -E '^AUTH_SERVICE_KEY=' ~/bitpos-private/runtime.env | cut -d= -f2-)
[ -n "$AUTH" ] && [ -n "$KEY" ] || { echo "AUTH_URL / AUTH_SERVICE_KEY missing in runtime.env" >&2; exit 1; }
SHOP=0; docker exec bitpos-staging-db-1 psql -U postgres -Atc "SELECT 1 FROM bitpos.merchants WHERE id='$MERCHANT'" | grep -q 1 && SHOP=1 || echo "note: shop not seeded yet; users are created now and memberships are added when this runs again after seed-demo.ts shop"
umask 077; mkdir -p "$DIR"; TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
if [ -f "$OUT" ]; then cp "$OUT" "$TMP"; else echo '[]' >"$TMP"; fi
# Reuse the owner made by the earlier owner-only script.
if [ -f "$OLD_OWNER" ] && ! python3 -c 'import json,sys;sys.exit(0 if any(c["role"]=="owner" for c in json.load(open(sys.argv[1]))) else 1)' "$TMP"; then
  python3 - "$TMP" "$OLD_OWNER" <<'EOF'
import json,sys
p,o=sys.argv[1:];d=json.load(open(p));c=json.load(open(o));d.append({'email':c['email'],'password':c['password'],'role':'owner'});json.dump(d,open(p,'w'))
EOF
  echo "kept existing owner"
fi
for ROLE in owner manager staff; do
  python3 -c 'import json,sys;sys.exit(0 if any(c["role"]==sys.argv[2] for c in json.load(open(sys.argv[1]))) else 1)' "$TMP" "$ROLE" && continue
  EMAIL="$ROLE@orbit-cafe.test"; PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)
  ID=$(curl -fsS -X POST "$AUTH/admin/users" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true,\"user_metadata\":{\"demo\":\"orbit-cafe\"}}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  python3 - "$TMP" "$EMAIL" "$PASS" "$ROLE" "$ID" <<'EOF'
import json,sys
p,email,pw,role,uid=sys.argv[1:];d=json.load(open(p));d.append({'email':email,'password':pw,'role':role,'user_id':uid});json.dump(d,open(p,'w'))
EOF
  echo "created $ROLE ($EMAIL)"
done
if [ "$SHOP" = 1 ]; then
  for row in $(python3 -c 'import json,sys;[print(c["user_id"]+":"+c["role"]) for c in json.load(open(sys.argv[1])) if c.get("user_id")]' "$TMP"); do
    docker exec bitpos-staging-db-1 psql -U postgres -v ON_ERROR_STOP=1 -qc "INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES('${row%%:*}','$MERCHANT','${row#*:}') ON CONFLICT(user_id,merchant_id) DO UPDATE SET role=EXCLUDED.role"
  done; echo "memberships ok"
fi
install -m 600 "$TMP" "$OUT"; echo "wrote $OUT ($(python3 -c 'import json,sys;print(",".join(c["role"] for c in json.load(open(sys.argv[1]))))' "$OUT"))"
