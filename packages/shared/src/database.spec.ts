import { describe, expect, it } from 'vitest';
import { assertPostgresUrl, isPostgresUrl } from './database.js';

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
