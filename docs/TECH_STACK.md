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
| Container base        | node:24-alpine       | —       | api + web multi-stage image base                      |
| Language              | TypeScript           | ^5.9.3  | Strict mode                                           |
| API / Agents          | Mastra               | ^1.18   | `apps/api/` — agent framework, `mastra dev`           |
| LLM access            | Mastra model gateway | —       | `provider/model` string; no separate AI SDK           |
| Agent store           | @mastra/libsql       | ^1.15   | Agent memory/threads (SQLite/libsql)                  |
| Web                   | Next.js (App Router) | ^16     | `apps/web/`                                           |
| UI runtime            | React                | ^19     | Web app                                               |
| Design system         | Astryx               | ^0.1    | `@astryxdesign/core` (see templates/DESIGN_SYSTEM.md) |
| CSS utilities         | Tailwind CSS         | ^4      | Layout/spacing via Astryx Tailwind bridge             |
| Validation            | zod                  | ^3      | All external boundaries                               |
| Logging               | pino                 | ^9      | Via @mastra/loggers PinoLogger                        |
| Database              | PostgreSQL           | 17      | Docker Compose                                        |
| Vector                | pgvector             | ^0.8    | Optional                                              |
| Identity              | Keycloak             | latest  | Docker Compose                                        |
| Cache                 | Redis                | 7       | Docker Compose                                        |
| Linting               | ESLint               | ^10     | Flat config                                           |
| Formatting            | Prettier             | ^3      |                                                       |
| Testing (API)         | Vitest               | ^2      | `apps/api` — no config (defaults)                     |
| Testing (Web)         | Vitest               | ^2      | `apps/web/vitest.config.ts`                           |
| E2E Testing           | Playwright           | ^1      | `apps/web/playwright.config.ts` (autonomous)          |
| Git Hooks             | `.githooks/`         | —       | Native core.hooksPath; doc-contract + lint-staged     |
| Lint-Staged           | lint-staged          | ^17     | Invoked from `.githooks/pre-commit`                   |

---

## 2. API / Agents (`apps/api/`)

Mastra agent app. `mastra dev` serves the agent API under `/api/*` and the
Studio playground at the root, on `MASTRA_PORT` (default 4111). Source lives in
`src/mastra/` (`index.ts` instance, `agents/`, `tools/`). ESM, no decorators.

| Dependency      | Version | Purpose                                    |
| --------------- | ------- | ------------------------------------------ |
| @mastra/core    | ^1.49   | Agent, tools, Mastra instance              |
| @mastra/libsql  | ^1.15   | Durable agent memory/thread store (SQLite) |
| @mastra/loggers | ^1.2    | PinoLogger for structured logs             |
| mastra          | ^1.18   | CLI: `mastra dev` / `mastra build`         |
| zod             | ^3      | Tool input/output schemas + env validation |

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
> `apps/api` (Mastra) and `apps/web` (Next.js) are both ESM. See ADR-005.

---

## 5. Docker Compose Services

| Service  | Image                            | Port (host) | Purpose                              |
| -------- | -------------------------------- | ----------- | ------------------------------------ |
| api      | built — `apps/api/Dockerfile`    | 4111        | Mastra agent API (multi-stage build) |
| web      | built — `apps/web/Dockerfile`    | 3000        | Next.js web app (multi-stage build)  |
| postgres | postgres:17-alpine               | 5432        | Primary database                     |
| redis    | redis:7-alpine                   | 6379        | Cache                                |
| keycloak | quay.io/keycloak/keycloak:latest | 8080        | Identity provider                    |

- **api** / **web** images build from the repo root on **node:24-alpine** (multi-stage: pnpm workspace install + build → self-contained runtime bundle — `.mastra/output` for api, Next `.next/standalone` for web).
- Inter-service URLs use Docker DNS names (`postgres`, `redis`, `keycloak`, `api`), never `localhost`. `web` reaches the API via `MASTRA_INTERNAL_URL=http://api:4111`.
- `api` persists agent memory to the `precast-api-data` volume (`MASTRA_DB_URL=file:/data/mastra.db`).
- Both load the root `.env` if present (`env_file` optional); the compose `environment:` block overrides network-specific values.

---

## 6. Port Assignments

| Service           | Port | Notes                             |
| ----------------- | ---- | --------------------------------- |
| Web (host dev)    | 3000 | Next dev server                   |
| Mastra (host dev) | 4111 | `mastra dev` — agent API + Studio |
| Postgres (host)   | 5432 | Docker mapped                     |
| Redis (host)      | 6379 | Docker mapped                     |
| Keycloak (host)   | 8080 | Docker mapped                     |

The **Web** and **Mastra** dev ports above are the defaults; they are chosen at `pnpm bootstrap` and can be changed any time with `pnpm set-ports --mastra=<port> --web=<port>`, which rewrites env, config, pnpm scripts, Docker, and this table in one pass. Infra ports (Postgres/Redis/Keycloak) are reserved and rejected as app ports.

---

## 7. Testing Tools

| Tool       | Scope             | Config                                                    |
| ---------- | ----------------- | --------------------------------------------------------- |
| Vitest     | API (`apps/api/`) | Defaults; specs alongside source (`*.spec.ts`)            |
| Vitest     | Web (`apps/web/`) | `apps/web/vitest.config.ts`                               |
| Playwright | E2E (`apps/web/`) | `apps/web/playwright.config.ts`; specs in `apps/web/e2e/` |

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
