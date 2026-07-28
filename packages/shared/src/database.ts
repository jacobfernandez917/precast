/**
 * DATABASE_URL is a single env var that works for either Postgres or SQLite —
 * no separate "which engine" var, and no privileged default. The engine is
 * identified from the URL's own scheme, the same way `resolveDefaultModel()`
 * (apps/agents) identifies an LLM provider from whichever key is set, rather
 * than assuming one engine.
 *
 * Recognized schemes:
 *   - `postgres:` / `postgresql:` → Postgres (Precast's remote/managed DB)
 *   - `file:` / `sqlite:`         → local SQLite file
 *   - `libsql:`                   → SQLite-compatible (e.g. Turso), the same
 *     remote option `MASTRA_DB_URL` already documents for Mastra's own store
 *
 * Note: Node's `URL` parser normalizes a relative `file:` path (e.g.
 * `file:./app.db`) to root-relative (`file:///app.db`), not cwd-relative —
 * this function only reads `.protocol`, so that quirk doesn't affect
 * detection, but any code that goes on to derive a filesystem path from the
 * URL needs to handle the path portion itself rather than trusting `.href`.
 */

export type DatabaseKind = 'postgres' | 'sqlite';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const SQLITE_PROTOCOLS = new Set(['file:', 'sqlite:', 'libsql:']);

/**
 * Identify which database engine a `DATABASE_URL` value points at, from its
 * scheme. Throws a clear, actionable error on an unrecognized scheme rather
 * than guessing.
 */
export function getDatabaseKind(databaseUrl: string): DatabaseKind {
  const { protocol } = new URL(databaseUrl);
  if (POSTGRES_PROTOCOLS.has(protocol)) return 'postgres';
  if (SQLITE_PROTOCOLS.has(protocol)) return 'sqlite';
  throw new Error(
    `Unrecognized DATABASE_URL scheme "${protocol}" — expected postgres:// or postgresql:// ` +
      `for Postgres, or file:, sqlite:, or libsql: for SQLite.`,
  );
}
