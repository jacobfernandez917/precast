# PROGRESS.md — Context Memory

> **This file is the ultimate cross-tool context memory.** All coding agents MUST update this file on every meaningful change. If you finish work without updating PROGRESS.md, the work is **not** considered complete.

**Last Updated:** 2026-08-11
**Updated By:** Claude Code (orchestrator-crew Phases 1–4 + telemetry)
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
5. If you started/finished a phase, update the **Phase Plan**.
6. Keep entries terse. Link to files where helpful.

### 0.3 What Belongs Here vs Elsewhere

- **Here:** state of work, decisions, blockers, what's next, who/what did what.
- **Not here:** architectural rationale (→ [SPEC.md](SPEC.md)), style rules (→ [STYLE_GUIDE.md](STYLE_GUIDE.md)), test definitions (→ [TEST_CASES.md](TEST_CASES.md)).
- **Never here:** secrets, raw tokens, PII.

---

## 1. Project Snapshot

> Fill this in for your project after `pnpm bootstrap`.

| Field            | Value                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| **Project**      | <your project name>                                                                                          |
| **Mission**      | <one-line mission>                                                                                           |
| **Stacks**       | pnpm + Turborepo · Mastra (agents) · Next.js + Astryx (web) · zod · Postgres/Redis/Keycloak (remote/managed) |
| **Repo Root**    | <path>                                                                                                       |
| **Primary Docs** | [SPEC.md](SPEC.md), [TECH_STACK.md](TECH_STACK.md), [STYLE_GUIDE.md](STYLE_GUIDE.md)                         |

---

## 2. Phase Plan

> Track major phases here. Mark each: Not Started / In Progress / Completed / Blocked

| #   | Phase                     | Status      | Exit Criteria |
| --- | ------------------------- | ----------- | ------------- |
| 1   | (define your first phase) | Not Started | —             |

---

## 3. Task Tracker (live)

> Mark each task `[ ]`, `[~]` in-progress, `[x]` done, `[!]` blocked.

- [ ] (add your first task)

---

## 4. Open Decisions

| ID    | Decision | Date | Rationale |
| ----- | -------- | ---- | --------- |
| D-001 | —        | —    | —         |

---

## 5. Known Blockers

| ID  | Blocker | Impact | Workaround |
| --- | ------- | ------ | ---------- |

---

## 6. Test Coverage

| Area                | Tests                                            | Status  |
| ------------------- | ------------------------------------------------ | ------- |
| Agents (Vitest)     | `apps/agents/src/**` — placeholder example tool  | Passing |
| Web/shared (Vitest) | `apps/web/test/**` — env schema + fitness guards | Passing |
| E2E (Playwright)    | `apps/web/e2e/**` — home page                    | Passing |

---

## 7. Environment State

| Variable | Value                                    |
| -------- | ---------------------------------------- |
| `Node`   | 24 (`.nvmrc`)                            |
| `pnpm`   | 9.15.9                                   |
| `Ports`  | Web 3000 · Mastra 4111 (infra is remote) |

---

## 8. Session Log

<!-- Newest first. The progress-stamp hook appends <auto-journal> markers here. -->

