# PROGRESS.md — Context Memory

> **This file is the ultimate cross-tool context memory.** All coding agents MUST update this file on every meaningful change. If you finish work without updating PROGRESS.md, the work is **not** considered complete.

**Last Updated:** 2026-07-14
**Updated By:** Claude Code — Migrated web from Nuxt → Next.js (App Router) + Astryx design system
**Active Branch:** develop

---

## 0. How to Use This File

### 0.1 When to Update

You MUST update PROGRESS.md when you:

- Start or finish a task / subtask listed below.
- Make a code change, however small.
- Make or revise a design decision.
- Add, modify, or remove tests.
- Change environment variables or infrastructure config.
- Discover a blocker, risk, or open question.
- Switch tools between sessions.

### 0.2 How to Update

1. Bump **Last Updated** + **Updated By** at the top.
2. Append an entry to the **Session Log** (top of log = newest).
3. Tick / untick relevant **Task Tracker** checkboxes.
4. Update **Open Decisions**, **Known Blockers**, **Test Coverage** as needed.
5. If you started/finished a phase, update **Build Status**.
6. Keep entries terse. Link to files where helpful.

### 0.3 What Belongs Here vs Elsewhere

- **Here:** state of work, decisions, blockers, what's next, who/what did what.
- **Not here:** architectural rationale (→ [SPEC.md](SPEC.md)), style rules (→ [STYLE_GUIDE.md](STYLE_GUIDE.md)), test definitions (→ [TEST_CASES.md](TEST_CASES.md)).
- **Never here:** secrets, raw tokens, PII.

---

## 1. Project Snapshot

> Overwrite this table when you fork Precast for a real project.

| Field            | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Project**      | Precast v0.1.0 (boilerplate — rename on fork via `pnpm rename <name>`)                                     |
| **Mission**      | A precast, agent-ready TypeScript monorepo foundation with built-in documentation contracts and guardrails |
| **Stacks**       | pnpm + Turborepo · Mastra (agents) · Next.js + Astryx (web) · zod · Postgres/Redis/Keycloak (Docker)       |
| **Repo Root**    | `~/Projects/precast`                                                                                       |
| **Primary Docs** | [SPEC.md](SPEC.md), [TECH_STACK.md](TECH_STACK.md), [STYLE_GUIDE.md](STYLE_GUIDE.md)                       |

---

## 2. Phase Plan

> Track major phases here. Mark each: Not Started / In Progress / Completed / Blocked

| #   | Phase                               | Status      | Exit Criteria                                                                           |
| --- | ----------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| 0   | Boilerplate baseline                | Completed   | Consistent placeholder namespace, rename tooling, docs contract seeded, git initialized |
| 1   | (project-specific — define on fork) | Not Started | —                                                                                       |

---

## 3. Task Tracker (live)

> Mark each task `[ ]`, `[~]` in-progress, `[x]` done, `[!]` blocked.

- [x] Standardize the `precast` placeholder across all functional config
- [x] Add `pnpm rename` scaffold script (`scripts/rename-project.mjs`)
- [x] Rewrite README as the agent entry point
- [x] Fix stale model pins + `[current date]` placeholders
- [x] Seed HANDOFF.md §1/§2 and PROGRESS.md with real baseline state
- [x] Initialize a fresh git repo named `precast`
- [x] Scaffold runnable `apps/api` (NestJS) + `apps/web` (Nuxt) entrypoints on the shared package
- [x] Verify build / typecheck / lint / test all green; live `/health` on both apps
- [x] Switch default branch to `develop`
- [x] Add autonomous Playwright E2E (config boots `nuxt dev`) + specs
- [x] Add `pnpm deps:update` (latest compatible + verify)
- [x] Add `pnpm bootstrap` (rename + deps + blank git on `develop`)
- [x] Replace NestJS with Mastra (neutral example agent + tool); ESM everywhere; ports 4111/3000
- [x] Add feed-forward templates (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM) + bootstrap guidance
- [x] Keep apps neutral — domain (reservation, M3 Expressive) lives only in templates/

---

## 4. Open Decisions

