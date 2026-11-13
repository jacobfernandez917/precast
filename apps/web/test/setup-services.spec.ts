import { generateKeyPairSync } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSetupGrant, setupServices } from '../../../scripts/setup-services.mjs';

const name = 'connected-project';
const uuid = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
const grant = {
  projectName: name,
  applicationId: uuid('1'),
  clientId: 'project-client',
  clientSecret: 'project-secret',
  apiUrl: 'https://api.example.com',
  tokenUrl: 'https://auth.example.com/realms/test/protocol/openid-connect/token',
  modelSlug: 'gemini-flash',
  modelId: 'gemini-3.5-flash',
  modelListingId: uuid('2'),
  modelOrg: 'test-org',
  hannibalSlug: 'hannibal-postgres',
  hannibalListingId: uuid('3'),
  hannibalOrg: 'test-org',
  databaseHost: 'test.ap-southeast-1.rds.amazonaws.com',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};
const connectionString = `postgresql://project_owner:database-secret@${grant.databaseHost}:5432/connected_project?sslmode=require`;
const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .publicKey.export({ format: 'der', type: 'spki' })
  .toString('base64url');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'precast-services-'));
  roots.push(parent);
  const root = join(parent, name);
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name }));
  writeFileSync(join(root, '.env'), 'DATABASE_URL=postgresql://user:pass@your-postgres-host/db\n');
  return root;
}
function server({
  uncertain = false,
  modelAvailable = true,
  subscriptionActive = true,
  geminiFailure = false,
} = {}) {
  let provisionCalls = 0;
  const fetch = vi.fn(
    async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit = {}) => {
      const url = String(input);
      expect(init.redirect).toBe('error');
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      const response = (v: unknown) => new Response(JSON.stringify(v));
      if (url === grant.tokenUrl) return response({ access_token: 'token' });
      if (url.endsWith('/mcp')) {
        const tool = body.params.name;
        const payload =
          tool === 'agentbase.list_models'
            ? {
                items: modelAvailable
                  ? [
                      {
                        slug: grant.modelSlug,
                        modelId: grant.modelId,
                        listingId: grant.modelListingId,
                        orgSlug: grant.modelOrg,
                      },
                    ]
                  : [],
              }
            : tool === 'agentbase.get_agent'
              ? {
                  listingId: grant.hannibalListingId,
                  agentCardUrl: `${grant.apiUrl}/proxy/a2a/${grant.hannibalOrg}/${grant.hannibalSlug}/.well-known/agent.json`,
                }
              : { subscription: { status: subscriptionActive ? 'ACTIVE' : 'PENDING' } };
        return response({ result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } });
      }
      const agentUrl = `${grant.apiUrl}/proxy/a2a/${grant.hannibalOrg}/${grant.hannibalSlug}`;
      if (url.endsWith('/.well-known/agent.json'))
        return response({ url: agentUrl, skills: [{ id: 'provisionDatabaseTool' }] });
      if (url.endsWith('/chat/completions')) {
        expect(body.max_tokens).toBe(1024);
        return geminiFailure
          ? new Response(JSON.stringify({ code: 'llm_empty_response' }), { status: 502 })
          : response({ choices: [{ message: { content: 'PRECAST_GEMINI_OK' } }] });
      }
      expect(url).toBe(agentUrl);
      provisionCalls++;
      if (uncertain) throw new Error('lost reply database-secret');
      return response({ result: { parts: [{ kind: 'text', text: connectionString }] } });
    },
  );
  return {
    fetch,
    get provisionCalls() {
      return provisionCalls;
    },
  };
}

