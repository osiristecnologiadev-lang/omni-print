# OmniPrint on the Hostinger VPS — runbook

Target: `root@187.127.60.242` (Hostinger KVM 4, São Paulo, Ubuntu 24.04).
**This VPS also runs Vortex (`/opt/vortex`), which is critical**: a store
sells through it and its Windows cashiers sync to it. Every step below is
written so that OmniPrint can't take Vortex down.

## Coexistence rules (do not break)

- Vortex's Caddy (`vortex-caddy-1`) owns ports 80/443. OmniPrint has **no
  proxy and no published ports**. Caddy reaches it through the
  `omniprint_edge` network.
- OmniPrint lives in its own directory (`/opt/omniprint`), compose project
  (`omniprint`), networks and Postgres. It never touches Vortex's Postgres.
- Every OmniPrint container has memory and CPU limits, ~4.5 GB / 4 CPUs in
  total, so it can't starve Vortex. The VPS has no swap, and the Vortex
  backend has no memory limit.
- Never run `docker system prune`, `docker volume prune`, or `docker compose
  down` outside `/opt/omniprint`. Never read or copy `/opt/vortex/.env`.
- Changes to Vortex's Caddyfile: make a backup first, then `caddy validate`,
  then `caddy reload` (no downtime). Do it **outside the store's hours** and
  tell the Vortex owner first.
- No new ufw ports.

## Phase 0 — local (done in the repo)

- `api/Dockerfile`, `web/Dockerfile`, `ops/db-backup/Dockerfile`, built by
  `.github/workflows/deploy-vps.yml` and pushed to GHCR.
- The deploy job is off until the repo variable `VPS_DEPLOY_ENABLED=true`
  is set.
- `api` honours `TRUST_PROXY=1` (real client IP behind Caddy, so the
  60/min throttler is per client again). Unset on Railway, so Railway
  behaves as before.

## Phase 1 — bring OmniPrint up in parallel (Vortex untouched)

1. `mkdir -p /opt/omniprint && chmod 700 /opt/omniprint`. Copy
   `docker-compose.yml` and `deploy.sh` (`chmod 700`) into it.
2. Create `/opt/omniprint/.env` from `.env.example` (`chmod 600`):
   - Copy the values from Railway.
   - Generate a **new** `POSTGRES_PASSWORD`.
   - Keep `JWT_SECRET` identical to Railway's, so current logins stay valid.
3. Create a CI-only deploy key:
   - Generate `ssh-keygen -t ed25519 -C omniprint-ci`.
   - Add the public key to `/root/.ssh/authorized_keys` with the forced
     command shown at the top of `deploy.sh`.
   - Add the GitHub secrets `VPS_HOST`, `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`,
     and the GitHub variable `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
4. Start the database and restore the newest R2 backup into it. Use the
   `postgres:16` psql (≥16.10, because dumps contain `\restrict`). The only
   expected errors are the known cosmetic hypertable FK errors.
   ```
   docker compose -p omniprint up -d db
   gunzip -c omniprint-<date>.sql.gz | docker compose -p omniprint exec -T db psql -U omniprint -d omniprint
   ```
5. Copy the agent installers, tenant logos and ticket attachments into the
   `api_storage` volume:
   - Download them with `railway volume files download`, as on 2026-10-09.
   - Copy them into the volume with
     `docker run --rm -v omniprint_api_storage:/s -v $PWD:/in alpine cp -a /in/. /s/`.
   - Run `chown -R 1000:1000` on the volume (the container user is `node`).
6. First deploy: `./deploy.sh deploy latest`. This pulls the images, runs the
   migrations, starts api and web, and runs the health check.
7. **Do NOT enable the backup cron yet.** The backup file name is
   `omniprint-<date>.sql.gz` in the same bucket, so a VPS run would
   overwrite Railway's real backup of that day.

## Phase 2 — hook into Caddy with test hostnames (store closed)

1. In Cloudflare, create `vps.omniprint.app.br` and
   `api-vps.omniprint.app.br` as **DNS only** (grey cloud) A records pointing
   to `187.127.60.242`.
2. Follow the header of `Caddyfile.omniprint` (one-time setup):
   - back up the Caddyfile;
   - run `docker network connect omniprint_edge vortex-caddy-1`;
   - copy the file to `/opt/vortex/dados/caddy-config/omniprint.caddy`;
   - append ONE line with `>>`: `import /config/omniprint.caddy`;
   - run `caddy validate`, then `caddy reload`.

   After this, every OmniPrint change, including the cutover, edits only
   `omniprint.caddy`. Vortex's own Caddyfile is never touched again.
3. Make the network connection permanent. Ask the Vortex owner to add this
   to the caddy service in `/opt/vortex/docker-compose.yml`, taking effect
   on Vortex's next `up`:
   ```yaml
   networks: [default, omniprint_edge]   # plus, at the bottom:
   networks:
     omniprint_edge:
       external: true
   ```
   Without it, recreating Vortex's caddy silently detaches OmniPrint.
4. Check that Vortex still answers (`app.vortexsoft.app.br`).
5. Test OmniPrint on `https://vps.omniprint.app.br`:
   - login;
   - customers, devices, the pages report;
   - invoice PDF;
   - agent-installer download;
   - `/v1/health` on `api-vps`.

