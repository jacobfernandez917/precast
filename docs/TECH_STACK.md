# TECH_STACK.md — Tech Inventory

> **Authoritative source of truth for all tech-stack facts.** If this file disagrees with any other doc about a version, library, container image, or port, this file wins and the other doc has a bug.

**Last Updated:** 2026-07-14

---

## 1. Quick Reference

| Layer                 | Tech                 | Version | Notes                                                 |
| --------------------- | -------------------- | ------- | ----------------------------------------------------- |
| Package Manager       | pnpm                 | 9.15.9  | Workspaces monorepo                                   |
| Monorepo Orchestrator | Turborepo            | ^2.9.16 | Task orchestration                                    |
| Runtime               | Node.js              | 24      | `.nvmrc` pin                                          |
| Container base        | node:24-alpine       | —       | agents + web multi-stage image base                   |
| Language              | TypeScript           | ^5.9.3  | Strict mode                                           |
| Agents                | Mastra               | ^1.18   | `apps/agents/` — agent framework, `mastra dev`        |
| LLM access            | Mastra model gateway | —       | `provider/model` string; no separate AI SDK           |
| Agent store           | @mastra/libsql       | ^1.15   | Agent memory/threads (SQLite/libsql)                  |
| Web                   | Next.js (App Router) | ^16     | `apps/web/`                                           |
| UI runtime            | React                | ^19     | Web app                                               |
| Design system         | Astryx               | ^0.1    | `@astryxdesign/core` (see templates/DESIGN_SYSTEM.md) |
| CSS utilities         | Tailwind CSS         | ^4      | Layout/spacing via Astryx Tailwind bridge             |
| Validation            | zod                  | ^3      | All external boundaries                               |
| Logging               | pino                 | ^9      | Agents: @mastra/loggers PinoLogger. Web: own pino logger (`apps/web/app/lib/logger.ts`). Both keyed off `LOG_LEVEL` |
| Log pretty-print (dev) | pino-pretty          | ^13     | Web dev-only; colorized terminal output (prod = JSON)  |
| Database              | PostgreSQL           | 17      | **Remote/managed** (Neon, Supabase, RDS) — `DATABASE_URL` |
| Vector                | pgvector             | ^0.8    | Optional (on the remote Postgres)                     |
| Identity              | Keycloak / OIDC      | latest  | **Docker Compose (dev)** or remote — `KEYCLOAK_TOKEN_ISSUER_URI` |
| Cache                 | Redis                | 7       | **Remote/managed** (Upstash, Redis Cloud) — `REDIS_URL`   |
| Linting               | ESLint               | ^10     | Flat config                                           |
| Formatting            | Prettier             | ^3      |                                                       |
| Testing (agents)      | Vitest               | ^2      | `apps/agents` — no config (defaults)                  |
| Testing (Web)         | Vitest               | ^2      | `apps/web/vitest.config.ts`                           |
| E2E Testing           | Playwright           | ^1      | `apps/web/playwright.config.ts` (autonomous)          |
| Git Hooks             | `.githooks/`         | —       | Native core.hooksPath; doc-contract + lint-staged     |
| Lint-Staged           | lint-staged          | ^17     | Invoked from `.githooks/pre-commit`                   |
| Env loading (dev)     | dotenv-cli           | ^11     | Dev/start scripts load the single root `.env`         |

---

## 2. Agents (`apps/agents/`)

Mastra **agents-only** app — hosts agents and their tools, nothing else (no MCP
servers, no hand-rolled REST APIs; agents reach external services as tools).
`mastra dev` serves Mastra's HTTP surface under `/api/*` (A2A + agent routes)
and the Studio playground at the root, on `MASTRA_PORT` (default 4111). Source
lives in `src/mastra/` (`index.ts` instance, `agents/`, `tools/`). ESM, no decorators.

| Dependency      | Version | Purpose                                           |
| --------------- | ------- | ------------------------------------------------- |
| @mastra/core    | ^1.49   | Agent, tools, Mastra instance                     |
| @mastra/libsql  | ^1.15   | Durable agent memory/thread store (SQLite)        |
| @mastra/loggers | ^1.2    | PinoLogger for structured logs                    |
| @a2a-js/sdk     | ^0.3    | Official A2A types (agent card `securitySchemes`) |
| mastra          | ^1.18   | CLI: `mastra dev` / `mastra build`                |
| zod             | ^3      | Tool input/output schemas + env validation        |

