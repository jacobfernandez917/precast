#!/usr/bin/env node
import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mintToken, listModels } from './connect-agentbase.mjs';
import {
  askForDatabase,
  extractConnectionString,
  parseEnvFile,
  setEnvValue,
} from './provision-db.mjs';
import { restrictEnvFile } from './local-secrets.mjs';

export const SETUP_ALIAS = 'precast_project_setup';
export const RECEIPT_PREFIX = 'PRECAST_SERVICE_RECEIPT:';

class SetupError extends Error {}
function requireValue(ok, stage) {
  if (!ok) throw new SetupError(stage);
}

export function parseSetupGrant(raw, projectName, now = Date.now(), services = 'hannibal-gemini') {
  requireValue(
    ['hannibal-gemini', 'existing-postgres-gemini'].includes(services),
    'invalid_setup_mode',
  );
  const reuse = services === 'existing-postgres-gemini';
  const grant = JSON.parse(raw);
  requireValue(grant && typeof grant === 'object' && !Array.isArray(grant), 'invalid_setup_grant');
  const keys = [
    'projectName',
    'applicationId',
    'clientId',
    'clientSecret',
    'apiUrl',
    'tokenUrl',
    'modelSlug',
    'modelId',
    'modelListingId',
    'modelOrg',
    'hannibalSlug',
    'hannibalListingId',
    'hannibalOrg',
    'databaseHost',
    'expiresAt',
  ];
  if (reuse) {
    for (const key of ['hannibalSlug', 'hannibalListingId', 'hannibalOrg'])
      keys.splice(keys.indexOf(key), 1);
    keys.push('databaseUrl', 'databaseName');
  }
  const allowedKeys = [...keys, ...(reuse ? ['databaseCaPem'] : [])];
  requireValue(
    Object.keys(grant).every((key) => allowedKeys.includes(key)) &&
      keys.every(
        (k) =>
          typeof grant[k] === 'string' &&
          grant[k].length > 0 &&
          grant[k].length <= (k === 'databaseUrl' ? 8192 : 2048) &&
          !/[\r\n\0]/.test(grant[k]),
      ),
    'invalid_setup_grant',
  );
  requireValue(
    /^[a-z][a-z0-9-]{1,62}$/.test(projectName) && grant.projectName === projectName,
    'setup_project_mismatch',
  );
  requireValue(
    Date.parse(grant.expiresAt) > now && Date.parse(grant.expiresAt) <= now + 24 * 60 * 60_000,
    'setup_grant_expired',
  );
  for (const key of ['apiUrl', 'tokenUrl']) {
    const u = new URL(grant[key]);
    requireValue(
      u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search,
      'invalid_setup_origin',
    );
  }
  requireValue(
    new URL(grant.apiUrl).pathname === '/' &&
      new URL(grant.tokenUrl).pathname.endsWith('/protocol/openid-connect/token'),
    'invalid_setup_origin',
  );
  for (const key of ['modelSlug', 'modelOrg', ...(!reuse ? ['hannibalSlug', 'hannibalOrg'] : [])])
    requireValue(/^[a-z0-9][a-z0-9-]{1,127}$/.test(grant[key]), 'invalid_setup_target');
  for (const key of ['applicationId', 'modelListingId', ...(!reuse ? ['hannibalListingId'] : [])])
    requireValue(/^[a-f0-9-]{36}$/.test(grant[key]), 'invalid_setup_target');
  requireValue(
    /^gemini-[a-z0-9.-]+$/.test(grant.modelId) &&
      (reuse
        ? /^(?:[a-z0-9.-]+\.rds\.amazonaws\.com|db\.[a-z0-9]{20}\.supabase\.co|aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com)$/.test(
            grant.databaseHost,
          )
        : /^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(grant.databaseHost)),
    'invalid_setup_target',
  );
  if (reuse) {
    const url = new URL(grant.databaseUrl);
    const user = decodeURIComponent(url.username);
    const role = url.hostname.endsWith('.pooler.supabase.com')
      ? /^([a-z][a-z0-9_]{0,62})\.[a-z0-9]{20}$/.exec(user)?.[1]
      : user;
    requireValue(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname === grant.databaseHost &&
        Number(url.port || 5432) === 5432 &&
        url.password &&
        /^[a-z][a-z0-9_]{0,62}$/.test(grant.databaseName) &&
        !['template0', 'template1'].includes(grant.databaseName) &&
        decodeURIComponent(url.pathname.slice(1)) === grant.databaseName &&
        typeof role === 'string' &&
        /^[a-z][a-z0-9_]{0,62}$/.test(role) &&
        ![
          'postgres',
          'supabase_admin',
          'authenticator',
          'anon',
          'authenticated',
          'service_role',
        ].includes(role) &&
        [...url.searchParams.keys()].every((key) => key === 'sslmode') &&
        (!url.searchParams.has('sslmode') ||
          ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))),
      'existing_database_target_refused',
    );
    requireValue(
      grant.databaseCaPem === undefined ||
        (typeof grant.databaseCaPem === 'string' &&
          grant.databaseCaPem.length <= 32768 &&
          /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(
            grant.databaseCaPem,
          )),
      'invalid_database_ca',
    );
  }
  return { ...grant, apiUrl: grant.apiUrl.replace(/\/+$/, '') };
}

