#!/usr/bin/env node
/**
 * check-docker.mjs — the container-runtime preflight.
 *
 * Precast's fastest path to something visible is `pnpm poc`, which runs the
 * whole stack in Docker Compose. That needs a running container runtime, and a
 * first-time user usually doesn't have one — so this script makes the gap a
 * clear, actionable message with install instructions for the actual platform,
 * instead of the raw daemon error Compose emits ("Cannot connect to the Docker
 * daemon at unix:///var/run/docker.sock").
 *
 *   node scripts/check-docker.mjs            # check once, explain what's missing
 *   node scripts/check-docker.mjs --wait     # poll until the engine is up
 *   node scripts/check-docker.mjs --wait=600 # ...with a 600s timeout (default 900)
 *   node scripts/check-docker.mjs --quiet    # exit code only, no output when OK
 *
 * Exit codes: 0 = engine reachable · 1 = not reachable (or timed out).
 *
 * `--wait` is the "install it and I'll continue by myself" mode: the user
 * installs Docker Desktop and starts it while this polls, and the build
 * continues the moment the engine answers — no re-run needed.
 */

import { spawnSync } from 'node:child_process';
import { platform } from 'node:process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const waitArg = args.find((a) => a === '--wait' || a.startsWith('--wait='));
const waitSeconds = waitArg ? Number(waitArg.split('=')[1] ?? 900) || 900 : 0;
const POLL_INTERVAL_MS = 3000;

/**
 * Is the Docker CLI on PATH at all? Distinguishing "no CLI" (→ install Docker
 * Desktop) from "CLI but no engine" (→ start Docker Desktop) is the whole
 * point — they need different instructions.
 */
export function hasDockerCli() {
  const res = spawnSync('docker', ['--version'], { stdio: 'ignore', shell: false });
  return res.status === 0;
}

/**
 * Is the engine actually reachable? `docker info` talks to the daemon, unlike
 * `docker --version`, which answers from the client alone even when Docker
 * Desktop is installed but not started.
 */
export function isEngineRunning() {
  const res = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: 'ignore',
    shell: false,
  });
  return res.status === 0;
}

/** Does this host have `docker compose` (v2, the subcommand form Precast uses)? */
export function hasComposeV2() {
  const res = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: false });
  return res.status === 0;
}

/** One call for callers that just want the state, no output. */
export function dockerStatus() {
  if (!hasDockerCli()) return 'missing';
  if (!isEngineRunning()) return 'stopped';
  return 'running';
}

function installInstructions() {
  if (platform === 'darwin') {
    return [
      '   Install Docker Desktop for Mac (it bundles the engine + `docker compose`):',
      '     • Download:  https://www.docker.com/products/docker-desktop/',
      '     • Or:        brew install --cask docker',
      '   Then OPEN Docker Desktop once and wait for the whale icon to stop animating.',
    ];
  }
  if (platform === 'win32') {
    return [
      '   Install Docker Desktop for Windows (WSL2 backend recommended):',
      '     • Download:  https://www.docker.com/products/docker-desktop/',
      '     • Or:        winget install Docker.DockerDesktop',
      '   Then LAUNCH Docker Desktop and wait for it to report "Engine running".',
    ];
  }
  return [
    '   Install Docker Engine + the Compose plugin:',
    '     • Docs:      https://docs.docker.com/engine/install/',
    '     • Then:      sudo systemctl enable --now docker',
    '     • Optional:  sudo usermod -aG docker "$USER"   (re-login; run docker without sudo)',
  ];
}

function startInstructions() {
  if (platform === 'darwin') {
    return [
      '   Docker is installed but the engine is not running. Start it:',
      '     • open -a Docker        (then wait for the whale icon to settle)',
    ];
  }
  if (platform === 'win32') {
    return [
      '   Docker is installed but the engine is not running.',
      '     • Launch Docker Desktop from the Start menu and wait for "Engine running".',
    ];
  }
  return [
    '   Docker is installed but the engine is not running. Start it:',
    '     • sudo systemctl start docker',
  ];
}

function report(state) {
  const lines =
    state === 'missing'
      ? [
          '❌ Docker is not installed — Precast runs its stack in Docker Compose.',
          ...installInstructions(),
        ]
      : ['❌ Docker is installed but the engine is not reachable.', ...startInstructions()];
  for (const l of lines) console.error(l);
  console.error('');
  console.error('   Once it is up, this continues on its own if you run:');
  console.error('     pnpm docker:wait     # polls until the engine answers, then exits 0');
}

async function waitForEngine(timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const initial = dockerStatus();
  if (initial === 'running') return true;

  report(initial);
  console.error('');
  console.error(
    `⏳ Watching for the Docker engine (up to ${Math.round(timeoutSeconds / 60)} min) — ` +
      'install/start Docker, and the build continues automatically.',
  );

  let lastState = initial;
  for (;;) {
    if (Date.now() >= deadline) {
      console.error(`\n❌ Timed out after ${timeoutSeconds}s waiting for the Docker engine.`);
      return false;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const state = dockerStatus();
    if (state === 'running') {
      console.error('\n✅ Docker engine is up — continuing.');
      return true;
    }
    // Installing the CLI happens before the engine finishes starting; say so,
    // otherwise a long silent wait looks stuck.
    if (state !== lastState) {
      lastState = state;
      if (state === 'stopped') {
        console.error('   Docker CLI detected — now waiting for the engine to finish starting…');
      }
    }
    if (!quiet) process.stderr.write('.');
  }
}

async function main() {
  if (waitSeconds > 0) {
    process.exit((await waitForEngine(waitSeconds)) ? 0 : 1);
  }

  const state = dockerStatus();
  if (state !== 'running') {
    report(state);
    process.exit(1);
  }
  if (!hasComposeV2()) {
    console.error('❌ The Docker engine is running, but `docker compose` (v2) is unavailable.');
    console.error(
      '   Precast uses the Compose V2 subcommand, not the legacy `docker-compose` binary.',
    );
    console.error('   Install the Compose plugin: https://docs.docker.com/compose/install/');
    process.exit(1);
  }
  if (!quiet) console.log('✅ Docker engine reachable and `docker compose` available.');
  process.exit(0);
}

// Only run the CLI when invoked directly — the helpers above are imported by
// scripts/docker-compose.mjs, scripts/poc.mjs, and scripts/bootstrap.mjs.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
