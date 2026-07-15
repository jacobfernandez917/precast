# TEST_CASES.md — Test Catalog

> Test catalog for the boilerplate itself. When used to start a new project, replace this file with the project's own test cases.

---

## Boilerplate Smoke Tests

| ID        | Description                                                         | Status      |
| --------- | ------------------------------------------------------------------- | ----------- |
| SMOKE-001 | All required files exist (CLAUDE.md, HANDOFF.md, PROGRESS.md, etc.) | Not Started |
| SMOKE-002 | package.json parses and scripts are valid                           | Not Started |
| SMOKE-003 | tsconfig.base.json is valid JSON                                    | Not Started |
| SMOKE-004 | turbo.json is valid JSON                                            | Not Started |
| SMOKE-005 | pnpm-workspace.yaml is valid YAML                                   | Not Started |
| SMOKE-006 | .editorconfig is valid                                              | Not Started |
| SMOKE-007 | .prettierrc is valid JSON                                           | Not Started |
| SMOKE-008 | .env.example has no secrets                                         | Not Started |
| SMOKE-009 | .githooks/pre-commit is executable                                  | Not Started |
| SMOKE-010 | .claude/settings.json is valid JSON                                 | Not Started |
| SMOKE-011 | eslint.config.js is valid                                           | Not Started |
| SMOKE-012 | All docs/ files have no broken internal links                       | Not Started |
| SMOKE-013 | HANDOFF.md freshness gate (< 14 days)                               | Not Started |
| SMOKE-014 | PROGRESS.md has no placeholder content                              | Not Started |
| SMOKE-015 | All workspace packages have valid package.json                      | Not Started |

---

## Application Smoke Tests

> Verified manually on 2026-07-06 (Node 25.2.1 / pnpm 9.15.9). Automate under CI when it moves in scope.

| ID      | Description                                                                                | Status                          |
| ------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| APP-001 | `pnpm build` succeeds for shared + api (mastra build) + web from clean                     | Passing                         |
| APP-002 | `pnpm typecheck` passes across all packages                                                | Passing                         |
| APP-003 | `pnpm lint` passes across all packages                                                     | Passing                         |
| APP-004 | `pnpm test` passes (api + web Vitest)                                                      | Passing                         |
| APP-005 | Mastra API boots; `GET /api/agents` lists the example agent                                | Passing                         |
| APP-006 | Web builds; `GET /api/health` (Next.js route handler) returns `{status:"ok"}`; `/` renders | Passing                         |
| APP-007 | Env validation fails fast when `DATABASE_URL` is missing/invalid                           | Passing (covered by web Vitest) |

---

## Agent Tests (Vitest, `apps/api/src/mastra/`)

> Neutral placeholder — replace with your agents' tests.

| ID      | Description                      | Status  |
| ------- | -------------------------------- | ------- |
| AGT-001 | `echo` returns its input message | Passing |

---

## E2E UI Tests (Playwright, `apps/web/e2e/`)

> Autonomous — Playwright boots `next dev` itself. Verified on 2026-07-06 (Playwright 1.61.1, chromium). Run: `pnpm test:e2e`.

| ID      | Description                                                                        | Status  |
| ------- | ---------------------------------------------------------------------------------- | ------- |
| E2E-001 | Home page renders the `<h1>` app heading                                           | Passing |
| E2E-002 | Home page shows server health fetched from the Next.js route handler `/api/health` | Passing |
| E2E-003 | `GET /api/health` returns `{status:"ok"}` when hit directly                        | Passing |

---

## Tooling Tests

| ID       | Description                                                                          | Status                          |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------- |
| TOOL-001 | `rename-project.mjs` rewrites all functional `precast` refs, leaves docs prose       | Passing                         |
| TOOL-002 | `bootstrap.mjs` renames, resets git to a single commit on `develop`, activates hooks | Passing (verified in temp copy) |
| TOOL-003 | `update-deps.mjs --dry` lists outdated packages without writing                      | Passing                         |

---

## Documentation Contract Tests

| ID      | Description                                    | Status      |
| ------- | ---------------------------------------------- | ----------- |
| DOC-001 | CLAUDE.md references all required docs         | Not Started |
| DOC-002 | HANDOFF.md §1, §2, §3, §4 all present          | Not Started |
| DOC-003 | PROGRESS.md has all required sections (§0-§10) | Not Started |
| DOC-004 | TECH_STACK.md has all required sections        | Not Started |
| DOC-005 | ADRS.md has valid ADR format                   | Not Started |
| DOC-006 | STYLE_GUIDE.md covers all required topics      | Not Started |
| DOC-007 | SCRIPTS.md covers all pnpm scripts             | Not Started |
