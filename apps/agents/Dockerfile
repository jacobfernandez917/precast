# syntax=docker/dockerfile:1
# Mastra agents app — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/agents/Dockerfile -t precast-agents .

# ---- build: install the workspace and compile the Mastra bundle ----
# The dependency layer. Defaults to plain node so a clone with no registry
# access builds exactly as before; `pnpm poc` upgrades this to a prebuilt
# ghcr.io/.../precast-deps:lock-<hash> when one matching THIS lockfile is
# published (scripts/deps-image.mjs). Because the tag is the lockfile hash, a
# mismatched image cannot be silently consumed — it simply doesn't exist.
ARG BASE_IMAGE=node:24-alpine
FROM ${BASE_IMAGE} AS build
# Idempotent: already enabled in the deps image, needed on the plain fallback.
RUN corepack enable
WORKDIR /repo
COPY . .
# A no-op relink when the base already carries this lockfile's packages; a real
# (but store-warm, offline) install otherwise. `--store-dir` must match the one
# baked into deps.Dockerfile or the warm content is invisible here.
RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir "${PNPM_STORE_DIR:-/pnpm/store}"
# Filter by workspace PATH, not package name: a name-based `--filter @scope/pkg`
# that matches nothing (e.g. after `pnpm rename`) exits 0 and builds nothing,
# which only surfaces as an opaque COPY failure below. The `test -f` then makes
# a would-be-empty build fail loudly, here, instead of at the runtime COPY.
RUN pnpm --filter "./packages/shared" build \
 && pnpm --filter "./apps/agents" build \
 && test -f apps/agents/.mastra/output/index.mjs

# ---- runtime: the self-contained .mastra/output bundle (own node_modules) ----
FROM node:24-alpine AS runtime
# No MASTRA_DB_URL default. Agent memory lives in the managed Postgres supplied
# via .env (ADR-002); MASTRA_DB_URL is optional and falls back to DATABASE_URL.
# Baking `file:/data/mastra.db` here — as this image used to — is now a boot
# failure, not a fallback: the env schema validates MASTRA_DB_URL as a Postgres
# URL and rejects `file:`. Compose deliberately sets no value either, so
# whatever the image declares IS what the container gets.
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0 \
    MASTRA_PORT=45000
WORKDIR /app
COPY --from=build /repo/apps/agents/.mastra/output ./
EXPOSE 45000
CMD ["node", "index.mjs"]
