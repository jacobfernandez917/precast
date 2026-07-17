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

_Known carry-forwards:_ none.

---

## 2. Next task (overwrite on each handoff)

No scheduled next task — Precast is a runnable baseline. To start a real project:

1. `pnpm install && pnpm bootstrap` (or `pnpm bootstrap my-project`).
2. **Write the feed-forward docs first:** copy the relevant `templates/*.md` into `docs/`, replace the example content with your product.
3. Fill in `docs/PROGRESS.md` §1 (name + mission) and the README title; set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`, and point `DATABASE_URL` / `REDIS_URL` / `KEYCLOAK_TOKEN_ISSUER_URI` at your remote/managed services (see [.env.example](../.env.example)).
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
apps/agents/src/mastra/index.ts   ← Mastra instance (agents, storage, logger, server:4111)
apps/agents/src/mastra/agents/    ← example-agent.ts + summary-agent.ts (neutral placeholders; each auto-serves its own A2A card)
apps/agents/src/mastra/tools/     ← example-tool.ts (+ .spec.ts) — neutral placeholder
apps/agents/Dockerfile            ← multi-stage build of the Mastra .mastra/output bundle
apps/web/app/                ← layout.tsx, providers.tsx, page.tsx, AgentChat.tsx, globals.css
apps/web/app/lib/a2a-client.ts ← server-only callAgent() (A2A; forwards agentId)
apps/web/app/api/            ← route handlers: health/route.ts, a2a/[agentId]/route.ts
apps/web/test/               ← Vitest specs (env schema + fitness guards: a2a-only, docker-build)
apps/web/e2e/                ← Playwright UI specs (home.spec.ts)
apps/web/Dockerfile          ← multi-stage build of the Next standalone server
packages/shared/src/         ← env parser (zod, ESM) + shared types
templates/                   ← feed-forward planning docs (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM)
docker/                      ← Docker Compose (apps only; infra is remote via .env)
scripts/bootstrap.mjs        ← new-project bootstrap (rename + set-ports + deps + reset docs + blank git)
scripts/set-ports.mjs        ← retarget Mastra/Next dev ports across env/configs/scripts/compose/docs
scripts/rename-project.mjs   ← one-shot placeholder rename (walks all source)
scripts/update-deps.mjs      ← update deps to latest compatible + verify
scripts/progress-stamp.mjs   ← PROGRESS.md auto-journal
```

## 5. Lifecycle — when this file gets updated

- **On every meaningful task closure** — §1 (Current state), §2 (Next task), and §4 (File map for takeover, if files moved) are overwritten by the closing agent in the same change set as the code/doc changes.
- **§3 (Resume prompt) is stable** — only updated when the takeover contract itself changes (very rare).
- **§5 (Lifecycle) is meta** — only updated when this enforcement contract itself changes.

If you are picking up mid-session because the previous agent is unavailable, your first action is to read this file's §1 and §3, then paste §3's resume prompt into your next prompt to whichever agent continues the work. The seam is intentionally one file deep.
