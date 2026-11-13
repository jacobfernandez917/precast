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

- **PRD full flow and public acceptance passed (T-260, 2026-11-13).** Builder/template `731a733` read the real PDF exactly, asked only name/theme, and completed seven commands plus the bounded PRD input write on the real Developer Computer. Run `9237c2c7-41b0-40f4-83ae-ca1751137532`, Raya work `f1acd593-5a65-4ce1-9573-be7921457acf` and native A2A task completed; the long turn took 252559 ms. Both subscriptions, the real Gemini call and exactly one Hannibal invocation passed. Public `E2E-018` passed persistent CRUD, two-account isolation and a real streamed assistant reply in 50.7 seconds. The first public attempt hit `ERR_NETWORK_CHANGED` when opening the second account; a full rerun passed. Current app: https://o6ocvgsysepyzkxzuxmstud4lq.srv.us, expiry **05:29 PHT on 14 November**. The first disk-full project's sources/database remain; only disposable caches were cleared (4.79 GB recovered). Full verify: 12 tasks passed (agents 203, web 404/one skipped, shared 24, A2UI 34); all four code CI jobs passed. Final product assistant presentation adjustment is being applied and rechecked on the same live app; no model/database reprovisioning is needed.

- **Conversational setup deployed and passed (T-258, 2026-11-13).** Builder `830156b`
  uses `prepare-precast-project` to ask one missing bootstrap preference per turn: name,
  model, theme, database. It skips supplied answers and uses defaults only when requested.
  Selecting Gemini and managed Postgres maps to the existing connected flow; srv.us is
  automatic, with no tunnel question. Existing operator and saved owner approvals remain
  mandatory. Deferring either connection keeps both and the preview deferred. Focused
  checks: 17 passed; full verify: 12 tasks passed (agents 184, web 393/one skipped); all
  four code CI jobs passed. The existing LOCAL builder is SYNCED/RUNNING. A real five-turn
  Raya conversation asked the four questions in order and honored pause. Zero new Computer
  runs; the existing session and public preview (HTTP 200) are preserved. This acceptance
  stopped before creating another project/database; the prior six-step execution below
  remains the real connected-build evidence. Report: `docs/validation/scaffold-conversation-2026-11-13.json`.

- **Automatic connected preview passed (T-257, 2026-11-13).** The existing builder at
  `152a404` completed a fresh full Raya run with six successful commands for
  `Projects/raya-scaffold-auto-20261113-v2`. The project Application has active subscriptions;
  Gemini and one audited Hannibal invocation passed. The Computer verified trusted Postgres
  TLS and its restricted role, then automatically started the app and srv.us tunnel. The API
  verified public sign-in and handed the bounded preview to the owner. Raya and its native
  A2A task completed after 239661 ms. Public sign-up and real UI chat with SSE passed.
  Open https://6ipicslqumvnweft4iojuqqdba.srv.us (expires **03:00 PHT on 14 November**).
  Flags and a separate saved project approval remain mandatory; ordinary scaffolds do not
  expose a public app. Full verify passed 12 tasks (web 393 passed/one skipped, agents 174),
  code CI all four jobs, script/tool checks ten; companion API checks passed 36.
  The first attempt's finished project/database are preserved after fixing a guard that
  counted a never-started historical run as active. The earlier manual preview was stopped.

- **Extended public UI test passed:** a real Gemini turn containing a 120-second deterministic
  tool completed in **127407 ms**, with **26** live progress events, the UI counter through
  120 seconds and the final answer visible. The original tool and fixture environment were
  restored again, agents rebuilt, the tunnel reconnected to the same URL and a normal real
  tool call with JSON compatibility passed in 6442 ms. Code CI `43393207804` passed verify,
  E2E and both images. The preview expiry below remains unchanged.

