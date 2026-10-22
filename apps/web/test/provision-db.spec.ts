import { describe, expect, it } from 'vitest';
import {
  SUPERUSER_ENV,
  adminEndpoint,
  buildConnectionString,
  explainDbError,
  generatePassword,
  parseEnvFile,
  provisionOnRds,
  quoteIdent,
  redactUrl,
  resolveSuperuserUrl,
  setEnvValue,
  toDatabaseName,
  toRoleName,
} from '../../../scripts/provision-db.mjs';

/**
 * TOOL-008: `pnpm db:provision`, Precast's own database provisioner (ported from Hannibal).
 * The server is replaced by an injectable `connect`, so what is pinned here is every place a
 * wrong move would hand out a wrong or unsafe credential: naming, the password, the statements
 * and their order, the isolation revoke, the verification connect, the admin credential never
 * leaking into what the project receives, the credential sources, and the env writer.
 */

const ADMIN =
  'postgresql://precast_admin:adminpw@db.rds.amazonaws.com:5432/postgres?sslmode=require';

type Call = { config: Record<string, unknown>; queries: string[] };

/** A fake node-postgres: records every connection and statement, fails where told to. */
function fakeConnect(
  opts: {
    failQuery?: RegExp;
    failConnect?: (config: Record<string, unknown>) => Error | null;
  } = {},
) {
  const calls: Call[] = [];
  const connect = async (config: Record<string, unknown>) => {
    const err = opts.failConnect?.(config);
    if (err) throw err;
    const call: Call = { config, queries: [] };
    calls.push(call);
    return {
      escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
      query: async (sql: string) => {
        if (opts.failQuery?.test(sql)) {
          throw Object.assign(new Error('permission denied to create database'), { code: '42501' });
        }
        call.queries.push(sql);
        return { rows: [] };
      },
      end: async () => undefined,
    };
  };
  return { connect, calls };
}

