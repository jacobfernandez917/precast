#!/usr/bin/env node
/**
 * poc.mjs — get a running, clickable proof of concept in ONE command, with nothing but Node.
 *
 *   pnpm poc              # build both apps, (re)start them, wait for health, print URLs
 *   pnpm poc web          # rebuild + restart ONLY `web` (then health-check + print URLs)
 *   pnpm poc web agents   # ...or several apps
 *   pnpm poc --no-build   # restart on the last build
 *   pnpm poc --timeout=300
 *   pnpm stop             # stop them (pnpm poc --stop)
 *   pnpm logs [web]       # what each app wrote last (pnpm poc --logs)
 *
 * Why this exists: the slowest part of a Precast build used to be the gap
 * between "the code is written" and "the user can SEE it" — which meant an hour
 * of work could land on an output nobody wanted. This collapses that gap to one
 * command whose last line is a URL, so a proof of concept can be put in front of
 * the user for feedback BEFORE the build is hardened (CLAUDE.md §4.0).
 *
 * The apps run as the same production bundles AgentBase builds into its image
 * (the Mastra output, Next's standalone server), as background Node processes
 * bound to 127.0.0.1. Nothing local needs a container: Postgres is remote and
 * sign-in runs inside the web app. Each app's process id and log are kept in
 * `.precast/run/` (git-ignored), which is how a later run finds and replaces them.
 *
 * The app-name form exists for the "reflect the change" rule (CLAUDE.md §4.0):
 * after any substantial previewable change, the running preview must be
 * refreshed and the URLs re-shown. A running process keeps serving the build it
 * started with, so naming an app rebuilds it and restarts just that one.
 *
 * Steps: Node check → secrets → build → stop the old process → start → poll each
 * app's health → wait for sign-in → print the URLs (and, on failure, the cause).
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureLocalSecrets } from './local-secrets.mjs';
import { parseEnvFile } from './provision-db.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RUN_DIR = join(rootDir, '.precast', 'run');
/** The oldest Node line Precast supports; `.nvmrc` follows the current LTS. */
export const MIN_NODE_MAJOR = 24;
/** Every app is bound here: the preview is for this computer, not the network it is on. */
export const LOCAL_HOST = '127.0.0.1';

/**
 * How each app is built, prepared and started: the same steps as its Dockerfile, so the
 * preview runs what AgentBase will run. `env` is what the process needs on top of `.env`.
 */
export function appsFor({ agentsPort, webPort, localAgents }) {
  return {
    agents: {
      build: [['--filter', './apps/agents', 'build']],
      outputs: ['apps/agents/.mastra/output/index.mjs', 'apps/agents/.mastra/output/telemetry.mjs'],
      cwd: 'apps/agents/.mastra/output',
      // --import ./telemetry.mjs starts OpenTelemetry before the app graph, as the image does.
      command: ['--dns-result-order=ipv4first', '--import', './telemetry.mjs', 'index.mjs'],
      env: {
        NODE_ENV: 'production',
        MASTRA_HOST: LOCAL_HOST,
        MASTRA_PORT: String(agentsPort),
        MASTRA_TELEMETRY_DISABLED: '1',
      },
      port: agentsPort,
      // A 401 is healthy: /api/agents needs the bearer, which this probe does not send.
      health: { path: '/api/agents', ok: (status) => status < 500 },
    },
    web: {
      build: [['--filter', './apps/web', 'build']],
      outputs: ['apps/web/.next/standalone/apps/web/server.js'],
      // Next's standalone server serves static files and public/ only from beside itself.
      prepare: [
        ['apps/web/.next/static', 'apps/web/.next/standalone/apps/web/.next/static'],
        ['apps/web/public', 'apps/web/.next/standalone/apps/web/public'],
      ],
      cwd: 'apps/web/.next/standalone',
      command: ['--dns-result-order=ipv4first', 'apps/web/server.js'],
      env: {
        NODE_ENV: 'production',
        HOSTNAME: LOCAL_HOST,
        PORT: String(webPort),
        MASTRA_INTERNAL_URL: `http://${LOCAL_HOST}:${agentsPort}`,
        PRECAST_LOCAL_AGENTS: localAgents ? '1' : '0',
      },
      port: webPort,
      health: { path: '/api/health', ok: (status) => status >= 200 && status < 300 },
    },
  };
}

