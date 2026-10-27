import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { projectSchema, resolvePostgresSsl } from '@precast/shared';
import { log } from './logger';

/**
 * Sign-in for the web app, with Better Auth running inside it. Users, sessions
 * and accounts live in the project's own Postgres (`DATABASE_URL`, which every
 * Precast project has), in a schema of their own beside Mastra's, so there is no
 * identity container to run and no vendor account to create.
 *
 * Email and password work out of the box. When OIDC_ISSUER_URI and
 * OIDC_CLIENT_ID are set, people can also sign in with that identity provider
 * (any OIDC issuer: a company's single sign-on, a hosted login service), through
 * Better Auth's generic OAuth plugin with the issuer's discovery document.
 *
 * Created on first use rather than at import: `next build` imports this module
 * with no database and no secret, and Better Auth refuses to start without a
 * secret in production.
 */

/** Sign-in tables live in `<project>_auth`, so two projects on one database never share accounts. */
export const AUTH_DB_SCHEMA = projectSchema('auth');

export type SignInStatus =
  'ready' | 'missing-secret' | 'missing-database' | 'database-error' | 'starting';

/**
 * Whether the tables were prepared at startup. Kept on `globalThis`: Next
 * bundles instrumentation.ts separately from the route handlers, so a module
 * variable set there would never be seen by /api/health.
 */
const TABLES = Symbol.for('precast.web.authTablesReady');
type TablesHolder = { [TABLES]?: boolean };
const tables = {
  get: () => (globalThis as TablesHolder)[TABLES],
  set: (ready: boolean) => {
    (globalThis as TablesHolder)[TABLES] = ready;
  },
};

/** Whether sign-in can work right now; the reason is a code, never the detail. */
export function signInStatus(): SignInStatus {
  if (!read('BETTER_AUTH_SECRET')) return 'missing-secret';
  if (!read('DATABASE_URL')) return 'missing-database';
  if (tables.get() === false) return 'database-error';
  return tables.get() ? 'ready' : 'starting';
}
export const OIDC_PROVIDER_ID = 'oidc';

const read = (key: string): string | undefined => process.env[key]?.trim() || undefined;

/** True when people can also sign in with an external OIDC identity provider. */
export function isOidcConfigured(): boolean {
  return Boolean(read('OIDC_ISSUER_URI') && read('OIDC_CLIENT_ID'));
}

let pool: Pool | undefined;

/**
 * node-postgres lets the URL's own `sslmode` override an explicit `ssl` option,
 * and treats `require` as full certificate verification, which fails on a
 * managed Postgres with a private CA. So when `resolvePostgresSsl` decides, the
 * URL's `sslmode` is dropped and that decision is the only source (the same rule
 * as scripts/provision-db.mjs).
 */
export function poolConfig(connectionString: string | undefined) {
  if (!connectionString) return { connectionString };
  const ssl = resolvePostgresSsl(connectionString);
  if (ssl === undefined) return { connectionString };
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl };
}

function authPool(): Pool {
  pool ??= new Pool({ ...poolConfig(read('DATABASE_URL')), max: 5 });
  return pool;
}

function authOptions(): BetterAuthOptions {
  const issuer = read('OIDC_ISSUER_URI');
  const clientId = read('OIDC_CLIENT_ID');
  return {
    secret: read('BETTER_AUTH_SECRET'),
    baseURL: read('BETTER_AUTH_URL'),
    database: {
      dialect: new PostgresDialect({ pool: authPool() }),
      type: 'postgres',
      schemaName: AUTH_DB_SCHEMA,
    },
    emailAndPassword: { enabled: true },
    // Explicit so it is on everywhere, not only where NODE_ENV says production:
    // sign-in and sign-up are the endpoints worth guessing at.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    advanced: { database: { generateId: 'uuid' } },
    plugins: [
      ...(issuer && clientId
        ? [
            genericOAuth({
              config: [
                {
                  providerId: OIDC_PROVIDER_ID,
                  discoveryUrl: `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
                  clientId,
                  clientSecret: read('OIDC_CLIENT_SECRET'),
                  scopes: ['openid', 'profile', 'email'],
                  pkce: true,
                },
              ],
            }),
          ]
        : []),
      // Last, so cookies set by server-side calls reach the response.
      nextCookies(),
    ],
  };
}

let instance: ReturnType<typeof betterAuth> | undefined;

export function getAuth(): ReturnType<typeof betterAuth> {
  instance ??= betterAuth(authOptions());
  return instance;
}

/**
 * The signed-in user for a request, or null. Never throws: a database outage
 * or a missing secret makes the caller signed out, it does not break the page.
 */
export async function getSignedInUser(
  headers: Headers,
): Promise<{ id: string; email: string; name: string } | null> {
  try {
    const session = await getAuth().api.getSession({ headers });
    return session?.user
      ? { id: session.user.id, email: session.user.email, name: session.user.name }
      : null;
  } catch (err) {
    log.warn({ err: (err as Error)?.message }, 'auth — could not read the session');
    return null;
  }
}

/**
 * Create or update Better Auth's tables in the project's auth schema. Runs once when the
 * server starts (instrumentation.ts). A failure is logged and the app keeps
 * serving: the sign-in page and /api/health report the problem.
 */
export async function migrateAuthSchema(): Promise<void> {
  if (!read('DATABASE_URL')) {
    log.warn('auth — DATABASE_URL is not set, so sign-in is unavailable');
    tables.set(false);
    return;
  }
  try {
    await authPool().query(`CREATE SCHEMA IF NOT EXISTS "${AUTH_DB_SCHEMA}"`);
    const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions());
    if (toBeCreated.length === 0 && toBeAdded.length === 0) {
      tables.set(true);
      return;
    }
    await runMigrations();
    tables.set(true);
    log.info(
      { created: toBeCreated.map((t) => t.table), updated: toBeAdded.map((t) => t.table) },
      'auth — tables ready',
    );
  } catch (err) {
    tables.set(false);
    log.error({ err: (err as Error)?.message }, 'auth — could not prepare the tables');
  }
}
