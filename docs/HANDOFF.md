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

**Fresh baseline.** This is a clean Precast checkout — a runnable, agent-native monorepo with neutral placeholders (`example-agent` / `summary-agent` / `example-tool`, a generic landing page + agent-chat demo). No domain logic yet. `pnpm build` / `typecheck` / `lint` / `test` are green out of the box.

- The Mastra app (`apps/agents`) and Next app (`apps/web`) are intentionally **neutral placeholders**. Real agents/pages/schema come from the feed-forward docs in `templates/` + TECH_STACK.
- Infra (Postgres/Redis/Keycloak) is **remote/managed** via the root `.env` — not run in Compose.
- **Postgres-only** ([ADR-002](ADRS.md), supersedes ADR-001): `DATABASE_URL` rejects SQLite/libsql at boot. A provisioned managed Postgres is a bootstrap precondition — the stack will not start without one.
- **Agent memory is wired and durable.** `example-agent` carries a `Memory` backed by Postgres (`@mastra/pg`); `summary-agent` deliberately has none (transformation, not conversation). The web app derives `resourceId` (httpOnly cookie) and a resource-namespaced `threadId` **server-side** in `apps/web/app/lib/agent-context.ts` and never accepts either from the request body — Mastra otherwise defaults `resourceId` to the agent id, which would put every user in one shared memory bucket.
- **Orchestrator crew — `docs/plans/orchestrator-crew-plan.md` (Phases 1–4 done).** `apps/agents/src/mastra/crew.ts` is the single source of truth for the roster; `defineCrew()` (`lib/crew.ts`) builds an **in-process** orchestrator front door — `crew-orchestrator`, a Mastra Agent Network (agents-as-tools) over the members that routes LLM-decided and **activates only at 2+ members**, collapsing to the sole member at N=1 (no routing hop, no extra card). Each member stays a plain agent → keeps its own `/api/.well-known/:id/agent-card.json` and is independently invocable; the orchestrator is purely additive. `index.ts` registers exactly `crewAgents(crew)`. Guards: reserved orchestrator id, duplicate ids, flat single layer. **P2:** `scripts/emit-import-manifest.mjs` emits an `orchestration` block into `agentbase.import.json` (orchestrator id from `ORCHESTRATOR_ID`; members omitted → discovered; `defaultImport: orchestrator-only`), guarded by `orchestration-manifest.spec.ts`. **P4 R2/R3:** `apps/agents/src/mastra/telemetry/otel.ts` (imported FIRST in `index.ts`) starts an OTel SDK — W3C propagation always, OTLP export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (AgentBase injects it into hosted containers) — so the crew's in-process hops continue AgentBase's inbound trace and forward it on egress. (P3 + P4 R1/R4/R5 are AgentBase-side.)

_Known carry-forwards:_

- Memory has **not been exercised against a live Postgres** — the baseline is verified by typecheck, unit tests, `mastra build`, and runtime env-validation checks only. First run against a real `DATABASE_URL` should confirm Mastra creates its tables in the `mastra` schema and that a second turn recalls the first.
- The crew's **live A2A cards have not been fetched against a running server.** This checkout's `.env` carries only placeholder DB creds (`your-postgres-host`) plus a pre-existing invalid `file:` `MASTRA_DB_URL` (the repo is Postgres-only, ADR-002), so `mastra start`/`dev` cannot boot here. Phase 1 is verified by typecheck, lint, the 51 agents-package unit tests (8 new in `lib/crew.spec.ts`), and a successful `mastra build` (which constructs the full instance graph including all three agents). First boot against a real Postgres should confirm `/api/.well-known/{example-agent,summary-agent,crew-orchestrator}/agent-card.json` all serve, and that a 2-member prompt routes through `crew-orchestrator`.
- **Context threading (OBO subject + session) through the orchestrator → member → egress, and W3C `traceparent` propagation, are NOT in Phase 1** — they are Phase 4 (telemetry R1–R5) in the plan. In-process routing works today; the governed-context/telemetry seam is the next correctness-sensitive piece.
- The `resourceId` cookie is **anonymous, not authentication**. Keycloak ships for dev but no OIDC is wired into `apps/web`; swap `resolveResourceId()` for the verified token's `sub` when it is.

---

## 2. Next task (overwrite on each handoff)

**Orchestrator-crew Phases 1–4 are DONE** (`docs/plans/orchestrator-crew-plan.md`); the ecosystem is mirrored (precast, precast-plugin `skills/scaffold/SKILL.md`, precast-ground-zero HANDOFF/PROGRESS/ADR-017). Two carry-forwards need a **running stack** to close, and neither is committed yet:

1. **Live-verify the telemetry stitch (P4 R2/R3).** With a real Postgres + a wired OTLP backend, boot a 2-member crew container and confirm the orchestrator→member in-process spans carry AgentBase's inbound `traceparent` and land in the backend correlated with `audit_calls` by trace id. The bundled container likely needs `node --import ./instrumentation.mjs` (ESM instrumentation ordering) — `apps/agents/src/mastra/telemetry/otel.ts` currently self-starts on first import, which covers `mastra dev`; harden the Dockerfile CMD if the live check shows inbound extraction is missed.
2. **Live-verify the AgentBase Studio import drawer** (full-crew vs orchestrator-only) against an authenticated stack + a repo whose manifest carries `orchestration`.

Deferred (Phase 5, not built): `CREW_ROUTE_VIA_AGENTBASE` per-hop governed routing; Studio "Expose/Hide subagent".

Precast otherwise remains a runnable baseline. To start a real project:

