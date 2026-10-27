# syntax=docker/dockerfile:1
# Mastra agents app — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/agents/Dockerfile -t precast-agents .

# ---- build: install the workspace and compile the Mastra bundle ----
FROM node:lts-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
# Filter by workspace PATH, not package name: a name-based `--filter @scope/pkg`
# that matches nothing (e.g. after `pnpm rename`) exits 0 and builds nothing,
# which only surfaces as an opaque COPY failure below. The `test -f` then makes
# a would-be-empty build fail loudly, here, instead of at the runtime COPY.
# The agents build also emits telemetry.mjs, the preload the CMD starts first.
RUN pnpm --filter "./packages/shared" --filter "./packages/a2ui" build \
 && pnpm --filter "./apps/agents" build \
 && test -f apps/agents/.mastra/output/index.mjs \
 && test -f apps/agents/.mastra/output/telemetry.mjs

# ---- runtime: the self-contained .mastra/output bundle (own node_modules) ----
FROM node:lts-alpine AS runtime
# No MASTRA_DB_URL default. Agent memory lives in the managed Postgres supplied
# via .env (ADR-002); MASTRA_DB_URL is optional and falls back to DATABASE_URL.
# Baking `file:/data/mastra.db` here — as this image used to — is now a boot
# failure, not a fallback: the env schema validates MASTRA_DB_URL as a Postgres
# URL and rejects `file:`. AgentBase supplies DATABASE_URL from the project's
# variables, so whatever the image declares IS what the container gets.
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0 \
    MASTRA_PORT=45000
# Mastra sends anonymous usage analytics to a third-party service from every
# server unless this is set. A Precast agent runs on AgentBase, which governs
# what leaves the container (telemetry goes to AgentBase's own endpoint), so
# it is off. The agents scripts set the same for the CLI (mastra dev|build|start).
ENV MASTRA_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/agents/.mastra/output ./
# Drop root. `node:lts-alpine` ships an unprivileged `node` user (uid 1000), and
# nothing here needs more: both ports are above 1024, and the bundle is only
# read at runtime. Running as root turns any container escape or arbitrary-write
# bug into a considerably worse incident, and it is the default nobody chooses
# deliberately — it is simply what happens when no USER is set.
#
# --chown on the COPY rather than a `chown -R` layer: same result, no duplicated
# copy of the whole bundle in an extra layer.
USER node
EXPOSE 45000
# Prefer IPv4 when a host resolves to both. AgentBase is Cloudflare-fronted and
# publishes AAAA records, while Docker's default bridge has IPv6 disabled — so a
# container that picks the AAAA gets ENETUNREACH. Plain `node` often survives via
# Happy Eyeballs; Next's fetch runtime does not, which is why this surfaced as an
# intermittent `fetch failed` that looked exactly like bad credentials.
#
# Set on the CMD, NOT as ENV NODE_OPTIONS: a NODE_OPTIONS supplied through
# the host's environment would REPLACE the image's value and silently drop this —
# the same shadowing that once made the transport switch unsettable.
#
# --import ./telemetry.mjs starts OpenTelemetry before the app graph loads, so
# the http/fetch instrumentation and trace-context propagation are in place for
# the first request. AgentBase injects the OTEL_* settings into a container it
# hosts; with none, this only propagates context (apps/agents/src/mastra/telemetry/otel.ts).
CMD ["node", "--dns-result-order=ipv4first", "--import", "./telemetry.mjs", "index.mjs"]
