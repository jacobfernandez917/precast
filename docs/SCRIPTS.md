# SCRIPTS.md — Operator Cheatsheet

> Every `pnpm` script at the repo root, grouped by lifecycle.

---

## Setup & Install

| Script                      | Command                                  | Description                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap`            | `node scripts/bootstrap.mjs`             | New project: prompts name, auto-picks a free consecutive port block, asks LLM provider (incl. **AgentBase Models** — collects gateway URL/token URL/client id/secret/model into `.env`) and APC theme, renames placeholder, updates deps, blank git repo on `develop` |
| `pnpm rename <name>`        | `node scripts/rename-project.mjs <name>` | Replace the `precast` placeholder with your project name only                                                                                                                                                                                                         |
| `pnpm set-ports`            | `node scripts/set-ports.mjs`             | Set the stack's ports (`--mastra=45000 --web=45001 --keycloak=45002`, each optional; or `--auto` to pick a fresh free consecutive block in 45000–49100) across `.env`, `.env.example`, config, pnpm scripts, Docker, docs                                             |
| `pnpm set-theme [name]`     | `node scripts/set-theme.mjs`             | Choose the APC Design System theme — `stockholm`, `prague`, `arctic`, `nova`, `melbourne`. No argument lists them and shows the current one. Preview: https://apc-design-system.917v.dev                                                                              |
| `pnpm theme:build`          | `node scripts/build-apc-theme.mjs`       | Regenerate `apps/web/app/theme/apc-themes.css` from `apc.tokens.json`. `--check` fails when the committed CSS is stale (CI guard). Run after re-importing tokens from Claude Design                                                                                   |
| `pnpm deps:image`           | `node scripts/deps-image.mjs`            | Report which dependency base image the Docker builds will start FROM, and the lockfile tag that keys it. `--tag` prints just the tag (CI); `--resolve` prints the ref or nothing. `PRECAST_DEPS_IMAGE=off` disables it                                                |
| `pnpm deps:update`          | `node scripts/update-deps.mjs`           | Update deps to latest compatible (`--latest` / `--dry` / `--no-verify`), verify                                                                                                                                                                                       |
| `pnpm emit:import-manifest` | `node scripts/emit-import-manifest.mjs`  | Re-derive `agentbase.import.json` `requiredEnv` from the env schema (run after changing `packages/shared/src/env.ts`; WEB-005 guards it)                                                                                                                              |
| `pnpm precast:version`      | `node scripts/precast-lock.mjs`          | Print which Precast release this project was derived from (reads `precast.lock.json`)                                                                                                                                                                                 |
| `pnpm precast:update`       | `node scripts/precast-update.mjs`        | Pull later Precast improvements in. Check-only by default; `--apply` writes the safe changes, `--force` also takes conflicts, `--adopt` records a baseline for a project that predates provenance. See [MIGRATIONS.md](MIGRATIONS.md)                                 |
| `pnpm install`              | `pnpm install`                           | Install all workspace dependencies                                                                                                                                                                                                                                    |
| `pnpm setup`                | `pnpm install && pnpm build`             | Full setup from clean checkout                                                                                                                                                                                                                                        |

## Development

| Script                    | Command                               | Description                                             |
| ------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                | `turbo run dev`                       | Start all apps in dev mode                              |
| `pnpm dev:agents`         | `pnpm -F @precast/agents dev`         | Start agents dev server                                 |
| `pnpm dev:web`            | `pnpm -F @precast/web dev`            | Start web dev server                                    |
| `pnpm dev:verbose`        | `turbo run dev:verbose`               | Start all apps with `LOG_LEVEL=debug` (verbose logging) |
| `pnpm dev:agents:verbose` | `pnpm -F @precast/agents dev:verbose` | Agents only, verbose (`LOG_LEVEL=debug`)                |
| `pnpm dev:web:verbose`    | `pnpm -F @precast/web dev:verbose`    | Web only, verbose (`LOG_LEVEL=debug`)                   |

## Build

| Script              | Command                         | Description                 |
| ------------------- | ------------------------------- | --------------------------- |
| `pnpm build`        | `turbo run build`               | Build all packages and apps |
| `pnpm build:agents` | `pnpm -F @precast/agents build` | Build API only              |
| `pnpm build:web`    | `pnpm -F @precast/web build`    | Build web only              |

## Proof of Concept (see it run)

| Script            | Command                    | Description                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm poc`        | `node scripts/poc.mjs`     | **The "show me something" command.** Docker preflight → build + start the Compose stack → wait for every service's health endpoint → print the URLs. `--wait` also waits for Docker itself to be installed/started; `--no-build` reuses images; `--timeout=<s>` bounds the health wait |
| `pnpm poc <svc>`  | `node scripts/poc.mjs web` | **Refresh just what changed** — rebuilds that service's image and recreates only that container (`--force-recreate --no-deps`), then health-checks and re-prints the URLs. Takes `agents`, `web`, `keycloak`, or several                                                               |
| `pnpm verify:poc` | `turbo run typecheck`      | The reduced PoC check (typecheck only) — see CLAUDE.md §4.2.1                                                                                                                                                                                                                          |

