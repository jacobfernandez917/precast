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
**Status:** ~~Accepted~~ **Superseded by [ADR-002](#adr-002-precast-is-postgres-only)** (2026-08-07)

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

---

## ADR-002: Precast is Postgres-only

**Date:** 2026-08-07
**Status:** Accepted (supersedes ADR-001)

**Context:** ADR-001 let `DATABASE_URL` be either a managed Postgres URL or a
local SQLite file, with `getDatabaseKind()` branching on the scheme. The
reasoning was that a prototype shouldn't need to provision Postgres before it
can persist anything. In practice that optionality cost more than it saved:

- **Provisioning Postgres is already a bootstrap precondition.** It's asked for
  up front, so the SQLite path optimized away a step nobody was actually
  skipping — while still having to be supported, documented, and tested.
- **The two engines aren't interchangeable at the layer that matters.** Every
  persistence-touching thing a project adds — an ORM, migrations, a vector
  store — has to branch on `getDatabaseKind()`. ADR-001 itself listed this as a
  cost; the vector-store table in TECH_STACK.md had already grown one row per
  engine.
- **The default failed in the worst direction.** `MASTRA_DB_URL` defaulted to
  `file:./mastra.db`, and `docker-compose.yml` hardcoded
  `MASTRA_DB_URL: file:/data/mastra.db` in `environment:` — which _overrides_
  `env_file`. Agent memory therefore went to a container-local SQLite file even
  for a project that had correctly configured Postgres, and vanished on the
  next `pnpm poc agents` rebuild. A silent downgrade to a throwaway file is a
  worse failure than refusing to boot.

**Decision:** `DATABASE_URL` is **always Postgres** (`postgres://` or
`postgresql://`). SQLite, libsql, and file URLs are rejected by the env schema
at boot. `getDatabaseKind()` is replaced by `isPostgresUrl()` /
`assertPostgresUrl()` in `packages/shared/src/database.ts` — validation, not
engine detection, because there is no longer anything to detect.

Mastra's own store moves from `@mastra/libsql` to `@mastra/pg`.
`MASTRA_DB_URL` becomes an **optional** Postgres URL that falls back to
`DATABASE_URL` (`resolveMastraDbUrl()`), so a project still needs exactly one
provisioned Postgres to boot; Mastra's tables are namespaced into their own
schema (`MASTRA_DB_SCHEMA`, default `mastra`) so they can safely share it.

Unchanged from ADR-001: Postgres is still **never run in Docker Compose**
(CLAUDE.md §4.5). "Always Postgres" is a statement about the engine, not about
where it runs — point `DATABASE_URL` at a managed instance.

**Consequences:**

- +: One engine to support. No `getDatabaseKind()` branch in any ORM,
  migration, or vector-store wiring a project adds later.
- +: Agent memory is durable by default. The `agents` container is now
  stateless (its `agents-data` volume is gone), so rebuilds no longer discard
  conversation history.
- +: A misconfigured `DATABASE_URL` fails loudly at boot with a message naming
  the offending scheme, instead of silently writing to a local file.
- +: `pgvector` becomes the single vector-store answer, replacing the
  per-engine `pgvector`/`sqlite-vec` split.
- -: No zero-provisioning path. A throwaway prototype must still point at a
  Postgres instance — mitigated by free managed tiers (Neon, Supabase), but it
  is a real step that ADR-001 removed and this restores.
- -: Requires `@mastra/core >= 1.53` (the oldest `@mastra/pg` peer range), so
  this decision carried a Mastra family bump from 1.49 → 1.57 with it.
- -: Existing projects on a SQLite `DATABASE_URL` will fail env validation
  after upgrading. That is intentional and the error explains the fix; the
  migration is recorded in [MIGRATIONS.md](MIGRATIONS.md).
- Neutral: Redis is unaffected — `REDIS_URL` stays remote/managed-only.