- **2026-08-11 · Claude Code · orchestrator-crew Phases 2 + 4(R2/R3) — import-manifest emission + container telemetry ·** **P2:** extended `scripts/emit-import-manifest.mjs` to emit an `orchestration` block into `agentbase.import.json` — orchestrator id read from `ORCHESTRATOR_ID` via regex (single source; no TS loader/DB needed in the bare-Node emit context), `members` omitted (AgentBase discovers them, same as `agents`), `defaultImport: orchestrator-only`. Guarded by `apps/agents/src/mastra/orchestration-manifest.spec.ts` (manifest orchestrator === `ORCHESTRATOR_ID`, members omitted, valid mode). **P4 R2/R3:** added `apps/agents/src/mastra/telemetry/otel.ts` (`@opentelemetry/sdk-node` + `exporter-trace-otlp-http` + `instrumentation-http`/`-undici`), self-starting and imported FIRST in `index.ts`, so the container installs W3C propagation (continues AgentBase's inbound `traceparent` across the crew's in-process hops + re-injects on egress) and exports spans when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (AgentBase injects it — R5). Telemetry init is best-effort and never crashes serving. **Why:** make the crew importable into AgentBase with an operator full-crew/orchestrator-only choice, and keep complete trace visibility despite in-process routing. **Verified:** typecheck + lint + 55 agents tests + `mastra build` all green. **Carry-forward:** live e2e trace-stitch through the _bundled_ container isn't verified here (no running stack); ESM instrumentation ordering may want a `node --import` preload — see HANDOFF §2. AgentBase-side P3 + P4 R1/R4/R5 landed in `~/Projects/agentbase`. · `scripts/emit-import-manifest.mjs`, `agentbase.import.json`, `apps/agents/src/mastra/{orchestration-manifest.spec.ts,telemetry/otel.ts,index.ts}`, `apps/agents/package.json`, `docs/{HANDOFF.md,PROGRESS.md,TECH_STACK.md,plans/orchestrator-crew-plan.md}`

- **2026-08-11 · Claude Code · orchestrator-crew Phase 1 — shipped the in-process orchestrator crew into the boilerplate ·** Added `apps/agents/src/mastra/crew.ts` as the single source of truth for the roster + orchestrator, `lib/crew.ts` (`defineCrew()` — N=1 transparent pass-through, activates at 2+; `crewAgents()` — deduped registration; guards for the reserved `crew-orchestrator` id, duplicate member ids, and nested crews), and `agents/orchestrator.ts` (`createOrchestrator()` — a Mastra Agent Network via the `agents:` field, i.e. in-process agents-as-tools with an LLM-routed tight prompt; no memory by design, same transformation-vs-conversation rule as `summary-agent`). Rewired `index.ts` to register `crewAgents(crew)` instead of hand-listing agents. Members are untouched → each keeps its own `/api/.well-known/:id/agent-card.json` and stays standalone; the orchestrator is purely additive. **Why:** Phase 1 of `docs/plans/orchestrator-crew-plan.md` — a default single-point-of-contact for every Precast Mastra app, without swallowing the subagents. **Verified:** `tsc --noEmit`, `eslint src`, 51 agents-package tests (8 new `lib/crew.spec.ts`), and `mastra build` all green. Live A2A-card fetch deferred: this checkout's `.env` has only placeholder DB creds + an invalid `file:` `MASTRA_DB_URL`, so the server can't boot here. **Next:** Phase 2 — extend `scripts/emit-import-manifest.mjs` to emit the `orchestration` block from `crew.ts`. · `apps/agents/src/mastra/{crew.ts,index.ts}`, `apps/agents/src/mastra/agents/orchestrator.ts`, `apps/agents/src/mastra/lib/{crew.ts,crew.spec.ts}`, `docs/{HANDOFF.md,PROGRESS.md,plans/orchestrator-crew-plan.md}`

---

## 9. Cross-Tool Handoff Notes

| Date       | Agent       | Context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-11 | Claude Code | Orchestrator-crew **Phase 1 done** — in-process orchestrator (`crew-orchestrator`, Mastra Agent Network) scaffolded into the boilerplate via `mastra/crew.ts` + `lib/crew.ts` (`defineCrew`/`crewAgents`) + `agents/orchestrator.ts`; activates at 2+ members, N=1 pass-through; members keep their own cards. Green: typecheck, lint, 51 agents tests, `mastra build`. **Next: Phase 2** — emit the `orchestration` block from `crew.ts` in `scripts/emit-import-manifest.mjs` (plan §8.2). Then mirror to precast-plugin / precast-ground-zero, and AgentBase-side Phase 3. |

---

## 10. Changelog

- (record notable milestones here)
