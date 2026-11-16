import { afterEach, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('@mastra/pg', () => ({
  PostgresStore: class {
    constructor(options: unknown) {
      create(options);
    }
  },
}));
afterEach(() => vi.unstubAllEnvs());
it('preserves explicit certificate verification when node-postgres parses a hosted memory URL', async () => {
  vi.resetModules();
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://fixture:placeholder@database.invalid:5432/test?sslmode=verify-full',
  );
  vi.stubEnv('DATABASE_CA_PEM', '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----');
  const { getMastraStore } = await import('./storage');
  getMastraStore();
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionString: 'postgresql://fixture:placeholder@database.invalid:5432/test',
      ssl: { rejectUnauthorized: true, ca: expect.stringContaining('BEGIN CERTIFICATE') },
    }),
  );
});
