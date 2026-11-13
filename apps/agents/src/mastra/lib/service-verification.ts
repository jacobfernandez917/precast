import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { z } from 'zod';

const receiptSchema = z
  .object({
    projectName: z.string(),
    applicationId: z.string().uuid(),
    model: z.string(),
    geminiCallVerified: z.literal(true),
    database: z.string(),
    databaseHost: z.string(),
    receipt: z
      .object({
        key: z.string().max(2048),
        iv: z.string().max(64),
        tag: z.string().max(64),
        ciphertext: z.string().max(16384),
      })
      .strict(),
  })
  .strict();

export function createServiceVerifier(projectName: string) {
  const host = process.env.PRECAST_SETUP_DATABASE_HOST;
  if (!host || !/^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(host))
    throw new Error('The approved service database host is not configured.');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    async verify(stdout: string, connect = (config: pg.ClientConfig) => new pg.Client(config)) {
      let client: pg.Client | undefined;
      try {
        const line = stdout.split('\n').find((l) => l.startsWith('PRECAST_SERVICE_RECEIPT:'));
        if (!line) throw new Error('missing_receipt');
        const report = receiptSchema.parse(
          JSON.parse(line.slice('PRECAST_SERVICE_RECEIPT:'.length)),
        );
        const packet = report.receipt;
        const key = privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
          Buffer.from(packet.key, 'base64'),
        );
        const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(packet.iv, 'base64'));
        cipher.setAuthTag(Buffer.from(packet.tag, 'base64'));
        const proof = z
          .object({
            projectName: z.string(),
            applicationId: z.string().uuid(),
            connectionString: z.string().max(8192),
          })
          .strict()
          .parse(
            JSON.parse(
              Buffer.concat([
                cipher.update(Buffer.from(packet.ciphertext, 'base64')),
                cipher.final(),
              ]).toString(),
            ),
          );
        const url = new URL(proof.connectionString);
        if (
          proof.projectName !== projectName ||
          report.projectName !== projectName ||
          proof.applicationId !== report.applicationId ||
          !['postgres:', 'postgresql:'].includes(url.protocol) ||
          [...url.searchParams.keys()].some((key) => key !== 'sslmode') ||
          url.hostname !== host ||
          report.databaseHost !== host ||
          Number(url.port || 5432) !== 5432 ||
          !url.username ||
          !url.password ||
          url.pathname.slice(1) !== report.database ||
          ['postgres', 'template0', 'template1'].includes(report.database)
        )
          throw new Error('binding_mismatch');
        url.searchParams.delete('sslmode');
        const caPath = [
          ...(process.env.PRECAST_SETUP_CA_PATH ? [process.env.PRECAST_SETUP_CA_PATH] : []),
          join(process.cwd(), 'certs/rds-global-bundle.pem'),
          join(process.cwd(), 'scripts/certs/rds-global-bundle.pem'),
        ].find(existsSync);
        if (!caPath) throw new Error('trusted_ca_missing');
        client = connect({
          connectionString: url.toString(),
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
          ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true },
        });
        await client.connect();
        const result = await client.query('SELECT 1 AS connection_ok');
        if (result.rows[0]?.connection_ok !== 1) throw new Error('database_reply_unverified');
        const identity = await client.query(
          'SELECT current_database() AS database, current_user AS username, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
        );
        const role = identity.rows[0];
        if (
          role?.database !== report.database ||
          role.username !== decodeURIComponent(url.username) ||
          role.rolsuper !== false ||
          role.rolcreatedb !== false ||
          role.rolcreaterole !== false
        )
          throw new Error('database_role_not_scoped');
        return {
          projectName,
          applicationId: report.applicationId,
          model: report.model,
          geminiCallVerified: true as const,
          database: report.database,
          databaseVerified: true as const,
          verificationLocation: 'builder-server' as const,
        };
      } catch {
        throw new Error(
          'Service verification failed. The project is retained; do not repeat an uncertain database request.',
        );
      } finally {
        await client?.end().catch(() => undefined);
      }
    },
  };
}
