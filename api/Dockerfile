# Production image for the API on the Hostinger VPS (deploy/vps/). Railway
# ALSO builds from this file: it auto-detects a Dockerfile in the service's
# root directory (switched from Railpack on 2026-11-04). The API reads $PORT,
# so it kept working there - keep it that way (see web/Dockerfile's CMD note).
#
# Debian slim, not Alpine: Prisma's query engine needs OpenSSL and a glibc
# build, and slim avoids the musl engine variant entirely.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The prisma CLI is a devDependency; it is put back (same version as the
# client) after the prune so deploy.sh can run `prisma migrate deploy` from
# this same image.
RUN npx prisma generate && npm run build && npm prune --omit=dev \
 && npm install --no-save --omit=dev "prisma@$(node -p "require('@prisma/client/package.json').version")"

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TZ=UTC \
    PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# Agent installers, tenant logos and ticket attachments live here (paths are
# relative to the working directory) - mounted as a volume in compose.
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
EXPOSE 3000
# Migrations are NOT run on start: deploy/vps/deploy.sh runs
# `prisma migrate deploy` once, in a one-off container, before swapping.
CMD ["node", "dist/src/main"]
