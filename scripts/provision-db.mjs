#!/usr/bin/env node
/**
 * pnpm db:provision — create a Postgres database for this project and write it into `.env`.
 *
 * Every Precast project needs a Postgres it does not run itself (ADR-002). This script carves
 * one out of the organisation's shared database server: a fresh database with its own scoped
 * role and password, isolated from every other database on the instance, then proves the new
 * credentials connect before writing `DATABASE_URL`. Ported from Hannibal's provisioner, so the
 * guarantees are the same: no drop path exists here, nothing on the instance is enumerated, and
 * the admin credential is never part of anything returned or written.
 *
 *   pnpm db:provision                                   # label from package.json
 *   pnpm db:provision --label "a meeting-room booking assistant"
 *
 * The admin credential comes from the SHELL of the machine running the scaffold, never from
 * the project: PRECAST_RDS_SUPERUSER_URL (or RDS_SUPERUSER_URL, Hannibal's name for it), or
 * --superuser-url=. The project's `.env` is not read for it and never receives it; the project
 * gets only its own DATABASE_URL.
 *
 * The flow, each step named so a failure says which one:
 *   1. read the credential   (shell env or flag; the .env.example placeholder is refused)
 *   2. create                 (CREATE ROLE, CREATE DATABASE … OWNER, REVOKE ALL … FROM PUBLIC)
 *   3. verify                 (connect as the new role and run SELECT 1)
 *   4. write .env             (DATABASE_URL, replaced in place)
 *
 * TLS: node-postgres verifies the server certificate, and Node's trust store has no Amazon
 * roots, so the RDS CA bundle vendored at scripts/certs/ is used when present; override with
 * PRECAST_RDS_CA_BUNDLE_PATH. Without a bundle, node-postgres' defaults apply (a non-RDS host).
 *
 * The connection string carries a live password and is printed NOWHERE: the one output line
 * that mentions it shows the host, port and database name with the password redacted.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SUPERUSER_ENV = ['PRECAST_RDS_SUPERUSER_URL', 'RDS_SUPERUSER_URL'];
const DEFAULT_CA_BUNDLE = join(rootDir, 'scripts', 'certs', 'rds-global-bundle.pem');

/** Postgres identifier limit; longer names are silently truncated by the server. */
const PG_IDENTIFIER_MAX = 63;
const ROLE_SUFFIX = '_owner';

// ── Pure helpers (unit-tested in apps/web/test/provision-db.spec.ts) ─────────

/** Parse a dotenv file into a map: KEY=value, optional quotes, `#` comments, blank lines. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Z_][A-Z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

/** Replace `KEY=…` in place (the line keeps its position and the comments above it), or append. */
export function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

/** `postgresql://user:***@host:5432/db` — safe to print. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}

/** Short, lowercase, hex — safe inside a Postgres identifier. */
export function randomSuffix(bytes = 4) {
  return randomBytes(bytes).toString('hex');
}

/**
 * A free-text label ("Jamie's invoice tracker!") as a legal, collision-resistant database name
 * (`jamies_invoice_tracker_a1b2c3d4`). The random suffix is what makes this safe to run twice:
 * two projects described the same way get two databases rather than a clash.
 */
