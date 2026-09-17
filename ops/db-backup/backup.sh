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
R2_REMOTE="r2"

DATE="$(date -u +%F)"
DUMP_FILE="/tmp/omniprint-${DATE}.sql.gz"

echo "Dumping database..."
# Full dump (schema + data, pg_dump's default - never pass --data-only).
# TimescaleDB's continuous aggregates create circular-looking FK
# constraints, which pg_dump warns about (seen for real against this
# project's own local DB) - not a dump-time error, but if a real restore
# of this dump ever fails on that constraint, retry with
# `psql --single-transaction --disable-triggers` per pg_dump's own hint.
pg_dump "$DATABASE_URL" | gzip > "$DUMP_FILE"

# A near-empty dump almost certainly means pg_dump failed partway (bad
# DATABASE_URL, connection refused, etc.) rather than the DB genuinely
# having nothing in it - never keep/upload a backup that isn't real. This
# is the same "don't trust a suspiciously-small result" caution this
# project's own billing logic already applies elsewhere.
SIZE="$(wc -c < "$DUMP_FILE")"
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: dump is only ${SIZE} bytes - aborting, not uploading a likely-broken backup" >&2
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
