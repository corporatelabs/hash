# syntax=docker/dockerfile:1
# Node 22 LTS. better-sqlite3 publishes prebuilds for this line. Node 24 does not,
# so the image, CI, and .nvmrc all stay on 22.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build:client && npm run build:server \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    ENVIRONMENT=production \
    STORAGE=sqlite \
    DATABASE_PATH=/data/hash.sqlite \
    STATIC_ROOT=/app/dist/client \
    HOME=/tmp
RUN groupadd --system --gid 65532 hash \
  && useradd --system --uid 65532 --gid 65532 --home-dir /tmp --shell /usr/sbin/nologin hash \
  && mkdir -p /data \
  && chown -R hash:hash /data /app
COPY --from=build --chown=65532:65532 /app/package.json ./
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/adapters/node/main.js"]
