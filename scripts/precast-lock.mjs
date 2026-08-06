#!/usr/bin/env node
/**
 * precast-lock.mjs — Provenance for a project derived from Precast.
 *
 * `pnpm bootstrap` deletes Precast's git history on purpose, so a derived
 * project shares NO commit ancestry with upstream. Without a record of where it
 * came from, nothing can compute "what changed in Precast since I forked" — so
 * bootstrap writes `precast.lock.json` instead:
 *
 *   {
 *     "precastVersion": "0.1.0",        ← release this project was cut from
 *     "precastCommit":  "dd7fd8e…",     ← exact upstream commit
 *     "projectName":    "vectorizer",   ← the rename mapping (precast → this)
 *     "bootstrappedAt": "2026-08-06T…",
 *     "files": { "scripts/poc.mjs": "<sha256>", … }
 *   }
 *
 * The `files` hashes are of the LOCAL (already renamed) content at bootstrap
 * time. That baseline is what makes a 3-way comparison possible without git:
 * `precast-update.mjs` compares baseline vs local vs incoming-upstream to tell a
 * safe update apart from a file you have since customized.
 *
 * This module is shared by bootstrap.mjs and precast-update.mjs; it does nothing
 * when run directly except print the current lock summary.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCK_FILE = 'precast.lock.json';
export const MANIFEST_FILE = 'precast.manifest.json';

const WALK_SKIP = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
]);

export function readManifest(root) {
  const abs = join(root, MANIFEST_FILE);
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

export function readLock(root) {
  const abs = join(root, LOCK_FILE);
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

export function writeLock(root, lock) {
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n', 'utf-8');
}

/**
 * Match a repo-relative path against the manifest's patterns. Deliberately tiny:
 * exact paths, and `some/dir/**` prefixes. No globbing library, no surprises
 * about what a pattern silently swept in.
 */
export function matches(rel, patterns) {
  return patterns.some((p) =>
    p.endsWith('/**') ? rel === p.slice(0, -3) || rel.startsWith(p.slice(0, -2)) : rel === p,
  );
}

function walk(dir, root, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (WALK_SKIP.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, root, acc);
    else acc.push(relative(root, abs));
  }
  return acc;
}

/**
 * Every file in `root` covered by the given patterns. Directory patterns are
 * walked; exact patterns are included when they exist.
 */
export function collectFiles(root, patterns) {
  const found = new Set();
  for (const p of patterns) {
    if (p.endsWith('/**')) {
      for (const rel of walk(join(root, p.slice(0, -3)), root, [])) found.add(rel);
    } else if (existsSync(join(root, p))) {
      found.add(p);
    }
  }
  return [...found].sort();
}

export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function hashFile(abs) {
  return existsSync(abs) ? hashContent(readFileSync(abs)) : null;
}

/**
 * Build the `files` baseline: hashes of every managed + advisory file as it
 * currently sits on disk (i.e. AFTER the rename, which is why bootstrap calls
 * this last).
 */
export function snapshotFiles(root, manifest) {
  const patterns = [...(manifest.managed ?? []), ...(manifest.advisory ?? [])];
  const files = {};
  for (const rel of collectFiles(root, patterns)) {
    const h = hashFile(join(root, rel));
    if (h) files[rel] = h;
  }
  return files;
}

/**
 * Write `precast.lock.json`. Called by bootstrap AFTER the rename and ports pass
 * but BEFORE `.git` is wiped, so the upstream commit is still readable.
 */
export function stampLock(root, { projectName, commit, manifest }) {
  const m = manifest ?? readManifest(root);
  if (!m) return null;
  const lock = {
    $comment:
      'Provenance for this project’s Precast origin. Do not hand-edit: `pnpm precast:update` maintains it.',
    precastVersion: m.version,
    precastCommit: commit ?? null,
    repository: m.repository,
    projectName,
    bootstrappedAt: new Date().toISOString(),
    files: snapshotFiles(root, m),
  };
  writeLock(root, lock);
  return lock;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = readLock(root);
  if (!lock) {
    console.log(`No ${LOCK_FILE} here — this looks like Precast itself, not a derived project.`);
    const m = readManifest(root);
    if (m) console.log(`Precast version: ${m.version}`);
  } else {
    console.log(`Derived from Precast ${lock.precastVersion} (${lock.precastCommit ?? 'unknown'})`);
    console.log(`Project name:    ${lock.projectName}`);
    console.log(`Bootstrapped:    ${lock.bootstrappedAt}`);
    console.log(`Tracked files:   ${Object.keys(lock.files ?? {}).length}`);
  }
}
