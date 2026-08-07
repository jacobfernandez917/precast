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
| Database              | **Postgres** (remote/managed) — one `DATABASE_URL`, always Postgres (ADR-002)  |
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
8. **[docs/MIGRATIONS.md](docs/MIGRATIONS.md)** — how to pull later Precast improvements into this project, and what each release changed (see §4.10).
9. **[docs/DESIGN_SYSTEM_APC.md](docs/DESIGN_SYSTEM_APC.md)** — the APC Design System: five themes, how its tokens layer onto Astryx, switching, and re-importing from Claude Design.

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

### 4.0 Proof of Concept FIRST — **MANDATORY**

> **Never disappear for an hour and come back with a finished build.** Get the smallest thing that _runs and can be looked at_ in front of the user early, collect their reaction, and only then build the rest. An hour of polished work aimed at the wrong target is an hour lost; ten minutes of rough work aimed at the wrong target costs ten minutes.

**The loop for any new build (a project, a feature, a surface):**

1. **Slice.** Pick the thinnest **vertical** slice that a human can see and react to — one screen, or one agent answering one real prompt end to end. Vertical, not horizontal: a working thin path beats three complete layers that don't connect.
2. **Run it.** `pnpm poc` builds and starts the Docker Compose stack, waits for each service's health endpoint, and prints the URLs. The PoC is not done when the code compiles; it is done when there is a **URL that answers**.
3. **Show it and stop.** Give the user the URL(s), what to click, what is real, and what is still stubbed or mocked. Then **stop and ask for feedback.** Do not continue into hardening on your own initiative.
4. **Fold in the feedback**, then harden: full tests (§4.2), the complete doc contract (§4.6), and the remaining scope. Each substantial change along the way refreshes the preview and re-shows the URL (see the rules below) — the user should never have to ask "is it up, and where?".

**Rules:**

- **Keep the preview current, and always re-show the URL.** After **every** substantial change that can be previewed, refresh the running stack and hand the user the URL again — in the same reply as the change. A change the user cannot see has not been delivered.
  - Whole stack: `pnpm poc`. Just what changed: `pnpm poc web` / `pnpm poc agents` (rebuilds that image and recreates only that container — much faster).
  - **Never a bare `docker restart`.** Code is baked into the image, so restarting re-serves the _old_ build. `pnpm poc <service>` rebuilds, which is why it exists.
  - Always print the actual `http://localhost:<port>` — never "the usual port" or "localhost:3000" from memory. Ports are auto-assigned per project (§4.5); `pnpm poc` ends by printing the real ones.
  - Say what to click and what changed since last time, not just that it's up.
