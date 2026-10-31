#!/usr/bin/env bash
# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
# Creates the demo accounts of the PayPal demo shop (BitPOS PayPal Café, merchant 70707070-…) for judges:
# owner, manager and staff (@paypal-cafe.test). Runs ON the OCI host:
#   ssh -i <key> <host> 'bash -s' < tools/paypal/create-demo-staff.sh
# The auth service key is read from the private runtime env and never printed. Random passwords go only to
# ~/bitpos-private/paypal/demo-login-paypal.json (mode 600), which the POS quick sign-in reads (infra/paypal/compose.yaml).
# Idempotent: roles already in that file are kept; an owner created earlier (demo-owner.json) is reused, not recreated.
# Run it after `seed-demo.ts shop` (the members rows need the shop).
set -euo pipefail
DIR=~/bitpos-private/paypal; OUT=$DIR/demo-login-paypal.json; OLD_OWNER=$DIR/demo-owner.json
MERCHANT=70707070-7070-4070-8070-707070707070
AUTH=$(grep -E '^AUTH_URL=' ~/bitpos-private/runtime.env | cut -d= -f2-)
KEY=$(grep -E '^AUTH_SERVICE_KEY=' ~/bitpos-private/runtime.env | cut -d= -f2-)
[ -n "$AUTH" ] && [ -n "$KEY" ] || { echo "AUTH_URL / AUTH_SERVICE_KEY missing in runtime.env" >&2; exit 1; }
docker exec bitpos-staging-db-1 psql -U postgres -Atc "SELECT 1 FROM bitpos.merchants WHERE id='$MERCHANT'" | grep -q 1 || { echo "seed the shop first (seed-demo.ts shop)" >&2; exit 1; }
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
  EMAIL="$ROLE@paypal-cafe.test"; PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)
  ID=$(curl -fsS -X POST "$AUTH/admin/users" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true,\"user_metadata\":{\"demo\":\"paypal-cafe\"}}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  docker exec bitpos-staging-db-1 psql -U postgres -v ON_ERROR_STOP=1 -qc "INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES('$ID','$MERCHANT','$ROLE') ON CONFLICT DO NOTHING"
  python3 - "$TMP" "$EMAIL" "$PASS" "$ROLE" <<'EOF'
import json,sys
p,email,pw,role=sys.argv[1:];d=json.load(open(p));d.append({'email':email,'password':pw,'role':role});json.dump(d,open(p,'w'))
EOF
  echo "created $ROLE ($EMAIL)"
done
install -m 600 "$TMP" "$OUT"; echo "wrote $OUT ($(python3 -c 'import json,sys;print(",".join(c["role"] for c in json.load(open(sys.argv[1]))))' "$OUT"))"
