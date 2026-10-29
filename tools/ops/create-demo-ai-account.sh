#!/bin/bash
# Creates ONE demo sign-in for AI agents on the BitPOS OCI stack: a user `ai@bitpos.test` with the MANAGER role (never owner)
# in the merchant you name. Run it yourself on the OCI host as the `ubuntu` user; it is not run by any automation.
#
#   ./create-demo-ai-account.sh <merchant-id>
#
# - The password is generated here, written only to /home/ubuntu/bitpos-private/ai-demo-login.json (mode 600) and never printed.
# - It reads AUTH_URL and AUTH_SERVICE_KEY from /home/ubuntu/bitpos-private/runtime.env and prints neither.
# - It refuses to run twice (an existing ai@bitpos.test or an existing credentials file stops it).
# - To remove the account later: delete the user in the auth service, then
#   DELETE FROM bitpos.members WHERE user_id = '<id from the credentials file>';
# The AI signs in on the normal POS login form with that email, password and the merchant id (not the public quick sign-in).
set -euo pipefail
MERCHANT="${1:?usage: $0 <merchant-id>}"
[[ "$MERCHANT" =~ ^[0-9a-f-]{36}$ ]] || { echo "merchant id must be a UUID" >&2; exit 2; }
ENV_FILE=/home/ubuntu/bitpos-private/runtime.env
OUT=/home/ubuntu/bitpos-private/ai-demo-login.json
EMAIL=ai@bitpos.test
[ -e "$OUT" ] && { echo "$OUT already exists; remove the account and file first" >&2; exit 3; }
set -a; . "$ENV_FILE"; set +a
: "${AUTH_URL:?}" "${AUTH_SERVICE_KEY:?}"
umask 077
PASSWORD="$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)"
RESPONSE="$(curl -sS -X POST "$AUTH_URL/admin/users" \
  -H "apikey: $AUTH_SERVICE_KEY" -H "Authorization: Bearer $AUTH_SERVICE_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")"
USER_ID="$(printf '%s' "$RESPONSE" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["id"])' 2>/dev/null)" \
  || { echo "could not create the user (it may already exist); nothing was written" >&2; exit 4; }
docker exec -i bitpos-staging-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c "INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES('$USER_ID','$MERCHANT','manager')"
printf '{"email":"%s","password":"%s","merchantId":"%s","role":"manager","userId":"%s"}\n' "$EMAIL" "$PASSWORD" "$MERCHANT" "$USER_ID" > "$OUT"
chmod 600 "$OUT"
echo "Created $EMAIL as manager for merchant $MERCHANT. Credentials are in $OUT (not printed)."