- **If the request involves a UI and gave no design direction, ask before building.** Do not silently invent a look and reveal it later — that's the same wasted-hour failure this section exists to prevent. In your first reply, ask for **pegs, references, or inspirations**: existing products or screens they like, a brand/style guide, screenshots, a Figma file, or even "make it look like X". If they genuinely have none, say plainly that **you will propose a direction and that it is explicitly subject to their critique**, then build the smallest version of it and put it in front of them at the PoC gate. Record the chosen direction in `docs/DESIGN_SYSTEM.md`. Build from the Astryx design system either way (§4.1).
- **Time-box the PoC.** If the first runnable slice is more than roughly 20–30 minutes away, the slice is too big — cut it and show something smaller sooner.
- **Stub and mock in the open.** Reach for stubs, mock data, and mock external dependencies to get to "running" faster, but **say plainly what is fake** when presenting. Never present a mocked path as working.
- **Real, human-facing copy from the start** — no spec IDs, env-var names, agent/tool internal names, `TODO`, or lorem ipsum in the UI (see the scaffold skill's UI rules).
- **The PoC is a checkpoint, not a deliverable.** Don't optimize, refactor, or complete scope inside it; note what you deliberately deferred and pick it up after the feedback.
- **Record the gate** in `docs/PROGRESS.md`: what the PoC covered, what was deferred, and what the user said.

### 4.1 Code

- **Monorepo structure:** `apps/*` for deployable applications, `packages/*` for shared libraries.
- **`apps/agents` hosts Mastra agents ONLY** (and the tools they call). Do **not** add MCP servers or hand-rolled REST/HTTP endpoints there — agents reach external MCPs/APIs as _tools_ (`@mastra/mcp`), and Mastra already exposes each agent over A2A. Frontend/BFF endpoints belong in `apps/web`. (The app is named `agents`, not `api`, to make this scope obvious; Mastra's own HTTP surface is still served under `/api/*`.)
- **Web → agents is A2A-only.** `apps/web` interacts with Mastra agents **exclusively over the A2A protocol** (JSON-RPC 2.0), always through `callAgent()` (`apps/web/app/lib/a2a-client.ts`) — either **direct** (`POST /api/a2a/:id`, `message/send`) or via the **AgentBase proxy** (`ENABLE_AGENTBASE`). This holds **with or without AgentBase**. Never call Mastra's native REST (`/api/agents/:id/generate` | `/stream`), agent listing, or Studio from web code. Enforced by `apps/web/test/a2a-only.spec.ts`.
- **Validation:** `zod` at all external boundaries (HTTP body, env vars, API payloads).
- **Logging:** `pino` or equivalent structured logger. **Never** `console.log` in committed code.
- **No orphaned final words.** Text wrapping is set globally in `app/globals.css`: `text-wrap: balance` on headings and other short blocks, `text-wrap: pretty` on body copy. Don't re-declare either per component — and don't reach for `balance` on a long paragraph, where browsers cap it (~6 lines) and silently ignore it; `pretty` is the long-form tool. Both are set at specificity 0 via `:where()`, so a component that genuinely needs to opt out can say `text-wrap: wrap` (note: `normal` is **not** a valid value for this property — it is silently dropped, leaving the inherited value in place).
- **Design system first** in web apps — build UI from **Astryx** components (`@astryxdesign/core`), coloured by the **APC Design System** tokens layered on top (see below). Use **Tailwind** utility classes for layout/spacing (via the Astryx Tailwind bridge). No hand-written CSS beyond `app/globals.css`; reach for StyleX's `xstyle` prop only for one-offs with no Tailwind/token equivalent.
- **APC Design System themes.** The web app ships the five APC themes — **Stockholm** (default), **Prague**, **Arctic**, **Nova**, **Melbourne** — previewable at **https://apc-design-system.917v.dev**. `pnpm bootstrap` asks which one; `pnpm set-theme <name>` changes it later. They are token overrides layered on Astryx (`@layer apc-theme` after `astryx-theme`), generated by `pnpm theme:build` from `apps/web/app/theme/apc.tokens.json`. **Never write a literal colour** — reference semantic roles, or a component looks right in one theme and wrong in four. Light and dark ship together via CSS `light-dark()`, so check both. See [docs/DESIGN_SYSTEM_APC.md](docs/DESIGN_SYSTEM_APC.md) for the token architecture, the known Astryx↔APC mapping gaps, and how to re-import from Claude Design.
- **TypeScript strict mode** is required across all packages.

### 4.2 Testing — **MANDATORY**

> **Every new build ships with its tests.** A feature, fix, or infra change is **not complete** until the test layers below are updated **in the same change set** as the code. "It builds" is not "it's tested."
>
> **One exception, by phase:** a **proof of concept** (§4.0) ships on the reduced bar in §4.2.1. Full coverage is owed at the hardening pass, before the work is called done.

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

### 4.2.1 Reduced test bar for a proof of concept

> Writing a full test pyramid around a slice the user hasn't seen yet is the single biggest source of wasted time in a Precast build — the tests get discarded along with the design they were pinning down. **During the PoC phase (§4.0) only, the bar drops to the following.** It is a deferral, never a waiver.

**The PoC bar — all of it required:**

1. **`pnpm verify:poc`** (typecheck across the workspace) is green.
2. **`pnpm poc`** brings the stack up and every service reports healthy — that health-green run **is** the PoC's smoke test.
3. **One `SMOKE-*` row** in [docs/TEST_CASES.md](docs/TEST_CASES.md) recording that the stack came up and the slice answered.
4. **Deferred coverage is written down, not silently skipped** — add each intended test as a `Not Started` row in TEST_CASES.md, plus a PROGRESS.md blocker naming the hardening pass that owes it.

**What to skip during the PoC:** exhaustive unit tests for logic still in flux, Playwright specs for flows still being designed, and edge/error-path tests for behaviour the user may reject outright.

**What to test even in a PoC** (cheap now, expensive later):

- **Fitness guards** protecting an architectural invariant you touched — `apps/web/test/a2a-only.spec.ts`, env validation, `docker-build.spec.ts`, `ports.spec.ts`. These are why a PoC doesn't quietly rot the boilerplate's rules.
- **Anything involving auth, tokens, or a security boundary.** Never defer these.
- **A pure function whose correctness the slice depends on** — a one-line Vitest case costs less than debugging it through the UI.

**Leaving the PoC phase.** Once the user has given feedback and the design is settled, the full §4.2 bar applies again: author the deferred tests, flip the `Not Started` rows to real statuses, run `pnpm test` (and `pnpm test:e2e` if UI/routes changed), and clear the PROGRESS.md blocker. **A build cannot be reported as done while it is still on the PoC bar** — say explicitly that it is a PoC and what coverage it still owes.

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
- Use Docker DNS names for inter-**app** URLs, not `localhost` (e.g. `http://agents:45000`).
- **Redis is remote/managed, not in Compose** — the apps reach it via the root `.env` (`REDIS_URL`). Do not add a local Redis service to Compose.
- **`DATABASE_URL` is always Postgres, and Postgres is never run in Compose.** Only `postgres://` / `postgresql://` are accepted — SQLite, libsql, and `file:` URLs are rejected by the env schema at boot (`isPostgresUrl()` in `packages/shared/src/database.ts`). A provisioned managed Postgres (Neon, Supabase, RDS, Railway, …) is a bootstrap precondition, not a later upgrade. "Always Postgres" is about the engine, not where it runs — do **not** add a Postgres service to Compose. See [ADR-002](docs/ADRS.md), which supersedes ADR-001.
- **Agent memory lives in that same Postgres.** `MASTRA_DB_URL` is optional and falls back to `DATABASE_URL`, so one instance is enough; Mastra's tables are namespaced by `MASTRA_DB_SCHEMA` (default `mastra`). Never hardcode a DB URL under a Compose service's `environment:` — those keys **override** `env_file` and will silently shadow the real connection string.
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

### 4.10 Staying aligned with Precast

This project was scaffolded from the **Precast** boilerplate, which keeps improving after you fork it. `precast.lock.json` records which release you came from; `pnpm precast:update` pulls later improvements in.

- **Easiest path: the `upgrade` skill.** If the Precast plugin is installed, say "upgrade precast" (or `/precast:upgrade`) — it runs the check, summarizes the releases in between, applies the safe set, and works the per-release manual steps against this codebase. The rules below are what it follows.
- **Check before you apply.** `pnpm precast:update` is check-only and writes nothing. It classifies every managed file as `Update` (untouched here — safe), `Yours` (customized here — left alone), or `CONFLICT` (both sides moved). `--apply` takes the safe set; `--force` also takes conflicts, keeping a `.precast-bak`.
- **The sync only covers the framework surface** — `scripts/`, `.githooks/`, `docker/`, `templates/`, the root configs, and this file. Changes under `apps/` and `packages/` are yours; port those by hand from the release entry in [docs/MIGRATIONS.md](docs/MIGRATIONS.md).
- **Advisory files are never written automatically** (`package.json`, `.env.example`, the fitness-guard specs, `packages/shared/src/{env,database}.ts`). The plan reports them; you port them.
- **After any upgrade:** run `pnpm verify:poc`, then `pnpm test`, and record the version you moved to in PROGRESS.md.
- **Never hand-edit `precast.lock.json`** — the script maintains it, and a wrong baseline turns the next upgrade into false conflicts (or worse, silence).

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
