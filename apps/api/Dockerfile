# syntax=docker/dockerfile:1
# Mastra agent API — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/api/Dockerfile -t precast-api .

# ---- build: install the workspace and compile the Mastra bundle ----
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @precast/shared build \
 && pnpm --filter @precast/api build

# ---- runtime: the self-contained .mastra/output bundle (own node_modules) ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0 \
    MASTRA_PORT=4111 \
    MASTRA_DB_URL=file:/data/mastra.db
WORKDIR /app
# Agent-memory dir; a named volume mounts over this in compose, but create it so
# the image also runs standalone (MASTRA_DB_URL defaults to file:/data/mastra.db).
RUN mkdir -p /data
COPY --from=build /repo/apps/api/.mastra/output ./
EXPOSE 4111
CMD ["node", "index.mjs"]
