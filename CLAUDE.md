# CLAUDE.md — Project Brief

> **Read this first.** This file is loaded automatically by Claude Code at session start. It explains what this project is, where the authoritative specs live, and the **non-negotiable rules** every change must follow.

---

## 1. Project Snapshot

This is a **monorepo boilerplate** — a curated, opinionated starting point for new TypeScript projects. It provides:

- A **monorepo structure** (pnpm + Turborepo)
- **Documentation contracts** (CLAUDE.md → HANDOFF.md → PROGRESS.md → authoritative docs)
- **Progress tracking automation** (hooks, stamp script)
- **Guardrails** (git hooks, lint-staged, editorconfig, env validation)
- **Boilerplate templates** for APIs, web apps, shared packages, Docker Compose infra
- **Architectural Decision Records** (ADR) for documenting design rationale

**Stack at a glance:**

| Layer                 | Tech                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| Package Manager       | **pnpm** (workspaces)                                                         |
| Monorepo Orchestrator | **Turborepo**                                                                 |
| Agents (template)     | **Mastra** on Node.js — agents + their tools (Studio)                         |
| Web (template)        | **Next.js** (App Router) with route handlers                                  |
| Design system         | **Astryx** (`@astryxdesign/core`, web UI)                                     |
| Shared                | **TypeScript** packages with zod validation                                   |
| Database              | **Postgres** (remote/managed) or **SQLite** (local file) — one `DATABASE_URL` |
| Identity              | **Keycloak** / OIDC — **Docker Compose (dev)** or remote                      |
| Cache                 | **Redis** — **remote/managed**                                                |
| Containers            | **Docker Compose** (apps + Keycloak; Postgres/Redis never run here)           |
| Testing               | **Vitest** + **Playwright**                                                   |
| Linting               | **ESLint** + **Prettier**                                                     |

---

## 2. Authoritative Docs (read in this order)

0. **[docs/HANDOFF.md](docs/HANDOFF.md)** — **single-page continuity checkpoint. Read FIRST on every takeover; update on every meaningful task closure** (see §3.5).
1. **[docs/SPEC.md](docs/SPEC.md)** — canonical specification: structure, conventions, templates, and how to use it.
2. **[docs/TECH_STACK.md](docs/TECH_STACK.md)** — **authoritative pinned versions + tech inventory + update procedure. Must be updated on every tech-stack-touching change** (see §4.8).
3. **[docs/PROGRESS.md](docs/PROGRESS.md)** — **long-form context memory; update every session.**
4. **[docs/ADRS.md](docs/ADRS.md)** — architectural decision records (or `docs/adr/` directory).
5. **[docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)** — code style, naming conventions, and project-wide rules.
6. **[docs/TEST_CASES.md](docs/TEST_CASES.md)** — test catalog with traceability (if applicable).
7. **[docs/SCRIPTS.md](docs/SCRIPTS.md)** — operator cheatsheet: every `pnpm` script.

If any of these documents disagree:

- **Tech-stack facts** (versions, libraries, container images, ports) → [docs/TECH_STACK.md](docs/TECH_STACK.md) wins.
- **Boilerplate structure** (file layout, naming, conventions) → [docs/SPEC.md](docs/SPEC.md) wins.
- **Working rules** (this file) wins for process enforcement.

### Frozen archives — **DO NOT READ OR PARSE**

> ⛔ **`docs/archive/`** is write-once cold storage.
> It holds shipped/superseded plan docs kept for human reference only. Do **not** read, parse, or load them during normal work — they do not reflect current state and only waste context. Current status lives in `HANDOFF.md` → `PROGRESS.md`; live plans remain under `docs/plans/`.

---

## 3. PROGRESS.md Enforcement — **MANDATORY**

> **You MUST update [docs/PROGRESS.md](docs/PROGRESS.md) on every meaningful change.**
> If you finish work without updating PROGRESS.md, the work is **not complete**. This is the single mechanism that keeps context flowing between sessions and agents.

### When to update PROGRESS.md

Update PROGRESS.md whenever you:

- Start or finish a task/subtask in its Task Tracker.
- Create, modify, or delete code, infrastructure, or docs.
- Make or revise a design decision (record under "Open Decisions").
- Add, modify, remove, or fix tests.
- Change `.env` schema or any infrastructure config.
- Discover a blocker, risk, or open question.
- End a working session — leave a "Cross-Tool Handoff Note".

