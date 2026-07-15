# HANDOFF.md — Continuity Plan

> **Purpose.** Single, always-current entry point for any agent about to pick up work. Read this file first; everything you need to take over the last-executed task or continue the next one is captured here.
>
> **Authority.** This doc lives at the top of `docs/`. It is the **only** doc a takeover agent is required to read before doing anything else. Once you've read this, the **Resume prompt** below tells you exactly which other docs to consult.
>
> **Updates.** Every meaningful task closure MUST overwrite §1 + §2 + §4 of this file in the same change set that closes the task. See the enforcement clause in [`CLAUDE.md` §3.5](../CLAUDE.md#35-handoffmd-enforcement--mandatory).
>
> **What this is NOT.** Long-form session history (→ [`PROGRESS.md Session Log`](PROGRESS.md)); architectural rationale (→ [`SPEC.md`](SPEC.md)); the plan being executed (→ `docs/plans/...`). This file is _only_ the single-page continuity checkpoint.

---

## 1. Current state (overwrite on each handoff)

**Latest (2026-07-15):** Established the **web → agents A2A-only invariant**: `apps/web` interacts with Mastra agents exclusively over A2A (JSON-RPC 2.0) via `callAgent()` — with or without AgentBase — never Mastra's native REST (`/api/agents/:id/generate`|`/stream`), listing, or Studio. Enforced by a new fitness test `apps/web/test/a2a-only.spec.ts` (scans web source, fails on any non-A2A agent route). Documented in CLAUDE.md §4.1, `a2a-client.ts` header, INTEGRATION §7.7, README, and the skill. Also fixed a stale INTEGRATION §2.1 row (native invocation is `/api/agents/:id/generate|stream`, not the 404 `/agents/:id/messages`). Web tests 3/3 (incl. the new guard); build/typecheck/lint green.

**Prior (2026-07-15):** Renamed the Mastra app **`apps/api` → `apps/agents`** (`@precast/api` → `@precast/agents`) to end the "API" confusion, with an **agents-only scope rule** (no MCP servers, no hand-rolled REST APIs — agents call tools; frontend/BFF lives in `apps/web`). `git mv` preserved history. Swept: root scripts (`dev/build/test:agents`), Docker (service `agents`, container/volume `precast-agents*`, web DNS `http://agents:4111`), Dockerfile, `set-ports.mjs`, Mastra logger name, and structural docs (CLAUDE §4.1 rule + stack label, TECH_STACK, SPEC tree, README, STYLE_GUIDE, INTEGRATION, TEST_CASES, SCRIPTS, AGENT_SPEC template) + ADR-009 / D-012. **Mastra's own `/api/*` HTTP routes are unchanged.** `KEYCLOAK_CLIENT_ID` stays `precast-api` (an OAuth client name, not the app). build 3/3 · typecheck 4/4 · lint 3/3 · test 3/3 green.

**Prior (2026-07-15):** Guard-rail change — **AgentBase is now the DEFAULT transport**. `isAgentBaseEnabled()` returns `process.env.ENABLE_AGENTBASE !== '0'`, so a missing/any-non-`0` value proxies through AgentBase; only an explicit `ENABLE_AGENTBASE=0` uses direct A2A. Added a guard in `callViaAgentBase`: if AgentBase is active but `AGENTBASE_URL` is unset/placeholder, `callAgent()` returns a clear error reply (configure it, or set `=0`). Flipped the env-schema default to `'1'`, `.env.example`, docker-compose comment, and the docs framing (README, INTEGRATION §7). Verified all three paths at runtime (unset→agentbase, `=0`→direct, unconfigured→guard error). Also strengthened the **precast skill** `description` for trigger accuracy + added a "Making sure the skill gets used" section (explicit `/precast`, re-add to sync the app copy). `pnpm build`/`typecheck`/`lint` green.

**Prior (2026-07-14):** Made **AgentBase optional** via `ENABLE_AGENTBASE`. `apps/web/app/lib/a2a-client.ts` `callAgent()` now branches: `ENABLE_AGENTBASE=1` → proxy through AgentBase (`POST $AGENTBASE_URL/a2a`, `tasks/send`, Bearer `AGENTBASE_TOKEN`); otherwise (default) → **direct A2A** to Mastra (`POST $MASTRA_INTERNAL_URL/api/a2a/:agentId`, A2A `message/send`, Bearer `AGENT_API_TOKEN`). Verified against the real Mastra A2A endpoint: it requires `message/send` (rejects `tasks/send`). `callAgent()` returns a normalized `{ ok, text, error?, via, raw }`; the route handler + `AgentChat` consume it (chat shows which transport replied). Added `ENABLE_AGENTBASE` + `MASTRA_INTERNAL_URL` to the shared env schema + `.env.example`; docker-compose web sets `ENABLE_AGENTBASE=0` (in-cluster direct). Updated INTEGRATION §7 (both flows), README, and the external skill repo. Both modes runtime-verified via a capturing echo server (correct method/URL/bearer + normalized reply). `pnpm build`/`typecheck`/`lint` green.

**Prior (2026-07-14):** Public-prep + doc refinements on top of the migration. (a) **Credential/internal-ref scrub** for open-sourcing: internal `*.917v.dev` hosts → `agentbase.example.com`, internal MCP URL genericized, local path → `~/Projects/precast`; `origin/develop` history was squashed to a single clean baseline and force-pushed (no secrets/internal refs in tree or history; author email is the only 917 reference, in commit metadata). (b) **Nuxt-cleanup** of stale functional leftovers the migration missed: comments in `apps/agents/src/mastra/middleware/auth.ts` + `packages/shared/src/env.ts`, and `.githooks/pre-commit` (added `tsx`/`jsx` to `TRIGGER_PATTERNS` — it wasn't triggering the doc-check on React files), `.lintstagedrc.json`, `.dockerignore`, `.prettierignore` (`.nuxt`/`.output` → `.next`). (c) **Direct-A2A clarity**: made explicit in `auth.ts`, `.env.example`, `INTEGRATION_AGENTBASE.md` §2.1, and README that any A2A (JSON-RPC 2.0) client can invoke the agents at `POST /api/a2a/:agentId` with `Authorization: Bearer <token>` matching `AGENT_API_TOKEN` (routes open when unset). Remaining Nuxt mentions are intentional history (ADRs, session log). `pnpm lint`/`typecheck` green.

**Migration (2026-07-14) — Claude Code:** Migrated `apps/web` from Nuxt → Next.js (App Router) and swapped @nuxt/ui for the Astryx design system. Vue SFCs → React components under `apps/web/app/` (`layout.tsx`, `providers.tsx` with Astryx `<Theme>`, `page.tsx`, `AgentChat.tsx`); Nitro routes → Next route handlers (`app/api/health/route.ts`, `app/api/a2a/[agentId]/route.ts`); A2A client → `app/lib/a2a-client.ts` (reads `process.env`, still forwards `params.agentId`). Styling = Astryx components + Tailwind v4 (bridge in `app/globals.css`). **Build runs on webpack** (`next build --webpack`) + a `react/jsx-dev-runtime` shim (`apps/web/jsx-dev-runtime.shim.ts`, wired in `next.config.ts`) because Astryx 0.1.x ships dev-JSX-compiled components; `next dev` uses Turbopack. Swept repo configs (turbo `.next`, root eslint ignores, Dockerfile → Next standalone, compose `MASTRA_INTERNAL_URL`), scripts (set-ports/rename/bootstrap), and all framework-touching docs (TECH_STACK, SPEC, STYLE_GUIDE, INTEGRATION §7, ADR-008, DESIGN_SYSTEM template, TEST_CASES, SCRIPTS, README, CLAUDE.md). Verified: `pnpm --filter @precast/web build` ✓, `pnpm typecheck` 4/4 ✓, `pnpm lint` 3/3 ✓, web vitest 2/2 ✓, Playwright E2E 3/3 ✓ (run on a free port — 3000 was occupied by another local app; use `E2E_PORT=<free>` if 3000 is busy), `next dev` smoke ✓, and the a2a proxy confirmed forwarding `params.agentId` end-to-end. See [ADR-008](ADRS.md).

**Prior (2026-07-14):** Proved the boilerplate is **multi-agent**: added a second neutral placeholder agent (`apps/agents/src/mastra/agents/summary-agent.ts`, id `summary-agent`) registered alongside `exampleAgent` in `apps/agents/src/mastra/index.ts`. Each agent auto-serves its own A2A card at `/api/.well-known/:id/agent-card.json`. Fixed `callAgent()` to forward its `agentId` into JSON-RPC `params.agentId`.

**Prior (2026-07-13):** Wired Nuxt ↔ Mastra communication through the AgentBase A2A proxy with bearer token auth. Added `apps/web/server/utils/a2a-client.ts` (`callAgent()`), `apps/web/server/api/a2a/[agentId].post.ts` (Nitro proxy route), and `apps/agents/src/mastra/middleware/auth.ts` (Hono middleware enforcing `AGENT_API_TOKEN` on `/api/a2a/*` and `/api/agents/*`). Added `AGENTBASE_URL`, `AGENTBASE_TOKEN`, `AGENT_API_TOKEN` to shared env schema and `.env.example`. Added agent chat demo UI to `index.vue`. Updated `docs/INTEGRATION_AGENTBASE.md` §7 with full auth flow and wiring docs. Built and tested — all green.

**Prior (2026-07-07):** Untracked `docker/docker-compose.override.yml` (now gitignored per-developer local overrides); shipped its content as tracked `docker-compose.override.yml.example` template; updated SPEC file tree. Added reference/presentation docs (AgentBase integration guide, Sunset Boulevard workflow write-up, architecture SVG, agentic-workflows deck); clarified the clone → `pnpm bootstrap` flow in the README quick-start.

**Prior (2026-07-06):** Replaced NestJS with **Mastra** (agent API); moved shared + apps to ESM; ports Mastra 4111 / Nuxt 3000; added feed-forward templates (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM / Material 3 Expressive) and bootstrap guidance.

`apps/agents` is now a **Mastra** agent app, kept **neutral**: a placeholder `exampleAgent` + `exampleTool` (`src/mastra/`) that prove the wiring (agent + tool + model gateway + LibSQL memory) with no domain baked in. `mastra dev` serves the agent API + Studio playground on **4111**. `apps/web` (**Next.js** App Router, **Astryx** design system) is likewise a neutral landing page + health card + agent-chat demo on **3000**. The domain (meeting-room reservation) lives **only in `templates/`** as authoring guides — the harness builds real structure from those docs + TECH_STACK. Everything is **ESM** now — `packages/shared` is NodeNext ESM (`.js` import extensions) so Mastra's bundler resolves its named exports (reversed ADR-005; see ADR-007). API tests are Vitest.

**Verified 2026-07-06** (Node 25.2.1 / pnpm 9.15.9): `pnpm build` 3/3 (incl. `mastra build`) · `typecheck` 4/4 · `lint` 3/3 · `test` 3/3 · `test:e2e` 3/3 (chromium) · Mastra API boots and `GET /api/agents` lists `example-agent` · `bootstrap` end-to-end in a temp copy · `deps:update --dry` lists outdated.

**Known carry-forwards:**

- **LLM key:** the example agent needs `GOOGLE_GENERATIVE_AI_API_KEY` in `.env` to actually converse (via Mastra's model gateway, default `google/gemini-2.5-flash`). Tools + build/test work without it.
- **Storage:** `MASTRA_DB_URL` defaults to a local SQLite file (`file:./mastra.db`, gitignored) — not durable across deploys; point at libsql/Turso or swap `@mastra/pg` for production.
- Default branch is **`develop`**; CI lives outside this repo (ADR-006).
- First E2E run needs a browser: `pnpm -F @precast/web test:e2e:install` (chromium). No `postinstall` step anymore (Next needs no `prepare`); `next dev`/`build` generate `next-env.d.ts` + `.next/types`.
- **Astryx build constraint:** `apps/web` builds with `next build --webpack` + a `react/jsx-dev-runtime` shim because Astryx 0.1.x ships dev-JSX-compiled components (webpack alias reaches the SSR layer; Turbopack production build does not). `next dev` is fine on Turbopack. Revisit when Astryx ships a production build. See ADR-008 / TECH_STACK §3.
- The Mastra app and Next app are intentionally **neutral placeholders** (`exampleAgent`/`summaryAgent`/`exampleTool`, generic landing page + agent-chat demo). Real agents/pages/schema come from the feed-forward docs in `templates/` + TECH_STACK — do not treat the placeholders as the intended structure.
- **Multi-agent is code-complete but still needs the operational step per agent.** Each agent auto-exposes its own A2A card, and `callAgent()` now forwards `agentId`, but every agent must still be **registered separately on AgentBase** (`POST /agents` with its `agentCardUrl`) and have its skills approved before the proxy can route to it — see [`INTEGRATION_AGENTBASE.md`](INTEGRATION_AGENTBASE.md) §4.

---

## 2. Next task (overwrite on each handoff)

No scheduled next task — Precast is a runnable, agent-native baseline. To start a real project:

1. `pnpm install && pnpm bootstrap` (or `pnpm bootstrap my-project`).
2. **Write the feed-forward docs first:** copy the relevant `templates/*.md` into `docs/`, replace the reservation example with your product.
3. Fill in `docs/PROGRESS.md` §1 (name + mission) and the README title; set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`.
4. Build your agents/tools under `apps/agents/src/mastra/` and pages under `apps/web/app/`; extend the env schema in `packages/shared/src/env.ts`.

Boilerplate-improvement priorities (if working on Precast itself): back the reservation tools with Postgres (per DATA_MODEL); add an agent workflow + scorers; wire the web chat UI to the Mastra API using the Material 3 Expressive design system.

---

## 3. Resume prompt (paste into the next agent)

> Copy the block below verbatim into whichever agent picks up next. The prompt is self-contained — it tells the agent which docs to read, the authority order between them, and what verification to run before reporting "done".

```
You are taking over work. Read these in order before touching code:

1) docs/HANDOFF.md (this file) — current state + next task + return contract.
2) docs/PROGRESS.md — long-form context for the most recently closed task.
3) The plan file the current task references (linked in §2 above, if applicable). If §2 says "No scheduled next task", instead read PROGRESS.md Task Tracker and pick the highest-priority unchecked task there.

