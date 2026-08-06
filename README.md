# Precast

**A precast foundation for new TypeScript projects.** Start from it — rename the placeholder to your project, and build — with the monorepo structure, guardrails, and agent-handoff documentation already in place.

Precast is built to be driven by coding agents (Claude Code, OpenClaw, or any other) as much as by humans. Everything an agent needs to take over work without context loss lives in a small chain of documents, described below.

---

## What you get

- **Monorepo structure** — pnpm workspaces + Turborepo (`apps/*` deployables, `packages/*` shared libs).
- **Documentation contract** — a `CLAUDE.md → HANDOFF.md → PROGRESS.md → authoritative docs` chain that keeps context flowing between sessions and agents.
- **Guardrails** — pre-commit doc-contract enforcement, lint-staged, EditorConfig, zod-based env validation, and fitness tests (A2A-only web→agents, rename-proof Docker builds). Both apps' `dev` scripts build `@precast/shared` first, so a fresh scaffold's first `pnpm dev` never trips a missing-`dist` error.
- **Progress automation** — Claude Code hooks auto-journal every edit into `PROGRESS.md`.
- **Neutral runnable starters** — a **Mastra** agent API (a placeholder example agent + tool + durable memory, served with a Studio playground) and a **Next.js** web app (App Router, **Astryx** components coloured by the **APC Design System**) on a shared TypeScript package, plus a Docker Compose stack for the apps (multi-stage images) with a local **Keycloak** for dev auth, while **Postgres and Redis** are used as **remote/managed** services via `.env`. They carry no domain — just enough to prove the wiring, build, type-check, lint, and test green out of the box. You build the real structure from the feed-forward docs + tech stack.
- **Feed-forward planning templates** — PRD, data model, agent spec, and a design system guide in `templates/`, each a worked example you copy into `docs/` and fill in before building.
- **PRD-driven scaffolding** — already have a PRD? Hand it to your coding agent ("scaffold from this PRD") and it expands the PRD into the feed-forward docs and stubs the agents/UI, asking about anything vague. Drop the PRD at `docs/PRD.md`. (Delivered via the Precast scaffold skill; see `templates/PRD.md` for the shape — a loose PRD works too.)
- **Mocks for missing dependencies** — when an external REST API, MCP server, or A2A agent is referenced but you haven't supplied the real one, the scaffold generates a **standards-conforming mock** (real service interface, realistic payloads, swappable by config) so the MVP runs end-to-end. Real config in `.env` → the real dependency is used instead. Never mocks over something you provided.
- **Deployment mode chosen up front** — the scaffold asks how the project will run and wires it accordingly: **Standalone** (no AgentBase; direct A2A), **External agent** (you host, onboarded to AgentBase by registering its endpoint), or **Imported** (AgentBase imports the repo and hosts it). This sets `ENABLE_AGENTBASE`, keeps or drops `agentbase.import.json`, and points at the right onboarding path — see [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md).
- **Five APC Design System themes, chosen at scaffold time** — **Stockholm**, **Prague**, **Arctic**, **Nova**, **Melbourne**, previewable at **[apc-design-system.917v.dev](https://apc-design-system.917v.dev)**. They layer onto Astryx as token overrides (light + dark per theme), so switching is `pnpm set-theme <name>` rather than a UI rewrite. See [docs/DESIGN_SYSTEM_APC.md](docs/DESIGN_SYSTEM_APC.md).
- **Designs the UI when you don't** — no mockups? The scaffold builds a clean, modern, responsive interface from **Astryx** components on APC tokens, with real human-facing copy (no internal jargon or placeholders) and realistic mock data so screens look real out of the box. Provide a design and it follows yours instead.

See [docs/TECH_STACK.md](docs/TECH_STACK.md) for the pinned versions of everything.

---

## Getting started

### First: clone Precast

Precast is a launch pad for **new, independent projects**. Clone it, then run `pnpm bootstrap` — which wipes the inherited history and re-inits a blank repo, making the copy yours.

```bash
git clone <precast-url> my-project
cd my-project
```

### Fastest path: `pnpm bootstrap`

One command turns Precast into your project:

```bash
pnpm install        # so the script can run
pnpm bootstrap      # interactive, or: pnpm bootstrap my-project
```

`bootstrap` (see [scripts/bootstrap.mjs](scripts/bootstrap.mjs)) will:

1. **Ask for the project name**, then show an **auto-picked port block** for the stack — a random, verified-free, **consecutive** triple in `45000`–`49100` (agents / web / keycloak, e.g. `45000` / `45001` / `45002`). Press Enter to accept, or type a base port for the block. Random-and-free means two Precast projects on one machine never fight over `3000`/`4111`; staying under `49152` keeps the ports out of the OS ephemeral range, where an outbound socket could grab one first.
2. **Ask which LLM provider** you'll use — Anthropic, OpenAI, or Google — so it can remind you exactly which key to set (never collects the actual key value).
3. **Ask which APC Design System theme** the web app should use — **Stockholm** (default), **Prague**, **Arctic**, **Nova**, or **Melbourne**. Preview them at **[apc-design-system.917v.dev](https://apc-design-system.917v.dev)**; change your mind later with `pnpm set-theme <name>`.
4. **Rename** the `precast` placeholder to your project name everywhere it matters.
5. **Apply the chosen ports and theme** across `.env.example`, config, pnpm scripts, Docker, and docs.
6. **Update dependencies** to their latest compatible versions.
7. **Record where this project came from** in `precast.lock.json`, then **delete Precast's git history** and re-initialize a **blank repo on the `develop` branch** with a single initial commit, hooks activated.
8. **Create `.env` from `.env.example`** and print an explicit reminder naming the exact env var to fill in.

Non-interactively, pass flags: `pnpm bootstrap my-project --llm-provider=anthropic --theme=arctic`. Ports are auto-picked unless you pin them (`--mastra-port=45000 --web-port=45001 --keycloak-port=45002`, any subset) or keep the current ones (`--ports=keep`).

### Prerequisite: a container runtime

Precast's fastest path to something you can look at is `pnpm poc`, which runs the whole stack in Docker Compose — so you need **Docker Desktop** (macOS/Windows) or **Docker Engine + the Compose plugin** (Linux) before that step.

```bash
pnpm docker:check   # is a runtime installed and running? (platform-specific fix if not)
pnpm docker:wait    # install/start Docker while this polls; exits as soon as the engine answers
```

`pnpm docker:wait` is the first-run path: start the install, leave it polling, and the build continues by itself the moment the engine is up. Every `pnpm docker:*` and `pnpm poc` command runs this preflight first, so a missing runtime shows install instructions instead of a raw daemon-socket error.

### See it run (proof of concept first)

```bash
pnpm poc            # build + start the stack, wait for health, print the URLs
```

`pnpm poc` is the "show me something" command: it checks the runtime, builds and starts the Compose stack, polls each service's health endpoint, and ends by printing the URLs that actually answer. After a change, `pnpm poc web` (or `agents`/`keycloak`) rebuilds and recreates **only** that container and re-prints the URLs — much faster, and unlike a bare `docker restart` it actually serves the new code, since code is baked into the image. Precast builds **proof of concept first** — the smallest slice that runs, put in front of a human for feedback, before the build is hardened (see [CLAUDE.md §4.0](CLAUDE.md) and the reduced PoC test bar in §4.2.1). `pnpm verify:poc` is the matching fast check (typecheck only); the full `pnpm test` / `pnpm test:e2e` bar applies once the design is settled.

Then:

```bash
# .env already exists (bootstrap created it) — just add your provider key
pnpm build && pnpm test # verify
git remote add origin <url> && git push -u origin develop
```

### Manual path

If you'd rather do it step by step:

```bash
pnpm rename my-project                 # rename placeholder only (pnpm rename ... --dry to preview)
git config core.hooksPath .githooks    # activate the doc-contract pre-commit hook
cp .env.example .env
pnpm install
pnpm build
pnpm dev                               # all apps, or: pnpm dev:agents / pnpm dev:web
```

The web app runs at `http://localhost:45001` and the Mastra agent API + Studio playground at `http://localhost:45000`. The placeholder example agent needs an LLM key to converse (build/test work without it) — set **one** provider key in `.env` and the agents auto-detect which to use: Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Groq, Cerebras, Perplexity, or a router (OpenRouter, Vercel AI Gateway). See `apps/agents/src/mastra/lib/default-model.ts` for the canonical list and each provider's default model, or set `DEFAULT_LLM_MODEL` to a `<provider>/<model>` string to pick a specific model — including from any of the 100+ other providers Mastra resolves but doesn't auto-detect.

There is a **single `.env` at the repo root** — don't create per-app `.env` files. The dev/start scripts load it (via `dotenv-cli`), Docker Compose loads it (`env_file: ../.env`), and production uses the real environment.

**Local logging.** Both dev terminals log through pino, keyed off `LOG_LEVEL` (agents via Mastra's logger, web via `apps/web/app/lib/logger.ts`). The default `info` shows info/warn/error; for the detailed firehose (every request + A2A/tool call) run the verbose variants — which force `LOG_LEVEL=debug` without editing `.env`:

```bash
pnpm dev:verbose          # all apps, verbose
pnpm dev:agents:verbose   # agents only
pnpm dev:web:verbose      # web only
```

In dev the output is pretty-printed and colorized; in production it's structured JSON. Set `LOG_LEVEL` (`fatal`→`trace`) in `.env` for finer control.

**Important:** the web app talks to Mastra agents **only over A2A** (JSON-RPC 2.0), always through its server-side `callAgent()` util — never Mastra's native REST, and never from client code. This holds with or without AgentBase; the transport is selected by `ENABLE_AGENTBASE`, and **AgentBase is the default** (guard rail — you must explicitly opt out):

- `ENABLE_AGENTBASE=1` or **unset (default)** → route A2A calls through **each agent's own AgentBase proxy URL** (`AGENTBASE_AGENT_URL_<AGENT_ID>` — copy the "Invocation Endpoint" from the agent's listing in AgentBase Studio; one env var per agent). Auth is a developer **Application** (OAuth2 `client_credentials`) — the app mints its own short-lived JWT from `AGENTBASE_CLIENT_ID`/`AGENTBASE_CLIENT_SECRET`/`AGENTBASE_TOKEN_URL`, never a pasted static token. Your Application must also be **subscribed** to each agent's listing (even your own). If AgentBase is enabled but misconfigured, the call fails loudly with a fix-it message.
- `ENABLE_AGENTBASE=0` → talk to Mastra **directly over A2A** at `POST $MASTRA_INTERNAL_URL/api/a2a/:agentId` with `Authorization: Bearer $AGENT_API_TOKEN`.

See [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md) for both flows.

Any **A2A client can also invoke the agents directly** (JSON-RPC 2.0) at `POST /api/a2a/:agentId` by sending `Authorization: Bearer <AGENT_API_TOKEN>` — the bearer must match the server's `AGENT_API_TOKEN` (routes are open when it's unset). The "route through AgentBase" rule above applies to the **web frontend**; external clients authenticate directly with the token.

**Which LLM an imported agent uses is also org-admin-configurable.** _Locally_ (and in Standalone/External mode) an agent auto-detects its model from whichever provider key is set in `.env` — see `resolveDefaultModel()` above; no single provider is hardcoded. _On AgentBase_ the model is instead set per agent from the org's onboarded models, via Studio's "LLM configuration" card — and an agent with no model set fails loudly rather than reading an env key. `apps/agents/src/mastra/lib/agentbase-model.ts`'s `resolveAgentModel()` implements this split. See [docs/INTEGRATION_AGENTBASE.md §7.9](docs/INTEGRATION_AGENTBASE.md#79-org-admin-llm-configuration-for-imported-agents).

To move ports at any time, run `pnpm set-ports --mastra=45000 --web=45001 --keycloak=45002` (any flag optional), or `pnpm set-ports --auto` to have a fresh free consecutive block picked for you — either way it rewrites `.env`, `.env.example`, config, pnpm scripts, Docker, and the port-stating docs in one pass.

To publish the Docker containers on **different host ports** (without changing the app/container ports), set `AGENTS_HOST_PORT` / `WEB_HOST_PORT` / `KEYCLOAK_HOST_PORT` in the root `.env` — e.g. `AGENTS_HOST_PORT=60000`, `WEB_HOST_PORT=60001`, `KEYCLOAK_HOST_PORT=60002` map host `60000`→`agents`, `60001`→`web`, `60002`→`keycloak`. They default to the app port (Keycloak's container port is always `8080`), and only affect `pnpm docker:up`.

**Choosing which services to build/run:** set `COMPOSE_PROFILES` in the root `.env` (Compose's own mechanism) to a comma-separated subset of `agents,web,keycloak` — default is all three. Useful once the pieces are deployed to different places, e.g. Mastra agents hosted elsewhere (an AgentBase import) but you still need this stack's Next.js web app + Keycloak running somewhere: `COMPOSE_PROFILES=web,keycloak` builds/starts only those two. If you exclude `agents`, also point the web app's transport at the real agents endpoint (`ENABLE_AGENTBASE=1` + `AGENTBASE_AGENT_URL_<AGENT_ID>`, or `MASTRA_INTERNAL_URL`) — it can no longer reach a local `agents` container.

All `pnpm docker:*` scripts route through `scripts/docker-compose.mjs`, which fails fast with a clear message if the root `.env` is missing — Compose itself does **not** read the repo-root `.env` by default when invoked with `-f docker/docker-compose.yml`, so this wrapper is what makes `AGENTS_HOST_PORT`/`COMPOSE_PROFILES`/etc. actually take effect.

The `precast` placeholder spans package scopes (`@precast/*`), Docker container names, tsconfig path aliases, and env defaults (including the Keycloak client id and the database name in your `DATABASE_URL`). Renaming rewrites only functional config — the docs keep describing the boilerplate. Afterwards, set your project's name and mission in [docs/PROGRESS.md](docs/PROGRESS.md) §1 and update this README's title.

### Run in Docker (apps + Keycloak)

```bash
pnpm poc            # recommended: docker:up + health-wait + prints the URLs
pnpm docker:up      # agents + web + Keycloak (builds app images on first run)
```

Both apps are containerized (`apps/agents/Dockerfile`, `apps/web/Dockerfile`), **multi-stage with `node:24-alpine` as both the builder and the runtime base** — one Node major (matching `.nvmrc`) across build and run, on a base small enough to rebuild on every `pnpm poc`. A test (`apps/web/test/docker-build.spec.ts`) keeps both stages pinned there. The web container reaches the API over the Docker network (`http://agents:45000`). App ports follow your `pnpm set-ports` / `pnpm bootstrap` choices.

**Redis is remote, not in Compose**, and **Postgres is never run locally either way** — point the apps at your own **remote/managed** services by setting `DATABASE_URL` and `REDIS_URL` in the root `.env` (see [.env.example](.env.example)). Managed options include Neon/Supabase/RDS (Postgres) and Upstash/Redis Cloud (Redis). `DATABASE_URL` accepts **either engine** — a managed Postgres URL, or a local SQLite file (`file:./app.db`) as a lightweight alternative to provisioning Postgres — identified from the URL's own scheme by `getDatabaseKind()` (`packages/shared/src/database.ts`); no separate "which engine" var. **Keycloak runs locally** in Compose for dev auth (admin console at `http://localhost:${KEYCLOAK_HOST_PORT:-8080}`, `admin`/`admin` by default); in production set `KEYCLOAK_TOKEN_ISSUER_URI` to a managed Keycloak instead.

### Keeping dependencies current

```bash
pnpm deps:update            # bump within semver ranges, then build + test
pnpm deps:update --dry      # preview outdated packages
pnpm deps:update --latest   # bump to latest majors (review carefully)
```

### Keeping up with Precast itself

Precast keeps improving after you scaffold from it. `precast.lock.json` records which release
this project came from, and `pnpm precast:update` pulls later improvements in — without any
shared git history, which `pnpm bootstrap` deliberately removes.

```bash
pnpm precast:version        # which Precast release this project derives from
pnpm precast:update         # check only — print the plan, write nothing
pnpm precast:update --apply # take the safe changes
```

It syncs the framework surface (`scripts/`, `.githooks/`, `docker/`, `templates/`, root
configs, `CLAUDE.md`) and leaves anything you've customized alone. Changes under `apps/` and
`packages/` are yours to port by hand — [docs/MIGRATIONS.md](docs/MIGRATIONS.md) says what
each release changed and what the sync can't do for you.

Scaffolded before this existed? Record a baseline once with
`pnpm precast:update --adopt --ref=v0.1.0`.

---

## For coding agents: how to start here

If you are an agent picking up this repo, read in this exact order **before touching code**:

1. **[CLAUDE.md](CLAUDE.md)** — project brief + non-negotiable working rules. Claude Code loads this automatically; other tools should read it first.
2. **[docs/HANDOFF.md](docs/HANDOFF.md)** — the single-page continuity checkpoint: current state, the next task, and a copy-paste resume prompt. This is the _only_ doc required before starting.
3. **[docs/PROGRESS.md](docs/PROGRESS.md)** — long-form context memory + live task tracker.
4. Then consult the authoritative docs as needed: [SPEC.md](docs/SPEC.md) (structure), [TECH_STACK.md](docs/TECH_STACK.md) (versions/ports), [STYLE_GUIDE.md](docs/STYLE_GUIDE.md), [ADRS.md](docs/ADRS.md), [SCRIPTS.md](docs/SCRIPTS.md), [TEST_CASES.md](docs/TEST_CASES.md).

**The contract:** every meaningful change updates `PROGRESS.md`; every task closure updates `HANDOFF.md §1/§2/§4` — in the _same_ commit. The pre-commit hook enforces this. This is what lets any agent hand off to any other agent without losing context.

**Authority order** when docs disagree: tech-stack facts → `TECH_STACK.md`; structure/conventions → `SPEC.md`; working rules → `CLAUDE.md`.

---

## Documentation map

| File                                       | Purpose                                 | Updated when                     |
| ------------------------------------------ | --------------------------------------- | -------------------------------- |
| [CLAUDE.md](CLAUDE.md)                     | Project brief + non-negotiable rules    | On structural changes            |
| [docs/HANDOFF.md](docs/HANDOFF.md)         | Single-page continuity checkpoint       | Every task closure               |
| [docs/PROGRESS.md](docs/PROGRESS.md)       | Long-form context memory + task tracker | Every meaningful change          |
| [docs/TECH_STACK.md](docs/TECH_STACK.md)   | Pinned versions + tech inventory        | Every tech-stack change          |
| [docs/SPEC.md](docs/SPEC.md)               | Canonical structure & conventions       | When structure changes           |
| [docs/ADRS.md](docs/ADRS.md)               | Architectural decision records          | When a decision is made          |
| [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) | Code style + naming                     | When conventions change          |
| [docs/SCRIPTS.md](docs/SCRIPTS.md)         | Operator cheatsheet for `pnpm` scripts  | When scripts change              |
| [docs/TEST_CASES.md](docs/TEST_CASES.md)   | Test catalog with traceability          | Every new build (tests + status) |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md)   | Precast release ledger + upgrade steps  | Every Precast release            |
| [docs/DESIGN_SYSTEM_APC.md](docs/DESIGN_SYSTEM_APC.md) | APC themes, tokens, re-import       | When the design source changes    |

---

## Repository structure

```
├── apps/               ← Deployable applications
│   ├── api/            ← Mastra agent API (agents, tools, Studio)
│   └── web/            ← Next.js web (App Router + Astryx)
├── packages/           ← Shared libraries
│   └── shared/         ← Shared types, env parsing, utilities
├── docker/             ← Docker Compose infra services
├── docs/               ← Authoritative documentation
├── scripts/            ← bootstrap, rename, deps:update, progress-stamp
└── templates/          ← Boilerplate templates
```

---

## Common scripts

| Command              | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `pnpm bootstrap`     | Rename + update deps + blank git repo on `develop` (new project)    |
| `pnpm rename <name>` | Replace the `precast` placeholder with your project name            |
| `pnpm deps:update`   | Update dependencies to latest compatible, then verify               |
| `pnpm dev`           | Start all apps in dev mode                                          |
| `pnpm build`         | Build all packages and apps                                         |
| `pnpm test`          | Run all unit/integration tests                                      |
| `pnpm test:e2e`      | Run autonomous Playwright UI tests                                  |
| `pnpm lint`          | Lint all packages                                                   |
| `pnpm format`        | Format all files                                                    |
| `pnpm docker:up`     | Start agents + web + Keycloak; Postgres/Redis are remote via `.env` |

Full list: [docs/SCRIPTS.md](docs/SCRIPTS.md).

---

## Branches

- **`develop`** — default branch; integration state. A bootstrapped project starts here.
- Feature branches: `feat/<description>`, `fix/<description>`, `chore/<description>`.
