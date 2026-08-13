/**
 * `DATABASE_URL` is **Postgres, always**. Provisioning a Postgres instance is a
 * precondition of bootstrapping a Precast project, not a later upgrade — so
 * there is no SQLite path, no local-file fallback, and no "which engine"
 * branch for project code to carry. See ADR-002 (which supersedes ADR-001).
 *
 * Accepted schemes: `postgres:` and `postgresql:` (the two spellings libpq
 * itself accepts; they are interchangeable).
 *
 * Precast still does **not** run Postgres in Docker Compose (CLAUDE.md §4.5) —
 * point `DATABASE_URL` at a managed instance (Neon, Supabase, RDS, Railway, …).
 * "Always Postgres" is a statement about the engine, not about where it runs.
 */

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/**
 * True when `url` is a well-formed Postgres connection URL.
 *
 * Total function: returns `false` for malformed input rather than throwing, so
 * it can be used directly as a zod `.refine()` predicate. Use
 * {@link assertPostgresUrl} when you want the actionable error message.
 */
export function isPostgresUrl(url: string): boolean {
  let protocol: string;
  try {
    ({ protocol } = new URL(url));
  } catch {
    return false;
  }
  return POSTGRES_PROTOCOLS.has(protocol);
}

/**
 * Return `url` if it is a Postgres connection URL, otherwise throw an error
 * that names what was wrong and what to do about it.
 *
 * Distinguishes "not a URL at all" from "a URL, but the wrong engine" — the
 * second case is the interesting one, because it is what a project migrating
 * off the old SQLite path hits, and the message needs to say so.
 */
export function assertPostgresUrl(url: string, varName = 'DATABASE_URL'): string {
  let protocol: string;
  try {
    ({ protocol } = new URL(url));
  } catch {
    throw new Error(
      `${varName} is not a valid URL. Expected a Postgres connection string, ` +
        `e.g. postgresql://user:password@host:5432/dbname?sslmode=require`,
    );
  }

  if (!POSTGRES_PROTOCOLS.has(protocol)) {
    throw new Error(
      `${varName} must be a Postgres URL (postgres:// or postgresql://), got "${protocol}". ` +
        `Precast is Postgres-only — SQLite and libsql are not supported (see ADR-002). ` +
        `Point ${varName} at a managed Postgres instance (Neon, Supabase, RDS, Railway, …).`,
    );
  }

  return url;
}

/**
 * The TLS options a Postgres client should use for this connection string.
 *
 * Why this exists: `sslmode` in a connection string is a **libpq** convention,
 * and node-postgres does not implement its semantics faithfully. Under libpq,
 * `sslmode=require` means *encrypt the connection, do NOT verify the server
 * certificate* — verification is what `verify-ca` and `verify-full` are for.
 * node-postgres instead enables TLS with Node's default verification, so a
 * perfectly ordinary managed instance fails to connect.
 *
 * That is not hypothetical: an AWS RDS instance whose chain Node doesn't
 * already trust dies at boot with
 * `MASTRA_STORAGE_PG_INIT_FAILED: self-signed certificate in certificate chain`
 * — despite the URL asking only for encryption. Every derived project pointed
 * at RDS (or any provider using a private CA) hits it.
 *
 * So the mapping here is libpq's, not node-postgres's:
 *
 *   disable                    → no TLS
 *   allow | prefer | require   → TLS, certificate NOT verified
 *   verify-ca | verify-full    → TLS, certificate verified
 *   (absent)                   → let the driver decide
 *
 * `require` is genuinely weaker than `verify-full`: it stops passive
 * eavesdropping but not an active man-in-the-middle. That is exactly what the
 * user asked for by writing `require`, and silently upgrading it to strict
 * verification — which is what happens today — trades a documented, chosen
 * trade-off for a boot failure. A project that wants the strong guarantee
 * should say `verify-full` and supply its provider's CA bundle.
 */
export function resolvePostgresSsl(
  url: string,
): false | { rejectUnauthorized: boolean } | undefined {
  let mode: string | null;
  try {
    mode = new URL(url).searchParams.get('sslmode');
  } catch {
    return undefined;
  }
  if (!mode) return undefined;

  switch (mode) {
    case 'disable':
      return false;
    case 'allow':
    case 'prefer':
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return undefined;
  }
}
