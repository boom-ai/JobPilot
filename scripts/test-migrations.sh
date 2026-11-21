#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres database (with a stub of Supabase's auth schema)
# and verifies Row Level Security isolates users. Requires `psql` and a local Postgres superuser.
set -euo pipefail
DB=${DB:-jp_migration_test}
PSQL=${PSQL:-"sudo -u postgres psql"}
$PSQL -q -c "drop database if exists $DB" -c "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/test/auth_stub.sql -f supabase/migrations/0001_init.sql
echo "migration applied ✓"
$PSQL -q -d "$DB" -f supabase/test/rls_test.sql
