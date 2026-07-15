#!/usr/bin/env node
/**
 * set-ports.mjs — Point the project at different dev ports for the Mastra API
 * and the Next web app, wiring the change through env, configs, pnpm scripts,
 * Docker compose, and the port-stating docs in one pass.
 *
 *   node scripts/set-ports.mjs --mastra=4200 --web=3100
 *   node scripts/set-ports.mjs --mastra=4200              # web unchanged
 *   pnpm set-ports --web=3100                             # mastra unchanged
 *
 * A port not supplied keeps its current value (read from .env.example).
 * Idempotent and re-runnable: re-running with the same values changes nothing.
 *
 * `bootstrap` calls this after the placeholder rename so a new project starts
 * on the ports you chose. You can also run it any time later to move ports.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESERVED = { 5432: 'Postgres', 6379: 'Redis', 8080: 'Keycloak' };

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

// Current values are the source of truth for "from" — read them from .env.example.
const envExamplePath = join(rootDir, '.env.example');
const envText = existsSync(envExamplePath) ? readFileSync(envExamplePath, 'utf8') : '';
const curMastra = Number((envText.match(/^MASTRA_PORT=(\d+)/m) || [])[1] || 4111);
const curWeb = Number((envText.match(/^WEB_PORT=(\d+)/m) || [])[1] || 3000);

const mArg = flagVal('mastra');
const wArg = flagVal('web');

let mastra = curMastra;
let web = curWeb;
if (mArg !== undefined) {
  const r = validatePort(mArg);
  if (r.err) {
    console.error(`❌ Mastra port ${r.err}.`);
    process.exit(1);
  }
  mastra = r.port;
}
if (wArg !== undefined) {
  const r = validatePort(wArg);
  if (r.err) {
    console.error(`❌ Web port ${r.err}.`);
    process.exit(1);
  }
  web = r.port;
}
if (mastra === web) {
  console.error(`❌ Mastra and web ports must differ (both ${mastra}).`);
  process.exit(1);
}

let changed = 0;
function edit(rel, subs) {
  const p = join(rootDir, rel);
  if (!existsSync(p)) return;
  const before = readFileSync(p, 'utf8');
  let text = before;
  for (const [re, repl] of subs) text = text.replace(re, repl);
  if (text !== before) {
    writeFileSync(p, text);
    changed++;
    console.log(`  ✎ ${rel}`);
  }
}

// ── Configs (env schema + app config) ────────────────────────────────────────
edit('.env.example', [
  [/^(MASTRA_PORT=)\d+/m, `$1${mastra}`],
  [/^(WEB_PORT=)\d+/m, `$1${web}`],
]);
edit('packages/shared/src/env.ts', [
  [/(MASTRA_PORT:\s*z\.coerce\.number\(\)\.default\()\d+(\))/, `$1${mastra}$2`],
  [/(WEB_PORT:\s*z\.coerce\.number\(\)\.default\()\d+(\))/, `$1${web}$2`],
]);
edit('apps/api/src/mastra/index.ts', [[/(MASTRA_PORT \(default )\d+(\))/, `$1${mastra}$2`]]);
edit('apps/api/Dockerfile', [
  [/(MASTRA_PORT=)\d+/, `$1${mastra}`],
  [/(EXPOSE )\d+/, `$1${mastra}`],
]);
edit('apps/web/Dockerfile', [
  [/(\n\s*PORT=)\d+/, `$1${web}`],
  [/(EXPOSE )\d+/, `$1${web}`],
]);

// ── pnpm scripts + test harness ──────────────────────────────────────────────
edit('apps/web/package.json', [
  [/(next dev -p )\d+/, `$1${web}`],
  [/(next start -p )\d+/, `$1${web}`],
]);
edit('apps/web/playwright.config.ts', [[/(E2E_PORT \?\? )\d+/, `$1${web}`]]);
edit('apps/web/test/health.spec.ts', [
  [/(env\.MASTRA_PORT\)\.toBe\()\d+(\))/, `$1${mastra}$2`],
  [/(env\.WEB_PORT\)\.toBe\()\d+(\))/, `$1${web}$2`],
]);

// ── Docker compose (rewrite app-port occurrences if any are present) ──────────
// Infra ports (5432/6379/8080) are never touched — we only replace the exact
// current Mastra/web port numbers, and only when they actually changed.
for (const f of [
  'docker/docker-compose.yml',
  'docker/docker-compose.override.yml',
  'docker/docker-compose.override.yml.example',
]) {
  const subs = [];
  if (mastra !== curMastra) subs.push([new RegExp(`\\b${curMastra}\\b`, 'g'), String(mastra)]);
  if (web !== curWeb) subs.push([new RegExp(`\\b${curWeb}\\b`, 'g'), String(web)]);
  if (subs.length) edit(f, subs);
}

// ── Port-stating docs (kept accurate) ────────────────────────────────────────
edit('README.md', [
  [/(web app runs at `http:\/\/localhost:)\d+/, `$1${web}`],
  [/(Studio playground at `http:\/\/localhost:)\d+/, `$1${mastra}`],
]);
edit('docs/TECH_STACK.md', [
  [/(\| Web \(host dev\)\s*\|\s*)\d+/, `$1${web}`],
  [/(\| Mastra \(host dev\)\s*\|\s*)\d+/, `$1${mastra}`],
  [/(on `MASTRA_PORT` \(default )\d+(\))/, `$1${mastra}$2`],
]);

console.log(
  `\n✅ Ports set — Mastra ${mastra}, web ${web} (${changed} file${changed === 1 ? '' : 's'} updated).`,
);
if (changed === 0) console.log('   Nothing to change; already on those ports.');
