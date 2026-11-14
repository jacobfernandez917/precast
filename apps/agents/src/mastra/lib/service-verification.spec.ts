import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceVerifier } from './service-verification';

afterEach(() => vi.unstubAllEnvs());
const host = 'test.ap-southeast-1.rds.amazonaws.com';
const applicationId = '00000000-0000-4000-8000-000000000001';
function receipt(
  publicKey: string,
  projectName = 'connected-project',
  databaseHost = host,
  extra: { connectionString?: string; databaseMode?: 'existing'; databaseCaPem?: string } = {},
) {
  const connectionString =
    extra.connectionString ??
    `postgresql://owner:secret@${databaseHost}/new_project?sslmode=require`;
  const key = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        projectName,
        applicationId,
        connectionString,
        ...(extra.databaseCaPem ? { databaseCaPem: extra.databaseCaPem } : {}),
      }),
    ),
    cipher.final(),
  ]);
  return (
    'PRECAST_SERVICE_RECEIPT:' +
    JSON.stringify({
      projectName,
      applicationId,
      model: 'gemini-3.5-flash',
      geminiCallVerified: true,
      database: decodeURIComponent(new URL(connectionString).pathname.slice(1)),
      databaseHost,
      ...(extra.databaseMode ? { databaseMode: extra.databaseMode } : {}),
      receipt: {
        key: publicEncrypt(
          {
            key: createPublicKey({
              key: Buffer.from(publicKey, 'base64url'),
              format: 'der',
              type: 'spki',
            }),
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
          },
          key,
        ).toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    })
  );
}
describe('AGT-033 service verification', () => {
  it('requires an approved database target before starting the Computer', () => {
    vi.stubEnv('PRECAST_SETUP_DATABASE_HOST', '');
    expect(() => createServiceVerifier('test')).toThrow(/not configured/);
  });
  it('decrypts only inside the tool, uses verified TLS, SELECT 1 and closes the connection', async () => {
    vi.stubEnv('PRECAST_SETUP_DATABASE_HOST', host);
    const verifier = createServiceVerifier('connected-project');
    const client = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('pg_roles')
          ? [
              {
                database: 'new_project',
                username: 'owner',
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
              },
            ]
          : [{ connection_ok: 1 }],
      })),
      end: vi.fn(async () => undefined),
    };
    const connect = vi.fn((_config: unknown) => client);
    vi.stubEnv(
      'PRECAST_SETUP_CA_PATH',
      new URL('../../../../../scripts/certs/rds-global-bundle.pem', import.meta.url).pathname,
    );
    const result = await verifier.verify(receipt(verifier.publicKey), connect as never);
    expect(result.databaseVerified).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ ssl: { rejectUnauthorized: true } });
    expect(client.query).toHaveBeenCalledWith('SELECT 1 AS connection_ok');
    expect(client.end).toHaveBeenCalledOnce();
  });
  it('refuses an admin role even when the database connection and SELECT 1 work', async () => {
    vi.stubEnv('PRECAST_SETUP_DATABASE_HOST', host);
    vi.stubEnv(
      'PRECAST_SETUP_CA_PATH',
      new URL('../../../../../scripts/certs/rds-global-bundle.pem', import.meta.url).pathname,
    );
    const verifier = createServiceVerifier('connected-project');
    const client = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('pg_roles')
          ? [
              {
                database: 'new_project',
                username: 'owner',
                rolsuper: false,
                rolcreatedb: true,
                rolcreaterole: true,
              },
            ]
          : [{ connection_ok: 1 }],
      })),
      end: vi.fn(async () => undefined),
    };
    await expect(
      verifier.verify(receipt(verifier.publicKey), (() => client) as never),
    ).rejects.toThrow(/verification failed/);
    expect(client.end).toHaveBeenCalledOnce();
  });
  it.each([
    ['another-project', host],
    ['connected-project', 'evil.rds.amazonaws.com'],
  ])('rejects a changed project or host before connecting', async (projectName, databaseHost) => {
    vi.stubEnv('PRECAST_SETUP_DATABASE_HOST', host);
    const verifier = createServiceVerifier('connected-project'),
      connect = vi.fn();
    await expect(
      verifier.verify(receipt(verifier.publicKey, projectName, databaseHost), connect as never),
    ).rejects.toThrow(/verification failed/);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('AGT-042 existing database verification and schema boundaries', () => {
  const pooler = 'aws-0-ap-southeast-1.pooler.supabase.com';
  const uri = `postgresql://scaffold_runtime.abcdefghijklmnopqrst:private@${pooler}/postgres?sslmode=verify-full`;
  function settings() {
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', 'existing');
    vi.stubEnv('PRECAST_SETUP_DATABASE_HOST', pooler);
    vi.stubEnv('PRECAST_SETUP_DATABASE_NAME', 'postgres');
    vi.stubEnv('PRECAST_SETUP_DATABASE_PROJECT_REF', 'abcdefghijklmnopqrst');
  }
  function database(wrongOwner = false) {
    const client = {
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('pg_namespace')
          ? ['auth', 'agents', 'app'].map((p) => ({
              name: `p_${createHash('sha256').update('connected-project').digest('hex').slice(0, 32)}_${p}`,
              owner: wrongOwner ? 'other_project' : 'scaffold_runtime',
            }))
          : sql.includes('pg_roles')
            ? [
                {
                  database: 'postgres',
                  username: 'scaffold_runtime',
                  rolsuper: false,
                  rolcreatedb: false,
                  rolcreaterole: false,
                },
              ]
            : [{ connection_ok: 1 }],
      })),
    };
    return { client, connect: vi.fn(() => client) };
  }
  it('verifies the pooled role and three owned schemas using strict TLS and read-only SQL', async () => {
    settings();
    const verifier = createServiceVerifier('connected-project', true),
      db = database();
    const report = receipt(verifier.publicKey, 'connected-project', pooler, {
      connectionString: uri,
      databaseMode: 'existing',
    });
    await expect(verifier.verify(report, db.connect as never)).resolves.toMatchObject({
      database: 'postgres',
      databaseReused: true,
      hannibalInvoked: false,
    });
    expect(db.connect).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } }),
    );
    expect(db.client.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
    expect(db.client.end).toHaveBeenCalledOnce();
  });
  it("refuses another project's schemas even when SELECT 1 and the database role pass", async () => {
    settings();
    const verifier = createServiceVerifier('connected-project', true),
      db = database(true);
    await expect(
      verifier.verify(
        receipt(verifier.publicKey, 'connected-project', pooler, {
          connectionString: uri,
          databaseMode: 'existing',
        }),
        db.connect as never,
      ),
    ).rejects.toThrow(/verification failed/);
    expect(db.client.end).toHaveBeenCalledOnce();
  });
  it('refuses another pooled project reference before connecting', async () => {
    settings();
    const verifier = createServiceVerifier('connected-project', true),
      db = database();
    await expect(
      verifier.verify(
        receipt(verifier.publicKey, 'connected-project', pooler, {
          connectionString: uri.replace('abcdefghijklmnopqrst', 'uvwxyzabcdefghijklmn'),
          databaseMode: 'existing',
        }),
        db.connect as never,
      ),
    ).rejects.toThrow(/verification failed/);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it('accepts only the operator-pinned CA fingerprint', async () => {
    settings();
    const ca = '-----BEGIN CERTIFICATE-----\napproved-ca\n-----END CERTIFICATE-----\n';
    const verifier = createServiceVerifier('connected-project', true),
      db = database();
    const report = receipt(verifier.publicKey, 'connected-project', pooler, {
      connectionString: uri,
      databaseMode: 'existing',
      databaseCaPem: ca,
    });
    vi.stubEnv('PRECAST_SETUP_DATABASE_CA_SHA256', 'wrong');
    await expect(verifier.verify(report, db.connect as never)).rejects.toThrow(
      /verification failed/,
    );
    expect(db.connect).not.toHaveBeenCalled();
    vi.stubEnv('PRECAST_SETUP_DATABASE_CA_SHA256', createHash('sha256').update(ca).digest('hex'));
    await expect(verifier.verify(report, db.connect as never)).resolves.toMatchObject({
      databaseReused: true,
    });
    expect(db.connect).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { ca, rejectUnauthorized: true } }),
    );
  });
});
