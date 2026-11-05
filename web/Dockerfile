# Production image for the dashboard on the Hostinger VPS (deploy/vps/).
# Railway ALSO builds from this file: it auto-detects a Dockerfile in the
# service's root directory (switched from Railpack on 2026-11-04), so keep it
# working there too - see the CMD note below.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so
# the Stripe publishable key (public by design, not a secret) must be passed
# as a build arg - setting it only at runtime would leave the card form blank.
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TZ=UTC \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
USER node
EXPOSE 3000
# No `-p`: `next start` listens on $PORT. Railway injects its own PORT and
# routes traffic there - a hard-coded `-p 3000` took omniprint.app.br down
# (502) from 2026-11-04 20:57Z. The VPS gets 3000 from the ENV above.
CMD ["npx", "next", "start"]
