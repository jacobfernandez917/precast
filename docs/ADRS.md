# Architectural Decision Records

> This file records key architectural decisions. When the number of ADRs exceeds ~10, split into individual files under `docs/adr/`.

---

## ADR-001: Documentation Contract Enforcement

**Date:** 2026-07-06
**Status:** Accepted

**Context:** Multi-agent development fails without a mandatory documentation update rule. Without enforcement, handoff notes go stale and context is lost between sessions.

**Decision:** Adopt the documentation contract pattern:

- `CLAUDE.md` → `HANDOFF.md` → `PROGRESS.md` → authoritative docs
- `.githooks/pre-commit` blocks commits that update non-trivial files without staging HANDOFF.md, PROGRESS.md, and README.md
- PROGRESS.md must be updated on every meaningful change
- HANDOFF.md must be updated on every meaningful task closure

**Consequences:**

- +: Zero context loss between tools and sessions
- +: Freshness gate prevents stale handoff state
- -: Slight friction on every commit (mitigated by `SKIP_DOC_CHECK=1` bypass)

---

## ADR-002: Monorepo with pnpm + Turborepo

**Date:** 2026-07-06
**Status:** Accepted

**Context:** Need a monorepo setup that scales from small projects (2-3 packages) to large ones (10+ packages). Must support parallel builds, caching, and workspace-level dependency management.

**Decision:** Use pnpm workspaces for package management and Turborepo for task orchestration.

**Consequences:**

- +: pnpm is faster and more disk-efficient than npm/yarn
- +: Turborepo provides caching, parallel execution, and dependency graph awareness
- -: Learning curve for teams unfamiliar with pnpm/Turborepo

---

## ADR-003: Structured Documentation with Authority Chain

**Date:** 2026-07-06
**Status:** Accepted

**Context:** Multiple docs can disagree. Need a clear resolution policy.

**Decision:** Establish an authority chain:

1. `TECH_STACK.md` wins for tech-stack facts
2. `SPEC.md` wins for boilerplate structure/conventions
3. `CLAUDE.md` wins for working rules

**Consequences:**

- +: Clear conflict resolution
- +: Each doc has a defined scope
- -: Requires discipline to update the right doc

---

## ADR-004: CLAUDE.md as the Single Entry Point

**Date:** 2026-07-06
**Status:** Accepted

**Context:** Claude Code auto-loads `CLAUDE.md` at session start. Need to ensure all project-specific rules, pointers to authoritative docs, and enforcement clauses are in a file the tool reads automatically.

**Decision:** Make `CLAUDE.md` the single project brief that every agent reads. Embed all enforcement clauses, doc pointers, and working rules there.

**Consequences:**

- +: Zero-config for Claude Code — auto-loads on session start
- +: Single source of truth for project rules
- -: Requires discipline to keep supplementary docs in sync with CLAUDE.md

---

## ADR-005: CommonJS for runtime packages; native git hooks over Husky

