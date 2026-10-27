# Precast

**The kit for building agents on AgentBase.** A Precast project is a TypeScript monorepo with a Mastra agents app, a Next.js web app on the APC Design System, a Postgres database provisioned for it, and a documentation contract that lets any coding agent pick the work up without losing context. It runs on AgentBase: the organisation's gateway supplies the model, the proxy carries every call, and AgentBase hosts the agents once they are imported.

Most people drive it from Claude Code with the Precast plugin and never type a command: the five phrases below each map to one skill. Engineers get the same five things as `pnpm` scripts. Either way, when something fails the answer is one line with the fix, not a stack trace.

---

## What you can say

| Say                                    | What happens                                                                                                                                           | Skill      | Command               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| "start a project" (or hand over a PRD) | Eight questions in three waves, the scaffold, a Postgres database, and the first screen or agent running in front of you                               | `scaffold` | `pnpm bootstrap`      |
| "show it to me"                        | The stack is built and started; you get the real `http://localhost:<port>` and what to click                                                           | `show`     | `pnpm poc`            |
| "connect my AgentBase"                 | Where to find your Application's details in Studio; the secret typed in your own terminal; the connection proven before it is saved                    | `connect`  | `pnpm connect`        |
| "put it on AgentBase"                  | Pushed to GitHub, imported so AgentBase builds and hosts the agents, your Application subscribed, the web app switched over, one chat turn to prove it | `deploy`   | a Studio walkthrough  |
| "update it"                            | Later Precast improvements pulled into the project, manual steps included                                                                              | `upgrade`  | `pnpm precast:update` |