export function toDatabaseName(label, suffix = randomSuffix()) {
  const base = String(label ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  // An identifier may not start with a digit unless quoted; prefix rather than strip.
  const safe = /^[0-9]/.test(base) || base === '' ? `db_${base}` : base;
  const room = PG_IDENTIFIER_MAX - ROLE_SUFFIX.length - suffix.length - 1;
  return `${safe.slice(0, room).replace(/_+$/, '')}_${suffix}`;
}

/** The scoped role that owns a provisioned database. Never the admin. */
export function toRoleName(databaseName) {
  return `${databaseName}${ROLE_SUFFIX}`;
}

/** base64url only: the password goes into a URL, and percent-encoding bugs look like bad credentials. */
export function generatePassword(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

/** Host and port of the admin URL, and nothing else: no user, no password, no database. */
export function adminEndpoint(adminUrl) {
  const u = new URL(adminUrl);
  return { host: u.hostname, port: Number(u.port || 5432) };
}

/** The connection string the project receives. */
export function buildConnectionString({
  host,
  port,
  database,
  user,
  password,
  sslmode = 'require',
}) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=${sslmode}`;
}

/** Double-quote a Postgres identifier, escaping any embedded quote. */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * The admin credential: a flag, then the shell environment. The project's `.env` is not a
 * source on purpose, so the credential never has a reason to be in it. A placeholder host is
 * refused rather than dialled.
 */
export function resolveSuperuserUrl({ flags = {}, env = {} } = {}) {
  const candidates = [
    ['--superuser-url', flags['superuser-url']],
    ...SUPERUSER_ENV.map((k) => [k, env[k]]),
  ];
  for (const [source, value] of candidates) {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) continue;
    if (!/^postgres(ql)?:\/\//.test(v))
      return { url: null, error: `${source} is not a postgres:// URL` };
    if (/example\.com|your-postgres-host/.test(v))
      return { url: null, error: `${source} is the placeholder, not a real credential` };
    return { url: v, source };
  }
  return { url: null, error: `none of --superuser-url, ${SUPERUSER_ENV.join(', ')} is set` };
}

/** TLS for the admin and verification connections. */
export function tlsConfig(
  bundlePath = process.env.PRECAST_RDS_CA_BUNDLE_PATH || DEFAULT_CA_BUNDLE,
) {
  if (!bundlePath || !existsSync(bundlePath)) return {};
  return { ssl: { ca: readFileSync(bundlePath, 'utf8'), rejectUnauthorized: true } };
}

// ── The provisioning itself ─────────────────────────────────────────────────

export class StepError extends Error {
  constructor(step, message, hint) {
    super(message);
    this.step = step;
    this.hint = hint;
  }
}

/** What a thrown database error means to the person, by its code or message. */
export function explainDbError(err) {
  const code = err?.code ?? '';
  const msg = String(err?.message ?? err);
  if (code === '28P01' || /password authentication failed/i.test(msg)) {
    return 'The admin credential was refused. Check PRECAST_RDS_SUPERUSER_URL (user and password).';
  }
  if (code === '42501' || /permission denied/i.test(msg)) {
    return 'The admin role may not create roles or databases here. It needs CREATEROLE and CREATEDB, and `createrole_self_grant = set, inherit` to own a database for another role.';
  }
  if (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)
  ) {
    return 'The database server could not be reached from this machine. Check the host, the network, and the security group or firewall for port 5432.';
  }
  if (/certificate|SELF_SIGNED|unable to verify/i.test(msg)) {
    return `The server certificate could not be verified. The RDS CA bundle is read from ${DEFAULT_CA_BUNDLE}; set PRECAST_RDS_CA_BUNDLE_PATH if yours is elsewhere.`;
  }
  return null;
}

async function defaultConnect(config) {
  const { default: pg } = await import('pg');
  const client = new pg.Client(config);
  await client.connect();
  return client;
}

/**
 * Create the database and role, then verify the new credentials connect. `connect(config)` is
 * injectable so the statements are testable without a server. Returns everything the project
 * needs and nothing about the admin.
 */