| ID    | Decision                                                                 | Date       | Rationale                                                                                                      |
| ----- | ------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| D-001 | Use `precast` as the placeholder namespace, renamed via `pnpm rename`    | 2026-07-06 | One consistent token is safer to find-replace than a mix; resolved the `precast_dev`/`project_dev` DB mismatch |
| D-002 | Rename script rewrites only functional config, never docs/ prose         | 2026-07-06 | Docs describe the boilerplate itself and must stay readable after a rename                                     |
| D-003 | Runtime packages (`api`, `shared`) compile to CommonJS; remove Husky     | 2026-07-06 | Pure-ESM NestJS+decorators is fragile on node; Husky's `prepare` silently hijacked `.githooks`. See ADR-005    |
| D-004 | `develop` default branch; bootstrap resets git history; CI external      | 2026-07-06 | A forked project shouldn't inherit Precast's history; CI is owned outside the repo. See ADR-006                |
| D-005 | Replace NestJS with Mastra; ESM everywhere; ports Mastra 4111/Nuxt 3000  | 2026-07-06 | Agent-native fit; Mastra bundler needs ESM named exports (reverses ADR-005 CJS). See ADR-007                   |
| D-006 | Keep Mastra/web apps neutral; domain lives only in `templates/`          | 2026-07-06 | Boilerplate must not couple to one example; harness builds structure from feed-forward docs + TECH_STACK       |
| D-007 | Web on **Next.js (App Router) + Astryx**; style with Astryx + Tailwind   | 2026-07-14 | Chosen web tier + design system. Astryx components for the DS, Tailwind for layout. See ADR-008                |
| D-008 | Web builds with **webpack** + a `jsx-dev-runtime` shim; dev on Turbopack | 2026-07-14 | Astryx 0.1.x ships dev-JSX components; only webpack's alias reaches SSR. Revisit on Astryx prod build. ADR-008 |
| D-009 | `apps/web` uses the shared root ESLint config (no `eslint-config-next`)  | 2026-07-14 | eslint-config-next's plugins cap at ESLint 9; repo is on ESLint 10. Matches the apps/api pattern               |

---

## 5. Known Blockers

| ID  | Blocker | Impact | Workaround |
| --- | ------- | ------ | ---------- |

---

## 6. Test Coverage

| Area                | Tests                                                                   | Status        |
| ------------------- | ----------------------------------------------------------------------- | ------------- |
| API (Vitest)        | `example-tool.spec.ts` — 1 spec (placeholder)                           | Passing       |
| Web/shared (Vitest) | `test/health.spec.ts` — env schema (2)                                  | Passing       |
| Workspace build     | `pnpm build` — shared + api (mastra) + web                              | Passing       |
| Workspace typecheck | `pnpm typecheck` — 4 tasks                                              | Passing       |
| Workspace lint      | `pnpm lint` — 3 tasks                                                   | Passing       |
| Live smoke (api)    | Mastra `GET /api/agents` lists example-agent                            | Passing       |
| Live smoke (web)    | `next dev`: `/api/health` JSON, `/` SSRs Astryx, a2a forwards `agentId` | Passing       |
| E2E (Playwright)    | `e2e/home.spec.ts` — 3 specs, chromium (run on a free port)             | Passing (3/3) |
| Tooling             | rename / bootstrap / deps:update                                        | Passing       |

---

## 7. Environment State

| Variable | Value                                                               |
| -------- | ------------------------------------------------------------------- |
| `Node`   | 24 (`.nvmrc`); verified on 25.2.1 this session                      |
| `pnpm`   | 9.15.9                                                              |
| `Ports`  | Web 3000 · Mastra 4111 · Postgres 5432 · Redis 6379 · Keycloak 8080 |

---

## 8. Session Log


<auto-journal: 2026-07-15 05:34:24 — file edit>

<auto-journal: 2026-07-15 05:34:20 — file edit>

<auto-journal: 2026-07-15 05:34:14 — file edit>

<auto-journal: 2026-07-15 05:34:09 — file edit>

<auto-journal: 2026-07-15 05:34:05 — file edit>

<auto-journal: 2026-07-15 05:33:49 — file edit>

<auto-journal: 2026-07-14 14:38:56 — file edit>

<auto-journal: 2026-07-14 14:38:49 — file edit>

<auto-journal: 2026-07-14 14:38:20 — file edit>

<auto-journal: 2026-07-14 14:38:13 — file edit>

<auto-journal: 2026-07-14 14:38:06 — file edit>

<auto-journal: 2026-07-14 14:37:59 — file edit>

<auto-journal: 2026-07-14 14:37:48 — file edit>

<auto-journal: 2026-07-14 14:37:36 — file edit>

<auto-journal: 2026-07-14 14:37:28 — file edit>

