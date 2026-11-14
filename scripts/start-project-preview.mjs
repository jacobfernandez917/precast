#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  openSync,
  closeSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseEnvFile, setEnvValue } from './provision-db.mjs';
import { portsFrom } from './poc.mjs';

export const PREVIEW_ALIAS = 'precast_project_preview';
export const PREVIEW_PREFIX = 'PRECAST_PROJECT_PREVIEW:';
export const PUBLIC_URL = /^https:\/\/[a-z2-7]{26}\.srv\.us$/;
class PreviewError extends Error {}
const requireValue = (ok, stage) => {
  if (!ok) throw new PreviewError(stage);
};

export function parsePreviewApproval(raw, projectName, expiresAt, now = Date.now()) {
  const approval = JSON.parse(raw);
  const reuse = approval?.databaseMode === 'existing';
  const keys = [
    'projectName',
    'applicationId',
    'databaseHost',
    'relayHost',
    'httpsDomains',
    'expiresAt',
    ...(reuse ? ['databaseMode'] : []),
  ];
  requireValue(
    approval &&
      !Array.isArray(approval) &&
      Object.keys(approval).length === keys.length &&
      keys.every((key) => Object.hasOwn(approval, key)),
    'invalid_preview_approval',
  );
  requireValue(
    /^[a-z][a-z0-9-]{1,62}$/.test(projectName) && approval.projectName === projectName,
    'preview_project_mismatch',
  );
  requireValue(
    /^[a-f0-9-]{36}$/.test(approval.applicationId) &&
      approval.relayHost === 'srv.us' &&
      (reuse
        ? /^(?:[a-z0-9.-]+\.rds\.amazonaws\.com|db\.[a-z0-9]{20}\.supabase\.co|aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com)$/.test(
            approval.databaseHost,
          )
        : /^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(approval.databaseHost)),
    'invalid_preview_target',
  );
  requireValue(
    Array.isArray(approval.httpsDomains) &&
      approval.httpsDomains.length <= 8 &&
      approval.httpsDomains.every(
        (host) => typeof host === 'string' && /^[a-z0-9.-]+\.[a-z]{2,63}$/.test(host),
      ),
    'invalid_preview_target',
  );
  const expiry = Date.parse(expiresAt);
  requireValue(
    Number.isFinite(expiry) &&
      expiry > now + 60_000 &&
      expiry <= Date.parse(approval.expiresAt) &&
      expiry <= now + 8 * 3600000,
    'preview_window_invalid',
  );
  return { ...approval, expiresAt: new Date(expiry).toISOString() };
}

