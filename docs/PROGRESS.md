# PROGRESS.md — Context Memory

> **This file is the ultimate cross-tool context memory.** All coding agents MUST update this file on every meaningful change. If you finish work without updating PROGRESS.md, the work is **not** considered complete.

**Last Updated:** 2026-07-20
**Updated By:** Claude Code (fixed `apps/agents`/`apps/web` dev scripts not building `@precast/shared` first — see Session Log)
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

- **2026-07-20 · Claude Code · build — fixed `apps/agents`/`apps/web` dev scripts not building `@precast/shared` first ·** Discovered while scaffolding an external project: a fresh `pnpm dev`/`dev:agents`/`dev:web` on a clean scaffold failed with `Cannot find module '.../shared/dist/index.js'` because both apps depend on `@precast/shared` (workspace package) but neither their own `dev` script nor the root `dev:agents`/`dev:web` shortcuts (which call `pnpm --filter` directly, bypassing Turbo) ever built it first. Fix: `apps/agents/package.json` and `apps/web/package.json` `dev` scripts now run `pnpm --filter @precast/shared build` before starting their dev server (covers every invocation path); `turbo.json`'s `dev` task gained `dependsOn: ["^build"]` for turbo-native flows (`pnpm dev` / `turbo run dev`). No test added — this is a monorepo wiring fix, not app behavior. `apps/agents/package.json`, `apps/web/package.json`, `turbo.json`.

<!-- Newest first. The progress-stamp hook appends <auto-journal> markers here. -->

---

## 9. Cross-Tool Handoff Notes

| Date | Agent | Context |
| ---- | ----- | ------- |

---

## 10. Changelog

- (record notable milestones here)
