#!/usr/bin/env bash
# Deploys one image tag of OmniPrint on the VPS. Lives at
# /opt/omniprint/deploy.sh and is the FORCED COMMAND of the CI deploy key in
# /root/.ssh/authorized_keys, so that key can run this script and nothing
# else:
#   command="/opt/omniprint/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... omniprint-ci
#
# The CI sends `deploy <git-sha>` as the SSH command and a short-lived GHCR
# read token on stdin. Manual use on the box:  ./deploy.sh deploy <sha|latest>
# Rollback = deploy the previous tag (kept in .deployed-tag.prev).
#
# Touches ONLY the "omniprint" compose project. Never prunes anything.
set -euo pipefail
cd /opt/omniprint

ARGS="${SSH_ORIGINAL_COMMAND:-$*}"
read -r VERB TAG EXTRA <<<"$ARGS" || true
if [[ "$VERB" != "deploy" || -n "${EXTRA:-}" || ! "$TAG" =~ ^([0-9a-f]{7,40}|latest)$ ]]; then
  echo "usage: deploy <git-sha|latest>" >&2
  exit 2
fi

export IMAGE_TAG="$TAG"
COMPOSE=(docker compose --project-name omniprint -f /opt/omniprint/docker-compose.yml)

# Registry login only when a token is piped in (CI). The token is the job's
# own GITHUB_TOKEN, valid only while the workflow runs.
if [ ! -t 0 ]; then
  TOKEN="$(cat)"
  if [ -n "$TOKEN" ]; then
    printf '%s' "$TOKEN" | docker login ghcr.io -u omniprint-ci --password-stdin >/dev/null
    trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
  fi
fi

echo "==> pulling $TAG"
"${COMPOSE[@]}" --profile backup pull api web db-backup

echo "==> migrations"
# --wait: block until db's healthcheck passes - without it the migration
# races a still-starting Postgres (seen in the local test run).
"${COMPOSE[@]}" up -d --wait db
"${COMPOSE[@]}" run --rm --no-deps -T api npx prisma migrate deploy

echo "==> starting api + web"
"${COMPOSE[@]}" up -d --no-deps api web

echo "==> health check"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T api node -e \
      "fetch('http://localhost:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    [ -f .deployed-tag ] && cp .deployed-tag .deployed-tag.prev
    echo "$TAG" > .deployed-tag
    echo "==> OK: $TAG is live"
    exit 0
  fi
  sleep 2
done
echo "==> api did not become healthy - roll back with: ./deploy.sh deploy \$(cat .deployed-tag.prev)" >&2
exit 1
