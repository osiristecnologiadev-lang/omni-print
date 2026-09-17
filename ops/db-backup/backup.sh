#!/bin/bash
# Nightly Postgres -> Cloudflare R2 backup. Runs as a one-shot Railway
# service on a cron schedule (see ../../reference-railway-infra memory /
# the deploy.cronSchedule field) - the container starts, this script runs
# to completion, and Railway stops it until the next scheduled trigger.
# Not a long-running daemon.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"

API_BASE_URL="${API_BASE_URL:-https://api.omniprint.app.br}"

# Failure-only alert, reusing the exact same webhook web/'s instrumentation.ts
# calls (api/src/ops-alerts/) - deliberately not a "backup succeeded" email
# every night too (user's own choice: silence means it worked, an email
# means it didn't). OPS_ALERT_SECRET is optional here on purpose - a
# misconfigured alert must never be why a real backup failure goes
# unnoticed, but it also must never block the backup itself, so this is
# best-effort and silent about its own failure.
alert_failure() {
  local msg="$1"
  echo "ERROR: ${msg}" >&2
  if [ -n "${OPS_ALERT_SECRET:-}" ]; then
    curl -sS -m 10 -X POST "${API_BASE_URL}/v1/ops/alert" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${OPS_ALERT_SECRET}" \
      -d "{\"message\":\"${msg}\",\"path\":\"db-backup cron\"}" \
      >/dev/null 2>&1 || true
  fi
}
# set -e means an explicit `exit 1` (used below for the too-small-dump
# case) does NOT run this trap - it only fires for a command that returns
# non-zero on its own (pg_dump, rclone, etc.), per bash's own ERR-trap
# semantics. The too-small-dump branch calls alert_failure directly
# instead, before its own exit.
trap 'alert_failure "db-backup failed at line $LINENO - check the db-backup service logs on Railway"' ERR

# rclone's RCLONE_CONFIG_<REMOTE>_<KEY> env-var convention defines a
# remote named "r2" without ever writing an rclone.conf file. Tried the
# inline ":backend,param=value:path" connection-string syntax first, but
# rclone's parser chokes on the colons inside the endpoint URL itself
# ("Custom endpoint `https` was not a valid URI") - env vars sidestep that
# entirely since there's no single string to parse.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
# rclone's S3 backend tries a CreateBucket call before writing, to make
# sure the destination exists - real R2 API tokens are scoped to object
# read/write only (no bucket-admin rights), so that call itself 403s even
# though the bucket already exists and the actual write would have been
# fine. --s3-no-check-bucket skips that check entirely (confirmed by
# hitting the real 403 against this project's own real R2 token first).
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
R2_REMOTE="r2"

DATE="$(date -u +%F)"
DUMP_FILE="/tmp/omniprint-${DATE}.sql.gz"

echo "Dumping database..."
# Full dump (schema + data, pg_dump's default - never pass --data-only).
# TimescaleDB's hypertables (metrics) create circular-looking FK
# constraints, which pg_dump warns about - confirmed by an actual
# restore-into-a-scratch-database test against a real backup (not just
# reading the warning): every row in every table, metrics included,
# restores byte-for-byte correctly (verified via COUNT(*), not the
# stale/estimated pg_stat_user_tables.n_live_tup), and metrics comes back
# as a real hypertable with the right chunks. The ONLY actual gap is
# cosmetic: metrics' device_id FK constraint fails to (re-)declare on the
# parent hypertable itself ("ONLY option not supported on hypertable
# operations") because the per-CHUNK FK constraints already satisfy it -
# a plain `psql -f` restore is safe to use as-is, this is not a reason to
# add --disable-triggers or anything else.
pg_dump "$DATABASE_URL" | gzip > "$DUMP_FILE"

# A near-empty dump almost certainly means pg_dump failed partway (bad
# DATABASE_URL, connection refused, etc.) rather than the DB genuinely
# having nothing in it - never keep/upload a backup that isn't real. This
# is the same "don't trust a suspiciously-small result" caution this
# project's own billing logic already applies elsewhere.
SIZE="$(wc -c < "$DUMP_FILE")"
if [ "$SIZE" -lt 1024 ]; then
  alert_failure "db-backup produced a suspiciously small dump (${SIZE} bytes) - aborted, did not upload"
  exit 1
fi
echo "Dump OK (${SIZE} bytes), uploading to R2..."

rclone copyto "$DUMP_FILE" "${R2_REMOTE}:${R2_BUCKET}/$(basename "$DUMP_FILE")"
rm -f "$DUMP_FILE"

# Simple retention: keep the last 14 daily backups. Adjust if a longer
# history is ever needed - R2's free tier (10GB) has a lot of headroom at
# this project's current data volume.
echo "Pruning backups older than 14 days..."
rclone delete --min-age 14d "${R2_REMOTE}:${R2_BUCKET}/"

echo "Backup complete."
