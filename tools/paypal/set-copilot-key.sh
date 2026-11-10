#!/usr/bin/env bash
# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
# Stores a dedicated Gemini API key for Café Copilot in the PRIVATE PayPal env on the OCI host
# (/home/ubuntu/bitpos-private/paypal/paypal.env, mode 600) and restarts only the bitpos-paypal api.
# The key is typed into a hidden prompt, sent over ssh stdin (never argv, never a file on this Mac, never printed).
#   OCI_HOST=user@host OCI_SSH_KEY=/path/to/key tools/paypal/set-copilot-key.sh
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
[ -t 0 ] || { echo "run this in a terminal (the key is read from a hidden prompt)" >&2; exit 1; }
read -rs -p "Gemini API key for Café Copilot (hidden): " KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[[ "$KEY" =~ ^[A-Za-z0-9_-]{20,200}$ ]] || { echo "that does not look like a Gemini API key; nothing changed" >&2; exit 1; }
printf '%s\n' "$KEY" | ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST" 'bash -c '"'"'
set -euo pipefail; umask 077
read -r K; F=~/bitpos-private/paypal/paypal.env
cp -p "$F" "$F.bak-$(date -u +%Y%m%dT%H%M%SZ)"
grep -v "^BITPOS_PAYPAL_GEMINI_API_KEY=" "$F" > "$F.new"; printf "BITPOS_PAYPAL_GEMINI_API_KEY=%s\n" "$K" >> "$F.new"
chmod 600 "$F.new"; mv "$F.new" "$F"
cd ~/bitpos-paypal && docker compose -p bitpos-paypal -f compose.yaml up -d --force-recreate --no-deps api >/dev/null 2>&1
echo "stored (length ${#K}); bitpos-paypal api recreated"
'"'"''
unset KEY
