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

This is the neutral Precast starting point. Project mode serves the app's agents; the separately gated scaffold-builder mode creates projects through Raya's Developer Computer.

Readable PRDs supply the product brief and field contracts. The builder asks missing questions one at a time, preserves human overrides and pauses, and blocks unsupported scope until it is clarified. Connected previews require the existing saved owner approvals and operator gates. A saved project credential may additionally allow one exact HTTPS Raya parent; only that derived build becomes embeddable, while the default CSP and legacy frame header continue to deny every parent.

Use this document for the derived project's own continuity. Maintainer session notes, operational identifiers and internal validation reports belong in the separate maintainer workspace and require explicit approval before publication.

## 2. Next task (overwrite on each handoff)

Define the project's mission, users, data and acceptance criteria in its feed-forward docs. Configure the approved model and Postgres connection, then run the relevant checks described in `TEST_CASES.md` and `SCRIPTS.md`. If an embedded Raya preview is required, use the operator-issued setup credential that names its exact HTTPS origin; never add a wildcard or copy an approval between projects.

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

Existing database reuse: `lib/database-setup-mode.ts` validates the operator restriction; `scripts/setup-services.mjs` has a separate no-Hannibal path, while `lib/service-verification.ts` binds the actual database, pooler project, role and three owned schemas. `scripts/start-project-preview.mjs` preserves strict TLS and the saved external approval. `docs/fixtures/scaffold-project-ideas.json` defines ten regression ideas.

PRD review lifecycle: `lib/prd-drafts.ts` retains exact source and unreadable filenames; `tools/read-prd.ts` handles explicit cancellation and distinguishes excluded features; `agents/scaffold-builder.ts` requires confirmed settlement before claiming cancellation.

PRD flow: `middleware/auth.ts` automatically captures the actual attachment before the model; `tools/prepare-scaffold.ts` analyses a still-unprocessed draft through `tools/read-prd.ts`; `lib/prd-drafts.ts` persists the exact source/hash and analysis under the scoped builder memory schema. `prepare-scaffold.ts` merges supplied PRD preferences with human replies and returns one next question. `scaffold-project.ts` uploads only a bounded PRD input into the fresh project; `scripts/apply-prd.mjs` validates its source/hash, refuses customized/symlinked outputs and writes the specs plus `project-brief.ts`. `packages/shared/src/prd.ts` owns the product/record contracts. `PrdWorkspace.tsx`, `api/project-records/route.ts` and `lib/prd-records.ts` implement signed-in CRUD; `e2e/prd-workspace.spec.ts` is the real public acceptance test. `middleware/auth.ts` binds builder memory to verified person/room, preserving project-mode behavior. `AgentChat.tsx` has a plain assistant presentation for PRD products; its default template demo remains available.

Conversational setup: `apps/agents/src/mastra/tools/prepare-scaffold.ts` returns the next
single question or ready execution request without side effects; its spec covers question
order, supplied answers, explicit defaults, invalid names and deferred connections.
`agents/scaffold-builder.ts` controls the dialogue; `tools/scaffold-project.ts` defaults
connected builds to srv.us while retaining the existing gates.

Automatic previews: `scripts/start-project-preview.mjs` checks the saved project approval,
trusted Postgres role and app readiness; `scripts/preview-tunnel.mjs` owns only the expiring
srv.us SSH connection to the app's loopback web port. `scaffold-project.ts` and
`agentbase-computer.ts` perform authorization and owner handoff through AgentBase.
`scripts/setup-services.mjs` validates the optional exact Raya preview parent and writes it into
the derived environment; the web package loads that sealed environment for its production build,
and `apps/web/next.config.ts` keeps strict frame denial unless the value is present, then emits only
the approved CSP ancestor and drops the incompatible legacy frame header.

Preview streaming: `apps/web/app/lib/chat-stream.ts` sends elapsed-time/result frames and parses
bounded incremental responses; `chat-stream.spec.ts` and `a2a-route.spec.ts` cover framing,
cleanup, errors, identity and pre-stream refusals.

Scaffold coverage: `apps/agents/src/mastra/crew.spec.ts` covers scenario factory selection; `scripts/initial-commit-env.mjs` and `apps/web/test/initial-commit-env.spec.ts` cover initial commits on a fresh Computer. `scripts/setup-services.mjs` and `apps/web/test/setup-services.spec.ts` cover the connected setup; `apps/agents/src/mastra/lib/service-verification.ts` verifies its sealed database receipt; `scaffold-project.spec.ts` covers orchestration and output sanitization. The live runtime uses the existing Precast repository, without a separate management repository.

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
apps/agents/src/mastra/crew.ts    ← mode gate: project crew by default; isolated builder only when explicitly selected
apps/agents/src/mastra/agents/    ← project members + orchestrator + scaffold-builder.ts (fixed Computer workflow)
apps/agents/src/mastra/tools/scaffold-project.ts ← validated clone/bootstrap/verify/build sequence; no arbitrary command input
apps/agents/src/mastra/lib/agentbase-computer.ts ← governed Computer run/action client with signed Raya proof forwarding
apps/agents/src/mastra/lib/crew.ts ← defineCrew()/crewAgents() — N=1 pass-through, activate at 2+, guards; drives registration (and Phase-2 manifest)
apps/agents/src/mastra/lib/agentbase-model.ts ← resolveAgentModel() — org-admin-configured LLM per imported agent, else the agent's own fallback string
apps/agents/src/mastra/lib/storage.ts ← getMastraStore() — the single shared PostgresStore (one connection pool)
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
scripts/bootstrap.mjs        ← new-project bootstrap (rename + set-ports + deps + reset docs + blank git)
scripts/poc.mjs              ← `pnpm poc`: build both apps, run them on 127.0.0.1, wait for health + sign-in; `pnpm stop`, `pnpm logs`
scripts/set-ports.mjs        ← retarget the agents/web port pair across env/configs/scripts/Dockerfiles/docs
scripts/rename-project.mjs   ← one-shot placeholder rename (walks all source)
scripts/update-deps.mjs      ← update deps to latest compatible + verify
scripts/progress-stamp.mjs   ← PROGRESS.md auto-journal
scripts/emit-import-manifest.mjs ← derive agentbase.import.json requiredEnv from the env schema
```

## 5. Lifecycle — when this file gets updated

- **On every meaningful task closure** — §1 (Current state), §2 (Next task), and §4 (File map for takeover, if files moved) are overwritten by the closing agent in the same change set as the code/doc changes.
- **§3 (Resume prompt) is stable** — only updated when the takeover contract itself changes (very rare).
- **§5 (Lifecycle) is meta** — only updated when this enforcement contract itself changes.

If you are picking up mid-session because the previous agent is unavailable, your first action is to read this file's §1 and §3, then paste §3's resume prompt into your next prompt to whichever agent continues the work. The seam is intentionally one file deep.
