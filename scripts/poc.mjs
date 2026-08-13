#!/usr/bin/env node
/**
 * poc.mjs — get a running, clickable proof of concept in ONE command.
 *
 *   pnpm poc              # build + start the whole stack, wait for health, print URLs
 *   pnpm poc web          # rebuild + restart ONLY `web` (then health-check + print URLs)
 *   pnpm poc web agents   # ...or several services
 *   pnpm poc --wait       # ...and wait for Docker itself to be installed/started
 *   pnpm poc --no-build   # reuse existing images (faster re-up)
 *   pnpm poc --timeout=300
 *
 * Why this exists: the slowest part of a Precast build used to be the gap
 * between "the code is written" and "the user can SEE it" — which meant an hour
 * of work could land on an output nobody wanted. This collapses that gap to one
 * command whose last line is a URL, so a proof of concept can be put in front of
 * the user for feedback BEFORE the build is hardened (CLAUDE.md §4.0).
 *
 * The service-name form exists for the "reflect the change" rule (CLAUDE.md
 * §4.0): after any substantial previewable change, the running preview must be
 * refreshed and the URLs re-shown. Code is baked into the image, so a plain
 * `restart` would keep serving the OLD build — targeting a service rebuilds that
 * image and recreates just that container, which is much faster than the whole
 * stack while still guaranteeing the preview shows the new code.
 *
 * Steps: Docker preflight → compose up (build) → poll each service's health →
 * print the URLs (and, on failure, the exact log command to run).
 */

import { spawnSync } from 'node:child_process';
import { resolveBaseImage } from './deps-image.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerStatus } from './check-docker.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const waitForDocker = args.includes('--wait');
const timeoutArg = args.find((a) => a.startsWith('--timeout='));
const healthTimeoutMs = (Number(timeoutArg?.split('=')[1]) || 240) * 1000;

const SERVICES = ['agents', 'web', 'keycloak'];
// Bare (non-flag) args name the services to rebuild + recreate. Empty = whole stack.
const targeted = args.filter((a) => !a.startsWith('-'));
const unknown = targeted.filter((s) => !SERVICES.includes(s));
if (unknown.length) {
  console.error(`❌ Unknown service(s): ${unknown.join(', ')}. Valid: ${SERVICES.join(', ')}.`);
  process.exit(1);
}

