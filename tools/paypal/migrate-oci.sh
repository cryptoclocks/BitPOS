#!/usr/bin/env bash
# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
# Applies the PayPal migrations (supabase/migrations/40x_paypal_*.sql) to the one BitPOS database on the OCI host.
#
#   OCI_HOST=… OCI_SSH_KEY=… tools/paypal/migrate-oci.sh                                  list what is missing (read-only)
#   OCI_HOST=… OCI_SSH_KEY=… tools/paypal/migrate-oci.sh --apply --backup <dump file>     apply the missing ones
#
# --apply needs proof of a fresh backup: a dump made in the last 2 hours by the coordinator tool
# (`python3 tools/runtime/backup-bitpos-db.py`, run from ~/Desktop/BitPOS; it writes local/private/db-backups/).
# All missing files go in ONE transaction with lock_timeout 5 s, each recorded in public.bitpos_migrations with its
# sha256; any error rolls everything back. Only 4xx PayPal files are ever sent; 0xx/1xx/3xx belong to other streams.
# Refuses --apply before 2026-11-05 09:00 ICT (the Meta hackathon deadline on the same host).
set -euo pipefail
: "${OCI_HOST:?set OCI_HOST=user@host}" "${OCI_SSH_KEY:?set OCI_SSH_KEY=/path/to/private/key}"
APPLY=0;BACKUP=
while [ $# -gt 0 ]; do case "$1" in --apply) APPLY=1;; --backup) BACKUP=${2:-};shift;; *) echo "unknown argument $1" >&2;exit 2;; esac;shift;done
cd "$(git rev-parse --show-toplevel)"
SSH=(ssh -i "$OCI_SSH_KEY" -o BatchMode=yes "$OCI_HOST")
DB=bitpos-staging-db-1
psql_remote(){ "${SSH[@]}" "docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -qAt"; }
sha(){ shasum -a 256 "$1" | cut -d' ' -f1; }

missing=()
for f in supabase/migrations/4[0-9][0-9]_paypal_*.sql; do
  n=$(basename "$f")
  row=$(echo "SELECT coalesce(to_jsonb(m)->>'source_sha256','-') FROM public.bitpos_migrations m WHERE name='$n';" | psql_remote)
  if [ -z "$row" ]; then missing+=("$f"); echo "missing  $n"
  elif [ "$row" = "-" ] || [ "$row" = "$(sha "$f")" ]; then echo "applied  $n"
  else echo "CHANGED  $n (applied with a different sha256; write a new migration instead)" >&2; exit 1; fi
done
[ ${#missing[@]} -eq 0 ] && { echo "all PayPal migrations applied"; exit 0; }
# 401 replaces the pre-existing bitpos.unpaid_order_safe (last defined by 055 in every stream's repository). If the live
# definition is not that version, another stream changed it since: stop rather than overwrite their change.
if printf '%s\n' "${missing[@]}" | grep -q 401_paypal_ledger; then
  live=$(echo "SELECT md5(pg_get_functiondef('bitpos.unpaid_order_safe(uuid,uuid)'::regprocedure));" | psql_remote)
  [ "$live" = 6d9bae04089da015a694142e96aa4df6 ] && echo "unpaid_order_safe: live definition is the 055 version (safe to extend)" \
    || { echo "STOP: live unpaid_order_safe differs from the 055 version ($live); merge that change into 401 first" >&2; exit 1; }
fi
[ "$APPLY" = 1 ] || { echo; echo "read-only listing; nothing changed. Back up, then re-run with --apply --backup <dump>."; exit 0; }

[ "$(date +%s)" -ge 1793844000 ] || { echo "refusing --apply before 2026-11-05 09:00 ICT" >&2; exit 1; }
[ -n "$BACKUP" ] && [ -s "$BACKUP" ] || { echo "refusing: --backup <dump file> is required and must not be empty" >&2; exit 1; }
age=$(( $(date +%s) - $(stat -f %m "$BACKUP" 2>/dev/null || stat -c %Y "$BACKUP") ))
[ "$age" -le 7200 ] || { echo "refusing: backup is $((age/60)) minutes old (max 120)" >&2; exit 1; }
echo "backup ok: $(basename "$BACKUP") ($(du -h "$BACKUP" | cut -f1), $((age/60)) min old)"

TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
{ echo "BEGIN;"; echo "SET LOCAL lock_timeout='5s';"
  echo "ALTER TABLE public.bitpos_migrations ADD COLUMN IF NOT EXISTS source_sha256 text;"
  for f in "${missing[@]}"; do n=$(basename "$f")
    echo "\\echo applying $n"; cat "$f"; echo
    echo "INSERT INTO public.bitpos_migrations(name,source_sha256) VALUES('$n','$(sha "$f")');"; done
  echo "COMMIT;"; } >"$TMP"
psql_remote <"$TMP"
echo "SELECT count(*) FROM information_schema.tables WHERE table_schema='bitpos' AND table_name LIKE 'paypal_%';" | psql_remote | sed 's/^/paypal tables: /'
