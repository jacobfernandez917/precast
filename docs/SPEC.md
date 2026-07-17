# Specification

**Version:** 0.1.0
**Date:** 2026-07-06
**Status:** Active

---

## 0. What This Is

This is the **base project root** for all development. It is not a template to clone — it is the actual structure every feature, service, and application lives on top of.

It provides:

- Documentation contracts ensuring zero context loss between agents
- Guardrails and automated progress tracking
- Shared libraries and type definitions
- Infrastructure configuration (Docker Compose)
- Monorepo orchestration (pnpm + Turborepo)

---

## 1. Directory Structure

```
├── CLAUDE.md                  ← Project brief (auto-read by Claude Code)
├── README.md                  ← User-facing overview
├── package.json               ← Root scripts + dependencies
├── pnpm-workspace.yaml        ← Workspace configuration
├── turbo.json                 ← Turborepo task orchestration
├── tsconfig.base.json         ← Shared TypeScript config
├── eslint.config.js           ← ESLint flat config
├── .prettierrc                ← Prettier formatting rules
├── .prettierignore            ← Formatting exclusions
├── .editorconfig              ← Editor settings
├── .nvmrc                     ← Node version pin
├── .env.example               ← Env var template (single root .env; no per-app .env)
├── .dockerignore              ← Docker build exclusions
├── .lintstagedrc.json         ← Lint-staged configuration
│
├── .claude/
│   ├── settings.json          ← Claude Code hooks (committed)
│   └── settings.local.json    ← Local overrides (gitignored)
│
├── .githooks/
│   └── pre-commit             ← Documentation contract enforcement
│
├── docs/
│   ├── HANDOFF.md             ← Continuity checkpoint (read first)
│   ├── PROGRESS.md            ← Context memory (update every session)
│   ├── SPEC.md                ← This file (canonical spec)
│   ├── TECH_STACK.md          ← Pinned versions + tech inventory
│   ├── ADRS.md                ← Architectural decision records
│   ├── STYLE_GUIDE.md         ← Code style + naming conventions
│   ├── SCRIPTS.md             ← Operator cheatsheet
│   ├── TEST_CASES.md          ← Test catalog
│   ├── plans/                 ← Live plans (create as needed)
│   └── archive/               ← Frozen, do-not-parse
│
├── apps/
│   ├── agents/                ← Mastra agents app — agents + tools ONLY (ESM)
│   │   ├── src/mastra/
│   │   │   ├── index.ts       ← Mastra instance (agents, storage, logger, server)
│   │   │   ├── agents/        ← example-agent.ts, summary-agent.ts (neutral placeholders)
│   │   │   └── tools/         ← example-tool.ts (+ .spec.ts) (neutral placeholder)
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                   ← Next.js web (App Router, Astryx; ESM)
│       ├── app/
│       │   ├── layout.tsx     ← root layout (globals.css + <Providers>)
│       │   ├── providers.tsx  ← 'use client' Astryx <Theme>
│       │   ├── page.tsx       ← landing page (server component)
│       │   ├── AgentChat.tsx  ← 'use client' agent-chat demo
│       │   ├── globals.css    ← Tailwind v4 + Astryx cascade layers
│       │   ├── lib/           ← a2a-client.ts (server-only)
│       │   └── api/           ← health/route.ts, a2a/[agentId]/route.ts
│       ├── public/            ← static assets
│       ├── test/              ← Vitest specs
│       ├── e2e/               ← Playwright UI specs
│       ├── next.config.ts     ← standalone output; webpack jsxDEV shim (prod)
│       ├── jsx-dev-runtime.shim.ts ← Astryx dev-JSX → prod jsx (prod build)
│       ├── postcss.config.mjs ← Tailwind v4 PostCSS plugin
│       ├── vitest.config.ts
│       ├── playwright.config.ts ← autonomous E2E (boots next dev)
│       ├── package.json
│       └── tsconfig.json      ← extends ../../tsconfig.base.json (+ next plugin)
│
├── packages/
│   └── shared/                ← Shared TypeScript library
│       ├── src/
│       │   ├── env.ts         ← Zod env parser
│       │   ├── types.ts       ← Shared types
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docker/
│   ├── docker-compose.yml     ← App containers (agents + web); infra is remote via .env
│   └── docker-compose.override.yml.example ← Template; copy to docker-compose.override.yml (gitignored local overrides)
│
├── scripts/
│   ├── bootstrap.mjs          ← New-project bootstrap (rename + deps + blank git)
│   ├── rename-project.mjs     ← One-shot `precast` → your-name rename
│   ├── update-deps.mjs        ← Update deps to latest compatible + verify
│   └── progress-stamp.mjs     ← Auto-journaling utility
│
├── templates/                 ← Feed-forward planning docs (PRD, DATA_MODEL,
│                                 AGENT_SPEC, DESIGN_SYSTEM) — worked examples
│
└── patches/                   ← pnpm patched dependencies
```

