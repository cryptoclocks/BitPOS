#!/bin/zsh
# Create (or recreate) the throwaway database bitpos_render_fixture on the local fixture cluster (port 55440)
# and apply every supabase/migration in order. Roles (bitpos_app etc.) already exist on that cluster.
# Migration 029 has a guard that needs 3 historical Gemini starts: seeded here under a synthetic merchant, as in docs/RUNBOOK_BACKUP_RESTORE_TH.md.
set -e
cd "$(dirname $0)/../../../../.."
export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
H=(-h 127.0.0.1 -p ${PGPORT_RENDER:-55440} -U cryptoclock)
DB=bitpos_render_fixture
[ "$1" = "--recreate" ] && psql "${H[@]}" -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
psql "${H[@]}" -d postgres -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1 && { echo "$DB exists (use --recreate)"; exit 0; }
psql "${H[@]}" -d postgres -qc "CREATE DATABASE $DB"
for f in supabase/migrations/*.sql; do
  n=$(basename $f)
  if [ "$n" = "029_coffee_copilot.sql" ]; then
    psql "${H[@]}" -d $DB -q -c "SET search_path TO bitpos,extensions,public; INSERT INTO merchants(id,name,treasury) VALUES('00000000-0000-0000-0000-0000000000d1','drill-synthetic','synthetic'); INSERT INTO ai_generation_jobs(merchant_id,state,actor_id,input,products,attempts,provider_origin) SELECT '00000000-0000-0000-0000-0000000000d1','FAILED','drill','{}','[]',1,'https://generativelanguage.googleapis.com' FROM generate_series(1,3);"
  fi
  psql "${H[@]}" -d $DB -q -1 -v ON_ERROR_STOP=1 -f $f >/dev/null || { echo "FAILED $n"; exit 1; }
done
echo "applied $(ls supabase/migrations | wc -l) migrations to $DB"
