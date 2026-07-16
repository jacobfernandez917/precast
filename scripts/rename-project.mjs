#!/usr/bin/env node
/**
 * rename-project.mjs — Replace the `precast` placeholder with your project name.
 *
 * Precast ships with `precast` as the placeholder namespace across all functional
 * config: package scopes (@precast/*), Docker container/volume names, the Postgres
 * database, the Keycloak realm/client, tsconfig path aliases, and env defaults.
 *
 * Run this ONCE, first thing, after cloning Precast for a new project:
 *
 *   pnpm rename my-project
 *   node scripts/rename-project.mjs my-project        # (equivalent)
 *   node scripts/rename-project.mjs my-project --dry   # preview only, write nothing
 *
 * It rewrites root config files plus every source file under apps/ and packages/
 * (skipping node_modules, build output, and docs/ — the docs describe the
 * boilerplate itself and must stay readable). Case is preserved: `precast` ->
 * `myapp`, `Precast` -> `Myapp`, `PRECAST` -> `MYAPP`.
 *
 * After running: review the diff, run `pnpm install`, then delete this script if you
 * like — it has done its job.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = join(dirname(__filename), '..');

// ── Explicit root/config files whose `precast` occurrences are functional. ────
const ROOT_FILES = [
  'package.json',
  '.env.example',
  'tsconfig.base.json',
  'docker/docker-compose.yml',
];

// ── Source trees walked recursively for functional `precast` references. ──────
const SOURCE_DIRS = ['apps', 'packages'];

// Never descend into generated/vendored output or docs (docs describe the
// boilerplate itself and must stay readable).
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'docs']);

const SOURCE_EXT = /\.(ts|tsx|mjs|cjs|js|json|yml|yaml|css)$/;
// Extensionless files that still hold functional `precast` references (e.g. the
// `-t precast-*` image tags in Dockerfiles). Matched by exact filename.
const SOURCE_NAMES = new Set(['Dockerfile']);

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else if (SOURCE_EXT.test(entry) || SOURCE_NAMES.has(entry)) acc.push(abs);
  }
  return acc;
}

function collectTargets() {
  const abs = ROOT_FILES.map((f) => join(rootDir, f)).filter(existsSync);
  for (const d of SOURCE_DIRS) {
    const dirAbs = join(rootDir, d);
    if (existsSync(dirAbs)) walk(dirAbs, abs);
  }
  // Return repo-relative paths, deduped, sorted for stable output.
  return [...new Set(abs.map((a) => relative(rootDir, a)))].sort();
}

const TARGET_FILES = collectTargets();

function parseArgs(argv) {
  const args = argv.slice(2);
  const dry = args.includes('--dry');
  const name = args.find((a) => !a.startsWith('--'));
  return { name, dry };
}

// npm package names: lowercase, may contain - and _, no leading dot/underscore.
function validateName(name) {
  if (!name) return 'A project name is required.';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return `Invalid name "${name}". Use lowercase letters, digits, and hyphens (start with a letter), e.g. "my-project".`;
  }
  if (name === 'precast') return 'Name is already "precast" — nothing to do.';
  return null;
}

function toTitle(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Case-preserving replacement of the whole token `precast`.
function replaceToken(content, name) {
  return content
    .replace(/PRECAST/g, name.toUpperCase())
    .replace(/Precast/g, toTitle(name))
    .replace(/precast/g, name);
}

function main() {
  const { name, dry } = parseArgs(process.argv);

  const err = validateName(name);
  if (err) {
    console.error(`❌ ${err}`);
    process.exit(1);
  }

  console.log(`Renaming placeholder "precast" → "${name}"${dry ? ' (dry run)' : ''}\n`);

  let changedFiles = 0;
  let missing = 0;

  for (const rel of TARGET_FILES) {
    const abs = join(rootDir, rel);
    if (!existsSync(abs)) {
      console.warn(`   ⚠  skip (not found): ${rel}`);
      missing++;
      continue;
    }
    const before = readFileSync(abs, 'utf-8');
    const after = replaceToken(before, name);
    if (before === after) continue;

    const hits = before.match(/precast/gi)?.length ?? 0;
    console.log(`   ✓ ${rel} (${hits} occurrence${hits === 1 ? '' : 's'})`);
    if (!dry) writeFileSync(abs, after, 'utf-8');
    changedFiles++;
  }

  console.log(
    `\n${dry ? 'Would update' : 'Updated'} ${changedFiles} file${changedFiles === 1 ? '' : 's'}.` +
      (missing ? ` ${missing} target(s) not found.` : ''),
  );

  if (!dry) {
    console.log('\nNext steps:');
    console.log('  1. Review the diff:            git diff');
    console.log('  2. Reinstall workspaces:       pnpm install');
    console.log('  3. Update docs (name/mission): docs/PROGRESS.md §1, README.md title');
    console.log('  4. (optional) delete this script — its job is done.');
  }
}

main();