---

## 2. Documentation Contract

The documentation contract ensures that any coding agent can pick up work without context loss.

### 2.1 Required Files

| File                 | Purpose                                 | Updated By                         |
| -------------------- | --------------------------------------- | ---------------------------------- |
| `CLAUDE.md`          | Project brief + non-negotiable rules    | On structural changes              |
| `docs/HANDOFF.md`    | Single-page continuity checkpoint       | Every task closure                 |
| `docs/PROGRESS.md`   | Long-form context memory + task tracker | Every meaningful change            |
| `docs/TECH_STACK.md` | Pinned versions + tech inventory        | Every tech-stack change            |
| `README.md`          | User-facing overview                    | When user-facing behaviour changes |

### 2.2 Enforcement

- `.githooks/pre-commit` blocks commits that touch non-trivial files without staging updates to HANDOFF.md, PROGRESS.md, and README.md.
- Bypass with `SKIP_DOC_CHECK=1` (must explain in commit message).
- Activate once per clone: `git config core.hooksPath .githooks`.

### 2.3 Authority Order

On disagreement between docs:

1. **Tech-stack facts** → `docs/TECH_STACK.md` wins
2. **Boilerplate structure** → `docs/SPEC.md` wins
3. **Working rules** → `CLAUDE.md` wins

---

## 3. Guardrails

### 3.1 Git Hooks

- **pre-commit** (`.githooks/pre-commit`, native `core.hooksPath`): documentation contract enforcement (see §2.2), then lint-staged.
- No Husky — the hook is a plain script activated once per clone (see ADR-005).

### 3.2 Lint-Staged

- Runs ESLint + Prettier on staged files, invoked from `.githooks/pre-commit`.
- Configured in `.lintstagedrc.json`.

### 3.3 EditorConfig

- Consistent indentation (2 spaces), line endings (LF), final newlines.
- Configured in `.editorconfig`.

### 3.4 Claude Code Hooks

- **PostToolUse**: Auto-stamps PROGRESS.md journal entries on every Edit/Write.
- **Stop**: Flushes pending journal entries at session end.
- **SessionStart**: Stamps session start in journal.

---

## 4. Monorepo Conventions

### 4.1 Package Manager

- **pnpm** with workspaces.
- Workspace root: `pnpm-workspace.yaml`.
- All packages use scoped names (e.g., `@precast/agents`, `@precast/shared`). Replace `@precast/` with your project name via `pnpm rename <name>`.

### 4.2 Task Orchestration

- **Turborepo** for parallel task execution.
- Tasks: `build`, `test`, `lint`, `typecheck`, `clean`.
- Dependencies flow through the workspace graph.

### 4.3 TypeScript

- Strict mode required across all packages.
- Shared base config: `tsconfig.base.json`.
- Each app/package extends the base config.
- **ESM everywhere.** `packages/shared` is NodeNext ESM (relative imports use
  `.js` extensions); `apps/agents` (Mastra) and `apps/web` (Next.js) are ESM. See ADR-007.

### 4.4 Validation

- `zod` at all external boundaries (HTTP body, env vars, API payloads).
- Env validation in `packages/shared/src/env.ts`.
- **Single root `.env`** — the only env file in the monorepo; no per-app `.env` in `apps/*`. Dev/start scripts load it via `dotenv-cli`; Docker Compose via `env_file: ../.env`; production from the real environment.

### 4.5 Logging

- Structured logging (pino or equivalent).
- **Never** `console.log` in committed code.

---

## 5. Extending the Project

### 5.1 Adding a New App

1. Create `apps/<name>/` with its own `package.json` and `tsconfig.json`.
2. Add the workspace path to `pnpm-workspace.yaml`.
3. Add Turborepo task configuration in `turbo.json` if needed.
4. Update `docs/TECH_STACK.md` with the new app's tech.
5. Update `docs/HANDOFF.md` §4 (File map).

### 5.2 Adding a New Shared Package

1. Create `packages/<name>/` with its own `package.json` and `tsconfig.json`.
2. Add the workspace path to `pnpm-workspace.yaml`.
3. Add path alias in `tsconfig.base.json` if needed.
4. Import in apps via the workspace dependency.

---

## 6. Versioning

- Follow [SemVer](https://semver.org/).
- v0.x.y: Project in active development (breaking changes expected).
- v1.0.0: Production-ready baseline.
- Maintain a changelog in `docs/PROGRESS.md §10`.