describe('TOOL-016 connected scaffold service boundaries', () => {
  it.each([
    ['project', { projectName: 'another-project' }],
    ['expiry', { expiresAt: '2000-01-01T00:00:00Z' }],
    ['HTTP', { apiUrl: 'http://api.example.com' }],
    ['model', { modelId: 'claude-model' }],
    ['multiline', { clientSecret: 'secret\nINJECTED=yes' }],
    ['unknown field', { unwanted: true }],
  ])('refuses a bad %s approval before any call', (_label, change) => {
    expect(() => parseSetupGrant(JSON.stringify({ ...grant, ...change }), name)).toThrow();
  });
  it('subscribes only pinned services, verifies the model, stores owner-only credentials and seals the database receipt', async () => {
    const root = fixture(),
      upstream = server();
    const result = await setupServices({
      root,
      projectName: name,
      grant: JSON.stringify(grant),
      publicKey,
      fetch: upstream.fetch,
    });
    expect(upstream.provisionCalls).toBe(1);
    const subscriptions = upstream.fetch.mock.calls
      .filter(
        ([, init]) => typeof init?.body === 'string' && init.body.includes('agentbase.subscribe'),
      )
      .map(([, init]) => JSON.parse(String(init?.body)).params.arguments.listingId);
    expect(subscriptions).toEqual([grant.modelListingId, grant.hannibalListingId]);
    expect(JSON.stringify(result)).not.toContain('database-secret');
    expect(JSON.stringify(result)).not.toContain('project-secret');
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain(connectionString);
    expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600);
    await setupServices({
      root,
      projectName: name,
      grant: JSON.stringify(grant),
      publicKey,
      fetch: upstream.fetch,
    });
    expect(upstream.provisionCalls).toBe(1);
  });
  it('refuses a retry after a lost database reply, without a second request', async () => {
    const root = fixture(),
      upstream = server({ uncertain: true });
    const call = () =>
      setupServices({
        root,
        projectName: name,
        grant: JSON.stringify(grant),
        publicKey,
        fetch: upstream.fetch,
      });
    await expect(call()).rejects.toThrow();
    const count = upstream.fetch.mock.calls.length;
    await expect(call()).rejects.toThrow('database_outcome_needs_review');
    expect(upstream.provisionCalls).toBe(1);
    expect(upstream.fetch.mock.calls.length).toBe(count);
  });
  it('does not request a database or save credentials after a failed model check', async () => {
    const root = fixture(),
      upstream = server({ geminiFailure: true });
    await expect(
      setupServices({
        root,
        projectName: name,
        grant: JSON.stringify(grant),
        publicKey,
        fetch: upstream.fetch,
      }),
    ).rejects.toThrow('gemini_call_failed');
    expect(upstream.provisionCalls).toBe(0);
    expect(readFileSync(join(root, '.env'), 'utf8')).not.toContain(grant.clientSecret);
  });
  it.each([{ modelAvailable: false }, { subscriptionActive: false }])(
    'never provisions when access is unavailable: %j',
    async (options) => {
      const root = fixture(),
        upstream = server(options);
      await expect(
        setupServices({
          root,
          projectName: name,
          grant: JSON.stringify(grant),
          publicKey,
          fetch: upstream.fetch,
        }),
      ).rejects.toThrow();
      expect(upstream.provisionCalls).toBe(0);
    },
  );
  it('refuses an existing unbound database and symlinked secret destinations', async () => {
    const root = fixture(),
      upstream = server();
    writeFileSync(join(root, '.env'), `DATABASE_URL=${connectionString}\n`);
    await expect(
      setupServices({
        root,
        projectName: name,
        grant: JSON.stringify(grant),
        publicKey,
        fetch: upstream.fetch,
      }),
    ).rejects.toThrow('existing_database_refused');
    rmSync(join(root, '.env'));
    symlinkSync(join(root, 'package.json'), join(root, '.env'));
    await expect(
      setupServices({
        root,
        projectName: name,
        grant: JSON.stringify(grant),
        publicKey,
        fetch: upstream.fetch,
      }),
    ).rejects.toThrow('setup_symlink_refused');
    expect(upstream.fetch).not.toHaveBeenCalled();
  });
});
