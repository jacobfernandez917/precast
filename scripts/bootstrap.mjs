#!/usr/bin/env node
/**
 * bootstrap.mjs — Turn Precast into your project in one command.
 *
 *   pnpm bootstrap                 # interactive
 *   pnpm bootstrap my-project      # non-interactive (name as arg)
 *   pnpm bootstrap my-project --yes# skip the confirmation prompt
 *
 * Steps, in order:
 *   1. Ask for (or read) the project name.
 *   2. Ask for the Mastra API and Next web dev ports (Enter to keep defaults).
 *   3. Rename the `precast` placeholder everywhere (scripts/rename-project.mjs).
 *   4. Apply the chosen ports across env, configs, pnpm scripts, Docker, docs
 *      (scripts/set-ports.mjs).
 *   5. Install + update dependencies to latest compatible (scripts/update-deps.mjs).
 *   6. Remove Precast's own git history and re-initialize a BLANK repo on the
 *      `develop` branch with a single initial commit, hooks activated.
 *
 * Non-interactive port selection uses equals-form flags:
 *   pnpm bootstrap my-project --mastra-port=4200 --web-port=3100
 *
 * This is destructive to .git on purpose: a project bootstrapped from Precast
 * must not inherit Precast's commit history. It runs LAST so a failure earlier
 * leaves your git history intact.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BRANCH = 'develop';
const DEFAULT_MASTRA_PORT = 4111;
const DEFAULT_WEB_PORT = 3000;
const RESERVED_PORTS = { 5432: 'Postgres', 6379: 'Redis', 8080: 'Keycloak' };

const rawArgs = process.argv.slice(2);
const assumeYes = rawArgs.includes('--yes') || rawArgs.includes('-y');
const skipDeps = rawArgs.includes('--skip-deps');
const nameArg = rawArgs.find((a) => !a.startsWith('-'));

function flagVal(name) {
  const pref = `--${name}=`;
  const hit = rawArgs.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

function validatePort(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { err: `Ports must be an integer 1–65535 (got "${v}").` };
  }
  if (RESERVED_PORTS[n]) return { err: `Port ${n} is used by ${RESERVED_PORTS[n]}. Pick another.` };
  return { port: n };
}

function run(cmd, args, { allowFail = false } = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: rootDir, stdio: 'inherit', shell: false });
  if (res.status !== 0 && !allowFail) {
    console.error(
      `\n❌ \`${cmd} ${args.join(' ')}\` failed (exit ${res.status}). Bootstrap aborted.`,
    );
    process.exit(res.status ?? 1);
  }
  return res.status ?? 0;
}

function validateName(name) {
  if (!name) return 'A project name is required.';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return `Invalid name "${name}". Use lowercase letters, digits, and hyphens (start with a letter).`;
  }
  if (name === 'precast') return 'Pick a name other than "precast".';
  return null;
}

async function resolveName() {
  if (nameArg) {
    const err = validateName(nameArg);
    if (err) {
      console.error(`❌ ${err}`);
      process.exit(1);
    }
    return nameArg;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = (await rl.question('Project name (lowercase, hyphens): ')).trim();
      const err = validateName(answer);
      if (!err) return answer;
      console.error(`  ${err}`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Ask for a single port. Enter (empty) keeps the default. In non-interactive
 * mode (name passed as an arg) it reads the equals-form flag or falls back to
 * the default without prompting.
 */
async function resolvePort(label, flagName, def) {
  const fv = flagVal(flagName);
  if (nameArg) {
    if (fv === undefined) return def;
    const r = validatePort(fv);
    if (r.err) {
      console.error(`❌ ${label} port: ${r.err}`);
      process.exit(1);
    }
    return r.port;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = (await rl.question(`${label} port [default ${def}, Enter to skip]: `)).trim();
      if (!answer) return def;
      const r = validatePort(answer);
      if (r.port) return r.port;
      console.error(`  ${r.err}`);
    }
  } finally {
    rl.close();
  }
}

