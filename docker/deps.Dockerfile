# syntax=docker/dockerfile:1
#
# deps.Dockerfile — the shared dependency layer for the app images.
#
#   docker build -f docker/deps.Dockerfile -t precast-deps .
#
# ── Why this exists ───────────────────────────────────────────────────────────
# A fresh scaffold used to run THREE full installs of a ~1.1 GB, ~970-package
# dependency graph: once on the host (`pnpm bootstrap`) and once inside EACH app
# Dockerfile, which share no layers. On a slow link that dominates the time to a
# first `pnpm poc`, and every one of those installs is a fresh chance to hit a
# native-module build error specific to whatever machine is running it.
#
# This image resolves the graph ONCE, in CI, natively per architecture, and
# publishes it to GHCR. The app images then start from it, so their `pnpm
# install` becomes a near-no-op relink instead of a download.
#
# ── What it deliberately does NOT contain ─────────────────────────────────────
# No application source. Only the files that determine the dependency graph are
# copied, so editing a component never invalidates this layer — and the app
# images always build YOUR code from the local context. A prebuilt *app* image
# would go stale the moment someone edits a page; this cannot.
#
# ── Why the store as well as node_modules ─────────────────────────────────────
# `node_modules` alone is brittle: `pnpm rename` changes the workspace package
# names (`@precast/shared` → `@yourproject/shared`), so the app build must
# re-link regardless. Keeping the content-addressed store means that relink —
# and any dependency the project has since added — resolves OFFLINE from local
# content instead of hitting the network. The store is what makes a lockfile
# MISS cheap rather than catastrophic.

FROM node:24-alpine
RUN corepack enable

# Explicit, predictable store path. The app Dockerfiles pass the same
# `--store-dir`, which is what lets them reuse this content.
ENV PNPM_STORE_DIR=/pnpm/store
WORKDIR /repo

# ONLY the dependency-graph inputs. Adding source here would defeat the point.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/agents/package.json ./apps/agents/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# `--ignore-scripts` matches the app images: no lifecycle scripts run at install
# time, so nothing here depends on source that isn't present.
RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir "$PNPM_STORE_DIR"

# Recorded so `pnpm deps:image` can tell whether a published tag matches the
# lockfile in front of it, and so a human can check an image without unpacking.
ARG PRECAST_LOCK_HASH=unknown
ENV PRECAST_LOCK_HASH=${PRECAST_LOCK_HASH}
LABEL org.opencontainers.image.source="https://github.com/jacobfernandez917/precast" \
      org.opencontainers.image.description="Precast workspace dependencies (pnpm store + node_modules) for the lockfile identified by precast.lock.hash" \
      org.opencontainers.image.licenses="MIT" \
      dev.precast.lock-hash="${PRECAST_LOCK_HASH}"
