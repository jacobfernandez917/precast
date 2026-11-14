import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, migrations, migrate, configs } = vi.hoisted(() => ({
  query: vi.fn(),
  migrations: vi.fn(),
  migrate: vi.fn(),
  configs: [] as Record<string, unknown>[],
}));
vi.mock('pg', () => ({
  Pool: class {
    query = query;
    constructor(config: Record<string, unknown>) {
      configs.push(config);
    }
  },
}));
vi.mock('better-auth/db/migration', () => ({ getMigrations: migrations }));

const TABLES = Symbol.for('precast.web.authTablesReady');
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://runtime:unused@db.example.invalid/postgres?sslmode=verify-full',
  );
  vi.stubEnv('PRECAST_DB_NAMESPACE', 'p_prepared');
  configs.length = 0;
  query.mockReset().mockResolvedValue({ rows: [{ owned: true }] });
  migrate.mockReset().mockResolvedValue(undefined);
  migrations.mockReset().mockResolvedValue({
    toBeCreated: [{ table: 'user' }],
    toBeAdded: [],
    runMigrations: migrate,
  });
  delete (globalThis as Record<symbol, unknown>)[TABLES];
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<symbol, unknown>)[TABLES];
});

describe('WEB-044 prepared sign-in schema', () => {
  it('migrates only in the owned search path without requesting schema creation', async () => {
    const { migrateAuthSchema, AUTH_DB_SCHEMA } = await import('../app/lib/auth');
    await migrateAuthSchema();
    expect(AUTH_DB_SCHEMA).toBe('p_prepared_auth');
    expect(configs[0]).toMatchObject({
      options: '-c search_path=p_prepared_auth',
      ssl: { rejectUnauthorized: true },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_namespace'), [AUTH_DB_SCHEMA]);
    expect(migrations.mock.calls[0][0].database).not.toHaveProperty('schemaName');
    expect(migrate).toHaveBeenCalledOnce();
    expect((globalThis as Record<symbol, unknown>)[TABLES]).toBe(true);
  });

  it('refuses migration when the prepared schema belongs to another role', async () => {
    query.mockResolvedValue({ rows: [{ owned: false }] });
    const { migrateAuthSchema } = await import('../app/lib/auth');
    await migrateAuthSchema();
    expect(migrations).not.toHaveBeenCalled();
    expect((globalThis as Record<symbol, unknown>)[TABLES]).toBe(false);
  });

  it('retains explicit schema selection for ordinary projects', async () => {
    vi.stubEnv('PRECAST_DB_NAMESPACE', undefined);
    const { migrateAuthSchema, AUTH_DB_SCHEMA } = await import('../app/lib/auth');
    await migrateAuthSchema();
    expect(migrations.mock.calls[0][0].database.schemaName).toBe(AUTH_DB_SCHEMA);
    expect(migrate).toHaveBeenCalledOnce();
  });
});
