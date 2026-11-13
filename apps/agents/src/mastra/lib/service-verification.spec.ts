import {
  constants,
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceVerifier } from './service-verification';

afterEach(() => vi.unstubAllEnvs());
const host = 'test.ap-southeast-1.rds.amazonaws.com';
const applicationId = '00000000-0000-4000-8000-000000000001';
function receipt(publicKey: string, projectName = 'connected-project', databaseHost = host) {
  const key = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        projectName,
        applicationId,
        connectionString: `postgresql://owner:secret@${databaseHost}/new_project?sslmode=require`,
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
      database: 'new_project',
      databaseHost,
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
