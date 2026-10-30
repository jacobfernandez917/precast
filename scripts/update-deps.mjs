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
 *
 * After the update, the AI SDK packages the agents app depends on directly are
 * pinned to the provider version `@mastra/core` ships. Mastra pins its own
 * `@ai-sdk/provider` exactly, and so does every `@ai-sdk/openai-compatible`
 * release; updated independently they end on two copies of the provider types,
 * and the agents app stops typechecking.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = join(rootDir, 'apps', 'agents');
const PROVIDER = '@ai-sdk/provider';
const COMPATIBLE = '@ai-sdk/openai-compatible';

const args = process.argv.slice(2);
const latest = args.includes('--latest');
const dry = args.includes('--dry');
const noVerify = args.includes('--no-verify');

function run(cmd, cmdArgs, { allowFail = false } = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const res = spawnSync(cmd, cmdArgs, { cwd: rootDir, stdio: 'inherit', shell: false });
  if (res.status !== 0 && !allowFail) {
    console.error(`\n❌ \`${cmd} ${cmdArgs.join(' ')}\` failed (exit ${res.status}).`);
    console.error('   Its output above says why. Fix that, then run pnpm deps:update again.');
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
  if (alignAiSdk()) run('pnpm', ['install']);

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

/**
 * The provider versions `@mastra/core` depends on, from its package.json
 * dependencies. Mastra installs each provider generation under an alias
 * (`"@ai-sdk/provider-v7": "npm:@ai-sdk/provider@4.0.29"`); the alias names
 * change between releases, so only the targets are read.
 */
export function mastraProviderVersions(mastraDeps = {}) {
  const prefix = `npm:${PROVIDER}@`;
  return Object.values(mastraDeps)
    .filter((spec) => typeof spec === 'string' && spec.startsWith(prefix))
    .map((spec) => spec.slice(prefix.length));
}

const major = (version) => version.split('.')[0];
const isStable = (version) => /^\d+\.\d+\.\d+$/.test(version);

/** Highest first, by numeric major, minor and patch. */
function compareDesc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
  return 0;
}

/**
 * The `@ai-sdk/openai-compatible` release to pin, and the provider version it
 * brings, given the provider versions Mastra ships and the stable releases of
 * one openai-compatible major (`[{ version, dependencies }]`). That major builds
 * on one provider major; the match is the newest release whose provider is
 * exactly the one Mastra ships for that provider major.
 */
export function alignedVersions({ mastraProviders, releases }) {
  const stable = releases
    .filter((r) => isStable(r.version) && r.dependencies?.[PROVIDER])
    .sort((a, b) => compareDesc(a.version, b.version));
  if (!stable.length) throw new Error(`No stable ${COMPATIBLE} release lists ${PROVIDER}.`);
  const providerMajor = major(stable[0].dependencies[PROVIDER]);
  const target = mastraProviders.find((v) => major(v) === providerMajor);
  if (!target) {
    throw new Error(
      `@mastra/core ships no ${PROVIDER} ${providerMajor}.x, which ${COMPATIBLE} ` +
        `${stable[0].version} is built on. Move ${COMPATIBLE} to the major Mastra supports.`,
    );
  }
  const match = stable.find((r) => r.dependencies[PROVIDER] === target);
  if (!match) {
    throw new Error(
      `No ${COMPATIBLE} release is built on ${PROVIDER} ${target}, the version @mastra/core ` +
        `ships. Pin ${COMPATIBLE} by hand to one that typechecks.`,
    );
  }
  return { compatible: match.version, provider: target };
}

function npmView(spec) {
  const res = spawnSync('npm', ['view', spec, 'version', 'dependencies', '--json'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`npm could not look up ${spec}. Check the network and run this again.`);
  }
  const parsed = JSON.parse(res.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Pin the agents app's direct AI SDK dependencies to the provider version the
 * installed `@mastra/core` ships. Returns true when package.json changed.
 */
function alignAiSdk() {
  const pkgPath = join(AGENTS_DIR, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = pkg.dependencies ?? {};
  if (!deps[COMPATIBLE] || !deps['@mastra/core']) return false;

  const mastraPkg = JSON.parse(
    readFileSync(join(AGENTS_DIR, 'node_modules', '@mastra', 'core', 'package.json'), 'utf8'),
  );
  const installed = JSON.parse(
    readFileSync(
      join(AGENTS_DIR, 'node_modules', ...COMPATIBLE.split('/'), 'package.json'),
      'utf8',
    ),
  );
  const { compatible, provider } = alignedVersions({
    mastraProviders: mastraProviderVersions(mastraPkg.dependencies),
    releases: npmView(`${COMPATIBLE}@${major(installed.version)}`),
  });

  if (deps[COMPATIBLE] === compatible && (!deps[PROVIDER] || deps[PROVIDER] === provider)) {
    return false;
  }
  deps[COMPATIBLE] = compatible;
  if (deps[PROVIDER]) deps[PROVIDER] = provider;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(
    `\nPinned ${COMPATIBLE} ${compatible} and ${PROVIDER} ${provider}, the provider ` +
      `@mastra/core ${mastraPkg.version} ships.`,
  );
  return true;
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
