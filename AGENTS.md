# AGENTS.md

Orientation for any coding agent working in this repository — Claude Code, OpenCode,
Kimi, Cursor, Aider, or a human doing it by hand.

> **The full working rules live in [CLAUDE.md](CLAUDE.md). Read it now.** Despite the
> name it is not Claude-specific: it is this project's contract, and every rule in it
> applies to whatever agent is editing. This file exists because most harnesses look
> for `AGENTS.md` and would otherwise start with no instructions at all.

Read next, in this order: **[docs/HANDOFF.md](docs/HANDOFF.md)** (where the last agent
stopped) → **[docs/PROGRESS.md](docs/PROGRESS.md)** (the long-form ledger) →
[docs/SPEC.md](docs/SPEC.md) and [docs/TECH_STACK.md](docs/TECH_STACK.md) when you need
structure or versions.

## The rules that will bite you

These are the ones enforced by tests and git hooks rather than by trust, so breaking
them fails a command rather than a review.

- **The documentation contract is enforced at commit time.** `.githooks/pre-commit`
  blocks any non-trivial change that does not also stage `docs/HANDOFF.md`,
  `docs/PROGRESS.md`, `docs/TEST_CASES.md` and `README.md`. This runs for every agent
  and every human — it is git, not a harness feature. `SKIP_DOC_CHECK=1` bypasses it
  and expects a reason in the commit message.
- **The web app talks to agents only over A2A.** Never Mastra's native REST, never from
  client code. Enforced by `apps/web/test/a2a-only.spec.ts`.
- **`apps/agents` hosts Mastra agents and their tools only.** No MCP servers, no
  hand-rolled REST. Frontend endpoints belong in `apps/web`.
- **Postgres only.** `DATABASE_URL` rejects SQLite, libsql and `file:` at boot
  ([ADR-002](docs/ADRS.md)). A managed Postgres is a precondition, not an upgrade.
- **Never `console.log` in committed code**, and validate every external boundary with
  zod.
- **Tests ship with the change**, in the same commit — see CLAUDE.md §4.2, and §4.2.1
  for the reduced bar that applies during a proof of concept.

## Commands

| | |
| --- | --- |
| `pnpm verify` | typecheck + lint + test — what CI runs, and what to run before pushing |
| `pnpm verify:all` | the above plus build and end-to-end |
| `pnpm poc` | build and start the Docker stack, wait for health, print the URLs |
| `pnpm test:e2e` | Playwright |
| `pnpm precast:update` | pull later Precast improvements (check-only by default) |

`pnpm poc` matters more than it looks: this project's workflow is proof-of-concept
first — get something running in front of the user early, then harden (CLAUDE.md §4.0).

## What is Claude-specific here, and what happens without it

`.claude/settings.json` wires three hooks that auto-journal edits into
`docs/PROGRESS.md`. Under any other harness those simply do not fire — you lose the
automatic breadcrumbs, **not** the contract, because the pre-commit hook still demands
the update. Write the PROGRESS.md entry yourself.

The `precast-plugin` skills (`/precast:scaffold`, `/precast:upgrade`) are Claude Code
plugins. The same work is available as plain commands: `pnpm bootstrap` and
`pnpm precast:update`, with the per-release manual steps in
[docs/MIGRATIONS.md](docs/MIGRATIONS.md).

Nothing else in this repository depends on a particular agent.