<auto-journal: 2026-07-14 14:37:17 — file edit>
<auto-journal: 2026-07-14 09:13:12 — file edit>
<auto-journal: 2026-07-14 09:12:42 — file edit>

<auto-journal: 2026-07-14 09:12:23 — file edit>

<auto-journal: 2026-07-14 09:08:58 — file edit>

<auto-journal: 2026-07-14 09:08:36 — file edit>

- **2026-07-14 — Claude Code —** Migrated `apps/web` from **Nuxt 4 → Next.js 16 (App Router)** and replaced **@nuxt/ui with the Astryx design system** (`@astryxdesign/core`, neutral theme) + Tailwind v4 for layout. Ported: Vue SFCs → React (`app/layout.tsx`, `app/providers.tsx`, `app/page.tsx`, `app/AgentChat.tsx`); Nitro routes → route handlers (`app/api/health/route.ts`, `app/api/a2a/[agentId]/route.ts`); util → `app/lib/a2a-client.ts` (reads `process.env`, preserves `params.agentId`). New: `next.config.ts`, `postcss.config.mjs`, `app/globals.css`, `jsx-dev-runtime.shim.ts`. Deleted the Nuxt files. Build pinned to `next build --webpack` + jsxDEV shim (Astryx ships dev-JSX; see D-008/ADR-008); dev on Turbopack. Repo sweep: turbo outputs `.next`, root eslint ignores, `.gitignore`, `apps/web/Dockerfile` → Next standalone, compose `MASTRA_INTERNAL_URL`, set-ports/rename/bootstrap scripts. Docs: CLAUDE.md, TECH_STACK, SPEC, STYLE_GUIDE, INTEGRATION §7, HANDOFF, ADR-008, DESIGN_SYSTEM template, TEST_CASES, SCRIPTS, AGENT_SPINUP_PROMPTS, WORKFLOW_SUNSET_BOULEVARD (+svg), README. Verified: web build ✓, `pnpm typecheck` 4/4 ✓, `pnpm lint` 3/3 ✓, web vitest 2/2 ✓, `next dev` smoke ✓, Playwright E2E 3/3 ✓ (on a free port — port 3000 was occupied by another local app), and a2a proxy confirmed to forward `params.agentId` end-to-end via a local echo server.

<auto-journal: 2026-07-14 09:08:19 — file edit>

<auto-journal: 2026-07-14 09:08:10 — file edit>

<auto-journal: 2026-07-14 09:07:59 — file edit>

<auto-journal: 2026-07-14 09:07:48 — file edit>

<auto-journal: 2026-07-14 09:07:39 — file edit>

<auto-journal: 2026-07-14 09:07:34 — file edit>

<auto-journal: 2026-07-14 09:07:10 — file edit>

<auto-journal: 2026-07-14 09:06:50 — file edit>

<auto-journal: 2026-07-14 09:06:46 — file edit>

<auto-journal: 2026-07-14 09:06:37 — file edit>

<auto-journal: 2026-07-14 09:06:18 — file edit>

<auto-journal: 2026-07-14 09:05:57 — file edit>

<auto-journal: 2026-07-14 09:05:40 — file edit>

<auto-journal: 2026-07-14 09:05:03 — file edit>

<auto-journal: 2026-07-14 09:04:15 — file edit>

<auto-journal: 2026-07-14 09:04:14 — file edit>

<auto-journal: 2026-07-14 09:03:57 — file edit>

<auto-journal: 2026-07-14 09:03:56 — file edit>

<auto-journal: 2026-07-14 09:03:55 — file edit>

<auto-journal: 2026-07-14 09:03:53 — file edit>

<auto-journal: 2026-07-14 09:03:50 — file edit>

<auto-journal: 2026-07-14 09:03:47 — file edit>

<auto-journal: 2026-07-14 09:03:46 — file edit>

<auto-journal: 2026-07-14 09:03:44 — file edit>

<auto-journal: 2026-07-14 09:03:43 — file edit>

<auto-journal: 2026-07-14 09:03:43 — file edit>

<auto-journal: 2026-07-14 09:03:41 — file edit>

<auto-journal: 2026-07-14 09:03:40 — file edit>

<auto-journal: 2026-07-14 09:03:36 — file edit>

<auto-journal: 2026-07-14 09:03:36 — file edit>

<auto-journal: 2026-07-14 09:03:35 — file edit>

<auto-journal: 2026-07-14 09:03:33 — file edit>

<auto-journal: 2026-07-14 09:03:31 — file edit>

<auto-journal: 2026-07-14 09:03:25 — file edit>