- **srv.us preview passed (2026-11-13):** the existing connected app runs on the real Developer Computer at https://ssc4pd3mnfawg6t26wvwtx6sua.srv.us until **23:35 PHT / 15:35 UTC today**. Public sign-up, authenticated UI chat and a real Gemini turn containing a deterministic 45-second echo tool passed: 49999 ms, ten incremental elapsed-time events, first at 702 ms. Restored the original tool and fixture environment, rebuilt agents, forced SSH reconnection to the same URL and passed another real tool call with JSON compatibility in 6710 ms. Postgres trusted TLS and the restricted role were verified inside the Computer. Full `pnpm verify` passed 12 tasks (web 390 passed/1 skipped, agents 171); focused checks passed 38. Progress events are live; the upstream answer arrives at completion. Companion AgentBase OD-223 provides an explicit bounded owner reservation and exact expiring relay/RDS networking. Keys and Application/database credentials stay private in the Computer.

- **Connected Raya scaffold passed (2026-11-13).** Deployed builder `3e3088c` cloned template `5e95164` into `Projects/raya-scaffold-live-20261113-connected`. Computer run `63107f67-e301-45db-9768-9a90a790225f` completed all five steps with zero exits. The project's own Application has both subscriptions active; the Computer made the real Gemini call and one audited Hannibal invocation. The hosted builder verified trusted RDS TLS, `SELECT 1`, the expected database/user and no superuser/role/database-creation privileges. Raya work `5433b827-fc65-4055-9c66-bbabc30a93fd` and native A2A task completed after 232786 ms. Exact template/package identity, web build ID, agent bundle and three normal Raya file views passed. The project is configured and built; no app preview or public tunnel was started. The original deferred project and failed model-check folder are retained.

- **Connected gates and verification:** optional `hannibal-gemini` setup requires the explicit request, builder/operator settings and an approved Computer credential lease bound to one project Application and exact listings. An uncertain database request refuses automatic retry. The model check now allows 1024 tokens; the earlier 32-token failure stopped before any database request. Signed Developer image v5 passed three model-directed attended synthetic HTTPS external-write trials, with disposable resources erased. Ordinary scaffold egress stays HTTPS-only; the optional preview has its own exact expiring exception. The encrypted database receipt is verified at the hosted builder. Code CI, focused checks and the real connected run pass. AgentBase `a1f59fac` fixes omitted fields being reset by partial Computer grant edits; 30 policy tests and API typecheck pass.

- **Fresh Computer bootstrap:** initial-commit identity falls back to `Project Scaffold <scaffold@localhost>` only for missing identity fields; existing Git configuration and author/committer environment overrides win. This fixes the failure reproduced inside the Developer image without changing member settings.
- **End-to-end Raya scaffold passed (2026-11-13).** The deployed builder at code `6a3dc9e` completed clone, bootstrap, `verify:poc` and build with four zero exits, and Raya returned the successful final reply after 238963 ms, beyond the former 180-second cutoff. Output `Projects/raya-scaffold-live-20261113-endtoend` has the requested package name, template commit `6a3dc9e`, a web build ID and the agent bundle; all three normal Raya file views returned 200. Signed Developer image `20261113.precast.5` is installed, promoted and attended-qualified with three model-directed trials, project-cache checks and a real npm registry read. Earlier image, memory, CI-lockfile and npm-configuration defects are fixed; v1–v4 are retired. Builder mode alone gets a bounded 15-minute server window; project mode keeps three minutes. General, existing nonprod capacity and prior project folders are preserved. No remote repository was created. Deployment scope is LOCAL/nonprod.
- **Validation:** both bundled modes served exactly their expected agent cards against managed Postgres; full `pnpm verify` and code CI passed. Fresh Developer-image desktop and initial-commit probes passed. Companion fixes are AgentBase `ab50cbbb` (per-agent identity + governance holds) and Raya `03ec2e0` (proposal rooms matched by stable subscribed agent ID); their focused unit and real-Postgres integration checks passed.

**Fresh baseline.** This is a clean Precast checkout — a runnable, agent-native monorepo with neutral placeholders (`example-agent` / `summary-agent` / `example-tool`, a generic landing page + agent-chat demo). No domain logic yet. `pnpm build` / `typecheck` / `lint` / `test` are green out of the box.