export function privatePreviewDirectory(root) {
  for (const suffix of ['', 'preview']) {
    const path = join(root, '.precast', suffix);
    requireValue(!existsSync(path) || !lstatSync(path).isSymbolicLink(), 'preview_symlink_refused');
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const dir = join(root, '.precast', 'preview');
  for (const name of [
    'config.json',
    'srv.json',
    'id_rsa',
    'host_sha256',
    'tunnel.log',
    'start.log',
  ])
    requireValue(
      !existsSync(join(dir, name)) || !lstatSync(join(dir, name)).isSymbolicLink(),
      'preview_symlink_refused',
    );
  return dir;
}

export async function verifyPreviewDatabase(root, env, expectedHost, connect, options = {}) {
  const url = new URL(env.DATABASE_URL);
  requireValue(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === expectedHost &&
      Number(url.port || 5432) === 5432 &&
      url.username &&
      url.password &&
      [...url.searchParams.keys()].every((key) => key === 'sslmode') &&
      !['', '/template0', '/template1', ...(!options.reuse ? ['/postgres'] : [])].includes(
        url.pathname,
      ) &&
      (!options.reuse || decodeURIComponent(url.pathname.slice(1)) === options.databaseName),
    'preview_database_mismatch',
  );
  url.searchParams.delete('sslmode');
  const config = {
    connectionString: url.toString(),
    connectionTimeoutMillis: 15000,
    statement_timeout: 10000,
    ssl: {
      ...(options.reuse
        ? options.caPem
          ? { ca: options.caPem }
          : {}
        : { ca: readFileSync(join(root, 'scripts/certs/rds-global-bundle.pem'), 'utf8') }),
      rejectUnauthorized: true,
    },
  };
  const client = connect
    ? connect(config)
    : new (createRequire(join(root, 'package.json'))('pg').Client)(config);
  try {
    await client.connect();
    requireValue(
      (await client.query('SELECT 1 AS ok')).rows[0]?.ok === 1,
      'preview_database_unverified',
    );
    const role = (
      await client.query(
        'SELECT current_database() AS database, current_user AS username, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    requireValue(
      role?.database === decodeURIComponent(url.pathname.slice(1)) &&
        role?.username === (options.databaseUser ?? decodeURIComponent(url.username)) &&
        role.rolsuper === false &&
        role.rolcreatedb === false &&
        role.rolcreaterole === false,
      'preview_database_role_refused',
    );
  } finally {
    await client.end();
  }
}

export async function startProjectPreview({
  root,
  projectName,
  expiresAt,
  rawApproval,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const approval = parsePreviewApproval(rawApproval, projectName, expiresAt);
  requireValue(
    basename(root) === projectName &&
      basename(resolve(root, '..')) === 'Projects' &&
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === projectName,
    'preview_project_mismatch',
  );
  for (const path of ['.env', '.precast/service-setup.json'])
    requireValue(
      existsSync(join(root, path)) && !lstatSync(join(root, path)).isSymbolicLink(),
      'connected_project_required',
    );
  const state = JSON.parse(readFileSync(join(root, '.precast/service-setup.json'), 'utf8'));
  const reuse = approval.databaseMode === 'existing';
  requireValue(
    state.status === 'configured' &&
      state.projectName === projectName &&
      state.applicationId === approval.applicationId &&
      state.geminiCallVerified === true &&
      (reuse ? state.databaseMode === 'existing' : state.databaseMode !== 'existing'),
    'connected_project_required',
  );
  let text = readFileSync(join(root, '.env'), 'utf8');
  const env = parseEnvFile(text);
  const { webPort } = portsFrom(env);
  requireValue(
    Number.isInteger(webPort) && webPort >= 1024 && webPort <= 65535,
    'invalid_preview_port',
  );
  const dir = privatePreviewDirectory(root);
  if (existsSync(join(dir, 'srv.json'))) {
    const previous = JSON.parse(readFileSync(join(dir, 'srv.json'), 'utf8'));
    if (previous.pid) {
      let live = false;
      try {
        process.kill(previous.pid, 0);
        live = true;
      } catch {
        /* The saved process has already ended. */
      }
      requireValue(!live, 'existing_preview_requires_review');
    }
  }
  const caPath = reuse && state.databaseCaFile ? join(root, '.precast/database-ca.pem') : undefined;
  requireValue(
    !caPath || (existsSync(caPath) && !lstatSync(caPath).isSymbolicLink()),
    'preview_database_ca_refused',
  );
  await verifyPreviewDatabase(
    root,
    env,
    approval.databaseHost,
    undefined,
    reuse
      ? {
          reuse: true,
          databaseName: state.database,
          databaseUser: state.databaseUser,
          ...(caPath ? { caPem: readFileSync(caPath, 'utf8') } : {}),
        }
      : {},
  );
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      projectName,
      projectPath: `Projects/${projectName}`,
      applicationId: approval.applicationId,
      webPort,
      expiresAt: approval.expiresAt,
    }),
    { mode: 0o600 },
  );
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('RAYA_SECRET_FD_')),
  );
  const log = openSync(join(dir, 'tunnel.log'), 'a', 0o600);
  const tunnel = spawn(process.execPath, ['scripts/preview-tunnel.mjs'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: childEnv,
  });
  tunnel.unref();
  closeSync(log);
  let started = false;
  try {
    let tunnelState;
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const current = JSON.parse(readFileSync(join(dir, 'srv.json'), 'utf8'));
        if (
          current.pid === tunnel.pid &&
          current.state === 'ready' &&
          PUBLIC_URL.test(current.url)
        ) {
          tunnelState = current;
          break;
        }
      } catch {
        /* The tunnel has not published its state yet. */
      }
      await wait(1000);
    }
    requireValue(tunnelState, 'preview_tunnel_not_ready');
    for (const [key, value] of Object.entries({
      PRECAST_AGENT_MODE: 'project',
      PRECAST_LOCAL_AGENTS: '1',
      BETTER_AUTH_URL: tunnelState.url,
      ...(!reuse
        ? { NODE_EXTRA_CA_CERTS: join(root, 'scripts/certs/rds-global-bundle.pem') }
        : caPath
          ? { NODE_EXTRA_CA_CERTS: caPath }
          : {}),
    }))
      text = setEnvValue(text, key, value);
    const database = new URL(env.DATABASE_URL);
    database.searchParams.set('sslmode', 'verify-full');
    text = setEnvValue(text, 'DATABASE_URL', database.toString());
    writeFileSync(join(root, '.env'), text, { mode: 0o600 });
    chmodSync(join(root, '.env'), 0o600);
    const poc = spawnSync(process.execPath, ['scripts/poc.mjs', '--no-build'], {
      cwd: root,
      env: childEnv,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    });
    writeFileSync(join(dir, 'start.log'), (poc.stdout ?? '') + (poc.stderr ?? ''), { mode: 0o600 });
    requireValue(poc.status === 0, 'preview_app_start_failed');
    const health = await fetch(`http://127.0.0.1:${webPort}/api/health`, {
      signal: AbortSignal.timeout(10000),
    });
    const body = await health.json();
    requireValue(
      health.ok && body.status === 'ok' && body.signIn === 'ready',
      'preview_sign_in_not_ready',
    );
    started = true;
    return {
      projectName,
      projectPath: `Projects/${projectName}`,
      applicationId: approval.applicationId,
      provider: 'srv.us',
      url: tunnelState.url,
      expiresAt: approval.expiresAt,
      signInRequired: true,
    };
  } finally {
    if (!started) {
      try {
        tunnel.kill('SIGTERM');
      } catch {
        /* The child may already have exited. */
      }
      spawnSync(process.execPath, ['scripts/poc.mjs', '--stop'], {
        cwd: root,
        env: childEnv,
        stdio: 'ignore',
        timeout: 15000,
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = Object.fromEntries(
      process.argv.slice(2).map((arg) => {
        const i = arg.indexOf('=');
        requireValue(i > 2, 'explicit_preview_required');
        return [arg.slice(2, i), arg.slice(i + 1)];
      }),
    );
    requireValue(
      Object.keys(args).length === 3 && args.provider === 'srv.us',
      'explicit_preview_required',
    );
    const fd = process.env[`RAYA_SECRET_FD_${PREVIEW_ALIAS.toUpperCase()}`];
    requireValue(/^[3-6]$/.test(fd ?? ''), 'preview_approval_not_granted');
    const result = await startProjectPreview({
      root: process.cwd(),
      projectName: args['project-name'],
      expiresAt: args['expires-at'],
      rawApproval: readFileSync(Number(fd), 'utf8'),
    });
    process.stdout.write(PREVIEW_PREFIX + JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(
      `Project preview did not finish${error instanceof PreviewError ? ` (${error.message})` : ''}. Check the saved project approval and retained private preview logs. No working URL is being claimed.\n`,
    );
    process.exitCode = 1;
  }
}