<auto-journal: 2026-07-14 09:03:20 — file edit>

<auto-journal: 2026-07-14 09:03:18 — file edit>

<auto-journal: 2026-07-14 09:03:17 — file edit>

<auto-journal: 2026-07-14 09:03:16 — file edit>

<auto-journal: 2026-07-14 09:03:14 — file edit>

<auto-journal: 2026-07-14 09:03:13 — file edit>

<auto-journal: 2026-07-14 09:03:11 — file edit>

<auto-journal: 2026-07-14 09:02:26 — file edit>

<auto-journal: 2026-07-14 09:02:08 — file edit>

<auto-journal: 2026-07-14 09:02:01 — file edit>

<auto-journal: 2026-07-14 09:01:56 — file edit>

<auto-journal: 2026-07-14 09:01:50 — file edit>

<auto-journal: 2026-07-14 09:01:45 — file edit>

<auto-journal: 2026-07-14 09:01:37 — file edit>

<auto-journal: 2026-07-14 09:01:16 — file edit>

<auto-journal: 2026-07-14 09:00:47 — file edit>

<auto-journal: 2026-07-14 09:00:39 — file edit>

<auto-journal: 2026-07-14 09:00:33 — file edit>

<auto-journal: 2026-07-14 09:00:27 — file edit>

<auto-journal: 2026-07-14 09:00:19 — file edit>

<auto-journal: 2026-07-14 09:00:14 — file edit>

<auto-journal: 2026-07-14 08:59:27 — file edit>

<auto-journal: 2026-07-14 08:59:22 — file edit>

<auto-journal: 2026-07-14 08:59:17 — file edit>

<auto-journal: 2026-07-14 08:56:29 — file edit>

<auto-journal: 2026-07-14 08:55:25 — file edit>

<auto-journal: 2026-07-14 08:55:21 — file edit>

<auto-journal: 2026-07-14 08:53:26 — file edit>

<auto-journal: 2026-07-14 08:53:00 — file edit>

<auto-journal: 2026-07-14 08:52:52 — file edit>

<auto-journal: 2026-07-14 08:50:44 — file edit>

<auto-journal: 2026-07-14 08:50:12 — file edit>

<auto-journal: 2026-07-14 08:49:48 — file edit>

<auto-journal: 2026-07-14 08:49:28 — file edit>

<auto-journal: 2026-07-14 08:41:42 — file edit>

<auto-journal: 2026-07-14 08:39:14 — file edit>

- **2026-07-14 — Claude Code —** Proved the boilerplate supports multiple agents each with its own agent card. Added `apps/api/src/mastra/agents/summary-agent.ts` (`summary-agent`, second neutral placeholder) and registered it in `index.ts` (`agents: { exampleAgent, summaryAgent }`); each agent auto-serves `/api/.well-known/:id/agent-card.json` via `@mastra/server` (no card code). Fixed `apps/web/server/utils/a2a-client.ts` — `callAgent()` now forwards `agentId` into JSON-RPC `params.agentId` (was accepted + validated at the Nitro route but dropped before the AgentBase call, so all traffic resolved to one target); made `agentId` a required field on the `A2aRequest.params` type. Verified: booted `mastra dev`, `GET /api/agents` lists both, both `.well-known` cards return distinct `name`/`url`/skills. `pnpm typecheck` 4/4 green. Carry-forward: each agent still needs separate AgentBase registration (`POST /agents`) + skill approval (INTEGRATION_AGENTBASE §4).

<auto-journal: 2026-07-14 06:43:36 — file edit>

<auto-journal: 2026-07-14 06:43:33 — file edit>

<auto-journal: 2026-07-14 06:43:23 — file edit>

<auto-journal: 2026-07-14 06:43:20 — file edit>

<auto-journal: 2026-07-14 06:43:13 — file edit>

<auto-journal: 2026-07-14 06:43:07 — file edit>
<auto-journal: 2026-07-08 12:56:27 — file edit>

<auto-journal: 2026-07-08 12:56:19 — file edit>

<auto-journal: 2026-07-08 01:28:56 — file edit>

<auto-journal: 2026-07-08 01:26:41 — file edit>

<auto-journal: 2026-07-08 01:26:35 — file edit>

<auto-journal: 2026-07-08 01:26:28 — file edit>

<auto-journal: 2026-07-08 01:26:06 — file edit>

<auto-journal: 2026-07-08 01:25:51 — file edit>