> The LLM is reached via Mastra's **model gateway** using a `provider/model`
> string (default `google/gemini-2.5-flash`). Set the matching provider key in
> `.env` (`GOOGLE_GENERATIVE_AI_API_KEY`) — no separate AI-SDK package is installed.

---

## 3. Web (`apps/web/`)

| Dependency                      | Version | Purpose                                             |
| ------------------------------- | ------- | --------------------------------------------------- |
| next                            | ^16     | Next.js framework (App Router)                      |
| react / react-dom               | ^19     | UI runtime                                          |
| @astryxdesign/core              | ^0.1    | Astryx design system components + tokens            |
| @astryxdesign/theme-neutral     | ^0.1    | Astryx theme (CSS custom properties + theme object) |
| @astryxdesign/cli               | ^0.1    | Astryx CLI (`astryx component`, docs, templates)    |
| tailwindcss                     | ^4      | Utility classes for layout/spacing                  |
| @tailwindcss/postcss            | ^4      | Tailwind v4 PostCSS plugin                          |
| postcss                         | ^8      | PostCSS (Tailwind pipeline)                         |
| @types/react / @types/react-dom | ^19     | React type definitions                              |

> **Styling model.** Build UI from Astryx components + theme tokens; use Tailwind
> utilities (`flex`, `gap`, `p-4`, and token-backed classes like `bg-surface`,
> `text-primary`) for layout. The Astryx Tailwind bridge (`@astryxdesign/core/tailwind-theme.css`)
> maps Tailwind theme vars to Astryx tokens. Cascade-layer order is declared in
> `apps/web/app/globals.css` — see `pnpm exec astryx docs styling-libraries tailwind`.
>
> **Build note.** Astryx 0.1.x ships components compiled against React's dev JSX
> runtime (`jsxDEV`), absent from production. `apps/web` therefore builds with
> **webpack** (`next build --webpack`) plus a `react/jsx-dev-runtime` shim
> (`apps/web/jsx-dev-runtime.shim.ts`, wired in `next.config.ts`). `next dev`
> stays on Turbopack (dev runtime present). Revisit when Astryx ships a prod build.
> ESLint uses the shared root flat config (no `eslint-config-next`, which caps at
> ESLint 9).

---

## 4. Shared (`packages/shared/`)

| Dependency  | Version | Purpose                         |
| ----------- | ------- | ------------------------------- |
| zod         | ^3      | Schema validation + env parsing |
| @types/node | ^24     | `process` types for env parser  |
| typescript  | ^5.9    | Type definitions                |

> `packages/shared` compiles to **ESM** (NodeNext) so Mastra's bundler can
> statically analyze its named exports; relative imports use `.js` extensions.
> `apps/agents` (Mastra) and `apps/web` (Next.js) are both ESM. See ADR-005.

---

## 5. Docker Compose Services

Compose runs the **apps + Keycloak**. **Postgres and Redis** are **not** run in
Compose — point the apps at your own remote/managed services via the root `.env`
(`DATABASE_URL`, `REDIS_URL`). **Keycloak** runs locally for dev auth; in production
point `KEYCLOAK_TOKEN_ISSUER_URI` at a managed Keycloak instead.

| Service  | Image                            | Port (host)                    | Purpose                               |
| -------- | -------------------------------- | ------------------------------ | ------------------------------------- |
| agents   | built — `apps/agents/Dockerfile` | `${AGENTS_HOST_PORT:-4111}`    | Mastra agents app (multi-stage build) |
| web      | built — `apps/web/Dockerfile`    | `${WEB_HOST_PORT:-3000}`       | Next.js web app (multi-stage build)   |
| keycloak | `quay.io/keycloak/keycloak:latest` | `${KEYCLOAK_HOST_PORT:-8080}` | OIDC identity provider (dev; `start-dev`) |