## Phase 3 — cutover (early morning, ~15–20 min of agent pause)

1. The day before, lower the TTL of the `omniprint.app.br` records in
   Cloudflare to 60 s.
2. Restore a **fresh** R2 backup on the VPS as a dry run, and compare row
   counts with Railway.
3. At the window:
   1. Stop Railway `api`, then `web`. Agents keep their state and retry.
   2. Take the final dump: redeploy Railway's `db-backup` (see the
      reference memory: `deploymentRestart`), or take a `pg_dump` through a
      temporary tcp-proxy.
   3. On the VPS, stop api and web, then recreate the empty database. Use
      `docker compose -p omniprint down` **inside /opt/omniprint only**,
      and remove the `omniprint_db_data` volume by name.
   4. Restore the final dump, then run `./deploy.sh deploy latest`.
   5. Sync `api_storage` again, in case of uploads since Phase 1.
   6. Switch `omniprint.caddy` to Stage 2, then validate and reload.
   7. In Cloudflare, point `omniprint.app.br`, `www` and `api` at the VPS
      IP (A records). Remove the Railway CNAME records and any
      Railway-related TXT records.
4. Check:
   - agents start reporting again (`/logs`, "último contato");
   - the panel works;
   - a manual ops alert reaches the inbox;
   - the Stripe webhook endpoint answers. In the Stripe dashboard, check
     that the URL uses `api.omniprint.app.br` and not a `*.up.railway.app`
     URL.
5. Enable the backup: put this host crontab line in place, then run it once
   by hand and look for the file in R2.
   ```
   0 5 * * * cd /opt/omniprint && docker compose -p omniprint --profile backup run --rm db-backup >> /var/log/omniprint-backup.log 2>&1
   ```
6. Set `VPS_DEPLOY_ENABLED=true`, so pushes to `main` deploy to the VPS.

## Phase 4 — afterwards

- Keep Railway **stopped but not deleted** for ~7 days, as a rollback path:
  point DNS back and start the Railway services again.
- Then disconnect Railway's auto-deploy and delete the project.
- Remove `vps.` and `api-vps.` from Cloudflare and from the Caddyfile.

## Rollback (any phase)

- **Caddy:** restore `Caddyfile.bak-*`, then `caddy reload`.
- **Cutover:** point DNS back to Railway and start Railway `api` and `web`.
  Data written on the VPS in the meantime would need to be carried back;
  agent readings self-heal, but manual panel edits do not.
- **Bad image:** `./deploy.sh deploy $(cat .deployed-tag.prev)`.