### What to update each time

1. Bump **Last Updated** and **Updated By** at the top.
2. Append a one-line entry to the **Session Log** (newest first).
3. Toggle relevant checkboxes in the **Task Tracker**.
4. Update **Open Decisions**, **Known Blockers**, **Test Coverage**, **Environment State** as relevant.
5. Add a **Cross-Session Handoff Note** if the session is ending or if you anticipate another agent picking up next.

### What NOT to put in PROGRESS.md

- Secrets, raw tokens, PII.
- Architectural rationale (→ [docs/SPEC.md](docs/SPEC.md)).
- Boilerplate templates (→ `templates/`).
- Test specifications (→ [docs/TEST_CASES.md](docs/TEST_CASES.md)).

### Session-start ritual

At the start of every session you MUST:

1. Read [docs/HANDOFF.md](docs/HANDOFF.md) **first** — before making changes.
2. Read [docs/PROGRESS.md](docs/PROGRESS.md) — confirm the current state.
3. Read the most recent **Cross-Tool Handoff Note** and **Session Log** entries.
4. Confirm the **Current Phase** and pick the next unchecked task.

### Session-end ritual

Before signing off:

1. Append a Session Log entry.
2. Update the Cross-Tool Handoff Note row describing exactly where you stopped and what's next.
3. Save.

### 3.5 HANDOFF.md Enforcement — **MANDATORY**

> **You MUST update [docs/HANDOFF.md](docs/HANDOFF.md) on every meaningful task closure.**
> HANDOFF.md is the single-page continuity checkpoint — it is the **only** doc the next agent is required to read before touching the codebase. If you finish a task without updating HANDOFF.md, the work is **not** complete.

#### When to update HANDOFF.md

Update HANDOFF.md whenever you:

- Close a task / subtask / phase.
- Land a substantial refactor or rename that changes how the next agent should navigate the codebase.
- Discover a blocker that changes what "next" looks like.

#### What to update each time

1. Overwrite **§1 Current state** with what you just finished, the test results, and any new "Known carry-forwards" entries.
2. Overwrite **§2 Next task** with what the next agent should pick up. If nothing is queued, leave a list of open items.
3. Overwrite **§4 File map for takeover** if files moved or were added / deleted.
4. Do NOT edit §3 (Resume prompt) unless the takeover contract itself changes — and if it does, keep edits backwards-compatible.
5. Make these edits in the **same change set** as the code/doc changes that triggered the handoff.

#### Disagreement with PROGRESS.md

HANDOFF.md is a snapshot; PROGRESS.md is the long-form ledger. On disagreement about _what just happened_, PROGRESS.md §10 wins (it is append-only and machine-journaled). HANDOFF.md is the curated _where to pick up next_ view. Keep them aligned at every task closure.

---

## 4. Working Rules (project-specific)

### 4.1 Code