- **agents** / **web** images build from the repo root on **node:24-alpine** (multi-stage: pnpm workspace install + build → self-contained runtime bundle — `.mastra/output` for agents, Next `.next/standalone` for web).
- Inter-service URLs use Docker DNS names, never `localhost`: `web` reaches the API via `MASTRA_INTERNAL_URL=http://agents:4111`. Remote infra is reached over the public network via its `.env` URL.
- `agents` persists agent memory to the `precast-agents-data` volume (`MASTRA_DB_URL=file:/data/mastra.db`).
- Both load the root `.env` (`env_file` optional) — that is where the remote infra URLs come from; the compose `environment:` block overrides only network-specific app values.
- **Each service declares `profiles: ['<own name>']`.** `COMPOSE_PROFILES` in the root `.env` (Compose's own variable) selects which build/run — default `agents,web,keycloak`. This lets you build only a subset once the pieces are deployed separately (e.g. agents hosted by an AgentBase import; only `web`+`keycloak` need to run here). `web`'s `depends_on.agents` is `required: false` so excluding `agents` doesn't fail Compose validation.
- **Compose does NOT read the repo-root `.env` by default** when invoked with `-f docker/docker-compose.yml` from the repo root (it looks in the compose file's own directory unless told otherwise) — so every `pnpm docker:*` script routes through `scripts/docker-compose.mjs`, which passes `--env-file .env` (failing fast with a clear message if `.env` is missing). Without this, `AGENTS_HOST_PORT`/`WEB_HOST_PORT`/`KEYCLOAK_HOST_PORT`/`COMPOSE_PROFILES`/`KEYCLOAK_ADMIN` all silently fall back to their YAML defaults.

---

## 6. Port Assignments

| Service            | Port | Notes                             |
| ------------------ | ---- | --------------------------------- |
| Web (host dev)     | 3000 | Next dev server                   |
| Mastra (host dev)  | 4111 | `mastra dev` — agent API + Studio |
| Keycloak (Compose) | 8080 | local dev OIDC (`KEYCLOAK_HOST_PORT`) |

The **Web** and **Mastra** dev ports above are the defaults; they are chosen at `pnpm bootstrap` and can be changed any time with `pnpm set-ports --mastra=<port> --web=<port>`, which rewrites env, config, pnpm scripts, Docker, and this table in one pass. Postgres/Redis run on your remote/managed provider — their ports are part of the `.env` URLs, not local host ports.

**Docker published host ports** are separate from the container/app ports: `docker-compose.yml` publishes `${AGENTS_HOST_PORT:-4111}:4111`, `${WEB_HOST_PORT:-3000}:3000`, and `${KEYCLOAK_HOST_PORT:-8080}:8080`. Set `AGENTS_HOST_PORT` / `WEB_HOST_PORT` / `KEYCLOAK_HOST_PORT` in the root `.env` to remap the host side (e.g. `60000`/`60001`/`60002`) without changing the container ports; they default to the container port and only affect `pnpm docker:up`.

---

## 7. Testing Tools

| Tool       | Scope                | Config                                                    |
| ---------- | -------------------- | --------------------------------------------------------- |
| Vitest     | API (`apps/agents/`) | Defaults; specs alongside source (`*.spec.ts`)            |
| Vitest     | Web (`apps/web/`)    | `apps/web/vitest.config.ts`                               |
| Playwright | E2E (`apps/web/`)    | `apps/web/playwright.config.ts`; specs in `apps/web/e2e/` |

> Playwright is **autonomous**: its `webServer` block boots `next dev` itself,
> so `pnpm test:e2e` needs no manually-started app. Install the browser once
> with `pnpm -F @precast/web test:e2e:install` (or `playwright install chromium`).

---

## 8. Maintenance

- **Dependency updates:** `pnpm deps:update` (`scripts/update-deps.mjs`) bumps
  deps to their latest compatible versions within semver ranges, then verifies
  with build + test. `--latest` bumps to latest major; `--dry` previews via
  `pnpm outdated`. Run it periodically or from external CI.
- **Bootstrapping a new project:** `pnpm bootstrap` (`scripts/bootstrap.mjs`)
  asks for a name, renames the placeholder, updates deps, re-initializes a blank
  git repo on the `develop` branch, and prints the feed-forward doc checklist.
- **Feed-forward planning docs:** `templates/` holds PRD, DATA_MODEL, AGENT_SPEC,
  and DESIGN_SYSTEM templates — each a worked example (chat-based meeting-room
  reservation, Astryx design system). Copy into `docs/`, replace the example,
  and write them before building.

---

## 9. Out of Scope

- CI/CD pipeline (implemented outside this repo).
