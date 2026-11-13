#!/usr/bin/env bash
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from tools/near/migrate-oci.sh.
# Applies the NEAR migrations (supabase/migrations/50x_near_*.sql) to the one BitPOS database on the OCI host.
#
#   OCI_HOST=… OCI_SSH_KEY=… tools/near/migrate-oci.sh                                  list what is missing (read-only)
#   OCI_HOST=… OCI_SSH_KEY=… tools/near/migrate-oci.sh --apply --backup <dump file>     apply the missing ones
#
# --apply needs proof of a fresh backup: a dump made in the last 2 hours by the coordinator tool
# (`python3 tools/runtime/backup-bitpos-db.py`, run from ~/Desktop/BitPOS; it writes local/private/db-backups/).
# All missing files go in ONE transaction with lock_timeout 5 s, each recorded in public.bitpos_migrations with its
# sha256; any error rolls everything back. Only 5xx NEAR files are ever sent; 0xx/1xx/3xx/4xx belong to other streams.
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
for f in supabase/migrations/5[0-9][0-9]_near_*.sql; do
  n=$(basename "$f")
  row=$(echo "SELECT coalesce(to_jsonb(m)->>'source_sha256','-') FROM public.bitpos_migrations m WHERE name='$n';" | psql_remote)
  if [ -z "$row" ]; then missing+=("$f"); echo "missing  $n"
  elif [ "$row" = "-" ] || [ "$row" = "$(sha "$f")" ]; then echo "applied  $n"
  else echo "CHANGED  $n (applied with a different sha256; write a new migration instead)" >&2; exit 1; fi
done
[ ${#missing[@]} -eq 0 ] && { echo "all NEAR migrations applied"; exit 0; }
# 501 rebuilds bitpos.unpaid_order_safe, keeping the PayPal clauses when PayPal tables exist. Dry run in a rolled-back
# transaction: the only difference between the live definition and the rebuilt one must be the two NEAR clauses;
# anything else means another stream changed the function since, so stop rather than overwrite their change.
if printf '%s\n' "${missing[@]}" | grep -q 501_near_ledger; then
  DRY=$(mktemp)
  { echo "BEGIN;"; echo "SET LOCAL lock_timeout='5s';"
    echo "\\o /dev/null"; for f in "${missing[@]}"; do cat "$f"; echo; done; echo "\\o"
    echo "SELECT pg_get_functiondef('bitpos.unpaid_order_safe(uuid,uuid)'::regprocedure);"; echo "ROLLBACK;"; } >"$DRY"
  live=$(echo "SELECT pg_get_functiondef('bitpos.unpaid_order_safe(uuid,uuid)'::regprocedure);" | psql_remote)
  rebuilt=$(psql_remote <"$DRY" | sed '/^BEGIN$/d;/^SET$/d;/^ROLLBACK$/d'); rm -f "$DRY"
  extra=$(diff <(echo "$live" | tr -s ' ' | sed 's/^ //') <(echo "$rebuilt" | tr -s ' ' | sed 's/^ //') | grep '^[<>]' || true)
  echo "$extra" | sed 's/^/  diff: /'
  # A removed line is fine only when it reappears with just its closing ");" moved to the end of the NEAR clauses.
  while IFS= read -r line; do
    body=$(echo "${line#< }" | sed -E 's/\)+;?$//')
    echo "$extra" | grep '^>' | sed 's/^> //' | sed -E 's/\)+;?$//' | grep -qxF "$body" || { echo "STOP: the rebuilt unpaid_order_safe drops: $line" >&2; exit 1; }
  done < <(echo "$extra" | grep '^<' || true)
  echo "$extra" | grep '^>' | grep -vqE 'near_bills|near_settlements|ESCROW|SETTLING|^> *AND NOT EXISTS|order_id=o.id\)\);|^> *\)' && { echo "STOP: unexpected additions" >&2; exit 1; }
  echo "unpaid_order_safe: rebuilt definition = live definition + NEAR clauses only"
fi
[ "$APPLY" = 1 ] || { echo; echo "read-only listing; nothing changed. Back up, then re-run with --apply --backup <dump>."; exit 0; }

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
echo "SELECT count(*) FROM information_schema.tables WHERE table_schema='bitpos' AND table_name LIKE 'near_%';" | psql_remote | sed 's/^/near tables: /'
