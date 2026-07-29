#!/usr/bin/env node
/**
 * set-ports.mjs — Point the project at different dev ports for the Mastra
 * agents API, the Next web app, and the local Keycloak, wiring the change
 * through env, configs, pnpm scripts, Docker Compose, and the port-stating docs
 * in one pass.
 *
 *   node scripts/set-ports.mjs --auto                       # random free consecutive triple
 *   node scripts/set-ports.mjs --mastra=45000 --web=45001 --keycloak=45002
 *   node scripts/set-ports.mjs --mastra=45000               # others unchanged
 *   pnpm set-ports --web=45001                              # mastra/keycloak unchanged
 *
 * A port not supplied keeps its current value (read from .env.example).
 * Idempotent and re-runnable: re-running with the same values changes nothing.
 *
 * `--auto` picks a random, currently-free, CONSECUTIVE triple in the high
 * private range (see PORT_RANGE below) and assigns them in stack order:
 * agents → web → keycloak (e.g. 45000 / 45001 / 45002). Consecutive so the
 * project's whole stack is one memorable block; random so two Precast projects
 * on the same machine don't collide the way two 3000/4111 projects always do;
 * range-bounded so it can't land on a port some other tool expects.
 *
 * `bootstrap` calls this (with `--auto` by default) after the placeholder
 * rename, so a new project starts on ports that are free on THIS machine. You
 * can also run it any time later to move ports.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESERVED = { 5432: 'Postgres', 6379: 'Redis' };

/**
 * Where `--auto` is allowed to land, and why these bounds:
 *  - Above 40000: clear of every common dev-server default (3000/4000/5173/
 *    8000/8080) and of the privileged range, so it never needs sudo.
 *  - Below 49152: that's where the IANA/macOS/Linux EPHEMERAL range starts.
 *    Publishing a container port inside it invites a random outbound socket to
 *    have grabbed the port first — a flaky "address already in use" that only
 *    reproduces sometimes. Staying under it makes the pick genuinely safe.
 * The max base leaves room for the whole consecutive block.
 */
export const PORT_RANGE = { min: 40000, max: 49100 };
export const STACK_SIZE = 3; // agents, web, keycloak

/** Is this port bindable right now on all interfaces (what Docker publishes on)? */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

/**
 * Pick `count` consecutive free ports starting at a random base inside
 * PORT_RANGE. Returns the ports in stack order. Throws only if the machine has
 * no free block at all after a generous number of attempts (effectively never).
 */
export async function pickConsecutivePorts(count = STACK_SIZE, attempts = 200) {
  const span = PORT_RANGE.max - PORT_RANGE.min + 1;
  for (let i = 0; i < attempts; i++) {
    const base = PORT_RANGE.min + Math.floor(Math.random() * span);
    const block = Array.from({ length: count }, (_, k) => base + k);
    if (block.some((p) => RESERVED[p])) continue;
    const free = await Promise.all(block.map(isPortFree));
    if (free.every(Boolean)) return block;
  }
  throw new Error(
    `Could not find ${count} consecutive free ports in ${PORT_RANGE.min}–${PORT_RANGE.max} ` +
      `after ${attempts} attempts. Free some ports, or pass explicit --mastra/--web/--keycloak.`,
  );
}

function flagVal(name) {
  const pref = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

function validatePort(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { err: `must be an integer 1–65535 (got "${v}") — pick another` };
  }
  if (RESERVED[n]) return { err: `${n} is used by ${RESERVED[n]} — pick another` };
  return { port: n };
}

/**
 * Apply a set of regex substitutions to a file, if it exists. Returns whether
 * the file changed.
 */
function edit(rel, subs, counter) {
  const p = join(rootDir, rel);
  if (!existsSync(p)) return false;
  const before = readFileSync(p, 'utf8');
  let text = before;
  for (const [re, repl] of subs) text = text.replace(re, repl);
  if (text === before) return false;
  writeFileSync(p, text);
  counter.changed++;
  console.log(`  ✎ ${rel}`);
  return true;
}

