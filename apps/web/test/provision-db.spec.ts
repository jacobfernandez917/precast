import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SUPERUSER_ENV,
  extractConnectionString,
  findProvisioner,
  provision,
  readApplication,
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

/**
 * TOOL-009: the Hannibal path, the default when no admin URL is in the shell. The project asks
 * the database agent on AgentBase through the Application it is connected with, so nobody
 * running it holds the server's admin credential. AgentBase and the database are both fakes:
 * what is pinned is which agent gets asked, what the token is sent to, what counts as a
 * connection string, and that nothing reaches `.env` unless it connected.
 */
const APP_ENV = [
  'AGENTBASE_URL=https://ab.test',
  'AGENTBASE_TOKEN_URL=https://id.ab.test/token',
  'AGENTBASE_CLIENT_ID=app',
  'AGENTBASE_CLIENT_SECRET=s3cret',
  'DATABASE_URL=postgresql://user:password@your-postgres-host:5432/your_db',
  '',
].join('\n');
const MINTED =
  'postgresql://hannibal_x_owner:pw-1@db.rds.amazonaws.com:5432/hannibal_x?sslmode=require';
const CARD = 'https://ab.test/proxy/a2a/org/hannibal-x/.well-known/agent.json';
const REPLY = `Here you go.\n\nConnection string:\n\`\`\`text\n${MINTED}\n\`\`\`\n\nEnvironment variables:\n\`\`\`bash\nPGHOST='db.rds.amazonaws.com'\n\`\`\``;

type Sent = { url: string; auth?: string; body?: Record<string, unknown> };

