# Architectural Decision Records

> This file records key architectural decisions. When the number of ADRs exceeds ~10, split into individual files under `docs/adr/`.
>
> Record a decision here whenever you make a non-obvious architectural choice — a library, a protocol, a structural rule, a tradeoff. Keep the format below.

---

## ADR-000: <Title> (template — copy this block)

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded by ADR-XXX

**Context:** What problem or constraint forced a decision? What options were on the table?

**Decision:** What we chose, stated plainly.

**Consequences:**

- +: benefit
- -: cost / tradeoff
- Neutral: notable side effect

---

## ADR-001: `DATABASE_URL` supports Postgres or SQLite, detected from the URL scheme

**Date:** 2026-07-28
**Status:** Accepted

**Context:** Precast originally required `DATABASE_URL` to be a remote/managed
Postgres connection string — Postgres was deliberately never run locally (see
CLAUDE.md §4.5), and every doc repeated that framing (README, `.env.example`,
`packages/shared/src/env.ts`'s comment, `docker-compose.yml`'s header). That's
right for projects that need Postgres, but it forces every project — including
ones with light, single-tenant, or prototype-stage persistence needs — to
provision a managed Postgres instance before they can persist anything at all,
even in local dev. Precast already has precedent for a lightweight local
default elsewhere: `MASTRA_DB_URL` (Mastra's own agent-memory store) defaults to
a local SQLite file and only asks for Postgres/Turso when a project needs it.
`DATABASE_URL` had no equivalent lightweight path.

**Decision:** `DATABASE_URL` stays a single, required env var, but now accepts
**either** engine — a managed Postgres URL (`postgres://` / `postgresql://`) or
a local SQLite file (`file:./app.db`, `sqlite:./app.db`) — with no separate
"which engine" var and no privileged default between the two. Which engine is
in play is identified from the URL's own scheme by
`getDatabaseKind()` (`packages/shared/src/database.ts`), mirroring how
`resolveDefaultModel()` (`apps/agents/src/mastra/lib/default-model.ts`)
identifies an LLM provider from whichever key is set rather than assuming one.
Postgres itself is still never run **locally** in Docker Compose — that part
of the original decision is unchanged; local SQLite is the lightweight
alternative to provisioning a managed Postgres, not a local Postgres instance.

**Consequences:**

- +: A project that doesn't need Postgres (prototypes, single-tenant tools,
  local-first agents) can persist to a plain SQLite file with zero external
  provisioning — same ergonomics `MASTRA_DB_URL` already gives Mastra's own
  store.
- +: No new env var — `getDatabaseKind()` reads the existing `DATABASE_URL`,
  so `.env.example`, the schema, and `agentbase.import.json`'s `requiredEnv`
  entry all stay as-is.
- +: Consistent with the `capability-modules` floor-stays-minimal philosophy
  already used for the LLM provider decision (ADR-less at the time, but the
  same shape): identify from what's configured, don't force a specific vendor.
- -: Any future real DB client/ORM wiring (Drizzle, etc.) that a downstream
  project adds must branch on `getDatabaseKind()` and configure the matching
  driver — a Postgres-only assumption baked into that code would silently
  break for a SQLite-backed project. Flag this in that project's own
  `docs/PROGRESS.md` if a persistence layer is added.
- -: `new URL('file:./app.db')` normalizes to `file:///app.db` (root-relative,
  not cwd-relative) — `getDatabaseKind()` only reads `.protocol` so this
  doesn't affect detection, but any downstream code that derives a filesystem
  path from the URL needs to handle the path portion itself rather than
  trusting `.href`. Documented in `database.ts`'s own comment.
- Neutral: Redis is unaffected — `REDIS_URL` stays remote/managed-only, no
  equivalent local-file alternative was requested or added.
