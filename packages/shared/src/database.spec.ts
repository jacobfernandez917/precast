import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  PROJECT_NAME,
  assertPostgresUrl,
  isPostgresUrl,
  projectSchema,
  ensureProjectSchema,
  resolvePostgresSsl,
} from './database.js';

const POSTGRES_URLS = [
  'postgres://user:pass@host:5432/db',
  'postgresql://user:pass@host:5432/db?sslmode=require',
];

// The engines Precast used to accept before ADR-002 made it Postgres-only.
// These must now be rejected — a silent downgrade to a local file is exactly
// the failure mode ADR-002 exists to prevent.
const REJECTED_URLS = [
  'file:./app.db',
  'file:///absolute/path/app.db',
  'sqlite:./app.db',
  'libsql://turso-host',
  'mysql://user:pass@host:3306/db',
];

describe('isPostgresUrl', () => {
  it.each(POSTGRES_URLS)('accepts %s', (url) => {
    expect(isPostgresUrl(url)).toBe(true);
  });

  it.each(REJECTED_URLS)('rejects %s', (url) => {
    expect(isPostgresUrl(url)).toBe(false);
  });

  it('returns false rather than throwing on a malformed URL, so it is safe as a zod refine', () => {
    expect(isPostgresUrl('not-a-url')).toBe(false);
  });
});

describe('assertPostgresUrl', () => {
  it.each(POSTGRES_URLS)('returns %s unchanged', (url) => {
    expect(assertPostgresUrl(url)).toBe(url);
  });

  it('names the offending scheme and points at ADR-002 for a non-Postgres URL', () => {
    expect(() => assertPostgresUrl('sqlite:./app.db')).toThrow(
      /must be a Postgres URL.*got "sqlite:".*ADR-002/s,
    );
  });

  it('distinguishes a malformed URL from a wrong-engine URL', () => {
    expect(() => assertPostgresUrl('not-a-url')).toThrow(/not a valid URL/);
  });

  it('uses the supplied variable name in the message', () => {
    expect(() => assertPostgresUrl('sqlite:./mastra.db', 'MASTRA_DB_URL')).toThrow(
      /^MASTRA_DB_URL must be a Postgres URL/,
    );
  });
});

describe('resolvePostgresSsl — libpq semantics, not node-postgres defaults', () => {
  /**
   * Regression: an AWS RDS instance with `?sslmode=require` crashed the agents
   * container at boot with SELF_SIGNED_CERT_IN_CHAIN. node-postgres verifies
   * the certificate even for `require`, which under libpq means "encrypt, do
   * not verify". Every derived project on RDS (or any private CA) hits it.
   */
  const url = (mode?: string) => `postgresql://u:p@host:5432/db${mode ? `?sslmode=${mode}` : ''}`;

  it('does not verify for the modes that only ask for encryption', () => {
    for (const mode of ['require', 'prefer', 'allow']) {
      expect(resolvePostgresSsl(url(mode)), `${mode} must not verify`).toEqual({
        rejectUnauthorized: false,
      });
    }
  });

  it('verifies only when the URL explicitly asks for verification', () => {
    for (const mode of ['verify-ca', 'verify-full']) {
      expect(resolvePostgresSsl(url(mode))).toEqual({ rejectUnauthorized: true });
    }
  });

  it('disables TLS for sslmode=disable', () => {
    expect(resolvePostgresSsl(url('disable'))).toBe(false);
  });

  it('defers to the driver when sslmode is absent or unrecognised', () => {
    expect(resolvePostgresSsl(url())).toBeUndefined();
    expect(resolvePostgresSsl(url('banana'))).toBeUndefined();
  });

  it('never throws on an unparseable URL', () => {
    expect(resolvePostgresSsl('not a url')).toBeUndefined();
  });
});

/**
 * The schemas are named after the project. Written without the boilerplate's own name in any
 * expected value, so the spec still passes after `pnpm rename` rewrites the literal.
 */
describe('projectSchema', () => {
  it('derives a schema per purpose from the project name', () => {
    expect(projectSchema('agents', 'meeting-rooms')).toBe('meeting_rooms_agents');
    expect(projectSchema('auth', 'meeting-rooms')).toBe('meeting_rooms_auth');
  });

  it('defaults to this project, and is never a generic name', () => {
    expect(projectSchema('agents')).toBe(projectSchema('agents', PROJECT_NAME));
    expect(projectSchema('agents')).not.toBe('mastra');
    expect(projectSchema('auth')).not.toBe('auth');
  });

  it('is always a legal unquoted identifier within 63 bytes', () => {
    for (const name of ['a', '9lives', 'x--y', 'q'.repeat(80), 'Weird Name!']) {
      const schema = projectSchema('agents', name);
      expect(schema, name).toMatch(/^[a-z][a-z0-9_]*_agents$/);
      expect(schema.length, name).toBeLessThanOrEqual(63);
    }
    expect(projectSchema('agents', '9lives')).toBe('p_9lives_agents');
  });
});

afterEach(() => vi.unstubAllEnvs());
describe('SHARED-011 existing-database project namespace isolation', () => {
  it('separates project names that normalize to the same legacy identifier', () => {
    const names = ['personal-notes', 'personal--notes'];
    expect(projectSchema('app', names[0])).toBe(projectSchema('app', names[1]));
    const schemas = names.map((name) => {
      vi.stubEnv(
        'PRECAST_DB_NAMESPACE',
        'p_' + createHash('sha256').update(name).digest('hex').slice(0, 32),
      );
      return projectSchema('app');
    });
    expect(new Set(schemas).size).toBe(2);
    expect(schemas.every((name) => name.length <= 63)).toBe(true);
  });
  it('refuses malformed namespace configuration rather than falling back to another project', () => {
    vi.stubEnv('PRECAST_DB_NAMESPACE', '../public');
    expect(() => projectSchema('app')).toThrow(/namespace/);
  });
});

describe('SHARED-012 prepared schemas without database CREATE privilege', () => {
  it('uses an owned prepared schema without issuing schema DDL', async () => {
    vi.stubEnv('PRECAST_DB_NAMESPACE', 'p_regression');
    const query = vi.fn().mockResolvedValue({ rows: [{ name: 'p_regression_auth', owned: true }] });
    await ensureProjectSchema({ query }, 'p_regression_auth');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toMatch(/^SELECT/);
  });
  it.each([{ rows: [] }, { rows: [{ name: 'p_regression_app', owned: false }] }])(
    'refuses missing or differently owned prepared schemas without creating a replacement',
    async ({ rows }) => {
      vi.stubEnv('PRECAST_DB_NAMESPACE', 'p_regression');
      const query = vi.fn().mockResolvedValue({ rows });
      await expect(ensureProjectSchema({ query }, 'p_regression_app')).rejects.toThrow(
        /prepared project schema/,
      );
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]![0]).toMatch(/^SELECT/);
    },
  );
  it('refuses another project or an unsafe identifier before querying', async () => {
    vi.stubEnv('PRECAST_DB_NAMESPACE', 'p_regression');
    const query = vi.fn();
    await expect(ensureProjectSchema({ query }, 'another_app')).rejects.toThrow(/namespace/);
    await expect(ensureProjectSchema({ query }, 'p_regression_app";DROP')).rejects.toThrow(
      /Invalid/,
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('retains normal schema creation for an ordinary project', async () => {
    vi.stubEnv('PRECAST_DB_NAMESPACE', undefined);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await ensureProjectSchema({ query }, 'ordinary_auth');
    expect(query).toHaveBeenLastCalledWith('CREATE SCHEMA IF NOT EXISTS "ordinary_auth"');
  });
});
