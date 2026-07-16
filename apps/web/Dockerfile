# syntax=docker/dockerfile:1
# Next.js web app — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/web/Dockerfile -t precast-web .

# ---- build: install the workspace and build Next (standalone output) ----
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
 && pnpm --filter "./apps/web" build \
 && test -f apps/web/.next/standalone/apps/web/server.js

# ---- runtime: the self-contained Next standalone server ----
# `output: 'standalone'` (next.config.ts) emits a minimal server plus only the
# node_modules it traces. With outputFileTracingRoot at the workspace root, the
# bundle mirrors the repo layout, so server.js lives at apps/web/server.js.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
