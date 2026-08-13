#!/usr/bin/env node
/**
 * precast-update.mjs — Pull Precast improvements into a project derived from it.
 *
 *   pnpm precast:update                    # check only: print the plan, write nothing
 *   pnpm precast:update --apply            # take the safe updates
 *   pnpm precast:update --apply --force    # also overwrite conflicts (backs up first)
 *   pnpm precast:update --ref=v0.3.0       # target a specific tag / branch / commit
 *   pnpm precast:update --from=../precast  # compare against a local checkout, no network
 *   pnpm precast:update --adopt            # first-time: record which Precast you're on
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * `pnpm bootstrap` deletes Precast's git history, so there is no common ancestor
 * and `git merge upstream` is not available. This does the same job without
 * ancestry, using the baseline hashes in `precast.lock.json`.
 *
 * ── How it avoids drowning in false conflicts ──────────────────────────────────
 * A derived project isn't a copy of Precast: the placeholder was renamed and the
 * ports were reassigned. Rather than reimplement those transforms (and drift from
 * them), this script REPLAYS Precast's own scripts against the fetched upstream
 * copy — `rename-project.mjs <your-name>` then `set-ports.mjs <your-ports>`. What
 * it then compares is "what upstream would look like had it been bootstrapped as
 * THIS project", so only real changes show up.
 *
 * ── How each file is classified (3-way, no git) ────────────────────────────────
 *   base   = hash recorded in precast.lock.json (upstream content at last sync)
 *   local  = hash of the file in this project right now
 *   up     = hash of the transformed upstream file
 *
 *   local == up                → current       (nothing to do)
 *   local == base, up != base  → UPDATE        (you never touched it; safe)
 *   up == base, local != base  → yours         (you customized it; left alone)
 *   all three differ           → CONFLICT      (needs review; --force to take upstream)
 *   missing locally            → RESTORE / NEW
 *   missing upstream           → removed upstream (reported, never auto-deleted)
 *
 * Files listed as `advisory` in precast.manifest.json are never written — they're
 * reported so you can port the change by hand (package.json, .env.example, the
 * fitness-guard specs). See docs/MIGRATIONS.md for what each release changed and
 * which parts this script can't do for you.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LOCK_FILE,
  collectFiles,
  hashFile,
  matches,
  readLock,
  readManifest,
  writeLock,
} from './precast-lock.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const KINDS = {
  update: { label: 'Update (safe — you never touched these)', write: true },
  new: { label: 'New in Precast', write: true },
  restore: { label: 'Missing locally — restore', write: true },
  conflict: { label: 'CONFLICT (changed both upstream and here)', write: false },
  unknown: { label: 'Differs, no baseline recorded', write: false },
  yours: { label: 'Yours (customized here, unchanged upstream)', write: false },
  removed: { label: 'Removed upstream (never auto-deleted)', write: false },
  current: { label: 'Already current', write: false },
};

function flag(name) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
}

function run(cmd, argv, cwd) {
  return spawnSync(cmd, argv, { cwd, encoding: 'utf-8' });
}

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

/** Ports this project uses — read the same way set-ports.mjs reads them. */
function readPorts(dir) {
  const p = join(dir, '.env.example');
  const txt = existsSync(p) ? readFileSync(p, 'utf-8') : '';
  return {
    mastra: Number((txt.match(/^MASTRA_PORT=(\d+)/m) || [])[1] || 4111),
    web: Number((txt.match(/^WEB_PORT=(\d+)/m) || [])[1] || 3000),
    keycloak: Number((txt.match(/^KEYCLOAK_HOST_PORT=(\d+)/m) || [])[1] || 8080),
  };
}

