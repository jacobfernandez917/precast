# Precast

**A precast foundation for new TypeScript projects.** Start from it — rename the placeholder to your project, and build — with the monorepo structure, guardrails, and agent-handoff documentation already in place.

Precast is built to be driven by coding agents (Claude Code, OpenClaw, or any other) as much as by humans. Everything an agent needs to take over work without context loss lives in a small chain of documents, described below.

---

## What you get

- **Monorepo structure** — pnpm workspaces + Turborepo (`apps/*` deployables, `packages/*` shared libs).
- **Documentation contract** — a `CLAUDE.md → HANDOFF.md → PROGRESS.md → authoritative docs` chain that keeps context flowing between sessions and agents.
- **Guardrails** — pre-commit doc-contract enforcement, lint-staged, EditorConfig, zod-based env validation.
- **Progress automation** — Claude Code hooks auto-journal every edit into `PROGRESS.md`.
- **Neutral runnable starters** — a **Mastra** agent API (a placeholder example agent + tool + durable memory, served with a Studio playground) and a **Next.js** web app (App Router, styled with the **Astryx** design system) on a shared TypeScript package, plus a full Docker Compose stack — both apps containerized (multi-stage images) alongside Postgres, Redis, and Keycloak. They carry no domain — just enough to prove the wiring, build, type-check, lint, and test green out of the box. You build the real structure from the feed-forward docs + tech stack.
- **Feed-forward planning templates** — PRD, data model, agent spec, and an Astryx design system guide in `templates/`, each a worked example you copy into `docs/` and fill in before building.

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

1. **Ask for the project name**, then the **Mastra API and Next web ports** (press Enter to keep the defaults, `4111` / `3000`).
2. **Rename** the `precast` placeholder to your project name everywhere it matters.
3. **Apply the chosen ports** across `.env.example`, config, pnpm scripts, Docker, and docs.
4. **Update dependencies** to their latest compatible versions.
5. **Delete Precast's git history** and re-initialize a **blank repo on the `develop` branch** with a single initial commit, hooks activated.

Non-interactively, pass ports as flags: `pnpm bootstrap my-project --mastra-port=4200 --web-port=3100`.

Then:

```bash
cp .env.example .env    # edit with your values
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
pnpm dev                               # all apps, or: pnpm dev:api / pnpm dev:web
```

The web app runs at `http://localhost:3000` and the Mastra agent API + Studio playground at `http://localhost:4111`. The placeholder example agent needs an LLM key — set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env` to converse (build/test work without it).

**Important:** All Next ↔ Mastra communication routes through the **AgentBase A2A proxy** — never call Mastra directly from the frontend. AgentBase handles auth, audit, and zero-trust forwarding. Set `AGENTBASE_URL`, `AGENTBASE_TOKEN` (Next → AgentBase), and `AGENT_API_TOKEN` (AgentBase → Mastra) in your `.env`. See [docs/INTEGRATION_AGENTBASE.md](docs/INTEGRATION_AGENTBASE.md) for the full auth flow.

To move to non-default ports at any time, run `pnpm set-ports --mastra=4200 --web=3100` (either flag optional) — it rewrites env, config, pnpm scripts, Docker, and the port-stating docs in one pass.

The `precast` placeholder spans package scopes (`@precast/*`), the Postgres database, the Keycloak realm/client, Docker container names, tsconfig path aliases, and env defaults. Renaming rewrites only functional config — the docs keep describing the boilerplate. Afterwards, set your project's name and mission in [docs/PROGRESS.md](docs/PROGRESS.md) §1 and update this README's title.

### Run in Docker (full stack)

```bash
pnpm docker:up      # api + web + Postgres + Redis + Keycloak (builds app images on first run)
```

Both apps are containerized (`apps/api/Dockerfile`, `apps/web/Dockerfile`, multi-stage on `node:24-alpine`). The web container reaches the API over the Docker network (`http://api:4111`). App ports follow your `pnpm set-ports` / `pnpm bootstrap` choices. To run only infra, target those services: `pnpm docker:up postgres redis keycloak`.

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

| File                                       | Purpose                                 | Updated when            |
| ------------------------------------------ | --------------------------------------- | ----------------------- |
| [CLAUDE.md](CLAUDE.md)                     | Project brief + non-negotiable rules    | On structural changes   |
| [docs/HANDOFF.md](docs/HANDOFF.md)         | Single-page continuity checkpoint       | Every task closure      |
| [docs/PROGRESS.md](docs/PROGRESS.md)       | Long-form context memory + task tracker | Every meaningful change |
| [docs/TECH_STACK.md](docs/TECH_STACK.md)   | Pinned versions + tech inventory        | Every tech-stack change |
| [docs/SPEC.md](docs/SPEC.md)               | Canonical structure & conventions       | When structure changes  |
| [docs/ADRS.md](docs/ADRS.md)               | Architectural decision records          | When a decision is made |
| [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) | Code style + naming                     | When conventions change |
| [docs/SCRIPTS.md](docs/SCRIPTS.md)         | Operator cheatsheet for `pnpm` scripts  | When scripts change     |
| [docs/TEST_CASES.md](docs/TEST_CASES.md)   | Test catalog with traceability          | When tests change       |

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

| Command              | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `pnpm bootstrap`     | Rename + update deps + blank git repo on `develop` (new project) |
| `pnpm rename <name>` | Replace the `precast` placeholder with your project name         |
| `pnpm deps:update`   | Update dependencies to latest compatible, then verify            |
| `pnpm dev`           | Start all apps in dev mode                                       |
| `pnpm build`         | Build all packages and apps                                      |
| `pnpm test`          | Run all unit/integration tests                                   |
| `pnpm test:e2e`      | Run autonomous Playwright UI tests                               |
| `pnpm lint`          | Lint all packages                                                |
| `pnpm format`        | Format all files                                                 |
| `pnpm docker:up`     | Start infra services (Postgres, Redis, Keycloak)                 |

Full list: [docs/SCRIPTS.md](docs/SCRIPTS.md).

---

## Branches

- **`develop`** — default branch; integration state. A bootstrapped project starts here.
- Feature branches: `feat/<description>`, `fix/<description>`, `chore/<description>`.