export function sealDatabaseReceipt(value, publicKey) {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return {
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
  };
}

export async function setupServices({
  root,
  projectName,
  grant: rawGrant,
  publicKey,
  fetch = globalThis.fetch,
  now = Date.now(),
  services = 'hannibal-gemini',
}) {
  const reuse = services === 'existing-postgres-gemini';
  const grant = parseSetupGrant(rawGrant, projectName, now, services);
  // Validate the verifier key before subscribing or provisioning anything.
  const verifier = createPublicKey({
    key: Buffer.from(publicKey, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  requireValue(
    verifier.asymmetricKeyType === 'rsa' && verifier.asymmetricKeyDetails.modulusLength >= 2048,
    'invalid_verifier',
  );
  requireValue(
    basename(root) === projectName &&
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === projectName,
    'setup_project_mismatch',
  );
  const envPath = join(root, '.env'),
    stateDir = join(root, '.precast'),
    statePath = join(stateDir, 'service-setup.json');
  for (const path of [envPath, stateDir, statePath])
    requireValue(!existsSync(path) || !lstatSync(path).isSymbolicLink(), 'setup_symlink_refused');
  let envText = readFileSync(envPath, 'utf8');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        projectName,
        grant.applicationId,
        grant.clientId,
        grant.modelListingId,
        grant.hannibalListingId,
        grant.databaseHost,
        ...(reuse
          ? [
              services,
              grant.databaseName,
              createHash('sha256').update(grant.databaseUrl).digest('hex'),
            ]
          : []),
      ]),
    )
    .digest('hex');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  requireValue(!state || state.fingerprint === fingerprint, 'setup_binding_changed');
  requireValue(state?.status !== 'database_request_started', 'database_outcome_needs_review');
  const before = parseEnvFile(envText);
  requireValue(
    state || !before.DATABASE_URL || /your-postgres-host|example\.com/.test(before.DATABASE_URL),
    'existing_database_refused',
  );
  const boundedFetch = (url, init = {}) =>
    fetch(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(180_000) });
  const app = {
    apiUrl: grant.apiUrl,
    tokenUrl: grant.tokenUrl,
    clientId: grant.clientId,
    clientSecret: grant.clientSecret,
  };
  const token = await mintToken({ ...app, fetch: boundedFetch });
  const rpc = async (name, args) => {
    const response = await boundedFetch(`${grant.apiUrl}/mcp`, {
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
    requireValue(response.ok, 'agentbase_request_refused');
    const body = await response.json();
    requireValue(!body.error && !body.result?.isError, 'agentbase_request_refused');
    return JSON.parse(body.result.content[0].text);
  };
  const models = await listModels({ apiUrl: grant.apiUrl, token, fetch: boundedFetch });
  const model = models.find(
    (m) =>
      m.slug === grant.modelSlug &&
      m.listingId === grant.modelListingId &&
      m.modelId === grant.modelId &&
      m.orgSlug === grant.modelOrg,
  );
  requireValue(model, 'approved_gemini_unavailable');
  let agentUrl;
  if (!reuse) {
    const agent = await rpc('agentbase.get_agent', { slug: grant.hannibalSlug });
    agentUrl = `${grant.apiUrl}/proxy/a2a/${grant.hannibalOrg}/${grant.hannibalSlug}`;
    requireValue(
      agent.listingId === grant.hannibalListingId &&
        agent.agentCardUrl === `${agentUrl}/.well-known/agent.json`,
      'approved_hannibal_unavailable',
    );
    const cardResponse = await boundedFetch(agent.agentCardUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    requireValue(cardResponse.ok, 'approved_hannibal_unavailable');
    const card = await cardResponse.json();
    requireValue(
      card.url === agentUrl && card.skills?.some((s) => s.id === 'provisionDatabaseTool'),
      'approved_hannibal_unavailable',
    );
  }
  for (const listingId of reuse
    ? [grant.modelListingId]
    : [grant.modelListingId, grant.hannibalListingId]) {
    const subscription = await rpc('agentbase.subscribe', { listingId });
    requireValue(
      subscription.status === 'ACTIVE' || subscription.subscription?.status === 'ACTIVE',
      'subscription_not_active',
    );
  }
  const modelUrl = `${grant.apiUrl}/proxy/llm/${grant.modelOrg}/${grant.modelSlug}/v1`;
  const smoke = await boundedFetch(`${modelUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: grant.modelId,
      messages: [{ role: 'user', content: 'Reply with exactly PRECAST_GEMINI_OK' }],
      max_tokens: 1024,
      stream: false,
    }),
  });
  requireValue(smoke.ok, 'gemini_call_failed');
  const reply = await smoke.json();
  requireValue(
    reply.choices?.[0]?.message?.content?.trim() === 'PRECAST_GEMINI_OK',
    'gemini_reply_unverified',
  );
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const saveState = (value) =>
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          fingerprint,
          projectName,
          applicationId: grant.applicationId,
          model: grant.modelId,
          ...value,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
  let connectionString = reuse
    ? grant.databaseUrl
    : state?.status === 'configured'
      ? before.DATABASE_URL
      : undefined;
  if (!connectionString) {
    // A lost reply is uncertain. A retry must not create a second database.
    saveState({ status: 'database_request_started' });
    const result = await askForDatabase({
      url: agentUrl,
      token,
      label: projectName,
      fetch: boundedFetch,
    });
    connectionString = extractConnectionString(result);
    requireValue(connectionString, 'hannibal_database_missing');
  }
  const database = new URL(connectionString);
  requireValue(
    ['postgres:', 'postgresql:'].includes(database.protocol) &&
      [...database.searchParams.keys()].every((key) => key === 'sslmode') &&
      database.hostname === grant.databaseHost &&
      Number(database.port || 5432) === 5432 &&
      database.username &&
      database.password &&
      !['', '/template0', '/template1', ...(!reuse ? ['/postgres'] : [])].includes(
        database.pathname,
      ) &&
      (!reuse || decodeURIComponent(database.pathname.slice(1)) === grant.databaseName),
    'database_target_refused',
  );
  if (reuse) database.searchParams.set('sslmode', 'verify-full');
  const databaseNamespace = reuse
    ? 'p_' + createHash('sha256').update(projectName).digest('hex').slice(0, 32)
    : undefined;
  const values = {
    AGENTBASE_URL: grant.apiUrl,
    AGENTBASE_TOKEN_URL: grant.tokenUrl,
    AGENTBASE_CLIENT_ID: grant.clientId,
    AGENTBASE_CLIENT_SECRET: grant.clientSecret,
    AGENTBASE_LLM_MODEL: grant.modelId,
    AGENTBASE_LLM_BASE_URL: modelUrl,
    DATABASE_URL: reuse ? database.toString() : connectionString,
    ...(reuse
      ? { PRECAST_DB_NAMESPACE: databaseNamespace, MASTRA_DB_SCHEMA: databaseNamespace + '_agents' }
      : {}),
  };
  if (reuse && grant.databaseCaPem) {
    const caPath = join(stateDir, 'database-ca.pem');
    requireValue(
      !existsSync(caPath) || !lstatSync(caPath).isSymbolicLink(),
      'setup_symlink_refused',
    );
    writeFileSync(caPath, grant.databaseCaPem, { mode: 0o600 });
    values.NODE_EXTRA_CA_CERTS = caPath;
  }
  for (const [key, value] of Object.entries(values)) envText = setEnvValue(envText, key, value);
  writeFileSync(envPath, envText, { mode: 0o600 });
  restrictEnvFile(envPath);
  saveState({
    status: 'configured',
    geminiCallVerified: true,
    database: database.pathname.slice(1),
    databaseVerification: 'pending_server_check',
    ...(reuse
      ? {
          databaseMode: 'existing',
          databaseCaFile: Boolean(grant.databaseCaPem),
          databaseUser: database.hostname.endsWith('.pooler.supabase.com')
            ? decodeURIComponent(database.username).split('.')[0]
            : decodeURIComponent(database.username),
          databaseNamespace,
        }
      : {}),
  });
  return {
    projectName,
    applicationId: grant.applicationId,
    model: grant.modelId,
    geminiCallVerified: true,
    database: database.pathname.slice(1),
    databaseHost: database.hostname,
    ...(reuse ? { databaseMode: 'existing' } : {}),
    receipt: sealDatabaseReceipt(
      {
        projectName,
        applicationId: grant.applicationId,
        connectionString: reuse ? database.toString() : connectionString,
        ...(reuse && grant.databaseCaPem ? { databaseCaPem: grant.databaseCaPem } : {}),
      },
      publicKey,
    ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = Object.fromEntries(
      process.argv.slice(2).map((arg) => {
        const i = arg.indexOf('=');
        requireValue(i > 2, 'invalid_setup_arguments');
        return [arg.slice(2, i), arg.slice(i + 1)];
      }),
    );
    requireValue(
      Object.keys(args).length === 3 &&
        ['hannibal-gemini', 'existing-postgres-gemini'].includes(args.services),
      'explicit_setup_required',
    );
    const fd = process.env[`RAYA_SECRET_FD_${SETUP_ALIAS.toUpperCase()}`];
    requireValue(/^[3-6]$/.test(fd ?? ''), 'setup_secret_not_granted');
    const grant = readFileSync(Number(fd), 'utf8');
    const result = await setupServices({
      root: process.cwd(),
      projectName: args['project-name'],
      grant,
      publicKey: args['verification-key'],
      services: args.services,
    });
    process.stdout.write(RECEIPT_PREFIX + JSON.stringify(result) + '\n');
  } catch (error) {
    // Neither upstream error text nor the database agent's reply may reach model-visible logs.
    process.stderr.write(
      `Service setup did not finish${error instanceof SetupError ? ` (${error.message})` : ''}. Check the approved project credential, subscriptions and service evidence; an uncertain database request requires review before retry.\n`,
    );
    process.exitCode = 1;
  }
}