/** A fake AgentBase: the token endpoint, the MCP tools, the cards and the A2A proxy. */
function fakeAgentBase(
  opts: {
    items?: { agentSlug: string }[];
    cards?: Record<string, unknown>;
    reply?: string | null;
    askStatus?: number;
    subscribe?: { isError?: boolean; text?: string };
  } = {},
) {
  const sent: Sent[] = [];
  const cards = opts.cards ?? {
    [CARD]: {
      name: 'provisioning-agent',
      skills: [{ id: 'provisionDatabaseTool' }],
      url: CARD.replace('/.well-known/agent.json', ''),
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const tool = (payload: unknown, isError = false) =>
    json({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError,
        content: [
          { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
        ],
      },
    });
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ url, auth: headers.get('authorization') ?? undefined, body });
    if (url === 'https://id.ab.test/token') return json({ access_token: 'tok' });
    if (url === 'https://ab.test/mcp') {
      const name = body?.params?.name;
      if (name === 'agentbase.search_registry')
        return tool({ items: opts.items ?? [{ agentSlug: 'hannibal-x' }] });
      if (name === 'agentbase.get_agent') {
        const slug = body.params.arguments.slug;
        return tool({
          slug,
          listingId: `listing-${slug}`,
          agentCardUrl: `https://ab.test/proxy/a2a/org/${slug}/.well-known/agent.json`,
        });
      }
      if (name === 'agentbase.subscribe')
        return tool(opts.subscribe?.text ?? { ok: true }, opts.subscribe?.isError);
    }
    if (url in cards) return json(cards[url]);
    if (url.startsWith('https://ab.test/proxy/a2a/')) {
      if (opts.askStatus) return new Response('bad gateway', { status: opts.askStatus });
      const text = opts.reply === undefined ? REPLY : opts.reply;
      return json({
        jsonrpc: '2.0',
        id: body?.id,
        result: {
          kind: 'task',
          artifacts: text === null ? [] : [{ parts: [{ kind: 'text', text }] }],
        },
      });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

const quiet = { log: { log: () => undefined } };
/** The shell the script reads its admin URL from: empty, or with what a case sets. */
const shell = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const NO_SHELL = shell({});
let dir: string;
let envPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'precast-provision-'));
  envPath = join(dir, '.env');
  writeFileSync(envPath, APP_ENV);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('TOOL-009 provisioning through the database agent on AgentBase', () => {
  it('asks the agent whose card offers provisioning, verifies, then writes only DATABASE_URL', async () => {
    const ab = fakeAgentBase();
    const db = fakeConnect();
    const result = await provision({
      label: 'a booking assistant',
      envPath,
      env: NO_SHELL,
      fetch: ab.fetch,
      connect: db.connect,
      ...quiet,
    });
    expect(result).toMatchObject({
      database: 'hannibal_x',
      host: 'db.rds.amazonaws.com',
      via: 'agentbase',
    });

    const ask = ab.sent.find((r) => r.body?.method === 'message/send')!;
    expect(ask.url).toBe('https://ab.test/proxy/a2a/org/hannibal-x');
    expect(JSON.stringify(ask.body)).toContain(
      'I need a Postgres database for a booking assistant.',
    );
    expect(
      ab.sent.some(
        (r) =>
          r.body?.params && (r.body.params as { name?: string }).name === 'agentbase.subscribe',
      ),
    ).toBe(true);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.queries).toEqual(['SELECT 1']);
    const env = readFileSync(envPath, 'utf8');
    expect(env).toContain(`DATABASE_URL=${MINTED}`);
    expect(env).toContain('AGENTBASE_CLIENT_SECRET=s3cret');
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('writes nothing when the new credentials do not connect', async () => {
    const ab = fakeAgentBase();
    const db = fakeConnect({ failConnect: () => new Error('password authentication failed') });
    await expect(
      provision({
        label: 'x',
        envPath,
        env: NO_SHELL,
        fetch: ab.fetch,
        connect: db.connect,
        ...quiet,
      }),
    ).rejects.toMatchObject({ step: 'verify' });
    expect(readFileSync(envPath, 'utf8')).toBe(APP_ENV);
  });

  it('skips a registry match whose card does not offer provisioning', async () => {
    const lookalike = 'https://ab.test/proxy/a2a/org/postgres-docs/.well-known/agent.json';
    const ab = fakeAgentBase({
      items: [{ agentSlug: 'postgres-docs' }, { agentSlug: 'hannibal-x' }],
      cards: {
        [lookalike]: { name: 'docs', skills: [{ id: 'answerQuestions' }] },
        [CARD]: { name: 'provisioning-agent', skills: [{ id: 'provisionDatabaseTool' }] },
      },
    });
    const agent = await findProvisioner({
      apiUrl: 'https://ab.test',
      token: 'tok',
      fetch: ab.fetch,
    });
    expect(agent).toEqual({
      slug: 'hannibal-x',
      listingId: 'listing-hannibal-x',
      url: 'https://ab.test/proxy/a2a/org/hannibal-x',
    });
  });

  it('never sends the token to an address a card names on another host', async () => {
    const ab = fakeAgentBase({
      cards: {
        [CARD]: { skills: [{ id: 'provisionDatabaseTool' }], url: 'https://elsewhere.test/a2a' },
      },
    });
    await provision({
      label: 'x',
      envPath,
      env: NO_SHELL,
      fetch: ab.fetch,
      connect: fakeConnect().connect,
      ...quiet,
    });
    expect(ab.sent.some((r) => r.url.startsWith('https://elsewhere.test'))).toBe(false);
  });

  it('says which step failed, and writes nothing, for each way the agent can let you down', async () => {
    const cases = [
      [fakeAgentBase({ items: [] }), 'find the database agent', /no agent on this AgentBase/],
      [fakeAgentBase({ askStatus: 502 }), 'ask for a database', /HTTP 502/],
      [
        fakeAgentBase({ reply: 'Sorry, something went wrong.' }),
        'ask for a database',
        /without a connection string/,
      ],
      [
        fakeAgentBase({ reply: 'mock: true, this database was not really created' }),
        'ask for a database',
        /test mode/,
      ],
      [
        fakeAgentBase({ subscribe: { isError: true, text: 'forbidden for this application' } }),
        'find the database agent',
        /subscribe/,
      ],
    ] as const;
    for (const [ab, step, message] of cases) {
      const err = await provision({
        label: 'x',
        envPath,
        env: NO_SHELL,
        fetch: ab.fetch,
        connect: fakeConnect().connect,
        ...quiet,
      }).catch((e) => e);
      expect(err, String(message)).toMatchObject({ step });
      expect(err.message).toMatch(message);
      expect(readFileSync(envPath, 'utf8')).toBe(APP_ENV);
    }
  });

  it('an already-subscribed Application is not a failure', async () => {
    const ab = fakeAgentBase({
      subscribe: { isError: true, text: 'Application is already subscribed to this listing' },
    });
    await expect(
      provision({
        label: 'x',
        envPath,
        env: NO_SHELL,
        fetch: ab.fetch,
        connect: fakeConnect().connect,
        ...quiet,
      }),
    ).resolves.toMatchObject({ via: 'agentbase' });
  });

  it('a project with no AgentBase connection is told how to connect, and AgentBase is not called', async () => {
    writeFileSync(envPath, 'AGENTBASE_URL=https://agentbase-api.example.com\nAGENT_API_TOKEN=x\n');
    const ab = fakeAgentBase();
    const err = await provision({
      label: 'x',
      envPath,
      env: NO_SHELL,
      fetch: ab.fetch,
      ...quiet,
    }).catch((e) => e);
    expect(err).toMatchObject({ step: 'read the AgentBase connection' });
    expect(err.hint).toMatch(/connect my AgentBase/);
    expect(ab.sent).toHaveLength(0);
  });

  it('an admin URL in the shell still goes to the server directly, and a bad one is not silently skipped', async () => {
    const ab = fakeAgentBase();
    const db = fakeConnect();
    await provision({
      label: 'x',
      envPath,
      env: shell({ PRECAST_RDS_SUPERUSER_URL: ADMIN }),
      fetch: ab.fetch,
      connect: db.connect,
      ...quiet,
    });
    expect(ab.sent).toHaveLength(0);
    expect(db.calls[0]!.queries[0]).toMatch(/^CREATE ROLE/);

    const err = await provision({
      label: 'x',
      envPath,
      env: shell({ PRECAST_RDS_SUPERUSER_URL: 'mysql://nope' }),
      fetch: ab.fetch,
      ...quiet,
    }).catch((e) => e);
    expect(err).toMatchObject({ step: 'read the credential' });
    expect(ab.sent).toHaveLength(0);
  });
});

describe('TOOL-009 reading the answer', () => {
  it('takes the text block verbatim, then any complete postgres URL', () => {
    expect(extractConnectionString(REPLY)).toBe(MINTED);
    expect(extractConnectionString(`It is ${MINTED} for you.`)).toBe(MINTED);
  });

  it('refuses anything that is not a complete connection string', () => {
    for (const text of [
      '',
      'no database today',
      '```text\npostgresql://db.rds.amazonaws.com:5432/x\n```',
      'postgresql://user@host:5432/db',
      'postgresql://user:pw@host:5432/',
    ]) {
      expect(extractConnectionString(text), text).toBeNull();
    }
  });

  it('reads the Application from .env and treats the example placeholders as not connected', () => {
    expect(readApplication(APP_ENV)).toEqual({
      apiUrl: 'https://ab.test',
      tokenUrl: 'https://id.ab.test/token',
      clientId: 'app',
      clientSecret: 's3cret',
    });
    expect(
      readApplication(APP_ENV.replace('https://ab.test', 'https://agentbase-api.example.com')),
    ).toBeNull();
    expect(readApplication('AGENTBASE_URL=https://ab.test\n')).toBeNull();
  });
});