export async function main() {
  // Current values are the source of truth for "from" — read them from .env.example.
  const envExamplePath = join(rootDir, '.env.example');
  const envText = existsSync(envExamplePath) ? readFileSync(envExamplePath, 'utf8') : '';
  const curMastra = Number((envText.match(/^MASTRA_PORT=(\d+)/m) || [])[1] || 4111);
  const curWeb = Number((envText.match(/^WEB_PORT=(\d+)/m) || [])[1] || 3000);
  const curKeycloak = Number((envText.match(/^KEYCLOAK_HOST_PORT=(\d+)/m) || [])[1] || 8080);

  const auto = process.argv.slice(2).includes('--auto');
  let mastra = curMastra;
  let web = curWeb;
  let keycloak = curKeycloak;

  if (auto) {
    [mastra, web, keycloak] = await pickConsecutivePorts();
    console.log(`Auto-picked a free consecutive block: ${mastra} / ${web} / ${keycloak}`);
  }

  // Explicit flags always win over --auto, so a caller can pin one port and
  // still let the others be chosen.
  for (const [flag, label, apply] of [
    ['mastra', 'Mastra', (p) => (mastra = p)],
    ['web', 'Web', (p) => (web = p)],
    ['keycloak', 'Keycloak', (p) => (keycloak = p)],
  ]) {
    const v = flagVal(flag);
    if (v === undefined) continue;
    const r = validatePort(v);
    if (r.err) {
      console.error(`❌ ${label} port ${r.err}.`);
      process.exit(1);
    }
    apply(r.port);
  }

  if (new Set([mastra, web, keycloak]).size !== 3) {
    console.error(
      `❌ Mastra, web, and Keycloak ports must all differ (got ${mastra}, ${web}, ${keycloak}).`,
    );
    process.exit(1);
  }

  const counter = { changed: 0 };

  // ── Configs (env schema + app config) ──────────────────────────────────────
  // Both .env.example (the committed schema) and .env (the real file, if it
  // already exists) — Compose interpolates the published host ports from .env,
  // so leaving it stale would publish the containers on the OLD ports.
  const envSubs = [
    [/^(MASTRA_PORT=)\d+/m, `$1${mastra}`],
    [/^(WEB_PORT=)\d+/m, `$1${web}`],
    [/^(AGENTS_HOST_PORT=)\d+/m, `$1${mastra}`],
    [/^(WEB_HOST_PORT=)\d+/m, `$1${web}`],
    [/^(KEYCLOAK_HOST_PORT=)\d+/m, `$1${keycloak}`],
    // Host-facing Keycloak issuer follows the published Keycloak port.
    [/^(KEYCLOAK_TOKEN_ISSUER_URI=http:\/\/localhost:)\d+/m, `$1${keycloak}`],
    // Mastra base URL follows the agents port, in either host or Docker-DNS form.
    [/^(MASTRA_INTERNAL_URL=http:\/\/(?:localhost|agents):)\d+/m, `$1${mastra}`],
  ];
  edit('.env.example', envSubs, counter);
  edit('.env', envSubs, counter);

  edit(
    'packages/shared/src/env.ts',
    [
      [/(MASTRA_PORT:\s*z\.coerce\.number\(\)\.default\()\d+(\))/, `$1${mastra}$2`],
      [/(WEB_PORT:\s*z\.coerce\.number\(\)\.default\()\d+(\))/, `$1${web}$2`],
      // Zod defaults are what the apps actually use when a var is unset — leaving
      // them on the old ports makes a missing var point at nothing.
      [/(MASTRA_INTERNAL_URL:[^\n]*localhost:)\d+/, `$1${mastra}`],
      [/(agents:)\d+(\.)/g, `$1${mastra}$2`],
      [/(KEYCLOAK_TOKEN_ISSUER_URI:[^\n]*localhost:)\d+/, `$1${keycloak}`],
    ],
    counter,
  );
  // The web app's direct-A2A fallback when MASTRA_INTERNAL_URL is unset.
  edit(
    'apps/web/app/lib/a2a-client.ts',
    [[/(MASTRA_INTERNAL_URL \?\? 'http:\/\/localhost:)\d+/, `$1${mastra}`]],
    counter,
  );
  // AgentBase import contract: `port` is the agents CONTAINER port it probes.
  edit('agentbase.import.json', [[/("port":\s*)\d+/, `$1${mastra}`]], counter);
  edit(
    'apps/agents/src/mastra/index.ts',
    [[/(MASTRA_PORT \(default )\d+(\))/, `$1${mastra}$2`]],
    counter,
  );
  edit(
    'apps/agents/Dockerfile',
    [
      [/(MASTRA_PORT=)\d+/g, `$1${mastra}`],
      [/(EXPOSE )\d+/g, `$1${mastra}`],
    ],
    counter,
  );
  edit(
    'apps/web/Dockerfile',
    [
      [/(\n\s*PORT=)\d+/g, `$1${web}`],
      [/(EXPOSE )\d+/g, `$1${web}`],
    ],
    counter,
  );

  // ── pnpm scripts + test harness ────────────────────────────────────────────
  // Global regexes: `dev` and `dev:verbose` both carry `next dev -p <port>`, and
  // a non-global replace would silently update only the first of them.
  edit(
    'apps/web/package.json',
    [
      [/(next dev -p )\d+/g, `$1${web}`],
      [/(next start -p )\d+/g, `$1${web}`],
    ],
    counter,
  );
  edit('apps/web/playwright.config.ts', [[/(E2E_PORT \?\? )\d+/g, `$1${web}`]], counter);
  edit(
    'apps/web/test/health.spec.ts',
    [
      [/(env\.MASTRA_PORT\)\.toBe\()\d+(\))/, `$1${mastra}$2`],
      [/(env\.WEB_PORT\)\.toBe\()\d+(\))/, `$1${web}$2`],
    ],
    counter,
  );

  // ── Docker compose (rewrite app-port occurrences if any are present) ────────
  // Infra ports (5432/6379) are never touched — we only replace the exact
  // current Mastra/web/Keycloak-host port numbers, and only when they changed.
  // Keycloak's CONTAINER port stays 8080; only its published host port moves,
  // and that lives in ${KEYCLOAK_HOST_PORT}'s default, handled below.
  for (const f of [
    'docker/docker-compose.yml',
    'docker/docker-compose.override.yml',
    'docker/docker-compose.override.yml.example',
  ]) {
    const subs = [];
    if (mastra !== curMastra) subs.push([new RegExp(`\\b${curMastra}\\b`, 'g'), String(mastra)]);
    if (web !== curWeb) subs.push([new RegExp(`\\b${curWeb}\\b`, 'g'), String(web)]);
    if (keycloak !== curKeycloak) {
      subs.push([new RegExp(`(KEYCLOAK_HOST_PORT:-)${curKeycloak}`, 'g'), `$1${keycloak}`]);
    }
    if (subs.length) edit(f, subs, counter);
  }

  // ── Port-stating docs (kept accurate) ──────────────────────────────────────
  edit(
    'README.md',
    [
      [/(web app runs at `http:\/\/localhost:)\d+/g, `$1${web}`],
      [/(Studio playground at `http:\/\/localhost:)\d+/g, `$1${mastra}`],
      [/(Keycloak admin console at `http:\/\/localhost:)\d+/g, `$1${keycloak}`],
    ],
    counter,
  );
  edit(
    'docs/TECH_STACK.md',
    [
      [/(\| Web \(host dev\)\s*\|\s*)\d+/, `$1${web}`],
      [/(\| Mastra \(host dev\)\s*\|\s*)\d+/, `$1${mastra}`],
      [/(\| Keycloak \(host dev\)\s*\|\s*)\d+/, `$1${keycloak}`],
      [/(on `MASTRA_PORT` \(default )\d+(\))/, `$1${mastra}$2`],
      [/(AGENTS_HOST_PORT:-)\d+(\})/g, `$1${mastra}$2`],
      [/(WEB_HOST_PORT:-)\d+(\})/g, `$1${web}$2`],
      [/(KEYCLOAK_HOST_PORT:-)\d+(\})/g, `$1${keycloak}$2`],
      [/(agents:)\d+/g, `$1${mastra}`],
    ],
    counter,
  );
  // Prose port claims elsewhere in the doc set. Only `localhost:<port>` and the
  // Docker-DNS `agents:<port>` forms are rewritten — a bare "8080" is often
  // Keycloak's CONTAINER port, which never moves.
  for (const f of ['CLAUDE.md', 'docs/INTEGRATION_AGENTBASE.md', 'docs/SPEC.md']) {
    edit(
      f,
      [
        [new RegExp(`(agents:)${curMastra}\\b`, 'g'), `$1${mastra}`],
        [new RegExp(`(localhost:)${curMastra}\\b`, 'g'), `$1${mastra}`],
        [new RegExp(`(localhost:)${curWeb}\\b`, 'g'), `$1${web}`],
      ],
      counter,
    );
  }

  console.log(
    `\n✅ Ports set — Mastra ${mastra}, web ${web}, Keycloak ${keycloak} ` +
      `(${counter.changed} file${counter.changed === 1 ? '' : 's'} updated).`,
  );
  if (counter.changed === 0) console.log('   Nothing to change; already on those ports.');

  return { mastra, web, keycloak };
}

// Only run the CLI when invoked directly — bootstrap.mjs imports the picker.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