export const APP_NAMES = ['agents', 'web'];

/**
 * Which apps to run. Both by default; only the web app once AgentBase hosts the agents
 * (`PRECAST_LOCAL_AGENTS=0`), since the local copy would answer nobody. Naming an app
 * runs it either way, so Mastra Studio stays one command away.
 */
export function appsToRun(env, named = []) {
  if (named.length) return APP_NAMES.filter((a) => named.includes(a));
  return env.PRECAST_LOCAL_AGENTS === '0' ? ['web'] : [...APP_NAMES];
}

/** The ports from `.env` (set by bootstrap or `pnpm set-ports`). */
export function portsFrom(env) {
  return {
    agentsPort: Number(env.MASTRA_PORT) || 45000,
    webPort: Number(env.WEB_PORT) || 45001,
  };
}

const pidFile = (app) => join(RUN_DIR, `${app}.pid`);
const logFile = (app) => join(RUN_DIR, `${app}.log`);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The process a pid file names, if it is still ours: a reused pid is someone else's. */
function ourProcess(app) {
  if (!existsSync(pidFile(app))) return null;
  const pid = Number(readFileSync(pidFile(app), 'utf8').trim());
  if (!pid || !alive(pid)) return null;
  if (process.platform !== 'win32') {
    const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    // Next renames its process to `next-server (vX)`, so the entry file is not always visible.
    const ours = app === 'agents' ? /index\.mjs/ : /server\.js|next-server/;
    if (!ours.test(ps.stdout ?? '')) return null;
  }
  return pid;
}

export async function stopApp(app) {
  const pid = ourProcess(app);
  rmSync(pidFile(app), { force: true });
  if (!pid) return false;
  // The app was started in its own process group, so this stops anything it spawned too.
  const signal = (sig) => {
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, sig);
    } catch {
      // already gone
    }
  };
  signal('SIGTERM');
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 200));
  if (alive(pid)) signal('SIGKILL');
  return true;
}

/** Is the port free on the address the app binds? */
export function isPortFree(port, host = LOCAL_HOST) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function run(cmd, cmdArgs) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const res = spawnSync(cmd, cmdArgs, { cwd: rootDir, stdio: 'inherit', shell: false });
  return res.status ?? 1;
}

