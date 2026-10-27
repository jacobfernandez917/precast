# syntax=docker/dockerfile:1
# Next.js web app — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/web/Dockerfile -t precast-web .

# ---- build: install the workspace and build Next (standalone output) ----
FROM node:lts-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
# Filter by workspace PATH, not package name: a name-based `--filter @scope/pkg`
# that matches nothing (e.g. after `pnpm rename`) exits 0 and builds nothing,
# which only surfaces as an opaque COPY failure below. The `test -f` then makes
# a would-be-empty build fail loudly, here, instead of at the runtime COPY.
RUN pnpm --filter "./packages/shared" --filter "./packages/a2ui" build \
 && pnpm --filter "./apps/web" build \
 && test -f apps/web/.next/standalone/apps/web/server.js

# ---- runtime: the self-contained Next standalone server ----
# `output: 'standalone'` (next.config.ts) emits a minimal server plus only the
# node_modules it traces. With outputFileTracingRoot at the workspace root, the
# bundle mirrors the repo layout, so server.js lives at apps/web/server.js.
FROM node:lts-alpine AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=45001
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Drop root. `node:lts-alpine` ships an unprivileged `node` user (uid 1000), and
# nothing here needs more: both ports are above 1024, and the bundle is only
# read at runtime. Running as root turns any container escape or arbitrary-write
# bug into a considerably worse incident, and it is the default nobody chooses
# deliberately — it is simply what happens when no USER is set.
#
# --chown on the COPY rather than a `chown -R` layer: same result, no duplicated
# copy of the whole bundle in an extra layer.
USER node
EXPOSE 45001
# Prefer IPv4 when a host resolves to both. AgentBase is Cloudflare-fronted and
# publishes AAAA records, while Docker's default bridge has IPv6 disabled — so a
# container that picks the AAAA gets ENETUNREACH. Plain `node` often survives via
# Happy Eyeballs; Next's fetch runtime does not, which is why this surfaced as an
# intermittent `fetch failed` that looked exactly like bad credentials.
#
# Set on the CMD, NOT as ENV NODE_OPTIONS: a NODE_OPTIONS supplied through
# the host's environment would REPLACE the image's value and silently drop this —
# the same shadowing that once made the transport switch unsettable.
CMD ["node", "--dns-result-order=ipv4first", "apps/web/server.js"]
