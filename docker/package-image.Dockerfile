# syntax=docker/dockerfile:1.7
#
# A warm, source-free Precast dependency package for the signed Raya Developer Computer image.
# It is never run as an application container. The final scratch image contains only a manifest
# and a compressed archive of pnpm's root/workspace node_modules trees. Runtime activation still
# checks the exact dependency-graph hash and falls back to a frozen install on any miss.

FROM node:24.22.1-bookworm-slim AS packages
RUN corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends zstd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/agents/package.json ./apps/agents/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/a2ui/package.json ./packages/a2ui/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY scripts/package-image.mjs ./scripts/package-image.mjs

ARG PRECAST_GRAPH_HASH
ARG PRECAST_SOURCE_REVISION
RUN test "$(node scripts/package-image.mjs --hash)" = "$PRECAST_GRAPH_HASH" \
  && printf '%s' "$PRECAST_SOURCE_REVISION" | grep -Eq '^[a-f0-9]{40}$' \
  && pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store

RUN mkdir -p /out \
  && { printf '%s\n' node_modules; find apps packages -mindepth 2 -maxdepth 2 -type d -name node_modules -print | sort; } > /tmp/package-paths \
  && tar --create --zstd --file /out/node-modules.tar.zst --files-from /tmp/package-paths \
  && node scripts/package-image.mjs --write-manifest \
       --archive=/out/node-modules.tar.zst \
       --revision="$PRECAST_SOURCE_REVISION" \
       --graph-hash="$PRECAST_GRAPH_HASH"

FROM scratch
COPY --from=packages /out /precast-package-image
ARG PRECAST_GRAPH_HASH
ARG PRECAST_SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/jacobfernandez917/precast" \
      org.opencontainers.image.description="Warm Precast pnpm package archive for Raya Developer Computers" \
      org.opencontainers.image.licenses="MIT" \
      dev.precast.graph-hash="$PRECAST_GRAPH_HASH" \
      dev.precast.source-revision="$PRECAST_SOURCE_REVISION"