export async function provisionOnRds({
  superuserUrl,
  label,
  connect = defaultConnect,
  suffix = randomSuffix(),
  password = generatePassword(),
  tls = tlsConfig(),
}) {
  const database = toDatabaseName(label, suffix);
  const user = toRoleName(database);
  const { host, port } = adminEndpoint(superuserUrl);
  const db = quoteIdent(database);
  const role = quoteIdent(user);

  const admin = new URL(superuserUrl);
  // An explicit `ssl` object and the URL's own sslmode both configure TLS; keep one source.
  admin.searchParams.delete('sslmode');
  const statements = [];
  let client;
  try {
    client = await connect({ connectionString: admin.toString(), ...tls });
  } catch (err) {
    throw new StepError(
      'create',
      `could not connect as the admin: ${err?.message ?? err}`,
      explainDbError(err),
    );
  }
  try {
    // The password cannot be a bind parameter in a utility statement; it is escaped as a
    // literal, which is safe because generatePassword() emits base64url characters only.
    // Identifiers come from toDatabaseName/toRoleName ([a-z0-9_] only), never from the label.
    for (const sql of [
      `CREATE ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(password)}`,
      // Cannot run inside a transaction block. Owning another role's database needs
      // `createrole_self_grant = set, inherit` on the admin role.
      `CREATE DATABASE ${db} OWNER ${role}`,
      // The isolation guarantee: no other role on the instance can connect to it.
      `REVOKE ALL ON DATABASE ${db} FROM PUBLIC`,
    ]) {
      statements.push(sql.replace(client.escapeLiteral(password), "'***'"));
      await client.query(sql);
    }
  } catch (err) {
    throw new StepError('create', `${err?.message ?? err}`, explainDbError(err));
  } finally {
    await client.end?.();
  }

  const connectionString = buildConnectionString({ host, port, database, user, password });
  const verify = new URL(connectionString);
  verify.searchParams.delete('sslmode');
  let scoped;
  try {
    scoped = await connect({ connectionString: verify.toString(), ...tls });
    await scoped.query('SELECT 1');
  } catch (err) {
    throw new StepError(
      'verify',
      `the new database exists but its credentials did not connect: ${err?.message ?? err}`,
      explainDbError(err) ??
        'Run again; a second database will be created and this one can be removed by an admin.',
    );
  } finally {
    await scoped?.end?.();
  }

  return {
    database,
    user,
    host,
    port,
    connectionString,
    createdAt: new Date().toISOString(),
    statements,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = 'true';
  }
  return flags;
}

function defaultLabel() {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
    return pkg.name ? `the ${pkg.name} project` : 'a new Precast project';
  } catch {
    return 'a new Precast project';
  }
}

export async function provision({ flags = {}, label, envPath, log = console, connect } = {}) {
  log.log('1/4  Reading the provisioning credential…');
  const cred = resolveSuperuserUrl({ flags, env: process.env });
  if (!cred.url) {
    throw new StepError(
      'read the credential',
      cred.error,
      "Set PRECAST_RDS_SUPERUSER_URL in your shell to your organisation's database-server admin URL (ask whoever runs AgentBase for it). It is never written into the project.",
    );
  }

  log.log(`2/4  Creating the database on ${adminEndpoint(cred.url).host}…`);
  log.log('3/4  Verifying the new credentials connect…');
  const result = await provisionOnRds({ superuserUrl: cred.url, label, connect });

  log.log('4/4  Writing DATABASE_URL into .env…');
  const before = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  writeFileSync(envPath, setEnvValue(before, 'DATABASE_URL', result.connectionString), 'utf-8');
  return result;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const envPath = flags.env ? join(process.cwd(), flags.env) : join(rootDir, '.env');
  const label = flags.label || defaultLabel();
  try {
    const { connectionString, database } = await provision({ flags, label, envPath });
    console.log(`\n✔ Database ${database} created and written to .env as DATABASE_URL:`);
    console.log(`  ${redactUrl(connectionString)}`);
    console.log(
      '  The password is in .env and nowhere else. Lose it and the fix is to provision again.',
    );
    console.log('\nNext: pnpm poc');
  } catch (err) {
    if (err instanceof StepError) {
      console.error(`\n✖ Could not get a database. Failed at step "${err.step}": ${err.message}`);
      if (err.hint) console.error(`  ${err.hint}`);
      console.error(
        '  Nothing was written to .env. Fix the cause and run `pnpm db:provision` again, or paste a URL of your own into DATABASE_URL.',
      );
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
