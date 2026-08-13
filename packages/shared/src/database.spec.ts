import { describe, expect, it } from 'vitest';
import { assertPostgresUrl, isPostgresUrl, resolvePostgresSsl } from './database.js';

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
