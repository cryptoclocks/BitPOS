#!/usr/bin/env bash
# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
# Creates the one demo owner account of the PayPal demo shop (BitPOS PayPal Café, merchant 70707070-…) for judges.
# Runs ON the OCI host:  ssh -i <key> <host> 'bash -s' < tools/paypal/create-demo-owner.sh
# The auth service key is read from the private runtime env and never printed; the random password goes only to
# ~/bitpos-private/paypal/demo-owner.json (mode 600). Idempotent: if that file exists, nothing is created.
# Run it after `seed-demo.ts shop` (the members row needs the shop).
set -euo pipefail
OUT=~/bitpos-private/paypal/demo-owner.json
MERCHANT=70707070-7070-4070-8070-707070707070
EMAIL=owner@paypal-cafe.test
[ -e "$OUT" ] && { echo "exists: $OUT (nothing created)"; exit 0; }
AUTH=$(grep -E '^AUTH_URL=' ~/bitpos-private/runtime.env | cut -d= -f2-)
KEY=$(grep -E '^AUTH_SERVICE_KEY=' ~/bitpos-private/runtime.env | cut -d= -f2-)
[ -n "$AUTH" ] && [ -n "$KEY" ] || { echo "AUTH_URL / AUTH_SERVICE_KEY missing in runtime.env" >&2; exit 1; }
docker exec bitpos-staging-db-1 psql -U postgres -Atc "SELECT 1 FROM bitpos.merchants WHERE id='$MERCHANT'" | grep -q 1 || { echo "seed the shop first (seed-demo.ts shop)" >&2; exit 1; }
umask 077; PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)
ID=$(curl -fsS -X POST "$AUTH/admin/users" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true,\"user_metadata\":{\"demo\":\"paypal-cafe\"}}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
docker exec bitpos-staging-db-1 psql -U postgres -v ON_ERROR_STOP=1 -qc "INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES('$ID','$MERCHANT','owner') ON CONFLICT DO NOTHING"
mkdir -p "$(dirname "$OUT")"
printf '{"email":"%s","password":"%s","role":"owner","merchantId":"%s"}\n' "$EMAIL" "$PASS" "$MERCHANT" >"$OUT"; chmod 600 "$OUT"
echo "created owner ($EMAIL); password in $OUT"
