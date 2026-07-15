# syntax=docker/dockerfile:1
# Next.js web app — built from the repo root (needs the pnpm workspace).
#   docker build -f apps/web/Dockerfile -t precast-web .

# ---- build: install the workspace and build Next (standalone output) ----
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @precast/shared build \
 && pnpm --filter @precast/web build

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
