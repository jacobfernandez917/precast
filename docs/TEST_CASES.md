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
| APP-001 | `pnpm build` succeeds for shared + agents (mastra build) + web from clean                  | Passing                         |
| APP-002 | `pnpm typecheck` passes across all packages                                                | Passing                         |
| APP-003 | `pnpm lint` passes across all packages                                                     | Passing                         |
| APP-004 | `pnpm test` passes (agents + web Vitest)                                                   | Passing                         |
| APP-005 | Mastra API boots; `GET /api/agents` lists the example agent                                | Passing                         |
| APP-006 | Web builds; `GET /api/health` (Next.js route handler) returns `{status:"ok"}`; `/` renders | Passing                         |
| APP-007 | Env validation fails fast when `DATABASE_URL` is missing/invalid                           | Passing (covered by web Vitest) |
| APP-008 | Compose publishes host ports from `AGENTS_HOST_PORT`/`WEB_HOST_PORT`/`KEYCLOAK_HOST_PORT` (default = container port; override remaps host side only) | Passing (verified via `node scripts/docker-compose.mjs -f docker/docker-compose.yml config` against a real root `.env` — the actual `pnpm docker:up` path: defaults 4111/3000/8080; overriding in `.env` → 60000/60001/8080 correctly) |
| APP-009 | Compose includes a `keycloak` service (dev `start-dev`, published on `KEYCLOAK_HOST_PORT`); Postgres/Redis remain remote | Passing (verified via `docker compose config`: services = agents, keycloak, web; compose valid) |
| APP-010 | `pnpm docker:*` reads the root `.env` for Compose interpolation (fails fast with a clear message if `.env` is missing, via `scripts/docker-compose.mjs`); `COMPOSE_PROFILES` in `.env` selects which of agents/web/keycloak build+run (default = all three; e.g. `web,keycloak` excludes agents with no Compose error) | Passing (verified end-to-end: missing `.env` → exit 1 + message; default profiles → all 3 services; `COMPOSE_PROFILES=web,keycloak` → agents excluded cleanly; full config incl. override validates) |

---

## Agent Tests (Vitest, `apps/agents/src/mastra/`)

> Neutral placeholder — replace with your agents' tests.

| ID      | Description                      | Status  |
| ------- | -------------------------------- | ------- |
| AGT-001 | `echo` returns its input message | Passing |
| AGT-002 | `agentbase-model.spec.ts` — `resolveAgentModel()`: **off** AgentBase (unset `AGENTBASE_HOSTED`) falls back to the plain router string + `.env` key; builds a gateway-backed model (keyed to `AGENTBASE_LLM_MODEL_<AGENT_ID>`) once both the base URL and this agent's model are set; **on** an AgentBase-hosted container (`AGENTBASE_HOSTED=1`) an unconfigured agent does NOT fall back to the env key — it returns a model that fails at CALL time with an actionable message. `getAgentBaseLlmToken()` mints via OAuth2 `client_credentials`, caches, auto-refreshes near expiry, and errors clearly on missing config / non-2xx | Passing |

---

## Web Tests (Vitest, `apps/web/test/`)

| ID      | Description                                                                                                                                           | Status  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| WEB-001 | `health.spec.ts` — shared `EnvSchema` defaults (`MASTRA_PORT`/`WEB_PORT`/`LOG_LEVEL`)                                                                 | Passing |
| WEB-002 | `a2a-only.spec.ts` — fitness guard: no web source references a non-A2A Mastra agent route (D-013)                                                     | Passing |
| WEB-003 | `docker-build.spec.ts` — fitness guard: every app Dockerfile builds via path filters (no rename-fragile `--filter @scope/…`) and asserts its artifact | Passing |
| WEB-004 | `logger.spec.ts` — web logger factory returns a usable logger, honors `LOG_LEVEL`, defaults to `info` on unset/invalid | Passing |
| WEB-005 | `import-manifest.spec.ts` — `agentbase.import.json` `requiredEnv` matches the required set derived from the env schema (drift guard) + never gates reserved names | Passing |
| WEB-006 | `docker-compose-profiles.spec.ts` — every `pnpm docker:*` script routes through `scripts/docker-compose.mjs` (so root `.env` is read); agents/web/keycloak each declare a matching `profiles:` entry; web's `depends_on.agents` is `required: false` | Passing |
| WEB-007 | `agentbase-auth.spec.ts` — mints an AgentBase access token via OAuth2 `client_credentials` (correct `grant_type`/`client_id`/`client_secret`); caches + auto-refreshes before expiry; clear errors on missing config, non-2xx response, or a thrown request | Passing |
| WEB-008 | `a2a-client.spec.ts` — proxy mode POSTs the plain A2A `message/send` envelope (no wrapper) with the minted bearer to the agent's `AGENTBASE_AGENT_URL_<AGENT_ID>`; derives the env var name from the agent id; guard-rails on a missing per-agent URL or a token-mint failure (no fetch call in either case); direct mode unaffected (still `message/send` straight to Mastra) | Passing |

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