<auto-journal: 2026-07-08 01:25:46 — file edit>

<auto-journal: 2026-07-08 01:18:24 — file edit>

<auto-journal: 2026-07-08 01:18:13 — file edit>

<auto-journal: 2026-07-08 01:17:56 — file edit>

<auto-journal: 2026-07-08 01:17:47 — file edit>

<auto-journal: 2026-07-08 01:17:30 — file edit>

<auto-journal: 2026-07-08 01:17:26 — file edit>

<auto-journal: 2026-07-08 01:16:53 — file edit>

<auto-journal: 2026-07-08 01:16:37 — file edit>

<auto-journal: 2026-07-08 01:16:29 — file edit>

<auto-journal: 2026-07-08 01:16:17 — file edit>

<auto-journal: 2026-07-08 01:16:09 — file edit>

<auto-journal: 2026-07-08 01:16:01 — file edit>

<auto-journal: 2026-07-08 01:13:53 — file edit>

<auto-journal: 2026-07-07 12:52:03 — file edit>

<auto-journal: 2026-07-07 12:51:56 — file edit>

<auto-journal: 2026-07-07 12:51:49 — file edit>

<auto-journal: 2026-07-07 12:51:29 — file edit>

<auto-journal: 2026-07-07 12:51:05 — file edit>
<auto-journal: 2026-07-07 12:45:34 — file edit>

<auto-journal: 2026-07-07 12:45:19 — file edit>

<auto-journal: 2026-07-07 12:07:16 — file edit>

<auto-journal: 2026-07-07 11:33:27 — file edit>

<auto-journal: 2026-07-07 11:33:13 — file edit>

<auto-journal: 2026-07-07 11:04:37 — file edit>

<auto-journal: 2026-07-07 10:45:55 — file edit>

<auto-journal: 2026-07-07 10:45:48 — file edit>

<auto-journal: 2026-07-07 10:45:44 — file edit>

<auto-journal: 2026-07-07 10:45:40 — file edit>

<auto-journal: 2026-07-07 10:45:35 — file edit>

<auto-journal: 2026-07-07 10:45:31 — file edit>

<auto-journal: 2026-07-07 10:45:27 — file edit>

<auto-journal: 2026-07-07 10:39:37 — file edit>

<auto-journal: 2026-07-07 10:37:59 — file edit>

<auto-journal: 2026-07-07 06:54:38 — file edit>

<auto-journal: 2026-07-06 10:25:40 — file edit>
<auto-journal: 2026-07-06 10:23:54 — file edit>

<auto-journal: 2026-07-06 10:23:38 — file edit>

<auto-journal: 2026-07-06 10:23:18 — file edit>

<auto-journal: 2026-07-06 10:23:09 — file edit>
Newest entries at the top. (`<auto-journal>` lines are stamped automatically by the Claude Code PostToolUse hook; collapsed periodically.)