async function confirm(question) {
  if (assumeYes) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  console.log('── Precast bootstrap ────────────────────────────────────────────\n');

  const name = await resolveName();
  const mastraPort = await resolvePort('Mastra API', 'mastra-port', DEFAULT_MASTRA_PORT);
  const webPort = await resolvePort('Next web', 'web-port', DEFAULT_WEB_PORT);
  if (mastraPort === webPort) {
    console.error(`❌ Mastra and web ports must differ (both ${mastraPort}).`);
    process.exit(1);
  }
  const portsCustom = mastraPort !== DEFAULT_MASTRA_PORT || webPort !== DEFAULT_WEB_PORT;

  console.log(`\nThis will:`);
  console.log(`  1. Rename the "precast" placeholder → "${name}"`);
  console.log(
    `  2. Set ports — Mastra ${mastraPort}, web ${webPort}${portsCustom ? '' : ' (defaults)'}`,
  );
  console.log(
    `  3. Install${skipDeps ? '' : ' + update'} dependencies${skipDeps ? '' : ' to latest compatible'}`,
  );
  console.log(`  4. Reset progress docs (PROGRESS/HANDOFF/journal) to a clean slate`);
  console.log(`  5. DELETE Precast's git history and start a blank repo on "${DEFAULT_BRANCH}"`);

  if (!(await confirm('\nProceed?'))) {
    console.log('Aborted — nothing changed.');
    process.exit(0);
  }

  // 1. Rename placeholder.
  run('node', ['scripts/rename-project.mjs', name]);

  // 2. Wire chosen ports through env, configs, pnpm scripts, Docker, docs.
  run('node', ['scripts/set-ports.mjs', `--mastra=${mastraPort}`, `--web=${webPort}`]);

  // 3. Dependencies.
  if (skipDeps) {
    run('pnpm', ['install']);
  } else {
    run('node', ['scripts/update-deps.mjs', '--no-verify']);
  }

  // 4. Reset progress memory so the new project starts with a clean slate.
  resetDocs();

  // 5. Reset git history → blank repo on develop.
  resetGit(name);

  console.log(`\n✅ ${name} is ready.`);
  console.log('\nNext steps:');
  console.log('  • Set your project name + mission in docs/PROGRESS.md §1 and the README title.');
  console.log('  • Copy env:            cp .env.example .env');
  console.log('  • Verify:              pnpm build && pnpm test');
  console.log(
    '  • Add your remote:     git remote add origin <url> && git push -u origin ' + DEFAULT_BRANCH,
  );

  printFeedForwardGuidance();
}

/**
 * Feed-forward docs are the highest-leverage thing to write before building:
 * they give every agent the same intent up front. Point the user at the
 * templates so they fill them in first.
 */
function printFeedForwardGuidance() {
  console.log('\n📄 Write your feed-forward docs first (templates in templates/):');
  console.log('   These give any coding agent shared intent before a line of code is written.');
  console.log('     • templates/PRD.md           — problem, goals, personas, scope, metrics');
  console.log('     • templates/DATA_MODEL.md     — entities, relationships, invariants');
  console.log('     • templates/AGENT_SPEC.md     — Mastra agents: job, tools, guardrails');
  console.log(
    '     • templates/DESIGN_SYSTEM.md  — UI design language + tokens (Material 3 Expressive example)',
  );
  console.log('   Copy the ones you need into docs/, replace the example content, then build.');
  console.log('   The example content walks a chat-based meeting-room reservation app end to end.');
}

/**
 * Wipe any accumulated progress memory so the new project starts clean:
 * drop the auto-journal file and strip stray <auto-journal> markers from
 * PROGRESS.md's Session Log. PROGRESS.md/HANDOFF.md ship as empty templates,
 * so no full rewrite is needed here.
 */
function resetDocs() {
  const journal = join(rootDir, 'docs', '.progress-journal.jsonl');
  if (existsSync(journal)) rmSync(journal, { force: true });

  const progress = join(rootDir, 'docs', 'PROGRESS.md');
  if (existsSync(progress)) {
    const cleaned = readFileSync(progress, 'utf-8')
      .split('\n')
      .filter((line) => !line.startsWith('<auto-journal:'))
      .join('\n');
    writeFileSync(progress, cleaned, 'utf-8');
  }
}

function resetGit(name) {
  const gitDir = join(rootDir, '.git');
  if (existsSync(gitDir)) {
    console.log('\nRemoving Precast git history…');
    rmSync(gitDir, { recursive: true, force: true });
  }
  run('git', ['init', '-b', DEFAULT_BRANCH]);
  run('git', ['config', 'core.hooksPath', '.githooks']);
  run('git', ['add', '-A']);
  // `git add -A` stages the required docs, so the doc-contract pre-commit hook
  // is satisfied on this first commit.
  run('git', ['commit', '-m', `chore: initialize ${name} from Precast`]);
}

main();
