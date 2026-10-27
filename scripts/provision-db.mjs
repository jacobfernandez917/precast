#!/usr/bin/env node
/**
 * pnpm db:provision — create a Postgres database for this project and write it into `.env`.
 *
 * Every Precast project needs a Postgres it does not run itself (ADR-002). A fresh database
 * with its own scoped role and password, isolated from every other database on the
 * organisation's server, comes from one of two places:
 *
 *   Hannibal, the database agent on AgentBase (the default). The project asks it through the
 *   AgentBase Application it is already connected with (`pnpm connect`), so the person running
 *   this needs nothing else: the server's admin credential stays with Hannibal.
 *
 *   The server directly, when the admin credential is in the SHELL of this machine:
 *   PRECAST_RDS_SUPERUSER_URL (or RDS_SUPERUSER_URL, Hannibal's name for it), or
 *   --superuser-url=. Hannibal's provisioner, ported, for whoever runs that server. The
 *   project's `.env` is not read for it and never receives it.
 *
 *   pnpm db:provision                                   # label from package.json
 *   pnpm db:provision --label "a meeting-room booking assistant"
 *
 * Either way the new credentials must connect before `DATABASE_URL` is written, no drop path
 * exists, and nothing on the server is enumerated. Each step is named so a failure says which.
 *
 * Through Hannibal:
 *   1. read the AgentBase connection  (the Application in .env)
 *   2. find the database agent        (registry search, then its card must offer provisioning)
 *   3. ask for a database             (A2A message/send through the AgentBase proxy)
 *   4. verify                         (connect as the new role and run SELECT 1)
 *   5. write .env                     (DATABASE_URL, replaced in place)
 *
 * Directly:
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

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPlaceholder, mintToken } from './connect-agentbase.mjs';
import { restrictEnvFile } from './local-secrets.mjs';

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
  return {
    url: null,
    unset: true,
    error: `none of --superuser-url, ${SUPERUSER_ENV.join(', ')} is set`,
  };
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
  await verifyConnects({ connectionString, connect, tls });

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

/** Connect as the new role and run SELECT 1; a credential that does not connect is never written. */
export async function verifyConnects({
  connectionString,
  connect = defaultConnect,
  tls = tlsConfig(),
}) {
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
}

// ── Through Hannibal on AgentBase ───────────────────────────────────────────

/** The skill a database agent's card must declare, so a near match in the registry is never asked. */
export const PROVISION_SKILL = 'provisionDatabaseTool';
const REGISTRY_QUERY = 'provision a postgres database';
const CANDIDATES = 3;
const ASK_TIMEOUT_MS = 120_000;
const NOT_CONNECTED_HINT =
  'Say “connect my AgentBase” in Claude Code (or run `pnpm connect`), then run `pnpm db:provision` again.';

/** The Application this project is connected with, from its `.env`; null when it is not connected. */
export function readApplication(envText) {
  const env = parseEnvFile(envText);
  const app = {
    apiUrl: env.AGENTBASE_URL?.replace(/\/+$/, ''),
    tokenUrl: env.AGENTBASE_TOKEN_URL,
    clientId: env.AGENTBASE_CLIENT_ID,
    clientSecret: env.AGENTBASE_CLIENT_SECRET,
  };
  return Object.values(app).every((v) => !isPlaceholder(v)) ? app : null;
}