1. `pnpm install && pnpm bootstrap` (or `pnpm bootstrap my-project`).
2. **Write the feed-forward docs first:** copy the relevant `templates/*.md` into `docs/`, replace the example content with your product.
3. Fill in `docs/PROGRESS.md` §1 (name + mission) and the README title; set **one** LLM provider key in `.env` — Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Groq, Cerebras, Perplexity, OpenRouter, or Vercel AI Gateway (the agents auto-detect which; see `apps/agents/src/mastra/lib/default-model.ts`), point `REDIS_URL` / `KEYCLOAK_TOKEN_ISSUER_URI` at your remote/managed services, and set `DATABASE_URL` to a **managed Postgres** URL — Postgres-only since [ADR-002](ADRS.md), and the stack will not boot without it (see [.env.example](../.env.example)).
4. Build your agents/tools under `apps/agents/src/mastra/` and pages under `apps/web/app/`; extend the env schema in `packages/shared/src/env.ts`.

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
.prettierrc                 ← formatting rules
.editorconfig               ← editor settings
.nvmrc                      ← Node version pin
.env.example                ← env var template (remote/managed infra URLs)
.githooks/pre-commit        ← doc-contract enforcement + lint-staged (native core.hooksPath)
.claude/settings.json       ← Claude Code hooks (PostToolUse, Stop, SessionStart)
docs/HANDOFF.md             ← this file (single-page continuity checkpoint)
docs/PROGRESS.md            ← live session log + task tracker (always update)
docs/SPEC.md                ← canonical boilerplate specification
docs/TECH_STACK.md          ← versions, libs, images, ports (authoritative)
docs/ADRS.md                ← architectural decision records (empty template)
docs/STYLE_GUIDE.md         ← code style + naming conventions
docs/SCRIPTS.md             ← every pnpm script with descriptions
docs/TEST_CASES.md          ← test catalog with traceability
docs/INTEGRATION_AGENTBASE.md ← AgentBase integration guide (reference)
docs/AGENT_SPINUP_PROMPTS.md ← prompts for building agents on Precast (template)
docs/plans/                 ← LIVE plans directory (create as needed)
docs/archive/               ← FROZEN, do-not-parse
apps/agents/src/mastra/index.ts   ← Mastra instance (registers crewAgents(crew), storage, logger, server:45000)
apps/agents/src/mastra/crew.ts    ← THE CREW — single source of truth for the roster + orchestrator (declare agents here)
apps/agents/src/mastra/agents/    ← example-agent.ts + summary-agent.ts (neutral placeholder members) + orchestrator.ts (createOrchestrator — in-process Agent Network front door)
apps/agents/src/mastra/lib/crew.ts ← defineCrew()/crewAgents() — N=1 pass-through, activate at 2+, guards; drives registration (and Phase-2 manifest)
apps/agents/src/mastra/lib/agentbase-model.ts ← resolveAgentModel() — org-admin-configured LLM per imported agent, else the agent's own fallback string
apps/agents/src/mastra/lib/storage.ts ← getPrecastStore() — the single shared PostgresStore (one connection pool)
apps/agents/src/mastra/lib/memory.ts  ← createAgentMemory() — Memory config + why semanticRecall is off
apps/agents/src/mastra/tools/     ← example-tool.ts (+ .spec.ts) — neutral placeholder
apps/agents/Dockerfile            ← multi-stage build of the Mastra .mastra/output bundle
apps/web/app/                ← layout.tsx, providers.tsx, page.tsx, AgentChat.tsx, globals.css
apps/web/app/lib/a2a-client.ts ← server-only callAgent() (A2A; sends contextId + metadata.resourceId)
apps/web/app/lib/agent-context.ts ← resolveAgentContext() — server-derived resourceId/threadId (multi-tenancy boundary)
apps/web/app/lib/agentbase-auth.ts ← mints/caches the AgentBase Application's OAuth2 client_credentials JWT
apps/web/app/api/            ← route handlers: health/route.ts, a2a/[agentId]/route.ts
apps/web/test/               ← Vitest specs (env schema + fitness guards: a2a-only, docker-build, agent-context)
apps/web/e2e/                ← Playwright UI specs (home.spec.ts)
apps/web/Dockerfile          ← multi-stage build of the Next standalone server
packages/shared/src/         ← env parser (zod, ESM) + Postgres-only DATABASE_URL validation + shared types
templates/                   ← feed-forward planning docs (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM)
docker/                      ← Docker Compose (agents + web + Keycloak; Postgres/Redis remote via .env; COMPOSE_PROFILES selects services). `agents` is stateless — no volume
scripts/bootstrap.mjs        ← new-project bootstrap (rename + set-ports + deps + reset docs + blank git)
scripts/set-ports.mjs        ← retarget Mastra/Next dev ports across env/configs/scripts/compose/docs
scripts/rename-project.mjs   ← one-shot placeholder rename (walks all source)
scripts/update-deps.mjs      ← update deps to latest compatible + verify
scripts/progress-stamp.mjs   ← PROGRESS.md auto-journal
scripts/emit-import-manifest.mjs ← derive agentbase.import.json requiredEnv from the env schema
scripts/docker-compose.mjs   ← wrapper: passes --env-file .env to every `pnpm docker:*` (fails fast if .env is missing)
```

## 5. Lifecycle — when this file gets updated

- **On every meaningful task closure** — §1 (Current state), §2 (Next task), and §4 (File map for takeover, if files moved) are overwritten by the closing agent in the same change set as the code/doc changes.
- **§3 (Resume prompt) is stable** — only updated when the takeover contract itself changes (very rare).
- **§5 (Lifecycle) is meta** — only updated when this enforcement contract itself changes.

If you are picking up mid-session because the previous agent is unavailable, your first action is to read this file's §1 and §3, then paste §3's resume prompt into your next prompt to whichever agent continues the work. The seam is intentionally one file deep.