/** Read a var from the root .env (falling back to .env.example, then a default). */
function envVar(name, fallback) {
  for (const file of ['.env', '.env.example']) {
    const p = join(rootDir, file);
    if (!existsSync(p)) continue;
    const hit = readFileSync(p, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    const val = hit?.[1]?.trim();
    if (val) return val;
  }
  return fallback;
}

function activeProfiles() {
  return envVar('COMPOSE_PROFILES', 'agents,web,keycloak')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function run(cmd, cmdArgs, { allowFail = false, env } = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const res = spawnSync(cmd, cmdArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (res.status !== 0 && !allowFail) process.exit(res.status ?? 1);
  return res.status ?? 0;
}

/** Poll a URL until it answers with any HTTP response (not necessarily 2xx). */
async function waitForHttp(url, { timeoutMs, expectOk = true }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!expectOk || res.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write('.');
  }
}

async function main() {
  console.log('── Precast PoC — bring the stack up and show it ──────────────────\n');

  // 1. Container runtime. `--wait` is the first-run path: the user installs
  //    Docker Desktop while this polls, then the build continues by itself.
  if (dockerStatus() !== 'running') {
    const status = run('node', ['scripts/check-docker.mjs', ...(waitForDocker ? ['--wait'] : [])], {
      allowFail: true,
    });
    if (status !== 0) {
      console.error('\n❌ No container runtime — cannot start the PoC stack.');
      console.error('   Install/start Docker, then re-run:  pnpm poc');
      process.exit(1);
    }
  }

  if (!existsSync(join(rootDir, '.env'))) {
    console.error('❌ .env not found at the repo root. Fix: cp .env.example .env');
    process.exit(1);
  }

  const profiles = activeProfiles();
  const mastraPort = envVar('AGENTS_HOST_PORT', envVar('MASTRA_PORT', '4111'));
  const webPort = envVar('WEB_HOST_PORT', envVar('WEB_PORT', '3000'));
  const keycloakPort = envVar('KEYCLOAK_HOST_PORT', '8080');

  // 2. Build + start. The first build pulls base images and compiles both apps,
  //    so it is the slow step — everything after it is seconds.
  //
  //    Targeting services rebuilds and recreates only those. Two flags matter:
  //    `--force-recreate` because a change that yields an identical image digest
  //    (or only an `.env` edit) would otherwise leave the old container running
  //    and the preview would silently serve stale output; and `--no-deps`
  //    because `web` declares `depends_on: agents`, so without it Compose
  //    force-recreates agents too — turning "refresh just web" into a restart of
  //    half the stack (measured: agents was recreated as well). The trade-off is
  //    that a targeted refresh won't START a stopped dependency — the health
  //    poll below catches that and names it.
  console.log(`\nServices (COMPOSE_PROFILES): ${profiles.join(', ')}`);
  if (targeted.length) {
    const skipped = targeted.filter((s) => !profiles.includes(s));
    if (skipped.length) {
      console.log(
        `⚠️  Not in COMPOSE_PROFILES, so not started: ${skipped.join(', ')} ` +
          '(add them to COMPOSE_PROFILES in .env if you expected them to run).',
      );
    }
    console.log(`Refreshing only: ${targeted.join(', ')}`);
  }
  // Swap in a prebuilt dependency image when one matches this lockfile. Purely
  // an accelerator: if nothing is published, unreachable, or disabled, the
  // build args fall through to the Dockerfile default and nothing changes.
  const base = noBuild ? { ref: null, reason: 'skipped (--no-build)' } : resolveBaseImage();
  if (base.ref) {
    console.log(`\nDependency layer: ${base.ref}\n  (${base.reason})`);
  } else if (!noBuild) {
    console.log(`\nDependency layer: building from source — ${base.reason}`);
  }

  run(
    'node',
    [
    'scripts/docker-compose.mjs',
    '-f',
    'docker/docker-compose.yml',
    '-f',
    'docker/docker-compose.override.yml',
    'up',
    '-d',
    ...(noBuild ? [] : ['--build']),
      ...(targeted.length ? ['--force-recreate', '--no-deps', ...targeted] : []),
    ],
    base.ref ? { env: { BASE_IMAGE: base.ref } } : {},
  );

  // 3. Health. Compose reports "started", not "serving" — poll the real
  //    endpoints so the URLs we print are ones that actually answer.
  const checks = [];
  if (profiles.includes('agents')) {
    checks.push({ name: 'agents', url: `http://localhost:${mastraPort}/api/agents` });
  }
  if (profiles.includes('web')) {
    checks.push({ name: 'web', url: `http://localhost:${webPort}/api/health` });
  }
  if (profiles.includes('keycloak')) {
    // Keycloak's root redirects; any response means it is serving.
    checks.push({ name: 'keycloak', url: `http://localhost:${keycloakPort}/`, expectOk: false });
  }

  const failed = [];
  for (const c of checks) {
    process.stdout.write(`\nWaiting for ${c.name} (${c.url}) `);
    const ok = await waitForHttp(c.url, {
      timeoutMs: healthTimeoutMs,
      expectOk: c.expectOk !== false,
    });
    console.log(ok ? ' ✅' : ' ❌');
    if (!ok) failed.push(c.name);
  }

  if (failed.length) {
    console.error(`\n❌ Not healthy in time: ${failed.join(', ')}`);
    console.error('   See what happened:   pnpm docker:logs');
    console.error('   Then bring it down:  pnpm docker:down');
    process.exit(1);
  }

  // The URLs are the whole point of this script — print them on EVERY run,
  // including a targeted refresh, so the user never has to remember or hunt for
  // the port (CLAUDE.md §4.0: always re-show how to access the preview).
  console.log(
    targeted.length
      ? `\n✅ Refreshed ${targeted.join(', ')} — the preview now serves the new build. Open these:\n`
      : '\n✅ PoC is up — open these:\n',
  );
  if (profiles.includes('web')) console.log(`   Web app         http://localhost:${webPort}`);
  if (profiles.includes('agents')) {
    console.log(`   Mastra Studio   http://localhost:${mastraPort}`);
  }
  if (profiles.includes('keycloak')) {
    console.log(
      `   Keycloak admin  http://localhost:${keycloakPort}  (${envVar('KEYCLOAK_ADMIN', 'admin')})`,
    );
  }
  console.log('\n   Logs:  pnpm docker:logs        Stop:  pnpm docker:down');
  console.log(
    targeted.length
      ? '\nTell the user what changed and re-share the URL above — a change they cannot see is not delivered.'
      : '\nShow this to whoever asked for it and collect feedback BEFORE hardening.',
  );
}

await main();