The plugin lives at [precast-plugin](https://github.com/jacobfernandez917/precast-plugin): `/plugin marketplace add jacobfernandez917/precast-plugin`, then `/plugin install precast@917v`.

---

## What you get

- **Monorepo structure** — pnpm workspaces + Turborepo (`apps/*` deployables, `packages/*` shared libs).
- **Documentation contract** — a `CLAUDE.md → HANDOFF.md → PROGRESS.md → authoritative docs` chain that keeps context flowing between sessions and agents.
- **Guardrails** — pre-commit doc-contract enforcement, lint-staged, EditorConfig, zod-based env validation, and fitness tests (A2A-only web→agents, rename-proof Docker builds). Both apps' `dev` scripts build `@precast/shared` and `@precast/a2ui` first, so a fresh scaffold's first `pnpm dev` never trips a missing-`dist` error.
- **Progress automation** — Claude Code hooks auto-journal every edit into `PROGRESS.md`.
- **Neutral runnable starters** — a **Mastra** agent API (a placeholder example agent + tool + durable memory, served with a Studio playground) and a **Next.js** web app (App Router, **Astryx** components coloured by the **APC Design System**) on a shared TypeScript package, plus sign-in inside the web app and `pnpm poc` to run both on your computer with Node alone, while **Postgres and Redis** are used as **remote/managed** services via `.env`. They carry no domain — just enough to prove the wiring, build, type-check, lint, and test green out of the box. You build the real structure from the feed-forward docs + tech stack.
- **Feed-forward planning templates** — PRD, data model, agent spec, and a design system guide in `templates/`, each a worked example you copy into `docs/` and fill in before building.
- **PRD-driven scaffolding** — already have a PRD? Hand it to your coding agent ("scaffold from this PRD") and it expands the PRD into the feed-forward docs and stubs the agents/UI, asking about anything vague. Drop the PRD at `docs/PRD.md`. (Delivered via the Precast scaffold skill; see `templates/PRD.md` for the shape — a loose PRD works too.)
- **Mocks for missing dependencies** — when an external REST API, MCP server, or A2A agent is referenced but you haven't supplied the real one, the scaffold generates a **standards-conforming mock** (real service interface, realistic payloads, swappable by config) so the MVP runs end-to-end. Real config in `.env` → the real dependency is used instead. Never mocks over something you provided.
- **Hosted on AgentBase, chosen up front** — the scaffold asks how the project will run and wires it accordingly: **Imported** (AgentBase imports the repository and hosts it, the default) or **External** (you host the agents and register their address; AgentBase proxies to them). There is no mode without AgentBase. This keeps or drops `agentbase.import.json` and points at the right onboarding path — see [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md).
- Telemetry reaches AgentBase without setup when it hosts the agents: traces (continuing the proxy's trace through every crew hop), memory and CPU metrics, and one log record per call, on the agent's Telemetry page. A self-hosted project sets two variables with a key from Studio. Prompts, completions and credentials never leave the container.
- **Five APC Design System themes, chosen at scaffold time** — **Stockholm**, **Prague**, **Arctic**, **Nova**, **Melbourne**, previewable at **[apc-design-system.917v.dev](https://apc-design-system.917v.dev)**. They layer onto Astryx as token overrides (light + dark per theme), so switching is `pnpm set-theme <name>` rather than a UI rewrite. See [docs/DESIGN_SYSTEM_APC.md](docs/DESIGN_SYSTEM_APC.md).
- **Designs the UI when you don't** — no mockups? The scaffold builds a clean, modern, responsive interface from **Astryx** components on APC tokens, with real human-facing copy (no internal jargon or placeholders) and realistic mock data so screens look real out of the box. Provide a design and it follows yours instead.

See [docs/TECH_STACK.md](docs/TECH_STACK.md) for the pinned versions of everything.

---

---

## Getting started, in that order

### 1. Connect my AgentBase

You need the current Node LTS with pnpm (`.nvmrc` says `lts/*`; `nvm install` picks it up) and an AgentBase **Application**. Nothing else runs on your computer: no Docker, no database. The Application is how a project gets its model, reaches tools and is hosted; four values identify it, and they are all in AgentBase Studio: open **Applications**, create one named after the project (or open one you already use), and on its **Credentials** tab take the **Client ID**, **Copy secret** for the secret, and **Copy snippet** for the token URL (the first line of the snippet, ending in `/protocol/openid-connect/token`). The fourth is the **API base URL** of AgentBase itself, which your admin has.

A new project asks for these at `pnpm bootstrap` (step 2). An existing project takes them with:

```bash
pnpm connect            # asks for whatever .env is missing; the secret is typed hidden
pnpm connect --check    # prove what .env already holds; writes nothing
```

`connect` mints a token with the id and secret, lists the models published to the Application, checks the chosen one is among them, and only then writes `.env`. Leave the model off the first run and it prints the list to choose from. Models come from the organisation's AgentBase gateway; no vendor API key is held anywhere in a project.

### 2. Start a project

Precast is a launch pad for **new, independent projects**. Clone it, then run `pnpm bootstrap` — which wipes the inherited history and re-inits a blank repo, making the copy yours.

```bash
git clone <precast-url> my-project
cd my-project
```

One command turns Precast into your project:

```bash
pnpm install        # so the script can run
pnpm bootstrap      # interactive, or: pnpm bootstrap my-project
```

`bootstrap` (see [scripts/bootstrap.mjs](scripts/bootstrap.mjs)) will:

1. **Ask for the project name**, then show an **auto-picked port pair** for the two apps: a random, verified-free, **consecutive** pair in `45000`–`49100` (agents / web, e.g. `45000` / `45001`). Press Enter to accept, or type a base port for the block. Random-and-free means two Precast projects on one machine never fight over `3000`/`4111`; staying under `49152` keeps the ports out of the OS ephemeral range, where an outbound socket could grab one first.
2. **Ask where the model comes from**: your AgentBase Application (API base URL, token URL, client id, and the secret typed hidden) plus the model slug, the same values `pnpm connect` takes later. No vendor key is ever asked for.
3. **Ask which APC Design System theme** the web app should use — **Stockholm** (default), **Prague**, **Arctic**, **Nova**, or **Melbourne**. Preview them at **[apc-design-system.917v.dev](https://apc-design-system.917v.dev)**; change your mind later with `pnpm set-theme <name>`.
4. **Ask where the Postgres database comes from**: have the database agent on AgentBase create one now (`--db=provision`; it asks through the project's AgentBase Application, so you need no database credential, and writes `DATABASE_URL` only after the new database answers), paste a URL you already have (`--db=postgresql://…`), or decide later (`--db=later`, then `pnpm db:provision` any time).
5. **Rename** the `precast` placeholder to your project name everywhere it matters.
6. **Apply the chosen ports and theme** across `.env.example`, config, pnpm scripts, the Dockerfiles, and docs.
7. **Update dependencies** to their latest compatible versions.
8. **Record where this project came from** in `precast.lock.json`, then **delete Precast's git history** and re-initialize a **blank repo on the `develop` branch** with a single initial commit, hooks activated.
9. **Create `.env` from `.env.example`** with everything you answered, and say what is still missing.

Non-interactively, pass flags: `pnpm bootstrap my-project --llm-provider=agentbase --agentbase-url=… --agentbase-token-url=… --agentbase-client-id=… --agentbase-client-secret=… --agentbase-model=<slug> --db=<postgresql://…> --theme=arctic`. Ports are auto-picked unless you pin them (`--mastra-port=45000 --web-port=45001`, either one) or keep the current ones (`--ports=keep`).

### 3. Show it to me

Precast's fastest path to something you can look at is `pnpm poc`. It needs nothing beyond Node and pnpm.

```bash
pnpm poc            # build both apps, start them, wait for health and sign-in, print the URLs
pnpm poc web        # after a change: rebuild and restart only the web app (or agents)
pnpm logs           # what each app wrote last (pnpm logs web for one)
pnpm stop           # stop both
```

`pnpm poc` is the "show me something" command. It checks Node (24 or newer), fills in any missing local secret, stops early if `DATABASE_URL` is still the placeholder, then builds the same production bundles the Dockerfiles build (the Mastra output and Next's standalone server) and starts them as two background Node processes on `127.0.0.1`. It waits for each health endpoint and for sign-in, and ends by printing the URLs that answer; a failure prints that app's last log lines instead. A running app keeps serving the build it started with, so after a change `pnpm poc web` (or `agents`) rebuilds that app and replaces only its process. Process ids and logs are kept in `.precast/run/`, which git ignores. Precast builds **proof of concept first** — the smallest slice that runs, put in front of a human for feedback, before the build is hardened (see [CLAUDE.md §4.0](CLAUDE.md) and the reduced PoC test bar in §4.2.1). `pnpm verify:poc` is the matching fast check (typecheck only); the full `pnpm test` / `pnpm test:e2e` bar applies once the design is settled.

Two checks once it is up: `pnpm verify:poc` (typecheck) and `pnpm smoke:chat`, one chat turn through the running agents to the organisation's gateway and back.

### 4. Put it on AgentBase

AgentBase clones the repository, builds `apps/agents`, hosts the container and lists each agent in the registry; nothing to operate. First the project has to be on GitHub:

```bash
pnpm verify                                                        # what CI runs
gh repo create <project-name> --private --source=. --remote=origin --push
```

Then, in Studio: a **Variables** namespace for the project with `DATABASE_URL` set in the Production environment (the hosted container does not read your `.env`); **Agents → Import from Repo** with the GitHub App installed on the repository; once the build finishes, subscribe your Application to the new listing. Finally switch the local web app to the hosted agents in `.env`:

```
PRECAST_LOCAL_AGENTS=0
```

and `pnpm poc` again (it now starts only the web app; `pnpm poc agents` still runs the local copy for Studio); the chat label changes from "direct A2A" to "via AgentBase proxy". A new commit is not deployed on its own: push, then **Pull latest & redeploy** on the agent's page. Every step, including the "you host it" alternative, is in [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md) §4.

### 5. Update it

Precast keeps improving after you scaffold from it. `precast.lock.json` records which release
this project came from, and `pnpm precast:update` pulls later improvements in — without any
shared git history, which `pnpm bootstrap` deliberately removes.

```bash
pnpm precast:version        # which Precast release this project derives from
pnpm precast:update         # check only — print the plan, write nothing
pnpm precast:update --apply # take the safe changes
```

It syncs the framework surface (`scripts/`, `.githooks/`, `templates/`, root
configs, `CLAUDE.md`) and leaves anything you've customized alone. Changes under `apps/` and
`packages/` are yours to port by hand — [docs/MIGRATIONS.md](docs/MIGRATIONS.md) says what
each release changed and what the sync can't do for you.

Scaffolded before this existed? Record a baseline once with
`pnpm precast:update --adopt --ref=v0.2.0`.

---

## When something fails

Every script ends a failure with one line after `❌` (or `✖`) that says what happened and what to do next: which command to run, or where in Studio to look. The full error is there when you ask for it with `PRECAST_DEBUG=1`. The plugin's skills quote that line and never answer with a stack trace.

---

## Working on the code

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

The web app runs at `http://localhost:45001` and the Mastra agent API + Studio playground at `http://localhost:45000`. The placeholder example agent needs a model to converse (build/test work without one): models come from your organisation's AgentBase LLM gateway, so set `AGENTBASE_LLM_MODEL` (a slug from `agentbase.list_models`) plus the Application credentials (`AGENTBASE_URL`, `AGENTBASE_TOKEN_URL`, `AGENTBASE_CLIENT_ID`, `AGENTBASE_CLIENT_SECRET`) in `.env`, or answer the bootstrap prompt. No vendor API key is read anywhere; AgentBase holds the provider keys.

There is a **single `.env` at the repo root** — don't create per-app `.env` files. The dev/start scripts load it (via `dotenv-cli`), `pnpm poc` reads it and passes it to both apps, and production uses the real environment.

**Local logging.** Both dev terminals log through pino, keyed off `LOG_LEVEL` (agents via Mastra's logger, web via `apps/web/app/lib/logger.ts`). The default `info` shows info/warn/error; for the detailed firehose (every request + A2A/tool call) run the verbose variants — which force `LOG_LEVEL=debug` without editing `.env`:

```bash
pnpm dev:verbose          # all apps, verbose
pnpm dev:agents:verbose   # agents only
pnpm dev:web:verbose      # web only
```

In dev the output is pretty-printed and colorized; in production it's structured JSON. Set `LOG_LEVEL` (`fatal`→`trace`) in `.env` for finer control.

**Important:** the web app talks to Mastra agents **only over A2A** (JSON-RPC 2.0), always through its server-side `callAgent()` util — never Mastra's native REST, and never from client code. Calls go through the AgentBase proxy, with one development switch:

- `PRECAST_LOCAL_AGENTS` **unset or `0` (default)** → route A2A calls through **each agent's own AgentBase proxy URL**, discovered at runtime from the Application's subscriptions. Auth is a developer **Application** (OAuth2 `client_credentials`) — the app mints its own short-lived JWT from `AGENTBASE_CLIENT_ID`/`AGENTBASE_CLIENT_SECRET`/`AGENTBASE_TOKEN_URL`, never a pasted static token. Your Application must be **subscribed** to each agent's listing (even your own). If AgentBase is misconfigured, the call fails loudly with a fix-it message.
- `PRECAST_LOCAL_AGENTS=1` → call the **local agents app directly over A2A** at `POST $MASTRA_INTERNAL_URL/api/a2a/:agentId` with `Authorization: Bearer $AGENT_API_TOKEN`. For a project that is not yet imported; `.env.example` ships it set, and `pnpm poc` points `MASTRA_INTERNAL_URL` at the local agents port. (`ENABLE_AGENTBASE=0`, the pre-v0.10.0 spelling, is still read for one release.)

See [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md) for both flows.

Any **A2A client can also invoke the agents directly** (JSON-RPC 2.0) at `POST /api/a2a/:agentId` by sending `Authorization: Bearer <AGENT_API_TOKEN>` — the bearer must match the server's `AGENT_API_TOKEN` (routes are open when it's unset). The "route through AgentBase" rule above applies to the **web frontend**; external clients authenticate directly with the token.

**Interactive cards (A2UI).** An agent with the `show_card` tool can attach one card to a reply: a title, text, label and value fields, up to five buttons and a dropdown, sent as an A2UI v0.9.1 surface in the `raya.blocks.v1` catalog that Raya and AgentBase also use. The web app draws it under the reply with `@a2ui/react` on Astryx, and a press goes back to the agent as text on the same conversation. The example agent ships with cards on; see [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md) §7.12.

**Models come from the organisation's AgentBase gateway.** No vendor key is held anywhere in a project. Locally an agent uses `AGENTBASE_LLM_MODEL` with the Application credentials in `.env` (`pnpm bootstrap --llm-provider=agentbase` collects them; `agentbase.list_models` is the catalogue). Once imported, an org admin sets the model per agent from Studio's "LLM configuration" card, and that choice wins; an imported agent with no model set fails at call time until one is chosen. See [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md) §7.9.

**Orchestrator crew.** Declare your agents in `apps/agents/src/mastra/crew.ts` (the single source of truth) via `defineCrew({ members: [...] })`. With two or more members you automatically get a `crew-orchestrator` — a single point of contact that routes to the right specialist **in-process** (Mastra Agent Network); each member still serves its own A2A card and is independently invocable, and a single-member project pays no orchestrator hop. On import, `agentbase.import.json`'s `orchestration` block (emitted by `pnpm emit:import-manifest`) lets AgentBase offer **full crew** (register every agent) or **orchestrator only** (register just the front door; members stay internal). See [docs/plans/orchestrator-crew-plan.md](docs/plans/orchestrator-crew-plan.md).

To move ports at any time, run `pnpm set-ports --mastra=45000 --web=45001` (either flag optional), or `pnpm set-ports --auto` to have a fresh free consecutive pair picked for you. Either way it rewrites `.env`, `.env.example`, config, pnpm scripts, the Dockerfiles, and the port-stating docs in one pass. `pnpm poc` starts the agents on `MASTRA_PORT` and the web app on `WEB_PORT`.

**Choosing which apps run:** `pnpm poc` follows `PRECAST_LOCAL_AGENTS`. With `1` (a project not yet imported) it runs both apps; with `0` (AgentBase hosts the agents) it runs only the web app, which then goes through the AgentBase proxy. `pnpm poc agents` starts the local agents either way, for Mastra Studio.

The `precast` placeholder spans the project name its database schemas are derived from, image tags, tsconfig path aliases, and env defaults (the `@precast/*` workspace scope stays as it is). Renaming rewrites only functional config — the docs keep describing the boilerplate. Afterwards, set your project's name and mission in [docs/PROGRESS.md](docs/PROGRESS.md) §1 and update this README's title.

### The Dockerfiles

`pnpm poc` never builds an image; the Dockerfiles are for AgentBase, which builds the agents image from `apps/agents/Dockerfile` when it imports the project, and for CI, whose `images` job builds both on every push so a broken Dockerfile shows up before an import. Both are **multi-stage with `node:lts-alpine` as both the builder and the runtime base**: the current Node LTS (matching `.nvmrc`'s `lts/*`) across build and run. A test (`apps/web/test/docker-build.spec.ts`) keeps both stages on that tag.

**Redis and Postgres are remote**, never run on your computer: point the apps at your own **remote/managed** services by setting `DATABASE_URL` and `REDIS_URL` in the root `.env` (see [.env.example](.env.example)), or let `pnpm db:provision` create the database. `DATABASE_URL` is **always Postgres** (`postgres://` / `postgresql://`) — SQLite and file URLs are rejected at boot by `isPostgresUrl()` (`packages/shared/src/database.ts`), so nothing silently degrades to a throwaway local file (see [ADR-002](docs/ADRS.md)). Agent memory shares that database by default: `MASTRA_DB_URL` is optional and falls back to `DATABASE_URL`, with Mastra's tables in a schema named after the project (`<project>_agents`, override with `MASTRA_DB_SCHEMA`) and sign-in's in `<project>_auth`. **Sign-in** runs inside the web app (Better Auth, email and password); set `OIDC_ISSUER_URI`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` to also offer an organisation's own sign-in.

### Keeping dependencies current

```bash
pnpm deps:update            # bump within semver ranges, then build + test
pnpm deps:update --dry      # preview outdated packages
pnpm deps:update --latest   # bump to latest majors (review carefully)
```

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

| File                                                   | Purpose                                 | Updated when                     |
| ------------------------------------------------------ | --------------------------------------- | -------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                 | Project brief + non-negotiable rules    | On structural changes            |
| [docs/HANDOFF.md](docs/HANDOFF.md)                     | Single-page continuity checkpoint       | Every task closure               |
| [docs/PROGRESS.md](docs/PROGRESS.md)                   | Long-form context memory + task tracker | Every meaningful change          |
| [docs/TECH_STACK.md](docs/TECH_STACK.md)               | Pinned versions + tech inventory        | Every tech-stack change          |
| [docs/SPEC.md](docs/SPEC.md)                           | Canonical structure & conventions       | When structure changes           |
| [docs/ADRS.md](docs/ADRS.md)                           | Architectural decision records          | When a decision is made          |
| [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)             | Code style + naming                     | When conventions change          |
| [docs/SCRIPTS.md](docs/SCRIPTS.md)                     | Operator cheatsheet for `pnpm` scripts  | When scripts change              |
| [docs/TEST_CASES.md](docs/TEST_CASES.md)               | Test catalog with traceability          | Every new build (tests + status) |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md)               | Precast release ledger + upgrade steps  | Every Precast release            |
| [docs/DESIGN_SYSTEM_APC.md](docs/DESIGN_SYSTEM_APC.md) | APC themes, tokens, re-import           | When the design source changes   |

---

## Repository structure

```
├── apps/               ← Deployable applications
│   ├── agents/         ← Mastra agents and their tools (Studio)
│   └── web/            ← Next.js web (App Router + Astryx)
├── packages/           ← Shared libraries
│   ├── shared/         ← Shared types, env parsing, utilities
│   └── a2ui/           ← Interactive cards: protocol, show_card, A2A parts
├── docs/               ← Authoritative documentation
├── scripts/            ← bootstrap, connect, provision-db, poc, precast-update, …
└── templates/          ← Boilerplate templates
```

---

## Common scripts

| Command              | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `pnpm bootstrap`     | Rename + update deps + blank git repo on `develop` (new project)             |
| `pnpm connect`       | Prove and save the AgentBase Application and model (`--check` only verifies) |
| `pnpm db:provision`  | Create a Postgres database for this project and write `DATABASE_URL`         |
| `pnpm poc`           | Build both apps, start them on this computer, wait for health, print URLs    |
| `pnpm stop`          | Stop the apps `pnpm poc` started (`pnpm logs` shows what they wrote)         |
| `pnpm rename <name>` | Replace the `precast` placeholder with your project name                     |
| `pnpm deps:update`   | Update dependencies to latest compatible, then verify                        |
| `pnpm dev`           | Start all apps in dev mode                                                   |
| `pnpm build`         | Build all packages and apps                                                  |
| `pnpm test`          | Run all unit/integration tests                                               |
| `pnpm test:e2e`      | Run autonomous Playwright UI tests                                           |
| `pnpm lint`          | Lint all packages                                                            |
| `pnpm format`        | Format all files                                                             |

Full list: [docs/SCRIPTS.md](docs/SCRIPTS.md).

---

## Branches

- **`develop`** — default branch; integration state. A bootstrapped project starts here.
- Feature branches: `feat/<description>`, `fix/<description>`, `chore/<description>`.