- **Two gated modes, one repository (2026-11-12).** `PRECAST_AGENT_MODE=project` is the default and constructs only the existing crew. `PRECAST_AGENT_MODE=scaffold-builder` constructs only `scaffold-builder`. Static factory imports avoid a live-discovered Mastra chunk cycle; project MCP preflight still runs only in project mode. Its execution tool runs a fixed Computer workflow in `Projects/<name>`: clone Precast → bootstrap (`--llm-provider=skip --db=later`) → `verify:poc` → build. The import manifest scopes Developer Computer needs to Mastra id `scaffold-builder`; normal project agents receive no Computer proposal.

- The Mastra app (`apps/agents`) and Next app (`apps/web`) are intentionally **neutral placeholders**. Real agents/pages/schema come from the feed-forward docs in `templates/` + TECH_STACK.
- Infra (Postgres/Redis) is **remote/managed** via the root `.env`, never run on the developer's computer. `pnpm poc` runs both apps as Node processes on `127.0.0.1`; there is no container runtime locally.
- **Postgres-only** ([ADR-002](ADRS.md), supersedes ADR-001): `DATABASE_URL` rejects SQLite/libsql at boot. A provisioned managed Postgres is a bootstrap precondition — the stack will not start without one.
- **Agent memory is wired and durable.** `example-agent` carries a `Memory` backed by Postgres (`@mastra/pg`); `summary-agent` deliberately has none (transformation, not conversation). The web app derives `resourceId` (`account-<user id>` from the signed-in session) and a resource-namespaced `threadId` **server-side** in `apps/web/app/lib/agent-context.ts` and never accepts either from the request body. Mastra otherwise defaults `resourceId` to the agent id, which would put every user in one shared memory bucket. Its tables are in `<project>_agents`.
- **Orchestrator crew — `docs/plans/orchestrator-crew-plan.md` (Phases 1–4 done).** `apps/agents/src/mastra/crew.ts` is the single source of truth for the roster; `defineCrew()` (`lib/crew.ts`) builds an **in-process** orchestrator front door — `crew-orchestrator`, a Mastra Agent Network (agents-as-tools) over the members that routes LLM-decided and **activates only at 2+ members**, collapsing to the sole member at N=1 (no routing hop, no extra card). Each member stays a plain agent → keeps its own `/api/.well-known/:id/agent-card.json` and is independently invocable; the orchestrator is purely additive. `index.ts` registers exactly `crewAgents(crew)`. Guards: reserved orchestrator id, duplicate ids, flat single layer. **P2:** `scripts/emit-import-manifest.mjs` emits an `orchestration` block into `agentbase.import.json` (orchestrator id from `ORCHESTRATOR_ID`; members omitted → discovered; `defaultImport: orchestrator-only`), guarded by `orchestration-manifest.spec.ts`. **P4 R2/R3:** `apps/agents/src/mastra/telemetry/otel.ts` (imported FIRST in `index.ts`) starts an OTel SDK — W3C propagation always, OTLP export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (AgentBase injects it into hosted containers) — so the crew's in-process hops continue AgentBase's inbound trace and forward it on egress. (P3 + P4 R1/R4/R5 are AgentBase-side.)

_Known carry-forwards:_

- Memory has **not been exercised against a live Postgres** — the baseline is verified by typecheck, unit tests, `mastra build`, and runtime env-validation checks only. First run against a real `DATABASE_URL` should confirm Mastra creates its tables in the `mastra` schema and that a second turn recalls the first.
- The crew's **live A2A cards have not been fetched against a running server.** This checkout's `.env` carries only placeholder DB creds (`your-postgres-host`) plus a pre-existing invalid `file:` `MASTRA_DB_URL` (the repo is Postgres-only, ADR-002), so `mastra start`/`dev` cannot boot here. Phase 1 is verified by typecheck, lint, the 51 agents-package unit tests (8 new in `lib/crew.spec.ts`), and a successful `mastra build` (which constructs the full instance graph including all three agents). First boot against a real Postgres should confirm `/api/.well-known/{example-agent,summary-agent,crew-orchestrator}/agent-card.json` all serve, and that a 2-member prompt routes through `crew-orchestrator`.
- **Context threading (OBO subject + session) through the orchestrator → member → egress, and W3C `traceparent` propagation, are NOT in Phase 1** — they are Phase 4 (telemetry R1–R5) in the plan. In-process routing works today; the governed-context/telemetry seam is the next correctness-sensitive piece.
- Sign-in runs inside the web app (Better Auth, `apps/web/app/lib/auth.ts`); chatting needs an account, and agent memory is scoped to `account-<user id>` from the verified session.

