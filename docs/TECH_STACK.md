# TECH_STACK.md — Tech Inventory

> **Authoritative source of truth for all tech-stack facts.** If this file disagrees with any other doc about a version, library, container image, or port, this file wins and the other doc has a bug.

**Last Updated:** 2026-07-28

---

## 1. Quick Reference

| Layer                  | Tech                                                                                                                                                 | Version         | Notes                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package Manager        | pnpm                                                                                                                                                 | 9.15.9          | Workspaces monorepo                                                                                                                                                                                                                                                                                                                                                                                           |
| Monorepo Orchestrator  | Turborepo                                                                                                                                            | ^2.9.16         | Task orchestration                                                                                                                                                                                                                                                                                                                                                                                            |
| Runtime                | Node.js                                                                                                                                              | 24              | `.nvmrc` pin                                                                                                                                                                                                                                                                                                                                                                                                  |
| Container base         | node:24-alpine                                                                                                                                       | —               | agents + web multi-stage image base                                                                                                                                                                                                                                                                                                                                                                           |
| Language               | TypeScript                                                                                                                                           | ^5.9.3          | Strict mode                                                                                                                                                                                                                                                                                                                                                                                                   |
| Agents                 | Mastra                                                                                                                                               | ^1.78 (core)    | `apps/agents/` — agent framework, `mastra dev`                                                                                                                                                                                                                                                                                                                                                                |
| LLM access             | AgentBase LLM gateway                                                                                                                                | —               | `AGENTBASE_LLM_MODEL` + the Application credentials; no vendor key in any project (v0.10.0)                                                                                                                                                                                                                                                                                                                   |
| Agent store            | @mastra/pg                                                                                                                                           | ^1.31           | Agent memory/threads/working memory, in Postgres (schema `MASTRA_DB_SCHEMA`)                                                                                                                                                                                                                                                                                                                                  |
| Agent memory           | @mastra/memory                                                                                                                                       | ^1.38           | `Memory` on conversational agents — see `apps/agents/src/mastra/lib/memory.ts`                                                                                                                                                                                                                                                                                                                                |
| Agent telemetry        | @opentelemetry/sdk-node + OTLP exporters (protobuf and JSON, all three signals), `instrumentation-http`, `instrumentation-undici`, `api`, `api-logs` | ^0.221 / ^1.9   | `apps/agents/src/mastra/telemetry/otel.ts`, preloaded in the container as `telemetry.mjs`. Traces, metrics and logs to AgentBase's `/telemetry/otlp` from the standard `OTEL_*` variables (AgentBase injects them when it hosts the agent); attribute allowlist; no endpoint means propagation only. Never crashes serving.                                                                                   |
| Agent UI               | A2UI (A2A extension)                                                                                                                                 | v0.9.1          | Interactive cards on agent replies, catalog `raya.blocks.v1` — `packages/a2ui/` + `apps/agents/src/mastra/middleware/a2ui.ts`. Data part `application/a2ui+json`; extension URI `https://a2ui.org/a2a-extension/a2ui/v0.9.1`. Spec: [a2ui.org](https://a2ui.org/)                                                                                                                                             |
| Web                    | Next.js (App Router)                                                                                                                                 | ^16             | `apps/web/`                                                                                                                                                                                                                                                                                                                                                                                                   |
| UI runtime             | React                                                                                                                                                | ^19             | Web app                                                                                                                                                                                                                                                                                                                                                                                                       |
| Design system          | Astryx                                                                                                                                               | ^0.1            | `@astryxdesign/core` — components + base tokens (see templates/DESIGN_SYSTEM.md)                                                                                                                                                                                                                                                                                                                              |
| Design tokens / themes | APC Design System                                                                                                                                    | tokens vendored | Five themes (Stockholm · Prague · Arctic · Nova · Melbourne), light + dark. Layered over Astryx via `@layer apc-theme`; source `apps/web/app/theme/apc.tokens.json` (W3C DTCG), generated by `pnpm theme:build`. Preview: https://apc-design-system.917v.dev — see [DESIGN_SYSTEM_APC.md](DESIGN_SYSTEM_APC.md)                                                                                               |
| CSS utilities          | Tailwind CSS                                                                                                                                         | ^4              | Layout/spacing via Astryx Tailwind bridge                                                                                                                                                                                                                                                                                                                                                                     |
| Validation             | zod                                                                                                                                                  | ^3              | All external boundaries                                                                                                                                                                                                                                                                                                                                                                                       |
| Logging                | pino                                                                                                                                                 | ^9              | Agents: @mastra/loggers PinoLogger. Web: own pino logger (`apps/web/app/lib/logger.ts`). Both keyed off `LOG_LEVEL`                                                                                                                                                                                                                                                                                           |
| Log pretty-print (dev) | pino-pretty                                                                                                                                          | ^13             | Web dev-only; colorized terminal output (prod = JSON)                                                                                                                                                                                                                                                                                                                                                         |
| Database               | PostgreSQL                                                                                                                                           | 17              | **Always Postgres**, via one `DATABASE_URL`; **remote/managed** (Neon, Supabase, RDS), never in Compose. Validated at boot by `isPostgresUrl()` (`packages/shared/src/database.ts`) — see ADR-002                                                                                                                                                                                                             |
| Database provisioning  | pg (node-postgres)                                                                                                                                   | ^8.23           | Root devDependency for `scripts/provision-db.mjs` (`pnpm db:provision`): creates a database + scoped role on the org's shared Postgres server, verifies, writes `DATABASE_URL`. Admin URL from the shell (`PRECAST_RDS_SUPERUSER_URL`), never in `.env`. Amazon RDS CA bundle vendored at `scripts/certs/rds-global-bundle.pem` (node-postgres verifies certificates); `PRECAST_RDS_CA_BUNDLE_PATH` overrides |
| Vector                 | pgvector                                                                                                                                             | ^0.8            | Optional, not yet implemented — see §9 RAG stack                                                                                                                                                                                                                                                                                                                                                              |
| Identity               | Keycloak / OIDC                                                                                                                                      | latest          | **Docker Compose (dev)** or remote — `KEYCLOAK_TOKEN_ISSUER_URI`                                                                                                                                                                                                                                                                                                                                              |
| Cache                  | Redis                                                                                                                                                | 7               | **Remote/managed** (Upstash, Redis Cloud) — `REDIS_URL`                                                                                                                                                                                                                                                                                                                                                       |
| Linting                | ESLint                                                                                                                                               | ^10             | Flat config                                                                                                                                                                                                                                                                                                                                                                                                   |
| Formatting             | Prettier                                                                                                                                             | ^3              |                                                                                                                                                                                                                                                                                                                                                                                                               |
| Testing (agents)       | Vitest                                                                                                                                               | ^2              | `apps/agents` — no config (defaults)                                                                                                                                                                                                                                                                                                                                                                          |
| Testing (Web)          | Vitest                                                                                                                                               | ^2              | `apps/web/vitest.config.ts`                                                                                                                                                                                                                                                                                                                                                                                   |
| E2E Testing            | Playwright                                                                                                                                           | ^1              | `apps/web/playwright.config.ts` (autonomous)                                                                                                                                                                                                                                                                                                                                                                  |
| Git Hooks              | `.githooks/`                                                                                                                                         | —               | Native core.hooksPath; doc-contract + lint-staged                                                                                                                                                                                                                                                                                                                                                             |
| Lint-Staged            | lint-staged                                                                                                                                          | ^17             | Invoked from `.githooks/pre-commit`                                                                                                                                                                                                                                                                                                                                                                           |
| Env loading (dev)      | dotenv-cli                                                                                                                                           | ^11             | Dev/start scripts load the single root `.env`                                                                                                                                                                                                                                                                                                                                                                 |

---

## 2. Agents (`apps/agents/`)

Mastra **agents-only** app — hosts agents and their tools, nothing else (no MCP
servers, no hand-rolled REST APIs; agents reach external services as tools).
`mastra dev` serves Mastra's HTTP surface under `/api/*` (A2A + agent routes)
and the Studio playground at the root, on `MASTRA_PORT` (default 45000). Source
lives in `src/mastra/` (`index.ts` instance, `agents/`, `tools/`). ESM, no decorators.

| Dependency                                              | Version        | Purpose                                                                                                                                                                              |
| ------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| @mastra/core                                            | ^1.78          | Agent, tools, Mastra instance                                                                                                                                                        |
| @mastra/pg                                              | ^1.31          | Durable Mastra store (Postgres)                                                                                                                                                      |
| @mastra/memory                                          | ^1.38          | Conversation + working memory for agents                                                                                                                                             |
| @mastra/mcp                                             | ^2.4           | MCP client for AgentBase-subscribed servers. 2.x serves only the 2026-07-28 MCP revision as a server; as a client it probes `server/discover` and falls back to the legacy handshake |
| @mastra/loggers                                         | ^1.3           | PinoLogger for structured logs                                                                                                                                                       |
| @a2a-js/sdk                                             | ^0.3           | Official A2A types (agent card `securitySchemes`)                                                                                                                                    |
| @ai-sdk/openai-compatible                               | ^3.0           | AgentBase LLM gateway client (see below)                                                                                                                                             |
| @ai-sdk/provider                                        | ^4.0           | `LanguageModelV4` type for the gateway client                                                                                                                                        |
| mastra                                                  | ^1.34          | CLI: `mastra dev` / `mastra build`, run with `MASTRA_TELEMETRY_DISABLED=1` (usage analytics off; the runtime image sets it too)                                                      |
| @precast/a2ui                                           | workspace      | `show_card` tool + A2UI middleware (see §4)                                                                                                                                          |
| hono (dev)                                              | 4.13.3         | Pinned to the version Mastra serves on, so the A2UI middleware test (AGT-014) exercises the same request-body caching as production                                                  |
| @mastra/deployer (dev)                                  | ^1.78          | `createHonoServer` for AGT-016, which runs A2UI through Mastra's own A2A server                                                                                                      |
| @opentelemetry/sdk-node                                 | ^0.221         | Telemetry SDK: providers, batch processors, the 30 s metric reader. See INTEGRATION_AGENTBASE §7.13                                                                                  |
| @opentelemetry/exporter-{trace,metrics,logs}-otlp-proto | ^0.221         | OTLP over `http/protobuf`, what AgentBase injects                                                                                                                                    |
| @opentelemetry/exporter-{trace,metrics,logs}-otlp-http  | ^0.221         | OTLP over `http/json`, when `OTEL_EXPORTER_OTLP_PROTOCOL` asks for it                                                                                                                |
| @opentelemetry/instrumentation-http / -undici           | ^0.221 / ^0.31 | W3C `traceparent` in on inbound requests and out on `fetch` egress                                                                                                                   |
| @opentelemetry/api / api-logs                           | ^1.9 / ^0.221  | Tracer, meter and logger APIs                                                                                                                                                        |
| esbuild (dev)                                           | ^0.28          | Builds `telemetry.mjs`, the container's `--import` preload, next to the Mastra bundle                                                                                                |
| zod                                                     | ^3             | Tool input/output schemas + env validation                                                                                                                                           |

> The model always comes from the organisation's **AgentBase LLM gateway**
> (`@ai-sdk/openai-compatible` against `{AGENTBASE_URL}/proxy/llm/<org>/<model-slug>/v1`,
> the route derived from `AGENTBASE_LLM_MODEL` and the Application's
> subscriptions). No vendor key is read anywhere since v0.10.0.
> `apps/agents/src/mastra/lib/agentbase-model.ts`'s `resolveAgentModel(agentId)`
> picks the per-agent model AgentBase injects on a hosted container, else the
> account-level `AGENTBASE_LLM_MODEL`, else a model that fails at call time
> naming what to set. See `docs/INTEGRATION_AGENTBASE.md` §7.9.

---

## 3. Web (`apps/web/`)

| Dependency                      | Version   | Purpose                                                                                                             |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| next                            | ^16       | Next.js framework (App Router)                                                                                      |
| react / react-dom               | ^19       | UI runtime                                                                                                          |
| @astryxdesign/core              | ^0.1      | Astryx design system components + tokens                                                                            |
| @astryxdesign/theme-neutral     | ^0.1      | Astryx theme (CSS custom properties + theme object)                                                                 |
| @astryxdesign/cli               | ^0.1      | Astryx CLI (`astryx component`, docs, templates)                                                                    |
| @a2ui/react                     | 0.14.0    | A2UI v0.9 surface renderer; `app/a2ui/catalog.tsx` implements `raya.blocks.v1` on Astryx. Pinned exact: 0.x preview |
| @a2ui/web_core                  | 0.14.0    | A2UI message processor, catalog model and validation (peer of `@a2ui/react`)                                        |
| @precast/a2ui                   | workspace | Catalog id, client capabilities, reply and press readers                                                            |
| zod                             | ^3        | Catalog component schemas                                                                                           |
| tailwindcss                     | ^4        | Utility classes for layout/spacing                                                                                  |
| @tailwindcss/postcss            | ^4        | Tailwind v4 PostCSS plugin                                                                                          |
| postcss                         | ^8        | PostCSS (Tailwind pipeline)                                                                                         |
| @types/react / @types/react-dom | ^19       | React type definitions                                                                                              |

> **Theme selection.** `pnpm bootstrap` asks which APC theme to ship; `pnpm set-theme <name>`
> changes it. The choice is a single constant in `apps/web/app/theme/apc-theme.ts`, rendered
> as `data-apc-theme` on `<html>` so the first paint is already themed. `pnpm theme:build
--check` fails when the committed CSS is stale.
>
> **Styling model.** Build UI from Astryx components + theme tokens; use Tailwind
> utilities (`flex`, `gap`, `p-4`, and token-backed classes like `bg-surface`,
> `text-primary`) for layout. The Astryx Tailwind bridge (`@astryxdesign/core/tailwind-theme.css`)
> maps Tailwind theme vars to Astryx tokens. Cascade-layer order is declared in
> `apps/web/app/globals.css` — see `pnpm exec astryx docs styling-libraries tailwind`.
>
> **Build note.** Astryx 0.1.x ships components compiled against React's dev JSX
> runtime (`jsxDEV`), absent from production. `apps/web` therefore builds with
> **webpack** (`next build --webpack`) plus a `react/jsx-dev-runtime` shim
> (`apps/web/jsx-dev-runtime.shim.ts`, wired in `next.config.ts`). `next dev`
> stays on Turbopack (dev runtime present). Revisit when Astryx ships a prod build.
> ESLint uses the shared root flat config (no `eslint-config-next`, which caps at
> ESLint 9).

---

## 4. Shared (`packages/shared/`)

| Dependency  | Version | Purpose                         |
| ----------- | ------- | ------------------------------- |
| zod         | ^3      | Schema validation + env parsing |
| @types/node | ^24     | `process` types for env parser  |
| typescript  | ^5.9    | Type definitions                |

> `packages/shared` compiles to **ESM** (NodeNext) so Mastra's bundler can
> statically analyze its named exports; relative imports use `.js` extensions.
> `apps/agents` (Mastra) and `apps/web` (Next.js) are both ESM. See ADR-005.

### `packages/a2ui/`

A2UI v0.9.1 for A2A agents, with no runtime dependencies. It holds the `raya.blocks.v1` catalog
(`catalog/raya-blocks-v1.catalog.json`, pinned by sha256 and excluded from Prettier), the
`show_card` card format and its JSON Schema, and the A2A part helpers for both wire versions
(0.3 and 1.0). The same source is meant to replace AgentBase's copy in `apps/api/src/a2ui/`, so
an agent and its renderer never disagree about the catalog. Builds to ESM like `packages/shared`.

---

## 5. Docker Compose Services

Compose runs the **apps + Keycloak**. **Postgres and Redis** are **not** run in
Compose — point the apps at your own remote/managed services via the root `.env`
(`DATABASE_URL`, `REDIS_URL`). **Keycloak** runs locally for dev auth; in production
point `KEYCLOAK_TOKEN_ISSUER_URI` at a managed Keycloak instead.

| Service  | Image                              | Port (host)                    | Purpose                                   |
| -------- | ---------------------------------- | ------------------------------ | ----------------------------------------- |
| agents   | built — `apps/agents/Dockerfile`   | `${AGENTS_HOST_PORT:-45000}`   | Mastra agents app (multi-stage build)     |
| web      | built — `apps/web/Dockerfile`      | `${WEB_HOST_PORT:-45001}`      | Next.js web app (multi-stage build)       |
| keycloak | `quay.io/keycloak/keycloak:latest` | `${KEYCLOAK_HOST_PORT:-45002}` | OIDC identity provider (dev; `start-dev`) |

- **agents** / **web** images build from the repo root on **`node:24-alpine` for BOTH the builder and the runtime stage** (multi-stage: pnpm workspace install + build → self-contained runtime bundle — `.mastra/output` for agents, Next `.next/standalone` for web). One Node major across build and run — matching `.nvmrc`, so no builder/runtime version skew — on a base small enough to rebuild on every `pnpm poc`. `apps/web/test/docker-build.spec.ts` pins every `FROM` to that tag and checks `.nvmrc` agrees.
- Inter-service URLs use Docker DNS names, never `localhost`: `web` reaches the API via `MASTRA_INTERNAL_URL=http://agents:45000`. Remote infra is reached over the public network via its `.env` URL.
- `agents` has **no volume** — it persists agent memory to the managed Postgres from `.env` (ADR-002), so the container is stateless and safe to recreate. Compose deliberately sets no `MASTRA_DB_URL`/`DATABASE_URL` under `environment:`, because keys listed there override `env_file` and would shadow the real connection string. The remaining volume (`keycloak-data`) is declared **bare** (no project-name prefix) because Compose prefixes it with the project itself — declaring `precast-keycloak-data` would produce the stuttering `precast_precast-keycloak-data`. The project prefix is what isolates volumes between repos, so bare names stay collision-free.
- Both load the root `.env` (`env_file` optional) — that is where the remote infra URLs come from; the compose `environment:` block overrides only network-specific app values.
- **Each service declares `profiles: ['<own name>']`.** `COMPOSE_PROFILES` in the root `.env` (Compose's own variable) selects which build/run — default `agents,web,keycloak`. This lets you build only a subset once the pieces are deployed separately (e.g. agents hosted by an AgentBase import; only `web`+`keycloak` need to run here). `web`'s `depends_on.agents` is `required: false` so excluding `agents` doesn't fail Compose validation.
- **Compose does NOT read the repo-root `.env` by default** when invoked with `-f docker/docker-compose.yml` from the repo root (it looks in the compose file's own directory unless told otherwise) — so every `pnpm docker:*` script routes through `scripts/docker-compose.mjs`, which passes `--env-file .env` (failing fast with a clear message if `.env` is missing). Without this, `AGENTS_HOST_PORT`/`WEB_HOST_PORT`/`KEYCLOAK_HOST_PORT`/`COMPOSE_PROFILES`/`KEYCLOAK_ADMIN` all silently fall back to their YAML defaults.

---

## 6. Port Assignments

| Service              | Port  | Notes                                    |
| -------------------- | ----- | ---------------------------------------- |
| Mastra (host dev)    | 45000 | `mastra dev` — agent API + Studio        |
| Web (host dev)       | 45001 | Next dev server                          |
| Keycloak (host dev)  | 45002 | local dev OIDC (`KEYCLOAK_HOST_PORT`)    |
| Keycloak (container) | 8080  | fixed — only the host mapping ever moves |

**The stack owns one consecutive block of three ports**, assigned in stack order (agents → web → keycloak). `pnpm bootstrap` picks that block **at random, verified free, inside `45000`–`49100`**; `pnpm set-ports --auto` re-picks one any time, and explicit `--mastra` / `--web` / `--keycloak` flags pin individual ports. The values above are what this boilerplate ships with as an example.

Why that range and shape:

- **Consecutive** — one project, one memorable block.
- **Random + verified free** — two Precast projects on the same machine used to collide on `3000`/`4111` every single time. A per-project block just works.
- **≥ 45000** — clear of every common dev-server default (`3000`, `4000`, `5173`, `8000`, `8080`) and of the privileged range, so no `sudo`.
- **< 49152** — that is where the IANA/macOS/Linux **ephemeral** range begins. Publishing a container port inside it lets a random outbound socket claim the port first, producing an "address already in use" that only reproduces sometimes. `apps/web/test/ports.spec.ts` enforces these bounds; the picker lives in `scripts/set-ports.mjs` (`PORT_RANGE`, `pickConsecutivePorts()`).

Postgres/Redis run on your remote/managed provider — their ports are part of the `.env` URLs, not local host ports.

**Docker published host ports** are separate from the container/app ports: `docker-compose.yml` publishes `${AGENTS_HOST_PORT:-45000}:45000`, `${WEB_HOST_PORT:-45001}:45001`, and `${KEYCLOAK_HOST_PORT:-45002}:8080`. Set `AGENTS_HOST_PORT` / `WEB_HOST_PORT` / `KEYCLOAK_HOST_PORT` in the root `.env` to remap the host side (e.g. `60000`/`60001`/`60002`) without changing the container ports; the app ones default to the app port, and they only affect `pnpm docker:up`.

**Container runtime is a prerequisite.** The Compose stack (and `pnpm poc`) needs Docker Desktop (macOS/Windows) or Docker Engine + the Compose plugin (Linux). `scripts/check-docker.mjs` (`pnpm docker:check`, `pnpm docker:wait`) is the preflight: it distinguishes "not installed" from "installed but not started", prints the fix for the actual platform, and `--wait` polls until the engine answers so a first-run install doesn't need the command re-run. Every `pnpm docker:*` and `pnpm poc` invocation runs it first.

---

## 7. Testing Tools

| Tool       | Scope                | Config                                                    |
| ---------- | -------------------- | --------------------------------------------------------- |
| Vitest     | API (`apps/agents/`) | Defaults; specs alongside source (`*.spec.ts`)            |
| Vitest     | Web (`apps/web/`)    | `apps/web/vitest.config.ts`                               |
| Playwright | E2E (`apps/web/`)    | `apps/web/playwright.config.ts`; specs in `apps/web/e2e/` |

> Playwright is **autonomous**: its `webServer` block boots `next dev` itself,
> so `pnpm test:e2e` needs no manually-started app. Install the browser once
> with `pnpm -F @precast/web test:e2e:install` (or `playwright install chromium`).

---

## 8. Maintenance

- **Dependency updates:** `pnpm deps:update` (`scripts/update-deps.mjs`) bumps
  deps to their latest compatible versions within semver ranges, then verifies
  with build + test. `--latest` bumps to latest major; `--dry` previews via
  `pnpm outdated`. Run it periodically or from external CI.
- **Bootstrapping a new project:** `pnpm bootstrap` (`scripts/bootstrap.mjs`)
  asks for a name, renames the placeholder, updates deps, re-initializes a blank
  git repo on the `develop` branch, and prints the feed-forward doc checklist.
- **Dependency base image (GHCR):** `docker/deps.Dockerfile` resolves the
  workspace's ~970-package graph once, per architecture, and publishes it to
  **`ghcr.io/<owner>/precast-deps:lock-<hash>`** via
  `.github/workflows/deps-image.yml` (native amd64 + arm64 runners, no QEMU).
  The app Dockerfiles declare `ARG BASE_IMAGE=node:24-alpine` and `pnpm poc`
  upgrades that to the published image **only when its tag matches this
  lockfile** (`scripts/deps-image.mjs`). Measured: the in-image `pnpm install`
  drops from **11.4s to 1.0s** per app build; the runtime images are byte-for-byte
  the same size (326 MB). The deps image is ~1.6 GB uncompressed / **~337 MB on
  the wire**, pulled once per lockfile and shared by both app builds. It is a
  pure accelerator — with no registry, no network, or `PRECAST_DEPS_IMAGE=off`,
  builds fall back to plain node and behave exactly as before.
- **Staying aligned with Precast:** `pnpm precast:update`
  (`scripts/precast-update.mjs`) pulls later Precast improvements into a derived
  project. Release identity and the managed/advisory file map live in
  **`precast.manifest.json`** (the `version` field there is the authoritative
  Precast release number); each project's origin and per-file hash baseline live
  in **`precast.lock.json`**, written by `pnpm bootstrap`
  (`scripts/precast-lock.mjs`). Check-only by default; `--apply` writes.
  Per-release steps: [MIGRATIONS.md](MIGRATIONS.md).
- **Feed-forward planning docs:** `templates/` holds PRD, DATA_MODEL, AGENT_SPEC,
  and DESIGN_SYSTEM templates — each a worked example (chat-based meeting-room
  reservation, Astryx design system). Copy into `docs/`, replace the example,
  and write them before building.

---

## 9. RAG stack (optional — not yet implemented)

Precast ships no RAG code today. This is the **designated stack** for when a project
built on Precast needs retrieval-augmented generation — recorded here so it's a
decision made once, not re-litigated per project:

| Layer                | Tech                                          | Notes                                                                                                                                                |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedding generation | Transformers.js (`@huggingface/transformers`) | Runs locally in Node — no external API key required; keeps the RAG floor at zero extra vendor keys, matching the `capability-modules` philosophy     |
| Embedding model      | `Xenova/all-MiniLM-L6-v2`                     | 384-dim, small and fast; a reasonable general-purpose default                                                                                        |
| Vector store         | `pgvector`                                    | Embeds alongside the project's own data in the same Postgres. Single answer since ADR-002 made Precast Postgres-only — there is no per-engine branch |

> Put the vectors in the project's own Postgres — don't stand up a second,
> RAG-only database when the store you already have fits. Neither embedding
> generation nor the vector store requires a new provider key: this capability's
> floor is the LLM key Precast already requires.

---

## 10. Out of Scope

- CI/CD pipeline (implemented outside this repo).
