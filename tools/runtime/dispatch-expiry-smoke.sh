#!/usr/bin/env bash
set -euo pipefail
# Only a uniquely named local disposable database; source schema and public asset
# metadata are copied, never merchant/customer rows or credentials.
db="bitpos_dispatch_expiry_fixture_$$"
createdb -h 127.0.0.1 -p 55436 -U cryptoclock "$db"
trap 'dropdb -h 127.0.0.1 -p 55436 -U cryptoclock "$db"' EXIT
pg_dump -h 127.0.0.1 -p 55436 -U cryptoclock --schema-only --no-owner bitpos_delivery_fixture | psql -q -h 127.0.0.1 -p 55436 -U cryptoclock -d "$db" -v ON_ERROR_STOP=1
pg_dump -h 127.0.0.1 -p 55436 -U cryptoclock --data-only --table=bitpos.payment_assets --table=public.bitpos_migrations --no-owner bitpos_delivery_fixture | psql -q -h 127.0.0.1 -p 55436 -U cryptoclock -d "$db" -v ON_ERROR_STOP=1
BITPOS_DISPATCH_EXPIRY_DATABASE="$db" pnpm exec tsx tools/runtime/delivery-snapshot-smoke.ts --dispatch --custody --issuer-expiry