---

## 2. Next task (overwrite on each handoff)

**Close T-260.** Apply the assistant presentation change to the existing running project, rebuild the web app, retain its srv.us URL/approval window, and rerun `E2E-018`. Save the curated validation report and push develop. The core seven-step flow and first complete public acceptance already passed; preserve the active owner preview.

The earlier orchestrator-crew live telemetry checks remain carry-forwards:

CI's first scaffold-builder run passed both Docker image builds and E2E, but its lint gate identified an unused initial command-output assignment. That assignment has been removed; command output is now scoped to each polling iteration.

The repository rename guard also caught placeholder-bearing mode identifiers that bootstrap would turn into invalid hyphenated TypeScript. These are now `AgentMode` and `resolveAgentMode`; the guard remains enforced.

1. **Live-verify the telemetry stitch (P4 R2/R3).** With a real Postgres + a wired OTLP backend, boot a 2-member crew container and confirm the orchestrator→member in-process spans carry AgentBase's inbound `traceparent` and land in the backend correlated with `audit_calls` by trace id. The bundled container likely needs `node --import ./instrumentation.mjs` (ESM instrumentation ordering) — `apps/agents/src/mastra/telemetry/otel.ts` currently self-starts on first import, which covers `mastra dev`; harden the Dockerfile CMD if the live check shows inbound extraction is missed.
2. **Live-verify the AgentBase Studio import drawer** (full-crew vs orchestrator-only) against an authenticated stack + a repo whose manifest carries `orchestration`.

Deferred (Phase 5, not built): `CREW_ROUTE_VIA_AGENTBASE` per-hop governed routing; Studio "Expose/Hide subagent".

Precast otherwise remains a runnable baseline. To start a real project:

1. `pnpm install && pnpm bootstrap` (or `pnpm bootstrap my-project`).
2. **Write the feed-forward docs first:** copy the relevant `templates/*.md` into `docs/`, replace the example content with your product.
3. Fill in `docs/PROGRESS.md` §1 (name + mission) and the README title; run `pnpm connect` for the AgentBase Application and model (it proves them before writing `.env`; no vendor key anywhere), point `REDIS_URL` at your remote/managed Redis, and set `DATABASE_URL` to a **managed Postgres** URL — Postgres-only since [ADR-002](ADRS.md), and the stack will not boot without it (see [.env.example](../.env.example)).
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

PRD flow: `middleware/auth.ts` automatically captures the actual attachment before the model; `tools/prepare-scaffold.ts` analyses a still-unprocessed draft through `tools/read-prd.ts`; `lib/prd-drafts.ts` persists the exact source/hash and analysis under the scoped builder memory schema. `prepare-scaffold.ts` merges supplied PRD preferences with human replies and returns one next question. `scaffold-project.ts` uploads only a bounded PRD input into the fresh project; `scripts/apply-prd.mjs` validates its source/hash, refuses customized/symlinked outputs and writes the specs plus `project-brief.ts`. `packages/shared/src/prd.ts` owns the product/record contracts. `PrdWorkspace.tsx`, `api/project-records/route.ts` and `lib/prd-records.ts` implement signed-in CRUD; `e2e/prd-workspace.spec.ts` is the real public acceptance test. `middleware/auth.ts` binds builder memory to verified person/room, preserving project-mode behavior.

Conversational setup: `apps/agents/src/mastra/tools/prepare-scaffold.ts` returns the next
single question or ready execution request without side effects; its spec covers question
order, supplied answers, explicit defaults, invalid names and deferred connections.
`agents/scaffold-builder.ts` controls the dialogue; `tools/scaffold-project.ts` defaults
connected builds to srv.us while retaining the existing gates.

Automatic previews: `scripts/start-project-preview.mjs` checks the saved project approval,
trusted Postgres role and app readiness; `scripts/preview-tunnel.mjs` owns only the expiring
srv.us SSH connection to the app's loopback web port. `scaffold-project.ts` and
`agentbase-computer.ts` perform authorization and owner handoff through AgentBase.

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