**Date:** 2026-07-06
**Status:** Partially superseded by [ADR-007](#adr-007-replace-nestjs-with-mastra-esm-everywhere) — the CommonJS decision was reversed when NestJS was replaced by Mastra. The Husky/native-hooks decision still stands.

**Context:** Two setup choices surfaced while wiring the `apps/api` and `apps/web` entrypoints so the boilerplate runs out of the box:

1. The stubs marked `apps/api` and `packages/shared` as ESM (`"type": "module"`), but the base tsconfig uses `moduleResolution: "Bundler"`, which emits extensionless relative imports that plain node cannot execute. Pure-ESM NestJS with decorators + `reflect-metadata` is also fragile.
2. `husky` shipped as a devDependency with a `prepare: husky` script. On install it set `core.hooksPath` to `.husky/_`, silently overriding the documented `.githooks` path and disabling the doc-contract pre-commit hook.

**Decision:**

- Compile `packages/shared` and `apps/api` to **CommonJS** (per-package tsconfig `module: CommonJS`, `moduleResolution: Node`; no `"type": "module"`). `apps/web` (Vite/Nitro) keeps consuming the shared package's TS source via the tsconfig path alias, so it is unaffected. The API tsconfig overrides `paths: {}` so `tsc` resolves the built `@precast/shared` from `node_modules` rather than recompiling its source under the API rootDir.
- **Remove Husky.** Keep the native `core.hooksPath = .githooks` mechanism and invoke `lint-staged` from `.githooks/pre-commit` after the doc-contract check.

**Consequences:**

- +: `pnpm build` / `dev` / `test` run out of the box; API boots on plain node.
- +: One git-hook mechanism (`.githooks`), so the doc-contract guardrail can't be silently disabled by an install step.
- -: Two module systems in the monorepo (CJS runtime packages, ESM web). Documented in TECH_STACK.md §4.
- -: `apps/web` needs `nuxt prepare` (wired as `postinstall`) before `typecheck`/`lint`, because both consume Nuxt's generated `.nuxt/` config.

---

## ADR-006: `develop` default branch; bootstrap resets git history; CI is external

**Date:** 2026-07-06
**Status:** Accepted

**Context:** Precast is a starting point, not a dependency. A project created from it should (a) not inherit Precast's commit history, (b) start on a conventional integration branch, and (c) begin on current dependencies. CI/CD is owned outside this repo.

**Decision:**

- Default branch is **`develop`**. `pnpm bootstrap` re-initializes a blank repo on `develop`; docs reference it as the integration branch.
- `pnpm bootstrap` (`scripts/bootstrap.mjs`) runs rename → dependency update → **`rm -rf .git` + `git init -b develop`** + first commit, in that order. The destructive git reset runs **last** so an earlier failure leaves history intact.
- **No CI workflow ships in the repo.** Dependency currency is a plain script (`pnpm deps:update`) that any external CI can call; there is no `.github/` directory.
- **Playwright E2E is autonomous** — the `webServer` block boots `nuxt dev`, so `pnpm test:e2e` is self-contained (no manually-started app).

**Consequences:**

- +: A bootstrapped project is clean: its own history, current deps, standard branch — in one command.
- +: CI-agnostic; no lock-in to a particular CI provider or committed workflow files.
- -: `bootstrap` is destructive to `.git` by design; it confirms first (skip with `--yes`) and only touches the repo it runs in.
- -: E2E requires a one-time `playwright install chromium`; the browser binary is not vendored.

---

## ADR-007: Replace NestJS with Mastra; ESM everywhere

**Date:** 2026-07-06
**Status:** Accepted — web-framework parts (Nuxt landing page, port note, `nuxt prepare`) superseded by [ADR-008](#adr-008-nuxtjs--nextjs-web-app--astryx-design-system)

**Context:** The boilerplate targets AI-agent applications (the worked example is a chat-based meeting-room reservation agent). NestJS is a general HTTP framework with no agent primitives, whereas [Mastra](https://mastra.ai) is a TypeScript agent framework (agents, tools, workflows, model gateway, Studio playground) — a much closer fit. Mastra is ESM-only and bundles the app with a rollup-based build (`mastra build`).

**Decision:**

- Replace NestJS in `apps/api` with **Mastra** (`@mastra/core`, `mastra` CLI, `@mastra/libsql` for durable agent memory, `@mastra/loggers` for pino). Source lives in `src/mastra/` (`index.ts` instance, `agents/`, `tools/`). Dev via `mastra dev` (agent API + Studio on port **4111**).
- Keep the Mastra and Nuxt apps **neutral**: ship only a placeholder `exampleAgent` + `exampleTool` (and a generic Nuxt landing page) that prove the wiring. No domain in app code — real structure comes from the feed-forward docs + TECH_STACK.
- **Reverse ADR-005's CommonJS decision:** `packages/shared` is now **ESM** (NodeNext, `.js` import extensions, `"type": "module"`). Reason: Mastra's bundler cannot statically resolve named exports through a CommonJS `export *` re-export (`__exportStar`), which broke `mastra build`. With NestJS gone, nothing needs CJS; both apps are ESM.
- **Test runner for the API moves from Jest to Vitest** (ESM-native, already used by web). Business logic is extracted into plain functions the tools wrap, so it unit-tests without Mastra's runtime.
- **Ports:** Mastra dev on **4111** (its default), web (Nuxt) moves to **3000** (its default, now free). Env vars `API_PORT/API_HOST` → `MASTRA_PORT/MASTRA_HOST`, plus `MASTRA_DB_URL` and the provider key `GOOGLE_GENERATIVE_AI_API_KEY` (example agent uses `google/gemini-2.5-flash`).
- Ship **feed-forward planning templates** in `templates/` (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM) as worked examples for the reservation use case; `pnpm bootstrap` points users at them.

**Consequences:**

- +: The starter is agent-native — a placeholder agent with a tool and durable memory boots out of the box and appears in Studio, without coupling the boilerplate to any domain.
- +: One module system (ESM) across the monorepo; no CJS/ESM split to reason about.
- +: LLM access via the model gateway means no AI-SDK dependency to manage.
- -: Requires a provider key (`GOOGLE_GENERATIVE_AI_API_KEY`) to actually converse; tools and build/test work without it.
- -: `packages/shared` ESM source uses explicit `.js` import extensions (NodeNext), which can surprise contributors used to extensionless TS imports.
- -: Mastra warns and falls back to in-memory storage if `MASTRA_DB_URL` is unset; the default local SQLite file is not durable across deploys.

---

## ADR-008: Nuxt.js → Next.js web app + Astryx design system

**Date:** 2026-07-14
**Status:** Accepted

**Context:** The web app (`apps/web`) shipped on Nuxt 4 + @nuxt/ui (Vue). The project chose to standardize the web tier on **Next.js (App Router, React)** and adopt **Astryx** (`@astryxdesign/core`, Meta Open Source) as the design system. The app is a neutral placeholder (landing page + health card + agent-chat demo), so the port is small; the AgentBase A2A proxy contract is unchanged.

**Decision:**

- Rebuild `apps/web` on **Next.js (App Router) + React 19**. Vue SFC pages → React components under `app/`; Nitro `server/api/*` routes → Next route handlers under `app/api/**/route.ts`; the `callAgent()` A2A client moves to `app/lib/a2a-client.ts` and reads `process.env` instead of `runtimeConfig`. The `agentId` forwarding into `params.agentId` is preserved.
- Adopt **Astryx** for UI (components + theme tokens) with the **neutral** theme, wired via a client `<Theme>` provider. Use **Tailwind v4** utilities for layout via the Astryx Tailwind bridge (`@astryxdesign/core/tailwind-theme.css`); cascade-layer order is declared in `app/globals.css`. This replaces the "Material 3 Expressive" design template.
- **Build on webpack** (`next build --webpack`) plus a `react/jsx-dev-runtime` shim: Astryx 0.1.x ships components compiled against React's dev JSX runtime (`jsxDEV`), which React sets to `undefined` in production and which Turbopack cannot alias across the SSR layer. `next dev` stays on Turbopack. Revisit when Astryx ships a production build.
- **ESLint:** `apps/web` uses the shared root flat config (no `eslint-config-next`, whose transitive plugins cap at ESLint 9 while the repo is on ESLint 10).
- **Docker:** Next `output: 'standalone'` replaces the Nitro `.output` runtime; the web env var `NUXT_MASTRA_BASE` → `MASTRA_INTERNAL_URL`. Ports unchanged (web 3000).

**Consequences:**

- +: Web tier is React/Next standard; Astryx gives an accessible, themeable component set out of the box.
- +: `@precast/shared` (`HealthStatus`, `EnvSchema`) carried over unchanged — the shared package stayed framework-agnostic.
- -: The production build is pinned to webpack + a JSX shim until Astryx ships a prod-compiled build; a Turbopack production build currently fails on Astryx.
- -: No `eslint-config-next` means Next-specific lint rules (e.g. `no-img-element`) aren't enforced; `next build` still type-checks.
- -: Astryx is pre-1.0 (`^0.1`); its component APIs may shift before a stable release.

---

## ADR-009: Rename `apps/api` → `apps/agents`; agents-only scope

**Date:** 2026-07-15
**Status:** Accepted

**Context:** The Mastra app was named `apps/api` (`@precast/api`). "API" was misleading: the app's purpose is to define **Mastra agents** (and their tools), not to host a general REST API or MCP servers. The name invited scope creep — contributors adding endpoints/MCPs where they don't belong. (Note: Mastra's own HTTP surface is legitimately served under `/api/*`; that is separate from the workspace folder name.)

**Decision:**

- Rename the workspace app `apps/api` → **`apps/agents`** and the package `@precast/api` → **`@precast/agents`**. Root scripts become `dev:agents` / `build:agents` / `test:agents`. Docker: service `api` → **`agents`**, `container_name`/volume `precast-api*` → `precast-agents*`, and the web app's `MASTRA_INTERNAL_URL` DNS → `http://agents:4111`.
- **Scope rule (guard rail):** `apps/agents` hosts **Mastra agents and their tools only** — no MCP servers, no hand-rolled REST/HTTP endpoints. Agents reach external MCPs/APIs as _tools_ (`@mastra/mcp`); Mastra already exposes each agent over A2A; frontend/BFF routes live in `apps/web`. Documented in `CLAUDE.md` §4.1 and the `index.ts` header.
- **Do NOT rename Mastra's HTTP routes** (`/api/a2a/:id`, `/api/agents`, `/api/health`, `/api/.well-known/...`) — those are Mastra's framework surface, unchanged.

**Consequences:**

- +: The folder name states its purpose; the scope rule discourages turning the agents app into a catch-all backend.
- +: Consistent identifiers across scripts, Docker service/DNS, logger name, and docs.
- -: A one-time churn across config + docs; historical PROGRESS/ADR entries still reference `apps/api` as the name at the time (intentionally left as history).
- Neutral: `KEYCLOAK_CLIENT_ID` stays `precast-api` — it names an OAuth client tier, not the workspace app.
