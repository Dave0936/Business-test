#!/usr/bin/env bash
# Applies the Supabase shim + migrations to a scratch Postgres database and runs the SQL tests.
# Usage: TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres ./scripts/test-db.sh
set -euo pipefail
BASE="${TEST_DATABASE_URL:-postgres://postgres@127.0.0.1:54322/postgres}"
DB="wo_test_$$"
psql "$BASE" -q -v ON_ERROR_STOP=1 -c "create database $DB"
trap 'psql "$BASE" -q -c "drop database if exists $DB" >/dev/null' EXIT
URL="${BASE%/*}/$DB"
cd "$(dirname "$0")/.."
psql "$URL" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
for f in supabase/tests/[1-9]*.sql; do echo "== $f"; psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" | grep -E "PASSED|ERROR" || true; done
