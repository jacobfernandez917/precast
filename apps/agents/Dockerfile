# syntax=docker/dockerfile:1
# Mastra agents app — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/agents/Dockerfile -t precast-agents .

# ---- build: install the workspace and compile the Mastra bundle ----
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
# Filter by workspace PATH, not package name: a name-based `--filter @scope/pkg`
# that matches nothing (e.g. after `pnpm rename`) exits 0 and builds nothing,
# which only surfaces as an opaque COPY failure below. The `test -f` then makes
# a would-be-empty build fail loudly, here, instead of at the runtime COPY.
RUN pnpm --filter "./packages/shared" build \
 && pnpm --filter "./apps/agents" build \
 && test -f apps/agents/.mastra/output/index.mjs

# ---- runtime: the self-contained .mastra/output bundle (own node_modules) ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0 \
    MASTRA_PORT=45000 \
    MASTRA_DB_URL=file:/data/mastra.db
WORKDIR /app
# Agent-memory dir; a named volume mounts over this in compose, but create it so
# the image also runs standalone (MASTRA_DB_URL defaults to file:/data/mastra.db).
RUN mkdir -p /data
COPY --from=build /repo/apps/agents/.mastra/output ./
EXPOSE 45000
CMD ["node", "index.mjs"]
