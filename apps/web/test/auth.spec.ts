import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('better-auth', () => ({ betterAuth: vi.fn(() => ({ api: { getSession } })) }));

import { projectSchema } from '@precast/shared';
import {
  AUTH_DB_SCHEMA,
  getSignedInUser,
  isOidcConfigured,
  migrateAuthSchema,
  poolConfig,
  signInStatus,
} from '../app/lib/auth';

/**
 * WEB-022: the sign-in module. Its connection settings follow one SSL rule, its
 * readiness is a code the health route can report, and reading the session can
 * fail in any way without breaking the request that asked.
 */
const TABLES = Symbol.for('precast.web.authTablesReady');
const KEYS = ['BETTER_AUTH_SECRET', 'DATABASE_URL', 'OIDC_ISSUER_URI', 'OIDC_CLIENT_ID'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  delete (globalThis as Record<symbol, unknown>)[TABLES];
  getSession.mockReset();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete (globalThis as Record<symbol, unknown>)[TABLES];
});

describe('poolConfig', () => {
  it('drops the URL sslmode when the shared rule decides, so the explicit option is the only source', () => {
    const config = poolConfig('postgresql://u:p@db.example.com:5432/app?sslmode=require');
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.connectionString).not.toContain('sslmode');
    expect(config.connectionString).toContain('db.example.com:5432/app');
  });

  it('leaves a URL without sslmode alone', () => {
    const url = 'postgresql://u:p@localhost:5432/app';
    expect(poolConfig(url)).toEqual({ connectionString: url });
    expect(poolConfig(undefined)).toEqual({ connectionString: undefined });
  });
});

describe('signInStatus', () => {
  it('reports what is missing before anything else', () => {
    expect(signInStatus()).toBe('missing-secret');
    process.env.BETTER_AUTH_SECRET = 's';
    expect(signInStatus()).toBe('missing-database');
  });

  it('follows the startup flag shared with instrumentation.ts', () => {
    process.env.BETTER_AUTH_SECRET = 's';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/app';
    expect(signInStatus()).toBe('starting');
    (globalThis as Record<symbol, unknown>)[TABLES] = true;
    expect(signInStatus()).toBe('ready');
    (globalThis as Record<symbol, unknown>)[TABLES] = false;
    expect(signInStatus()).toBe('database-error');
  });

  it('a blank value counts as missing', () => {
    process.env.BETTER_AUTH_SECRET = '   ';
    expect(signInStatus()).toBe('missing-secret');
  });
});

describe('getSignedInUser', () => {
  it('returns only id, email and name from a session', async () => {
    getSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@example.com', name: 'A', emailVerified: false },
      session: { token: 'secret-token' },
    });
    expect(await getSignedInUser(new Headers())).toEqual({
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
    });
  });

  it('is null with no session', async () => {
    getSession.mockResolvedValue(null);
    expect(await getSignedInUser(new Headers())).toBeNull();
  });

  it('never throws: a database or secret failure makes the caller signed out', async () => {
    getSession.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    expect(await getSignedInUser(new Headers({ cookie: 'x=y' }))).toBeNull();
  });
});

describe('OIDC and migrations', () => {
  it("keeps sign-in tables in the project's own schema, never a shared `auth`", () => {
    expect(AUTH_DB_SCHEMA).toBe(projectSchema('auth'));
    expect(AUTH_DB_SCHEMA).not.toBe('auth');
  });

  it('OIDC needs both the issuer and the client id', () => {
    expect(isOidcConfigured()).toBe(false);
    process.env.OIDC_ISSUER_URI = 'https://id.example.com';
    expect(isOidcConfigured()).toBe(false);
    process.env.OIDC_CLIENT_ID = 'web';
    expect(isOidcConfigured()).toBe(true);
  });

  it('with no DATABASE_URL the migration step records a failure instead of throwing', async () => {
    await expect(migrateAuthSchema()).resolves.toBeUndefined();
    expect((globalThis as Record<symbol, unknown>)[TABLES]).toBe(false);
  });
});