> Precast builds **proof of concept first** (CLAUDE.md §4.0): smallest runnable slice → show the user → collect feedback → _then_ harden with the full test + doc bar. `pnpm poc` exists so that first loop is one command ending in a URL.
>
> **After every substantial previewable change, refresh the preview and re-show the URL** (CLAUDE.md §4.0). Use `pnpm poc <service>` for speed. Never a bare `docker restart` — code is baked into the image, so a restart re-serves the **old** build; only a rebuild reflects the change. `--no-deps` is passed so targeting `web` doesn't also recreate `agents` via `depends_on`.

## Test

| Script             | Command                        | Description                        |
| ------------------ | ------------------------------ | ---------------------------------- |
| `pnpm test`        | `turbo run test`               | Run all unit/integration tests     |
| `pnpm test:agents` | `pnpm -F @precast/agents test` | Run API tests (Jest)               |
| `pnpm test:web`    | `pnpm -F @precast/web test`    | Run web tests (Vitest)             |
| `pnpm test:e2e`    | `turbo run test:e2e`           | Run autonomous Playwright UI tests |

> First E2E run needs a browser: `pnpm -F @precast/web test:e2e:install`. Playwright boots `next dev` itself — no app to start manually.

## Lint & Format

| Script              | Command               | Description             |
| ------------------- | --------------------- | ----------------------- |
| `pnpm lint`         | `turbo run lint`      | Lint all packages       |
| `pnpm format`       | `prettier --write .`  | Format all files        |
| `pnpm format:check` | `prettier --check .`  | Check formatting        |
| `pnpm typecheck`    | `turbo run typecheck` | Type-check all packages |

## Docker

| Script                | Command                                                                                                    | Description                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm docker:check`   | `node scripts/check-docker.mjs`                                                                            | Is a container runtime installed **and running**? Prints the platform-specific install/start fix if not                                                                                                                                                                        |
| `pnpm docker:wait`    | `node scripts/check-docker.mjs --wait`                                                                     | Poll until the Docker engine answers (default 15 min), then exit 0 — the first-run path: install/start Docker while this waits, and the build continues without re-running anything                                                                                            |
| `pnpm docker:up`      | `node scripts/docker-compose.mjs -f docker/docker-compose.yml -f docker/docker-compose.override.yml up -d` | Start the services selected by `COMPOSE_PROFILES` in `.env` (default agents+web+keycloak; builds app images on first run). Postgres/Redis are remote/managed via `.env`, not run here. `AGENTS_HOST_PORT`/`WEB_HOST_PORT`/`KEYCLOAK_HOST_PORT` publish on different host ports |
| `pnpm docker:down`    | `node scripts/docker-compose.mjs -f docker/docker-compose.yml down`                                        | Stop the stack                                                                                                                                                                                                                                                                 |
| `pnpm docker:logs`    | `node scripts/docker-compose.mjs -f docker/docker-compose.yml logs -f`                                     | Follow logs                                                                                                                                                                                                                                                                    |
| `pnpm docker:ps`      | `node scripts/docker-compose.mjs -f docker/docker-compose.yml ps`                                          | List services                                                                                                                                                                                                                                                                  |
| `pnpm docker:rebuild` | `node scripts/docker-compose.mjs -f docker/docker-compose.yml build --no-cache`                            | Rebuild app images                                                                                                                                                                                                                                                             |

All Compose-invoking `docker:*` scripts route through **`scripts/docker-compose.mjs`**, which (1) fails fast if no container runtime is reachable, deferring to `scripts/check-docker.mjs` for the platform-specific fix, and (2) fails fast (clear message, exit 1) if the root `.env` is missing, then passes `--env-file .env` — required because Compose does not read the repo-root `.env` by default for `-f docker/docker-compose.yml` invocations. `docker:check` / `docker:wait` are the preflight itself and don't touch Compose.

## Utility

| Script       | Command           | Description             |
| ------------ | ----------------- | ----------------------- |
| `pnpm clean` | `turbo run clean` | Clean all build outputs |

> Git hooks are activated once per clone with `git config core.hooksPath .githooks` (see README) — no `prepare` step.