/** One AgentBase MCP tool call; its JSON payload, or a StepError naming `step`. */
async function agentbaseTool({ apiUrl, token, name, args, step, fetch }) {
  let res;
  try {
    res = await fetch(`${apiUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (err) {
    throw new StepError(
      step,
      `could not reach AgentBase at ${apiUrl} (${err?.cause?.code ?? err?.message ?? err})`,
      'Check that you are online, then run `pnpm db:provision` again.',
    );
  }
  if (!res.ok) {
    throw new StepError(
      step,
      `AgentBase answered HTTP ${res.status} to ${name}`,
      NOT_CONNECTED_HINT,
    );
  }
  const body = await res.json().catch(() => ({}));
  const text = body?.result?.content?.[0]?.text ?? '';
  if (body?.error || body?.result?.isError) {
    const detail = String(body?.error?.message ?? text).slice(0, 200);
    throw Object.assign(new StepError(step, `AgentBase could not run ${name}: ${detail}`), {
      detail,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new StepError(step, `AgentBase answered ${name} in a form this script does not read`);
  }
}

async function fetchCard(cardUrl, token, fetch) {
  try {
    const res = await fetch(cardUrl, { headers: { authorization: `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Find the database agent: search the registry, then trust only a card that declares
 * {@link PROVISION_SKILL}. The address asked is the card's own, on AgentBase's origin; a card
 * pointing anywhere else would be sent this Application's token, so it is not followed.
 */
export async function findProvisioner({ apiUrl, token, fetch = globalThis.fetch }) {
  const step = 'find the database agent';
  const found = await agentbaseTool({
    apiUrl,
    token,
    fetch,
    step,
    name: 'agentbase.search_registry',
    args: { query: REGISTRY_QUERY, kind: 'a2a_agent' },
  });
  const slugs = (found?.items ?? [])
    .map((i) => i?.agentSlug)
    .filter(Boolean)
    .slice(0, CANDIDATES);
  for (const slug of slugs) {
    const agent = await agentbaseTool({
      apiUrl,
      token,
      fetch,
      step,
      name: 'agentbase.get_agent',
      args: { slug },
    });
    if (!agent?.agentCardUrl || !agent?.listingId) continue;
    const card = await fetchCard(agent.agentCardUrl, token, fetch);
    if (!card?.skills?.some((s) => s?.id === PROVISION_SKILL)) continue;
    const derived = agent.agentCardUrl.replace(/\/\.well-known\/[^/]+\.json$/, '');
    const sameOrigin = (u) => {
      try {
        return new URL(u).origin === new URL(agent.agentCardUrl).origin;
      } catch {
        return false;
      }
    };
    return {
      slug,
      listingId: agent.listingId,
      url: card.url && sameOrigin(card.url) ? card.url : derived,
    };
  }
  throw new StepError(
    step,
    'no agent on this AgentBase offers to create databases',
    'Ask your AgentBase admin whether the database agent (Hannibal) is published to your organisation, or paste a postgresql:// URL of your own into DATABASE_URL in .env.',
  );
}

/** The reply's text, wherever the A2A answer put it (same order as apps/web/app/lib/a2a-client.ts). */
export function replyText(result = {}) {
  const textOf = (parts) =>
    (parts ?? [])
      .filter((p) => p?.kind === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim();
  const lastAgentTurn = [...(result.history ?? [])].reverse().find((m) => m?.role === 'agent');
  return (
    textOf(result.parts) ||
    textOf(result.message?.parts) ||
    textOf(result.status?.message?.parts) ||
    textOf((result.artifacts ?? []).flatMap((a) => a?.parts ?? [])) ||
    textOf(lastAgentTurn?.parts)
  );
}

/**
 * The connection string in Hannibal's answer. Its agent puts it in a ```text block, copied from
 * the tool's output; that block is preferred, then any postgres:// URL. Only a URL with a user,
 * a password, a host and a database counts. Never rebuilt from parts.
 */
export function extractConnectionString(text) {
  const body = String(text ?? '');
  const fenced = [...body.matchAll(/```text[^\S\n]*\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  const loose = body.match(/postgres(?:ql)?:\/\/[^\s`'"<>]+/g) ?? [];
  for (const candidate of [...fenced, ...loose]) {
    if (!/^postgres(ql)?:\/\/\S+$/.test(candidate)) continue;
    try {
      const u = new URL(candidate);
      if (u.username && u.password && u.hostname && u.pathname.length > 1) return candidate;
    } catch {
      // not a URL; try the next one
    }
  }
  return null;
}

export async function askForDatabase({
  url,
  token,
  label,
  fetch = globalThis.fetch,
  timeoutMs = ASK_TIMEOUT_MS,
}) {
  const step = 'ask for a database';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            role: 'user',
            messageId: randomUUID(),
            // A sentence, not a payload: the agent names the database from how the project
            // is described.
            parts: [{ kind: 'text', text: `I need a Postgres database for ${label}.` }],
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new StepError(
      step,
      `the database agent did not answer (${err?.name === 'TimeoutError' ? `nothing after ${timeoutMs / 1000} s` : (err?.cause?.code ?? err?.message ?? err)})`,
      'AgentBase or the agent may be busy or restarting. Run `pnpm db:provision` again in a minute.',
    );
  }
  if (!res.ok) {
    throw new StepError(
      step,
      `the database agent answered HTTP ${res.status}`,
      res.status === 401 || res.status === 403
        ? 'This Application may not use the database agent. Ask your AgentBase admin to allow it.'
        : 'It may be restarting. Run `pnpm db:provision` again in a minute.',
    );
  }
  const body = await res.json().catch(() => null);
  if (!body || body.error) {
    throw new StepError(
      step,
      `the database agent could not answer${body?.error?.message ? `: ${String(body.error.message).slice(0, 200)}` : ''}`,
      'Run `pnpm db:provision` again in a minute.',
    );
  }
  return replyText(body.result);
}

export async function provisionThroughHannibal({
  app,
  label,
  log = console,
  fetch = globalThis.fetch,
  connect,
  tls,
}) {
  log.log('2/5  Finding the database agent on AgentBase…');
  let token;
  try {
    token = await mintToken({ ...app, fetch });
  } catch (err) {
    throw new StepError('find the database agent', err.message, err.hint ?? NOT_CONNECTED_HINT);
  }
  const agent = await findProvisioner({ apiUrl: app.apiUrl, token, fetch });
  try {
    await agentbaseTool({
      apiUrl: app.apiUrl,
      token,
      fetch,
      step: 'find the database agent',
      name: 'agentbase.subscribe',
      args: { listingId: agent.listingId },
    });
  } catch (err) {
    // Asking twice is fine; anything else is a refusal worth stopping on.
    if (!/already/i.test(err?.detail ?? '')) throw err;
  }

  log.log(`3/5  Asking it for a database for ${label}…`);
  const reply = await askForDatabase({ url: agent.url, token, label, fetch });
  const connectionString = extractConnectionString(reply);
  if (!connectionString) {
    throw new StepError(
      'ask for a database',
      /\bmock\b/i.test(reply)
        ? 'the database agent is running in test mode, so it created no database'
        : 'the database agent answered without a connection string',
      'Run `pnpm db:provision` again. If it keeps happening, tell your AgentBase admin the database agent is not returning connection strings.',
    );
  }

  log.log('4/5  Checking the new database connects…');
  await verifyConnects({ connectionString, connect, ...(tls ? { tls } : {}) });
  const u = new URL(connectionString);
  return {
    database: u.pathname.slice(1),
    user: decodeURIComponent(u.username),
    host: u.hostname,
    port: Number(u.port || 5432),
    connectionString,
    createdAt: new Date().toISOString(),
    via: 'agentbase',
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

/**
 * @param {{
 *   flags?: Record<string, string>,
 *   label: string,
 *   envPath: string,
 *   log?: { log: (...line: unknown[]) => void },
 *   connect?: (config: Record<string, unknown>) => Promise<any>,
 *   fetch?: typeof globalThis.fetch,
 *   env?: Record<string, string | undefined>,
 * }} options
 */
export async function provision({
  flags = {},
  label,
  envPath,
  log = console,
  connect,
  fetch = globalThis.fetch,
  env = process.env,
} = {}) {
  const before = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const cred = resolveSuperuserUrl({ flags, env });
  let result;
  let last;
  if (cred.url) {
    log.log('1/4  Reading the provisioning credential…');
    log.log(`2/4  Creating the database on ${adminEndpoint(cred.url).host}…`);
    log.log('3/4  Verifying the new credentials connect…');
    result = await provisionOnRds({ superuserUrl: cred.url, label, connect });
    last = '4/4';
  } else if (!cred.unset) {
    // An admin URL was given but is unusable: say so rather than going somewhere else.
    throw new StepError(
      'read the credential',
      cred.error,
      "PRECAST_RDS_SUPERUSER_URL must be your organisation's database-server admin URL. Unset it to ask the database agent on AgentBase instead.",
    );
  } else {
    log.log("1/5  Reading this project's AgentBase connection…");
    const app = readApplication(before);
    if (!app) {
      throw new StepError(
        'read the AgentBase connection',
        'this project is not connected to AgentBase yet, so there is nobody to ask for a database',
        NOT_CONNECTED_HINT,
      );
    }
    result = await provisionThroughHannibal({ app, label, log, fetch, connect });
    last = '5/5';
  }

  log.log(`${last}  Writing DATABASE_URL into .env…`);
  writeFileSync(envPath, setEnvValue(before, 'DATABASE_URL', result.connectionString), 'utf-8');
  restrictEnvFile(envPath);
  return result;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const envPath = flags.env ? join(process.cwd(), flags.env) : join(rootDir, '.env');
  const label = flags.label || defaultLabel();
  try {
    const { connectionString, database, via } = await provision({ flags, label, envPath });
    const from = via === 'agentbase' ? ' by the database agent on AgentBase' : '';
    console.log(`\n✔ Database ${database} created${from} and written to .env as DATABASE_URL:`);
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

/** One line a person can act on; the full error only when asked for. */
function exitWithReason(err) {
  console.error(`\n❌ ${err?.message ?? err}`);
  if (process.env.PRECAST_DEBUG) console.error(err?.stack ?? err);
  else console.error('   (PRECAST_DEBUG=1 shows the full error.)');
  process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  Promise.resolve().then(main).catch(exitWithReason);
}