describe('TOOL-008 naming and credentials', () => {
  it('turns a label into a legal, suffixed database name', () => {
    expect(toDatabaseName("Jamie's invoice tracker!", 'a1b2c3d4')).toBe(
      'jamie_s_invoice_tracker_a1b2c3d4',
    );
    expect(toDatabaseName('2048-game', 'ffff')).toBe('db_2048_game_ffff');
    expect(toDatabaseName('!!!', 'ffff')).toBe('db_ffff');
  });

  it('never exceeds the identifier limit, even with the role suffix', () => {
    const name = toDatabaseName('x'.repeat(200), 'a1b2c3d4');
    expect(name.length + '_owner'.length).toBeLessThanOrEqual(63);
    expect(toRoleName(name)).toBe(`${name}_owner`);
  });

  it('differs on repeat requests for the same label', () => {
    expect(toDatabaseName('my app')).not.toBe(toDatabaseName('my app'));
  });

  it('makes a URL-safe password that does not repeat', () => {
    const p = generatePassword();
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.length).toBeGreaterThanOrEqual(32);
    expect(generatePassword()).not.toBe(p);
  });

  it('keeps only host and port of the admin URL', () => {
    expect(adminEndpoint(ADMIN)).toEqual({ host: 'db.rds.amazonaws.com', port: 5432 });
    expect(adminEndpoint('postgres://a:b@h/db')).toEqual({ host: 'h', port: 5432 });
  });

  it('assembles a TLS connection string for the scoped user and quotes identifiers', () => {
    expect(
      buildConnectionString({ host: 'h', port: 5433, database: 'd', user: 'u', password: 'p+q' }),
    ).toBe('postgresql://u:p%2Bq@h:5433/d?sslmode=require');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});

describe('TOOL-008 provisioning statements', () => {
  it('creates the role, the database it owns, and revokes public access, in that order', async () => {
    const { connect, calls } = fakeConnect();
    const r = await provisionOnRds({
      superuserUrl: ADMIN,
      label: 'My App',
      connect,
      suffix: 'abcd1234',
      password: 'secretpw',
      tls: {},
    });
    expect(r.database).toBe('my_app_abcd1234');
    expect(r.user).toBe('my_app_abcd1234_owner');
    expect(calls[0]!.queries).toEqual([
      `CREATE ROLE "my_app_abcd1234_owner" LOGIN PASSWORD 'secretpw'`,
      `CREATE DATABASE "my_app_abcd1234" OWNER "my_app_abcd1234_owner"`,
      `REVOKE ALL ON DATABASE "my_app_abcd1234" FROM PUBLIC`,
    ]);
    expect(r.statements.join('\n')).not.toContain('secretpw');
  });

  it('connects as the admin without the URL sslmode, then verifies as the new role', async () => {
    const { connect, calls } = fakeConnect();
    const r = await provisionOnRds({
      superuserUrl: ADMIN,
      label: 'x',
      connect,
      suffix: 'ffff',
      password: 'pw',
      tls: { ssl: { ca: 'CA', rejectUnauthorized: true } },
    });
    expect(calls).toHaveLength(2);
    expect(String(calls[0]!.config.connectionString)).toBe(
      'postgresql://precast_admin:adminpw@db.rds.amazonaws.com:5432/postgres',
    );
    expect(calls[0]!.config.ssl).toEqual({ ca: 'CA', rejectUnauthorized: true });
    expect(String(calls[1]!.config.connectionString)).toBe(
      'postgresql://x_ffff_owner:pw@db.rds.amazonaws.com:5432/x_ffff',
    );
    expect(calls[1]!.queries).toEqual(['SELECT 1']);
    expect(r.connectionString).toBe(
      'postgresql://x_ffff_owner:pw@db.rds.amazonaws.com:5432/x_ffff?sslmode=require',
    );
  });

  it('never lets the admin credential into what the project receives', async () => {
    const { connect } = fakeConnect();
    const r = await provisionOnRds({ superuserUrl: ADMIN, label: 'x', connect, tls: {} });
    const everything = JSON.stringify(r);
    expect(everything).not.toContain('precast_admin');
    expect(everything).not.toContain('adminpw');
  });

  it('contains no drop statement and enumerates nothing', async () => {
    const { connect, calls } = fakeConnect();
    await provisionOnRds({ superuserUrl: ADMIN, label: 'x', connect, tls: {} });
    const sql = calls.flatMap((c) => c.queries).join('\n');
    expect(sql).not.toMatch(/DROP|pg_database/i);
  });

  it('names the step and explains a refused statement', async () => {
    const { connect } = fakeConnect({ failQuery: /CREATE DATABASE/ });
    await expect(
      provisionOnRds({ superuserUrl: ADMIN, label: 'x', connect, tls: {} }),
    ).rejects.toMatchObject({
      step: 'create',
      hint: expect.stringMatching(/CREATEDB/),
    });
  });

  it('names the step when the new credentials do not connect', async () => {
    let n = 0;
    const { connect } = fakeConnect({
      failConnect: () =>
        ++n === 2
          ? Object.assign(new Error('password authentication failed'), { code: '28P01' })
          : null,
    });
    await expect(
      provisionOnRds({ superuserUrl: ADMIN, label: 'x', connect, tls: {} }),
    ).rejects.toMatchObject({ step: 'verify' });
  });

  it('explains the common failures in plain words', () => {
    expect(explainDbError({ code: 'ENOTFOUND' })).toMatch(/could not be reached/);
    expect(explainDbError({ message: 'self signed certificate in certificate chain' })).toMatch(
      /certificate/,
    );
    expect(explainDbError({ code: '28P01' })).toMatch(/refused/);
    expect(explainDbError({ message: 'something else' })).toBeNull();
  });
});

describe('TOOL-008 credential sources and env handling', () => {
  it('reads a flag first, then the shell names, and refuses placeholders and non-postgres URLs', () => {
    expect(SUPERUSER_ENV).toEqual(['PRECAST_RDS_SUPERUSER_URL', 'RDS_SUPERUSER_URL']);
    expect(
      resolveSuperuserUrl({
        flags: { 'superuser-url': ADMIN },
        env: { RDS_SUPERUSER_URL: 'postgres://other' },
      }),
    ).toMatchObject({ url: ADMIN, source: '--superuser-url' });
    expect(resolveSuperuserUrl({ env: { RDS_SUPERUSER_URL: ADMIN } })).toMatchObject({
      url: ADMIN,
      source: 'RDS_SUPERUSER_URL',
    });
    expect(
      resolveSuperuserUrl({
        env: { PRECAST_RDS_SUPERUSER_URL: ADMIN, RDS_SUPERUSER_URL: 'postgres://other' },
      }).source,
    ).toBe('PRECAST_RDS_SUPERUSER_URL');
    expect(
      resolveSuperuserUrl({
        env: { PRECAST_RDS_SUPERUSER_URL: 'postgresql://u:p@your-postgres-host:5432/db' },
      }).url,
    ).toBeNull();
    expect(resolveSuperuserUrl({ env: { PRECAST_RDS_SUPERUSER_URL: 'mysql://x' } }).url).toBeNull();
    expect(resolveSuperuserUrl({}).error).toMatch(/none of/);
  });

  it('replaces DATABASE_URL in place, keeping its comments and position', () => {
    const env =
      '# db\nDATABASE_URL=postgresql://user:password@your-postgres-host:5432/your_db\nLOG_LEVEL=info\n';
    expect(setEnvValue(env, 'DATABASE_URL', 'postgresql://u:p@h/d')).toBe(
      '# db\nDATABASE_URL=postgresql://u:p@h/d\nLOG_LEVEL=info\n',
    );
    expect(setEnvValue('A=1', 'DATABASE_URL', 'x')).toBe('A=1\nDATABASE_URL=x\n');
  });

  it('parses quotes and ignores comments', () => {
    expect(parseEnvFile('# c\nA=1\nB="two words"\nC=\'x\'\n\nbad line\nlower=no\n')).toEqual({
      A: '1',
      B: 'two words',
      C: 'x',
    });
  });

  it('never prints the password', () => {
    expect(redactUrl('postgresql://u:s3cr3t@h:5432/d?sslmode=require')).toBe(
      'postgresql://u:***@h:5432/d?sslmode=require',
    );
    expect(redactUrl('nope')).toBe('(unparseable URL)');
  });
});