/** Highest semver tag on the remote, or null if the repo has no tags yet. */
function latestTag(repo) {
  const res = run('git', ['ls-remote', '--tags', '--refs', repo]);
  if (res.status !== 0) return null;
  const tags = res.stdout
    .split('\n')
    .map((l) => l.split('refs/tags/')[1])
    .filter((t) => t && /^v?\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => {
      const pa = a.replace(/^v/, '').split('.').map(Number);
      const pb = b.replace(/^v/, '').split('.').map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
  return tags.at(-1) ?? null;
}

function fetchUpstream({ repo, ref, from, tmp }) {
  if (from) {
    const src = resolve(process.cwd(), from);
    if (!existsSync(join(src, 'precast.manifest.json'))) {
      die(`--from=${from} doesn't look like a Precast checkout (no precast.manifest.json).`);
    }
    console.log(`Using local Precast checkout: ${src}`);
    cpSync(src, tmp, {
      recursive: true,
      filter: (s) => !/(^|\/)(\.git|node_modules|dist|\.next|\.turbo|coverage)(\/|$)/.test(s),
    });
    const sha = run('git', ['rev-parse', 'HEAD'], src);
    return sha.status === 0 ? sha.stdout.trim() : null;
  }

  console.log(`Fetching ${repo} @ ${ref}…`);
  let res = run('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, repo, tmp]);
  if (res.status !== 0) {
    // `--branch` only accepts tags/branches; fall back to a full clone for a SHA.
    rmSync(tmp, { recursive: true, force: true });
    res = run('git', ['clone', '--quiet', repo, tmp]);
    if (res.status !== 0) die(`Could not clone ${repo}:\n${res.stderr?.trim()}`);
    const co = run('git', ['checkout', '--quiet', ref], tmp);
    if (co.status !== 0) die(`Ref "${ref}" not found in ${repo}.`);
  }
  const sha = run('git', ['rev-parse', 'HEAD'], tmp);
  return sha.status === 0 ? sha.stdout.trim() : null;
}

/**
 * Make the upstream copy look like this project by replaying Precast's own
 * transforms. Reusing the real scripts is the point — a reimplementation here
 * would drift from them and turn every release into a wall of false conflicts.
 */
function transformUpstream(tmp, projectName, ports) {
  const rename = run('node', ['scripts/rename-project.mjs', projectName], tmp);
  if (rename.status !== 0) {
    die(`Replaying the rename on the upstream copy failed:\n${rename.stderr?.trim()}`);
  }
  const setPorts = run(
    'node',
    [
      'scripts/set-ports.mjs',
      `--mastra=${ports.mastra}`,
      `--web=${ports.web}`,
      `--keycloak=${ports.keycloak}`,
    ],
    tmp,
  );
  if (setPorts.status !== 0) {
    die(`Replaying the port assignment on the upstream copy failed:\n${setPorts.stderr?.trim()}`);
  }
}

/**
 * The 3-way decision, isolated and exported so it can be unit-tested — every
 * other part of this script is I/O around this one function.
 */
export function classify({ base, local, up }) {
  if (up === null) return local === null ? null : 'removed';
  if (local === null) return base === null ? 'new' : 'restore';
  if (local === up) return 'current';
  if (base === null) return 'unknown';
  if (local === base) return 'update';
  if (up === base) return 'yours';
  return 'conflict';
}

function buildPlan({ tmp, lock, manifest }) {
  const managed = manifest.managed ?? [];
  const advisory = manifest.advisory ?? [];
  const all = [...managed, ...advisory];

  // Union of what upstream has, what we have, and what the lock remembers —
  // so deletions on either side still surface.
  const paths = new Set([
    ...collectFiles(tmp, all),
    ...collectFiles(rootDir, all),
    ...Object.keys(lock.files ?? {}).filter((p) => matches(p, all)),
  ]);

  const plan = [];
  for (const rel of [...paths].sort()) {
    if (rel === LOCK_FILE) continue;
    const kind = classify({
      base: lock.files?.[rel] ?? null,
      local: hashFile(join(rootDir, rel)),
      up: hashFile(join(tmp, rel)),
    });
    if (!kind) continue;
    plan.push({ rel, kind, advisory: matches(rel, advisory) && !matches(rel, managed) });
  }
  return plan;
}

function report(plan, { from, to, apply, force }) {
  const group = (pred) => plan.filter(pred);
  const writable = group((e) => KINDS[e.kind].write && !e.advisory);
  const blocked = group((e) => ['conflict', 'unknown'].includes(e.kind) && !e.advisory);
  const advisory = group((e) => e.advisory && e.kind !== 'current');

  console.log(`\nPrecast ${from} → ${to}\n`);

  for (const kind of ['update', 'new', 'restore', 'conflict', 'unknown', 'yours', 'removed']) {
    const entries = group((e) => e.kind === kind && !e.advisory);
    if (!entries.length) continue;
    console.log(`${KINDS[kind].label} — ${entries.length}`);
    for (const e of entries) console.log(`   ${e.rel}`);
    console.log('');
  }

  if (advisory.length) {
    console.log(`Advisory — changed upstream, never written automatically (${advisory.length}):`);
    for (const e of advisory) console.log(`   ${e.rel}  [${e.kind}]`);
    console.log('   Port these by hand — see docs/MIGRATIONS.md for what changed and why.\n');
  }

  const current = group((e) => e.kind === 'current').length;
  console.log(`Already current: ${current}`);

  if (!writable.length && !blocked.length && !advisory.length) {
    console.log('\n✅ Nothing to do — this project is up to date with Precast.');
    return;
  }

  if (!apply) {
    console.log(
      `\nThis was a check — nothing was written.` +
        (writable.length
          ? `\n   Take the ${writable.length} safe change(s):  pnpm precast:update --apply`
          : ''),
    );
  }
  if (blocked.length && !force) {
    console.log(
      `\n⚠️  ${blocked.length} file(s) changed on both sides and were left alone.` +
        `\n   Review them, then re-run with --force to take upstream (a .precast-bak copy is kept).`,
    );
  }
}

function applyPlan(plan, tmp, force) {
  let written = 0;
  const taken = [];
  for (const e of plan) {
    if (e.advisory) continue;
    const forced = force && ['conflict', 'unknown'].includes(e.kind);
    if (!KINDS[e.kind].write && !forced) continue;

    const dest = join(rootDir, e.rel);
    if (forced && existsSync(dest)) {
      writeFileSync(`${dest}.precast-bak`, readFileSync(dest));
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(tmp, e.rel)));
    written++;
    taken.push(e.rel);
  }
  return { written, taken };
}

async function main() {
  const manifest = readManifest(rootDir);
  const adopt = flag('adopt') === true;
  let lock = readLock(rootDir);

  if (!lock && !adopt) {
    die(
      `No ${LOCK_FILE} here.\n\n` +
        `   If this project was scaffolded from Precast before provenance tracking existed,\n` +
        `   record where it came from once:\n\n` +
        `       pnpm precast:update --adopt --ref=<the Precast version you started from>\n\n` +
        `   Everything you have since customized will show up as "yours" and be left alone.`,
    );
  }

  const repo = flag('repo') ?? lock?.repository ?? manifest?.repository;
  const from = flag('from');
  if (!repo && !from) die('No Precast repository known — pass --repo=<url> or --from=<path>.');

  const ref = flag('ref') ?? (from ? 'local' : (latestTag(repo) ?? manifest?.branch ?? 'develop'));
  const projectName =
    lock?.projectName ?? JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).name;
  if (!projectName || projectName === 'precast') {
    die(
      "Could not determine this project's name — is this Precast itself rather than a derived project?",
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), 'precast-upstream-'));
  try {
    const commit = fetchUpstream({ repo, ref, from: typeof from === 'string' ? from : null, tmp });
    const upstreamManifest = readManifest(tmp);
    if (!upstreamManifest)
      die('The fetched Precast has no precast.manifest.json — too old to sync from.');

    transformUpstream(tmp, projectName, readPorts(rootDir));

    if (adopt) {
      const files = {};
      for (const rel of collectFiles(tmp, [
        ...(upstreamManifest.managed ?? []),
        ...(upstreamManifest.advisory ?? []),
      ])) {
        const h = hashFile(join(tmp, rel));
        if (h) files[rel] = h;
      }
      writeLock(rootDir, {
        $comment: `Provenance for this project's Precast origin. Do not hand-edit: 'pnpm precast:update' maintains it.`,
        precastVersion: upstreamManifest.version,
        precastCommit: commit,
        repository: upstreamManifest.repository,
        projectName,
        bootstrappedAt: lock?.bootstrappedAt ?? new Date().toISOString(),
        adoptedAt: new Date().toISOString(),
        files,
      });
      console.log(
        `\n✅ Recorded this project as derived from Precast ${upstreamManifest.version}` +
          ` (${Object.keys(files).length} files tracked).\n` +
          `   Run \`pnpm precast:update\` to see what a newer Precast would change.`,
      );
      return;
    }

    const plan = buildPlan({ tmp, lock, manifest: upstreamManifest });
    const apply = flag('apply') === true;
    const force = flag('force') === true;

    report(plan, { from: lock.precastVersion, to: upstreamManifest.version, apply, force });
    if (!apply) return;

    const { written, taken } = applyPlan(plan, tmp, force);

    // Advance the baseline ONLY for files we actually took (plus ones already
    // identical). A skipped conflict keeps its old baseline, so it keeps
    // reporting as a conflict next time instead of silently going quiet.
    const files = { ...(lock.files ?? {}) };
    for (const e of plan) {
      if (e.kind === 'current' || taken.includes(e.rel)) {
        const h = hashFile(join(tmp, e.rel));
        if (h) files[e.rel] = h;
      }
    }
    const pending = plan
      .filter((e) => ['conflict', 'unknown'].includes(e.kind) && !taken.includes(e.rel))
      .map((e) => e.rel);

    // Drop any stale pendingReview before re-adding — a conflict resolved by
    // --force must not keep reporting itself forever.
    const { pendingReview: _stale, ...carried } = lock;
    writeLock(rootDir, {
      ...carried,
      precastVersion: upstreamManifest.version,
      precastCommit: commit,
      updatedAt: new Date().toISOString(),
      files,
      ...(pending.length ? { pendingReview: pending } : {}),
    });

    console.log(
      `\n✅ Wrote ${written} file(s); ${LOCK_FILE} now records Precast ${upstreamManifest.version}.`,
    );
    if (pending.length) {
      console.log(`   Still needing review (baseline left at the old version): ${pending.length}`);
    }
    console.log(
      '   Review with `git diff`, then run `pnpm install` if scripts or configs changed.',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
