import { describe, expect, it } from 'vitest';
import { getDatabaseKind } from './database.js';

describe('getDatabaseKind', () => {
  it.each([
    'postgres://user:pass@host:5432/db',
    'postgresql://user:pass@host:5432/db?sslmode=require',
  ])('identifies %s as postgres', (url) => {
    expect(getDatabaseKind(url)).toBe('postgres');
  });

  it.each([
    'file:./app.db',
    'file:///absolute/path/app.db',
    'sqlite:./app.db',
    'libsql://turso-host',
  ])('identifies %s as sqlite', (url) => {
    expect(getDatabaseKind(url)).toBe('sqlite');
  });

  it('throws a clear, actionable error on an unrecognized scheme', () => {
    expect(() => getDatabaseKind('mysql://user:pass@host:3306/db')).toThrow(
      /Unrecognized DATABASE_URL scheme "mysql:".*postgres.*sqlite/s,
    );
  });

  it('propagates the underlying error for a malformed URL rather than misclassifying it', () => {
    expect(() => getDatabaseKind('not-a-url')).toThrow();
  });
});