function tail(app, lines = 15) {
  if (!existsSync(logFile(app))) return '';
  return readFileSync(logFile(app), 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

function startApp(app, spec, fileEnv) {
  mkdirSync(RUN_DIR, { recursive: true });
  const log = openSync(logFile(app), 'w');
  const child = spawn(process.execPath, spec.command, {
    cwd: join(rootDir, spec.cwd),
    env: { ...process.env, ...fileEnv, ...spec.env },
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();
  writeFileSync(pidFile(app), String(child.pid));
  return child.pid;
}

/** Poll until the app answers healthy, or its process exits, or time runs out. */
async function waitForHealth(app, spec, pid, timeoutMs) {
  const url = `http://${LOCAL_HOST}:${spec.port}${spec.health.path}`;
  process.stdout.write(`\nWaiting for ${app} (${url}) `);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!alive(pid)) return 'exited';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (spec.health.ok(res.status)) return 'ok';
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return 'timeout';
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write('.');
  }
}

/** What each sign-in state means, and what to do about it. */
const SIGN_IN_REASONS = {
  'missing-secret': 'BETTER_AUTH_SECRET is not set. Run pnpm poc again; it creates one.',
  'missing-database':
    'the project has no database. Run pnpm db:provision, or put a Postgres address in DATABASE_URL.',
  'database-error':
    'the sign-in tables could not be created in the database. pnpm logs web says why.',
  starting: 'it was still preparing after 30 seconds.',
};

/** Undefined once sign-in is ready, else the last reason reported. */
async function waitForSignIn(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let reason = 'starting';
  while (Date.now() < deadline) {
    try {
      const body = await (await fetch(url)).json();
      if (body.signIn === undefined || body.signIn === 'ready') return undefined;
      reason = body.signIn;
      if (reason !== 'starting') return reason;
    } catch {
      // not answering yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return reason;
}

/** A placeholder DATABASE_URL passes validation and fails as a hang; say so before building. */
export function databaseProblem(env) {
  const url = env.DATABASE_URL?.trim();
  if (!url) return 'DATABASE_URL is empty';
  if (/your-postgres-host|example\.com/.test(url)) return 'DATABASE_URL is still the placeholder';
  return null;
}

function readEnv() {
  const path = join(rootDir, '.env');
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const named = args.filter((a) => !a.startsWith('-'));
  const unknown = named.filter((a) => !APP_NAMES.includes(a));
  if (unknown.length) {
    throw new Error(`Unknown app: ${unknown.join(', ')}. The apps are ${APP_NAMES.join(' and ')}.`);
  }

  if (args.includes('--stop')) {
    for (const app of named.length ? named : APP_NAMES) {
      console.log((await stopApp(app)) ? `Stopped ${app}.` : `${app} was not running.`);
    }
    return;
  }
  if (args.includes('--logs')) {
    for (const app of named.length ? named : APP_NAMES) {
      const lines = tail(app, 60);
      console.log(`── ${app} ${'─'.repeat(60)}\n${lines || '(no log yet)'}\n`);
    }
    return;
  }

  console.log('── Precast PoC — build it, start it, show it ─────────────────────\n');

  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(
      `This project needs Node ${MIN_NODE_MAJOR} or newer, and this computer has ${process.versions.node}. ` +
        'Install the current LTS from nodejs.org (or run nvm install), then pnpm poc again.',
    );
  }
  if (!existsSync(join(rootDir, '.env'))) {
    throw new Error('There is no .env yet. Run cp .env.example .env, then pnpm connect.');
  }
  // Secrets this machine needs (the agents' bearer, the sign-in secret): added
  // when missing, so a project made before one existed still starts.
  const minted = ensureLocalSecrets(join(rootDir, '.env'));
  if (minted.length) console.log(`Created ${minted.join(' and ')} for this project in .env.`);

  const env = readEnv();
  const dbProblem = databaseProblem(env);
  if (dbProblem) {
    throw new Error(
      `${dbProblem}, so the agents could not start. Run pnpm db:provision, or paste a postgresql:// address into DATABASE_URL in .env.`,
    );
  }

  const ports = portsFrom(env);
  const localAgents = env.PRECAST_LOCAL_AGENTS !== '0';
  const apps = appsFor({ ...ports, localAgents });
  const chosen = appsToRun(env, named);
  const noBuild = args.includes('--no-build');
  const timeoutArg = args.find((a) => a.startsWith('--timeout='));
  const timeoutMs = (Number(timeoutArg?.split('=')[1]) || 180) * 1000;

  if (named.length) console.log(`Refreshing only: ${chosen.join(', ')}`);
  if (!named.length && !chosen.includes('agents')) {
    console.log(
      'AgentBase hosts the agents (PRECAST_LOCAL_AGENTS=0), so only the web app runs here.',
    );
  }

  // 1. Build: the shared packages, then each chosen app, exactly as its Dockerfile does.
  if (!existsSync(join(rootDir, 'node_modules'))) {
    if (run('pnpm', ['install', '--frozen-lockfile']) !== 0) {
      throw new Error('pnpm install failed; the lines above say why.');
    }
  }
  if (!noBuild) {
    const steps = [
      ['--filter', './packages/shared', '--filter', './packages/a2ui', 'build'],
      ...chosen.flatMap((app) => apps[app].build),
    ];
    for (const step of steps) {
      if (run('pnpm', step) !== 0) {
        throw new Error(
          'The build failed; the lines above say where. Fix it and run pnpm poc again.',
        );
      }
    }
  }
  for (const app of chosen) {
    const missing = apps[app].outputs.filter((f) => !existsSync(join(rootDir, f)));
    if (missing.length) {
      throw new Error(`${app} has no build yet (${missing[0]}). Run pnpm poc without --no-build.`);
    }
    for (const [from, to] of apps[app].prepare ?? []) {
      if (existsSync(join(rootDir, from))) {
        rmSync(join(rootDir, to), { recursive: true, force: true });
        cpSync(join(rootDir, from), join(rootDir, to), { recursive: true });
      }
    }
  }

  // 2. Replace the running copies. A port taken by something else is named, not fought over.
  for (const app of chosen) {
    await stopApp(app);
    if (!(await isPortFree(apps[app].port))) {
      throw new Error(
        `Port ${apps[app].port} (${app}) is in use by another program. Close it, or give this project new ports with pnpm set-ports --auto.`,
      );
    }
  }
  const pids = {};
  for (const app of chosen) pids[app] = startApp(app, apps[app], env);

  // 3. Health. "Started" is not "serving": poll the real endpoints so the URLs
  //    printed below are ones that answer.
  const failed = [];
  for (const app of chosen) {
    const state = await waitForHealth(app, apps[app], pids[app], timeoutMs);
    console.log(state === 'ok' ? ' ✅' : ' ❌');
    if (state !== 'ok') failed.push({ app, state });
  }
  if (failed.length) {
    for (const { app, state } of failed) {
      console.error(
        `\n❌ ${app} ${state === 'exited' ? 'stopped while starting' : 'did not answer in time'}. Its last lines:\n`,
      );
      console.error(tail(app) || '(nothing logged)');
    }
    console.error('\n   The usual causes, most likely first:');
    console.error(
      '     • DATABASE_URL is wrong, or the database cannot be reached  → pnpm db:provision, or fix it in .env',
    );
    console.error('     • not connected to AgentBase, or no model chosen          → pnpm connect');
    console.error('   All of it: pnpm logs        Stop: pnpm stop');
    process.exit(1);
  }

  // The web app answers before it can sign anyone in, and chat needs sign-in, so
  // "healthy" alone would announce an app nobody can use. Wait for sign-in.
  if (chosen.includes('web')) {
    const reason = await waitForSignIn(`http://${LOCAL_HOST}:${ports.webPort}/api/health`);
    if (reason) {
      console.error(
        `\n❌ The app is up, but nobody can sign in yet: ${SIGN_IN_REASONS[reason] ?? reason}`,
      );
      process.exit(1);
    }
  }

  // The URLs are the whole point of this script — print them on EVERY run,
  // including a targeted refresh, so the user never has to remember or hunt for
  // the port (CLAUDE.md §4.0: always re-show how to access the preview).
  console.log(
    named.length
      ? `\n✅ Refreshed ${chosen.join(', ')} — the preview now serves the new build. Open these:\n`
      : '\n✅ PoC is up — open these:\n',
  );
  const running = APP_NAMES.filter((a) => chosen.includes(a) || ourProcess(a));
  if (running.includes('web')) console.log(`   Web app         http://localhost:${ports.webPort}`);
  if (running.includes('agents')) {
    console.log(`   Mastra Studio   http://localhost:${ports.agentsPort}`);
  }
  console.log('\n   Logs:  pnpm logs        Stop:  pnpm stop');
  console.log(
    named.length
      ? '\nTell the user what changed and re-share the URL above — a change they cannot see is not delivered.'
      : '\nShow this to whoever asked for it and collect feedback BEFORE hardening.',
  );
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
