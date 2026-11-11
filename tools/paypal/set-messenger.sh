#!/usr/bin/env bash
# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
# Stores the Messenger ordering credentials of the PayPal demo shop's Facebook Page in the PRIVATE PayPal env on the
# OCI host (/home/ubuntu/bitpos-private/paypal/paypal.env, mode 600), then recreates only the bitpos-paypal api and
# worker. The Page access token and App secret are typed into hidden prompts and sent over ssh stdin (never argv,
# never a file on this Mac, never printed). A random verify token is generated on the host and shown ONCE in this
# terminal so it can be pasted into the Meta app's webhook settings. The table the chat orders for is Table 2.
#   OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/paypal/set-messenger.sh
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
[ -t 0 ] || { echo "run this in a terminal (credentials are read from hidden prompts)" >&2; exit 1; }
read -rs -p "Facebook Page access token (hidden): " PAGE; echo
read -rs -p "Meta App secret (hidden): " SECRET; echo
# Terminals wrap pasted text in bracketed-paste escapes (ESC[200~ … ESC[201~): strip them, then keep token characters only.
strip(){ printf '%s' "$1" | sed $'s/\e\\[20[01]~//g' | tr -cd 'A-Za-z0-9'; }
PAGE=$(strip "$PAGE"); SECRET=$(strip "$SECRET" | tr 'A-F' 'a-f')
[[ "$PAGE" =~ ^EAA[A-Za-z0-9]+$ && ${#PAGE} -ge 40 && ${#PAGE} -le 1000 ]] || { echo "that does not look like a Page access token (got ${#PAGE} token characters, starting \"${PAGE:0:3}\"; expected EAA…); nothing changed" >&2; exit 1; }
[[ "$SECRET" =~ ^[0-9a-f]{32}$ ]] || { echo "that does not look like an App secret (got ${#SECRET} characters, expected 32 hex); nothing changed" >&2; exit 1; }
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'REMOTE'
set -euo pipefail; umask 077
read -r P; read -r S; F=~/bitpos-private/paypal/paypal.env
E=$(docker exec -i bitpos-staging-db-1 psql -U postgres -At <<'SQL'
SELECT e.entry_token FROM bitpos.table_entries e JOIN bitpos.devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id
 AND d.table_id=e.table_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation
 WHERE d.merchant_id='70707070-7070-4070-8070-707070707070' AND d.label LIKE 'Terminal Table 2%' AND d.revoked_at IS NULL LIMIT 1;
SQL
)
[ -n "$E" ] || { echo "no Table 2 entry found; nothing changed" >&2; exit 1; }
V=$(grep "^BITPOS_PAYPAL_MESSENGER_VERIFY_TOKEN=" "$F" | cut -d= -f2- || true); [ -n "$V" ] || V=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d " \n")
cp -p "$F" "$F.bak-$(date -u +%Y%m%dT%H%M%SZ)"
grep -v "^BITPOS_PAYPAL_MESSENGER_" "$F" > "$F.new" || true
printf "BITPOS_PAYPAL_MESSENGER_PAGE_TOKEN=%s\nBITPOS_PAYPAL_MESSENGER_APP_SECRET=%s\nBITPOS_PAYPAL_MESSENGER_VERIFY_TOKEN=%s\nBITPOS_PAYPAL_MESSENGER_TABLE_ENTRY=%s\n" "$P" "$S" "$V" "$E" >> "$F.new"
chmod 600 "$F.new"; mv "$F.new" "$F"
cd ~/bitpos-paypal && docker compose -p bitpos-paypal -f compose.yaml up -d --force-recreate --no-deps api worker >/dev/null 2>&1
echo "stored; bitpos-paypal api and worker recreated"
echo
echo "In the Meta app: Messenger > Webhooks > Callback URL: https://paypal-pay.cashlessthailand.com/paypal/messenger/webhook"
echo "Verify token (paste it there, then subscribe the Page to: messages, messaging_postbacks):"
echo "$V"
REMOTE
scp -q -i "$OCI_SSH_KEY" "$TMP" "$OCI_HOST:/tmp/set-messenger-remote.sh"
printf '%s\n%s\n' "$PAGE" "$SECRET" | ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST" 'bash /tmp/set-messenger-remote.sh; rc=$?; rm -f /tmp/set-messenger-remote.sh; exit $rc'
unset PAGE SECRET
