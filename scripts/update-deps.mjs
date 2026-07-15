#!/usr/bin/env node
/**
 * update-deps.mjs — Update dependencies to their latest compatible versions.
 *
 * Runs `pnpm update -r` across the workspace (respecting the semver ranges in
 * each package.json), then verifies the result with build + test so a bad bump
 * fails loudly instead of landing silently.
 *
 *   pnpm deps:update            # update within ranges, then build + test
 *   pnpm deps:update --latest   # bump ranges to the latest major (pnpm update --latest)
 *   pnpm deps:update --no-verify# skip build + test (faster, unverified)
 *   pnpm deps:update --dry      # show what pnpm would change, write nothing
 *
 * This is intentionally CI-agnostic: it is a plain script you run locally or
 * wire into whatever external CI you use. The bootstrap script runs it once at
 * project creation so a new project starts on current dependencies.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const latest = args.includes('--latest');
const dry = args.includes('--dry');
const noVerify = args.includes('--no-verify');

function run(cmd, cmdArgs, { allowFail = false } = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const res = spawnSync(cmd, cmdArgs, { cwd: rootDir, stdio: 'inherit', shell: false });
  if (res.status !== 0 && !allowFail) {
    console.error(`\n❌ \`${cmd} ${cmdArgs.join(' ')}\` failed (exit ${res.status}).`);
    process.exit(res.status ?? 1);
  }
  return res.status ?? 0;
}

function main() {
  console.log(
    `Updating dependencies${latest ? ' to latest major' : ' within semver ranges'}` +
      `${dry ? ' (dry run)' : ''}…`,
  );

  const updateArgs = ['update', '-r'];
  if (latest) updateArgs.push('--latest');

  if (dry) {
    // `pnpm outdated` previews what could move without touching anything.
    run('pnpm', ['outdated', '-r'], { allowFail: true });
    console.log('\nDry run — nothing written. Re-run without --dry to apply.');
    return;
  }

  run('pnpm', updateArgs);
  run('pnpm', ['install']);

  if (noVerify) {
    console.log(
      '\n⚠️  Skipped verification (--no-verify). Run `pnpm build && pnpm test` before committing.',
    );
  } else {
    run('pnpm', ['build']);
    run('pnpm', ['test']);
    console.log('\n✅ Dependencies updated and verified (build + test green).');
  }

  console.log(
    '\nNext: review `git diff pnpm-lock.yaml package.json **/package.json`, then commit.',
  );
}

main();
