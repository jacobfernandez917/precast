# SCRIPTS.md — Operator Cheatsheet

> Every `pnpm` script at the repo root, grouped by lifecycle.

---

## Setup & Install

| Script               | Command                                  | Description                                                                                                         |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap`     | `node scripts/bootstrap.mjs`             | New project: prompts name + Mastra/web ports, renames placeholder, updates deps, blank git repo on `develop`        |
| `pnpm rename <name>` | `node scripts/rename-project.mjs <name>` | Replace the `precast` placeholder with your project name only                                                       |
| `pnpm set-ports`     | `node scripts/set-ports.mjs`             | Set Mastra/web dev ports (`--mastra=4200 --web=3100`, each optional) across env, config, pnpm scripts, Docker, docs |
| `pnpm deps:update`   | `node scripts/update-deps.mjs`           | Update deps to latest compatible (`--latest` / `--dry` / `--no-verify`), verify                                     |
| `pnpm install`       | `pnpm install`                           | Install all workspace dependencies                                                                                  |
| `pnpm setup`         | `pnpm install && pnpm build`             | Full setup from clean checkout                                                                                      |

## Development

| Script            | Command                       | Description                |
| ----------------- | ----------------------------- | -------------------------- |
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

| Script                | Command                                                        | Description                                                                             |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm docker:up`      | `docker compose -f docker/docker-compose.yml up -d`            | Start the app containers — agents + web (builds app images on first run). Postgres/Redis/Keycloak are remote/managed via `.env`, not run here |
| `pnpm docker:down`    | `docker compose -f docker/docker-compose.yml down`             | Stop the stack                                                                          |
| `pnpm docker:logs`    | `docker compose -f docker/docker-compose.yml logs -f`          | Follow logs                                                                             |
| `pnpm docker:ps`      | `docker compose -f docker/docker-compose.yml ps`               | List services                                                                           |
| `pnpm docker:rebuild` | `docker compose -f docker/docker-compose.yml build --no-cache` | Rebuild app images (api, web)                                                           |

## Utility

| Script       | Command           | Description             |
| ------------ | ----------------- | ----------------------- |
| `pnpm clean` | `turbo run clean` | Clean all build outputs |

> Git hooks are activated once per clone with `git config core.hooksPath .githooks` (see README) — no `prepare` step.
