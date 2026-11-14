import {
  constants,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
} from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { z } from 'zod';
import { projectSchema } from '@precast/shared';
import { resolveDatabaseSetupMode } from './database-setup-mode';

const receiptSchema = z
  .object({
    projectName: z.string(),
    applicationId: z.string().uuid(),
    model: z.string(),
    geminiCallVerified: z.literal(true),
    database: z.string(),
    databaseHost: z.string(),
    databaseMode: z.literal('existing').optional(),
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

export function createServiceVerifier(projectName: string, reuse = false) {
  const host = process.env.PRECAST_SETUP_DATABASE_HOST;
  const allowed = reuse
    ? /^(?:[a-z0-9.-]+\.rds\.amazonaws\.com|db\.[a-z0-9]{20}\.supabase\.co|aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com)$/
    : /^[a-z0-9.-]+\.rds\.amazonaws\.com$/;
  if (!host || !allowed.test(host) || (reuse && resolveDatabaseSetupMode() !== 'existing'))
    throw new Error('The approved service database host is not configured.');
  const approvedDatabase = reuse ? process.env.PRECAST_SETUP_DATABASE_NAME : undefined;
  if (
    reuse &&
    (!approvedDatabase ||
      !/^[a-z][a-z0-9_]{0,62}$/.test(approvedDatabase) ||
      ['template0', 'template1'].includes(approvedDatabase))
  )
    throw new Error('The approved existing database name is not configured.');
  if (
    reuse &&
    host.endsWith('.pooler.supabase.com') &&
    !/^[a-z0-9]{20}$/.test(process.env.PRECAST_SETUP_DATABASE_PROJECT_REF ?? '')
  )
    throw new Error('The approved database project reference is not configured.');
  if (
    reuse &&
    process.env.PRECAST_SETUP_DATABASE_CA_SHA256 &&
    !/^[a-f0-9]{64}$/.test(process.env.PRECAST_SETUP_DATABASE_CA_SHA256)
  )
    throw new Error('The approved database certificate fingerprint is not configured.');
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
            databaseCaPem: z.string().max(32768).optional(),
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
          ['template0', 'template1', ...(!reuse ? ['postgres'] : [])].includes(report.database) ||
          (reuse && (report.databaseMode !== 'existing' || report.database !== approvedDatabase)) ||
          (!reuse && report.databaseMode !== undefined)
        )
          throw new Error('binding_mismatch');
        url.searchParams.delete('sslmode');
        const caPath = reuse
          ? undefined
          : [
              ...(process.env.PRECAST_SETUP_CA_PATH ? [process.env.PRECAST_SETUP_CA_PATH] : []),
              join(process.cwd(), 'certs/rds-global-bundle.pem'),
              join(process.cwd(), 'scripts/certs/rds-global-bundle.pem'),
            ].find(existsSync);
        if (!reuse && !caPath) throw new Error('trusted_ca_missing');
        let expectedUser = decodeURIComponent(url.username);
        if (reuse && host.endsWith('.pooler.supabase.com')) {
          const reference = process.env.PRECAST_SETUP_DATABASE_PROJECT_REF;
          if (
            !reference ||
            !/^[a-z0-9]{20}$/.test(reference) ||
            !expectedUser.endsWith('.' + reference)
          )
            throw new Error('pooler_project_mismatch');
          expectedUser = expectedUser.slice(0, -reference.length - 1);
        }
        if (
          reuse &&
          [
            'postgres',
            'supabase_admin',
            'authenticator',
            'anon',
            'authenticated',
            'service_role',
          ].includes(expectedUser)
        )
          throw new Error('database_role_not_scoped');
        const caFingerprint = process.env.PRECAST_SETUP_DATABASE_CA_SHA256;
        if (
          reuse &&
          (proof.databaseCaPem || caFingerprint) &&
          (!proof.databaseCaPem ||
            !caFingerprint ||
            createHash('sha256').update(proof.databaseCaPem).digest('hex') !== caFingerprint)
        )
          throw new Error('database_ca_mismatch');
        client = connect({
          connectionString: url.toString(),
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
          ssl: {
            rejectUnauthorized: true,
            ...(reuse
              ? proof.databaseCaPem
                ? { ca: proof.databaseCaPem }
                : {}
              : { ca: readFileSync(caPath!, 'utf8') }),
          },
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
          role.username !== expectedUser ||
          role.rolsuper !== false ||
          role.rolcreatedb !== false ||
          role.rolcreaterole !== false
        )
          throw new Error('database_role_not_scoped');
        if (reuse) {
          const namespace =
            'p_' + createHash('sha256').update(projectName).digest('hex').slice(0, 32);
          const schemas = ['auth', 'agents', 'app'].map((purpose) =>
            projectSchema(purpose as 'auth' | 'agents' | 'app', namespace),
          );
          const owned = await client.query(
            'SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = ANY($1::text[])',
            [schemas],
          );
          if (
            owned.rows.length !== schemas.length ||
            schemas.some(
              (name) => !owned.rows.some((row) => row.name === name && row.owner === expectedUser),
            )
          )
            throw new Error('database_schema_not_scoped');
        }
        return {
          projectName,
          applicationId: report.applicationId,
          model: report.model,
          geminiCallVerified: true as const,
          database: report.database,
          databaseVerified: true as const,
          verificationLocation: 'builder-server' as const,
          ...(reuse ? { databaseReused: true as const, hannibalInvoked: false as const } : {}),
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