- **Monorepo structure:** `apps/*` for deployable applications, `packages/*` for shared libraries.
- **`apps/agents` hosts Mastra agents ONLY** (and the tools they call). Do **not** add MCP servers or hand-rolled REST/HTTP endpoints there — agents reach external MCPs/APIs as _tools_ (`@mastra/mcp`), and Mastra already exposes each agent over A2A. Frontend/BFF endpoints belong in `apps/web`. (The app is named `agents`, not `api`, to make this scope obvious; Mastra's own HTTP surface is still served under `/api/*`.)
- **Web → agents is A2A-only.** `apps/web` interacts with Mastra agents **exclusively over the A2A protocol** (JSON-RPC 2.0), always through `callAgent()` (`apps/web/app/lib/a2a-client.ts`) — either **direct** (`POST /api/a2a/:id`, `message/send`) or via the **AgentBase proxy** (`ENABLE_AGENTBASE`). This holds **with or without AgentBase**. Never call Mastra's native REST (`/api/agents/:id/generate` | `/stream`), agent listing, or Studio from web code. Enforced by `apps/web/test/a2a-only.spec.ts`.
- **Validation:** `zod` at all external boundaries (HTTP body, env vars, API payloads).
- **Logging:** `pino` or equivalent structured logger. **Never** `console.log` in committed code.
- **Design system first** in web apps — build UI from **Astryx** components (`@astryxdesign/core`) and theme tokens. Use **Tailwind** utility classes for layout/spacing (via the Astryx Tailwind bridge). No hand-written CSS beyond `app/globals.css`; reach for StyleX's `xstyle` prop only for one-offs with no Tailwind/token equivalent.
- **TypeScript strict mode** is required across all packages.

### 4.2 Testing — **MANDATORY**

> **Every new build ships with its tests.** A feature, fix, or infra change is **not complete** until the test layers below are updated **in the same change set** as the code. "It builds" is not "it's tested."

#### Test layers (what to touch, and where)

| Layer                       | Tool       | Location                                 | Command         |
| --------------------------- | ---------- | ---------------------------------------- | --------------- |
| Unit / integration          | Vitest     | `apps/agents/src/**`, `apps/web/test/**` | `pnpm test`     |
| Autonomous browser UI (E2E) | Playwright | `apps/web/e2e/**`                        | `pnpm test:e2e` |
| Test catalog (traceability) | —          | [docs/TEST_CASES.md](docs/TEST_CASES.md) | (manual)        |

#### For every new build you MUST

1. **Author the tests.** Add/extend Vitest specs for new logic and boundaries; add a Playwright spec in `apps/web/e2e/` for any new user-visible flow or route. Extend the fitness guards (`a2a-only.spec.ts`, env validation) when you touch what they protect.
2. **Register them in the catalog.** Add a row to the correct section of [docs/TEST_CASES.md](docs/TEST_CASES.md) with a new stable ID (`AGT-*`, `WEB-*`, `E2E-*`, `APP-*`, `TOOL-*`, `SMOKE-*`), a description, and a `Status`.
3. **Run them and record the result.** Run `pnpm test` (and `pnpm test:e2e` if the UI/routes changed); set each affected row's `Status` to the real outcome (`Passing` / `Failing` / `Not Started`). Never mark `Passing` without having run it.
4. **Update coverage.** Reflect the run in [docs/PROGRESS.md Test Coverage](docs/PROGRESS.md), and list the covered test IDs in the PR description.

#### Rules

- Every implementation must satisfy the relevant test IDs in [docs/TEST_CASES.md](docs/TEST_CASES.md).
- New product surface without a corresponding test (or an explicit, justified `Not Started` row) is an **incomplete build** — flag the gap in PROGRESS.md blockers rather than shipping it silently.
- Keep test IDs stable; never renumber. Retire an ID by marking it removed, don't reuse it.

### 4.3 Git & Commits

- Commits should be small, scoped, and message-formatted as `<area>: <imperative summary>` (e.g., `api: add rate limiting middleware`).
- Every commit that touches code/config/docs must include the matching PROGRESS.md update **in the same commit**.
- Do **not** commit `.env` (only `.env.example`).
- `.githooks/pre-commit` enforces the documentation contract (see §4.6).

### 4.4 Env & Config

- Validate env at boot. Missing required vars → fail fast.
- All secrets in environment variables, never in code.
- `.env.example` is the source of truth for env var schema.
- **Single root `.env`.** The repo uses ONE `.env` at the root — **never** create per-app `.env` files in `apps/agents` or `apps/web`. Local dev/start scripts load the root `.env` via `dotenv-cli` (`dotenv -e ../../.env -- …`); Docker Compose loads it via `env_file: ../.env`; production supplies vars from the real environment. `.gitignore` ignores `.env` at any depth so a stray per-app file can't be committed.

### 4.5 Ports & Compose

- Document assigned ports in [docs/TECH_STACK.md](docs/TECH_STACK.md).
- Use Docker DNS names for inter-**app** URLs, not `localhost` (e.g. `http://agents:4111`).
- **Redis is remote/managed, not in Compose** — the apps reach it via the root `.env` (`REDIS_URL`). Do not add a local Redis service to Compose.
- **Postgres is never run in Compose either way, but `DATABASE_URL` now accepts either engine** — a managed Postgres URL (`postgres://`/`postgresql://`), or a local SQLite file (`file:./app.db` / `sqlite:...`) as a lightweight alternative to provisioning one. `getDatabaseKind()` (`packages/shared/src/database.ts`) identifies which from the URL's own scheme — no separate "which engine" var, and no privileged default. Do not add a local Postgres service to Compose regardless of which engine a project chooses. See [ADR-001](docs/ADRS.md).
- **Keycloak runs in Compose for local dev** (`start-dev`), published on `KEYCLOAK_HOST_PORT` (default 8080). In production, point `KEYCLOAK_TOKEN_ISSUER_URI` at a managed Keycloak instead of the container.
- **Published host ports** are configurable via `AGENTS_HOST_PORT` / `WEB_HOST_PORT` / `KEYCLOAK_HOST_PORT` in `.env` (container ports unchanged).
- **Service selection is configurable via `COMPOSE_PROFILES`** in `.env` (Compose's own mechanism) — a comma-separated subset of `agents,web,keycloak` (default: all three). Each service declares `profiles: ['<own name>']`; `web`'s `depends_on.agents` is `required: false` so excluding `agents` doesn't break Compose. Use this once services are deployed to different places (e.g. agents hosted by an AgentBase import; only `web`+`keycloak` need to run in this stack).
- **Always invoke Compose through `scripts/docker-compose.mjs`** (all `pnpm docker:*` scripts already do) — never call `docker compose -f docker/docker-compose.yml …` directly. Compose does not read the repo-root `.env` by default for that invocation shape; the wrapper passes `--env-file .env` and fails fast if `.env` is missing.

### 4.6 Documentation Contract — **MANDATORY**

After any non-trivial change to the repo, update these files **in the same commit**:

1. **`docs/HANDOFF.md`** — update §1 Current state + §2 Next task.
2. **`docs/PROGRESS.md`** — Session Log entry + Task Tracker updates.
3. **`docs/TEST_CASES.md`** — add/adjust test rows + run status for any change that adds or alters testable behaviour (see §4.2).
4. **`README.md`** — if user-facing behaviour, architecture, or quick-start steps changed.
5. **`.githooks/pre-commit`** blocks commits that touch non-trivial files without staging updates to all required docs (bypass with `SKIP_DOC_CHECK=1`, explain in commit message).

### 4.7 Tone & UX of your own work

- Prefer editing existing files over adding new ones.
- Default to no comments — only add a comment to explain a non-obvious _why_.
- Never add features outside the explicit task; flag follow-ups in PROGRESS.md's blockers/decisions rather than silently broadening scope.
- After completing any change, always tell the user exactly what to do next to see it reflected.

### 4.8 TECH_STACK.md Enforcement — **MANDATORY**

> **You MUST update [docs/TECH_STACK.md](docs/TECH_STACK.md) on every tech-stack-touching change**, in the same change set as the underlying edit. If you change versions, libraries, container images, ports, or any infrastructure component without updating TECH_STACK.md, the change is **incomplete**.

#### What counts as a tech-stack-touching change

Update TECH_STACK.md whenever you:

- Add, remove, upgrade, or downgrade a runtime, framework, library, or Docker image.
- Change a pinned version.
- Change a container base image, host port mapping, or internal DNS name.
- Add or remove a service in `docker-compose.yml`.
- Add a new protocol, schema, or wire format.
- Adopt or replace a testing tool, lint/format tool, build tool, or CI step.

#### Disagreement resolution

If TECH_STACK.md disagrees with any other doc about a **tech-stack fact** (a version, an image tag, a port, a library), TECH_STACK.md wins and the other doc has a bug — fix the other doc, not TECH_STACK.md.

---

## 5. Quick Pointers

- **Where to start a new piece of work:** [docs/PROGRESS.md Task Tracker](docs/PROGRESS.md).
- **What "done" looks like:** code changes + tests pass + PROGRESS.md updated + HANDOFF.md updated.
- **When unsure about structure:** check [docs/SPEC.md](docs/SPEC.md).
- **When unsure about a convention:** check [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md).

---

## 6. Multi-Agent Support

This repo is worked on by any coding agent (Claude Code, Cline, etc.).

All agents must update [docs/PROGRESS.md](docs/PROGRESS.md) on every change. PROGRESS.md is the shared memory that makes hand-offs seamless.