- **2026-07-06 — Claude Code (session 6):** Switched the example agent to Gemini — `model: 'google/gemini-2.5-flash'`, provider key `GOOGLE_GENERATIVE_AI_API_KEY` (verified against Mastra 1.49's gateway registry). Updated env schema + `.env.example` and all doc/template references (README, TECH_STACK, ADR-007, HANDOFF, AGENT_SPEC). Build/typecheck/lint/test/e2e green.
- **2026-07-06 — Claude Code (session 5):** Neutralized the app code. The reservation domain and Material 3 Expressive belong only in `templates/` (authoring guides) — session 4 wrongly baked them into the Mastra app. Replaced `reservation-agent`/`reservation-tools` with neutral `example-agent` + `example-tool` (echo) placeholders that just prove the wiring; Nuxt was already neutral. Fixed the AGENT_SPEC template's "implemented in" reference. Corrected app-vs-template claims across README, TECH_STACK, ADR-007, SPEC, TEST_CASES, HANDOFF. Recorded D-006. Re-verified build/typecheck/lint/test/e2e green; API lists `example-agent`.
- **2026-07-06 — Claude Code (session 4):** Replaced NestJS with **Mastra** in `apps/api` — `src/mastra/` instance + reservation agent + `check-availability`/`book-room` tools + LibSQL memory; `mastra dev` on **4111**. Moved Nuxt to **3000**. Switched `packages/shared` to **ESM (NodeNext)** so Mastra's bundler resolves named exports (reversed ADR-005 CJS; recorded ADR-007). API tests → Vitest (logic extracted from tools into plain functions). Env: `API_*`→`MASTRA_*` + `MASTRA_DB_URL` + `OPENAI_API_KEY`. Added feed-forward `templates/` (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM — reservation + Material 3 Expressive worked examples) and bootstrap doc guidance. Verified build/typecheck/lint/test/e2e all green; Mastra API lists the agent at `/api/agents`. Updated CLAUDE, README, TECH_STACK, ADRS, SPEC, TEST_CASES, HANDOFF.
- **2026-07-06 — Claude Code (session 3):** Renamed default branch `main` → `develop`. Added autonomous Playwright E2E (`apps/web/playwright.config.ts` boots `nuxt dev`; `e2e/home.spec.ts`, 3 specs green on chromium) + turbo `test:e2e` task + `test:e2e:install`. Added `scripts/update-deps.mjs` (`pnpm deps:update` — latest compatible within ranges, then verify; `--latest`/`--dry`/`--no-verify`). Added `scripts/bootstrap.mjs` (`pnpm bootstrap` — asks name → rename → update deps → `rm -rf .git` + `git init -b develop` + first commit; verified end-to-end in a temp copy). Gitignored playwright output. Recorded ADR-006 (develop/bootstrap/external-CI). Updated README, TECH_STACK, SCRIPTS, SPEC, TEST_CASES, HANDOFF.
- **2026-07-06 — Claude Code (session 2):** Scaffolded runnable entrypoints. API: `main.ts` (pino bootstrap), `app.module.ts` (ConfigModule validate via shared zod + LoggerModule), `health` controller + Jest spec, `jest.config.ts`, `nest-cli.json`. Web: `app.vue`, `pages/index.vue`, `server/api/health.get.ts`, `nuxt.config.ts`, `vitest.config.ts` + spec, `eslint.config.mjs`. Made `packages/shared` + `apps/api` CommonJS; extended `parseEnv` to accept a source object. Removed Husky (hijacked `.githooks`), wired lint-staged into `.githooks/pre-commit`, added `@types/node`/`vue-tsc`/`@nuxt/eslint`, dropped `@nuxtjs/tailwindcss`. Cleaned stray emitted files from `packages/shared/src`, gitignored `.turbo`, formatted the whole repo. Verified: build 3/3, typecheck 4/4, lint 3/3, test 3/3, live `/health` on both apps. Updated TECH_STACK, ADR-005, TEST_CASES, SPEC, HANDOFF.
- **2026-07-06 — Claude Code (session 1):** Reviewed Precast end to end. Standardized the `precast` placeholder across package scopes, Docker, Keycloak, tsconfig, and env; fixed the `precast_dev`/`project_dev` DB-name mismatch. Added `scripts/rename-project.mjs` + `pnpm rename`. Rewrote README as the agent entry point. Refreshed model pins (opus-4-8) and `[current date]` placeholders. Seeded HANDOFF §1/§2 and this file. Initialized a fresh git repo named `precast`.

---

## 9. Cross-Tool Handoff Notes

| Date       | Agent       | Context                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-06 | Claude Code | Agent-native baseline (neutral Mastra example agent) on `develop`. Next agent: `pnpm install && pnpm bootstrap`, then write feed-forward docs from `templates/` and build real agents/pages from them. Example agent needs `GOOGLE_GENERATIVE_AI_API_KEY`; E2E needs `pnpm -F @precast/web test:e2e:install` once. See HANDOFF.md §2. |

---

## 10. Changelog

- 2026-07-06: Standardized `precast` placeholder; added rename script; rewrote README; refreshed stale pins/dates; initialized fresh git repo.
- 2026-07-06: Scaffolded runnable NestJS API + Nuxt web on the shared package; CommonJS runtime packages; removed Husky; added tests + configs; whole workspace builds/typechecks/lints/tests green.
- 2026-07-06: Default branch → `develop`; added autonomous Playwright E2E, `pnpm deps:update`, and `pnpm bootstrap`.
- 2026-07-06: Replaced NestJS with Mastra + LibSQL memory; ESM everywhere; ports Mastra 4111 / Nuxt 3000; added feed-forward templates (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM / Material 3 Expressive).
- 2026-07-06: Neutralized Mastra/Nuxt app code — replaced reservation agent/tools with `example-agent`/`example-tool` placeholders; the reservation + M3 Expressive domain now lives only in `templates/`.
- 2026-07-06: Example agent switched to Gemini (`google/gemini-2.5-flash`, `GOOGLE_GENERATIVE_AI_API_KEY`).