Authority order on disagreement:
- Tech-stack facts (versions, libs, container images, ports) → docs/TECH_STACK.md wins.
- Boilerplate structure (file layout, naming, conventions) → docs/SPEC.md wins.
- Working rules → CLAUDE.md wins.

Execution rules:
- Make atomic changes per task (code + tests + doc updates in one change set).
- Update docs/PROGRESS.md (Last Updated, Session Log, handoff note) on every meaningful change.
- Update docs/HANDOFF.md §1 + §2 + §4 in the SAME change set that closes a task.
- Run all tests listed for the task. If a pre-existing unrelated failure carries forward, document it under "Known carry-forwards" in HANDOFF.md §1.
- Stop after one logical task and report (a) what changed, (b) what tests ran + outcomes, (c) what's next.

Return format:
- Completed: <one-line summary>
- Files changed: <list>
- Tests run + outcomes: <list with green/red>
- Risks / blockers: <list>
- Next: <pointer to HANDOFF.md §2 or the new state thereof>
```

## 4. File map for takeover (always-current)

```
CLAUDE.md                   ← project brief + enforcement rules (auto-read by Claude Code)
README.md                   ← user-facing overview + quick start
package.json                ← root scripts + dependencies
pnpm-workspace.yaml         ← workspace configuration
turbo.json                  ← Turborepo task orchestration
tsconfig.base.json          ← shared TypeScript config
eslint.config.js            ← linting rules
.prettierrc                  ← formatting rules
.prettierignore             ← formatting exclusion
.editorconfig               ← editor settings
.nvmrc                      ← Node version pin
.env.example                ← env var template
.dockerignore               ← Docker build exclusions
.lintstagedrc.json          ← lint-staged configuration
docs/HANDOFF.md             ← this file (single-page continuity checkpoint)
docs/PROGRESS.md            ← live session log + task tracker (always update)
docs/SPEC.md                ← canonical boilerplate specification
docs/TECH_STACK.md          ← versions, libs, images, ports (authoritative)
docs/ADRS.md                ← architectural decision records
docs/STYLE_GUIDE.md         ← code style + naming conventions
docs/SCRIPTS.md             ← every pnpm script with descriptions
docs/TEST_CASES.md          ← test catalog with traceability
docs/INTEGRATION_AGENTBASE.md      ← AgentBase integration guide (reference)
docs/WORKFLOW_SUNSET_BOULEVARD.md  ← Sunset Boulevard workflow write-up (reference)
docs/assets/                ← diagrams/images (sunset-boulevard-architecture.svg)
docs/presentations/         ← decks (agentic-workflows.html)
docs/plans/                 ← LIVE plans directory (create as needed)
docs/archive/               ← FROZEN, do-not-parse
.githooks/pre-commit        ← doc-contract enforcement + lint-staged (native core.hooksPath)
.claude/settings.json       ← Claude Code hooks (PostToolUse, Stop, SessionStart)
.claude/settings.local.json ← local overrides (not committed)
apps/agents/src/mastra/index.ts        ← Mastra instance (agents, storage, logger, server:4111)
apps/agents/src/mastra/agents/         ← example-agent.ts + summary-agent.ts (neutral placeholders; each auto-serves its own A2A card)
apps/agents/src/mastra/tools/          ← example-tool.ts (+ .spec.ts) — neutral placeholder
apps/web/app/layout.tsx     ← root layout (imports globals.css, wraps <Providers>)
apps/web/app/providers.tsx  ← 'use client' — Astryx <Theme> provider (neutral, mode=system)
apps/web/app/page.tsx       ← landing page (server component; fetches /api/health)
apps/web/app/AgentChat.tsx  ← 'use client' agent-chat demo (posts to /api/a2a/:id)
apps/web/app/globals.css    ← Tailwind v4 + Astryx cascade-layer imports
apps/web/app/lib/a2a-client.ts ← server-only callAgent() (AgentBase A2A; forwards agentId)
apps/web/app/api/           ← route handlers: health/route.ts, a2a/[agentId]/route.ts
apps/web/next.config.ts     ← Next config (standalone output; webpack jsxDEV shim in prod)
apps/web/jsx-dev-runtime.shim.ts ← maps jsxDEV→jsx for Astryx's dev-JSX build (prod only)
apps/web/test/              ← Vitest specs (shared env schema)
apps/web/e2e/               ← Playwright UI specs (home.spec.ts)
apps/web/vitest.config.ts   ← Vitest config (shared alias)
apps/web/playwright.config.ts ← autonomous E2E (webServer boots next dev)
apps/web/eslint.config — none (uses shared root eslint.config.js)
packages/shared/src/        ← env parser (zod, ESM) + shared types
templates/PRD.md            ← feed-forward: product requirements (reservation example)
templates/DATA_MODEL.md     ← feed-forward: entities + invariants
templates/AGENT_SPEC.md     ← feed-forward: Mastra agent/tools/guardrails
templates/DESIGN_SYSTEM.md  ← feed-forward: Astryx design language
apps/agents/Dockerfile         ← multi-stage build of the Mastra .mastra/output bundle (node:24-alpine)
apps/web/Dockerfile         ← multi-stage build of the Next standalone server (node:24-alpine)
docker/                     ← Docker Compose infra + app services (docker-compose.yml + .override.yml.example template; real .override.yml is gitignored)
scripts/bootstrap.mjs       ← new-project bootstrap (rename + set-ports + deps + blank git + doc guidance)
scripts/set-ports.mjs       ← retarget Mastra/Next dev ports across env/configs/scripts/compose/docs
scripts/rename-project.mjs  ← one-shot placeholder rename (walks all source)
scripts/update-deps.mjs     ← update deps to latest compatible + verify
scripts/progress-stamp.mjs  ← PROGRESS.md auto-journal
```

## 5. Lifecycle — when this file gets updated

- **On every meaningful task closure** — §1 (Current state), §2 (Next task), and §4 (File map for takeover, if files moved) are overwritten by the closing agent in the same change set as the code/doc changes.
- **§3 (Resume prompt) is stable** — only updated when the takeover contract itself changes (very rare).
- **§5 (Lifecycle) is meta** — only updated when this enforcement contract itself changes.

If you are picking up mid-session because the previous agent is unavailable, your first action is to read this file's §1 and §3, then paste §3's resume prompt into your next prompt to whichever agent continues the work. The seam is intentionally one file deep.
