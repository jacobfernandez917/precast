#!/usr/bin/env node
/**
 * pnpm forget-secret — remove this project's secrets from the session logs on this computer.
 *
 * A person may paste the AgentBase client secret (or a database URL) into the Claude Code chat
 * instead of typing it at a prompt. The chat is written to Claude Code's session files, and the
 * commands that used the value are too. Once the value is safely in `.env`, this replaces every
 * copy of it elsewhere with a marker of the same length.
 *
 *   pnpm forget-secret          # files changed in the last 7 days
 *   pnpm forget-secret --all    # every file, however old
 *
 * The values are read from `.env`, never from the command line, so running this leaves no new
 * copy behind, and `.env` keeps them. A copy is overwritten in place, byte for byte, so a session
 * file Claude Code is still appending to is never truncated or rewritten under it.
 *
 * Where it looks: Claude Code's own folder (`~/.claude`, or CLAUDE_CONFIG_DIR: transcripts,
 * prompt history, file-edit backups), its temporary folder (background task output), and this
 * project's text files. Any `.env` file is left alone. What it cannot reach: what was already
 * sent to the model provider, and copies made elsewhere (a screenshot, another computer).
 */

import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPlaceholder } from './connect-agentbase.mjs';
import { parseEnvFile } from './provision-db.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Values a person might paste, or that a command might print. */
export const SECRET_KEYS = [
  'AGENTBASE_CLIENT_SECRET',
  'OIDC_CLIENT_SECRET',
  'AGENT_API_TOKEN',
  'BETTER_AUTH_SECRET',
];
/** URLs whose password is the secret part. */
export const URL_KEYS = ['DATABASE_URL', 'MASTRA_DB_URL', 'REDIS_URL'];

/** Shorter than this, a value could match ordinary text, so it is reported, not replaced. */
export const MIN_LENGTH = 12;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.mastra',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
]);

const isEnvFile = (name) => /^\.env(\..+)?$/.test(name) && name !== '.env.example';

/** The secrets in an `.env` text, each with a label and every spelling it may appear in. */
export function secretsFrom(envText) {
  const env = parseEnvFile(envText);
  const found = [];
  for (const key of SECRET_KEYS) {
    const value = env[key]?.trim();
    if (value && !isPlaceholder(value)) found.push({ label: key, value });
  }
  for (const key of URL_KEYS) {
    const raw = env[key]?.trim();
    if (!raw || isPlaceholder(raw)) continue;
    let password;
    try {
      password = new URL(raw).password;
    } catch {
      continue;
    }
    if (!password || password === 'password') continue;
    const decoded = safeDecode(password);
    found.push({ label: `${key} password`, value: password, also: decoded });
  }
  return found.map(({ label, value, also }) => {
    const spellings = new Set([value, also].filter(Boolean));
    // Inside a JSON transcript a quote or backslash is escaped.
    for (const v of [...spellings]) spellings.add(JSON.stringify(v).slice(1, -1));
    return { label, value, spellings: [...spellings] };
  });
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A marker exactly as long as what it replaces. */
export function markerFor(length) {
  return ('[removed]' + '*'.repeat(length)).slice(0, length);
}

/**
 * Overwrite every occurrence of each needle in one file, in place. Returns how many were
 * replaced per label. The file's length never changes.
 */
export function scrubFile(path, secrets) {
  let content;
  try {
    content = readFileSync(path);
  } catch {
    return {};
  }
  const hits = {};
  const writes = [];
  for (const { label, spellings } of secrets) {
    for (const spelling of spellings) {
      const needle = Buffer.from(spelling);
      for (let at = content.indexOf(needle); at !== -1; at = content.indexOf(needle, at + 1)) {
        writes.push({ at, bytes: Buffer.from(markerFor(needle.length)) });
        hits[label] = (hits[label] ?? 0) + 1;
      }
    }
  }
  if (!writes.length) return hits;
  const fd = openSync(path, 'r+');
  try {
    for (const { at, bytes } of writes) writeSync(fd, bytes, 0, bytes.length, at);
  } finally {
    closeSync(fd);
  }
  return hits;
}

/** Regular files under `dir`, skipping symlinks, build output and any `.env`. */
export function* filesUnder(dir, { since = 0, skipDirs = SKIP_DIRS } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) yield* filesUnder(path, { since, skipDirs });
      continue;
    }
    if (!entry.isFile() || isEnvFile(entry.name)) continue;
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat || stat.size > MAX_FILE_BYTES || stat.mtimeMs < since) continue;
    yield path;
  }
}

/** Claude Code's folder, its temporary folder, and the project. Duplicates removed. */
export function defaultRoots({ env = process.env, project = rootDir } = {}) {
  const uid = process.getuid?.() ?? '';
  const candidates = [
    env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
    `/tmp/claude-${uid}`,
    join(tmpdir(), `claude-${uid}`),
    project,
  ];
  const seen = new Set();
  return candidates.filter((dir) => {
    if (!existsSync(dir)) return false;
    const real = realpathSync(dir);
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
}

export function forgetSecrets({ envPath, roots, since = 0 }) {
  const secrets = secretsFrom(existsSync(envPath) ? readFileSync(envPath, 'utf8') : '');
  const tooShort = secrets.filter((s) => s.value.length < MIN_LENGTH).map((s) => s.label);
  const usable = secrets.filter((s) => s.value.length >= MIN_LENGTH);
  const totals = Object.fromEntries(usable.map((s) => [s.label, { copies: 0, files: 0 }]));
  // Claude Code's plugin checkouts are large and hold no session text.
  const skipDirs = new Set([...SKIP_DIRS, 'plugins']);
  for (const root of roots) {
    for (const file of filesUnder(root, { since, skipDirs })) {
      const hits = scrubFile(file, usable);
      for (const [label, n] of Object.entries(hits)) {
        totals[label].copies += n;
        totals[label].files += 1;
      }
    }
  }
  return { totals, tooShort, checked: usable.map((s) => s.label) };
}

function main() {
  const args = process.argv.slice(2);
  const envFlag = args.find((a) => a.startsWith('--env='))?.slice('--env='.length);
  const envPath = envFlag ? realpathSync(envFlag) : join(rootDir, '.env');
  if (!existsSync(envPath))
    throw new Error(`There is no .env at ${envPath}, so no secret to look for.`);
  const since = args.includes('--all') ? 0 : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const roots = defaultRoots({ project: dirname(envPath) });

  const { totals, tooShort, checked } = forgetSecrets({ envPath, roots, since });
  const removed = Object.entries(totals).filter(([, t]) => t.copies > 0);
  const clean = Object.entries(totals)
    .filter(([, t]) => t.copies === 0)
    .map(([label]) => label);

  if (!checked.length && !tooShort.length) {
    console.log('No secret in .env to look for.');
    return;
  }
  if (removed.length) {
    console.log("Removed from this computer's session logs:");
    for (const [label, t] of removed) {
      console.log(
        `  ${label.padEnd(26)} ${t.copies} ${t.copies === 1 ? 'copy' : 'copies'} in ${t.files} ${t.files === 1 ? 'file' : 'files'}`,
      );
    }
  }
  if (clean.length) console.log(`No copy found of: ${clean.join(', ')}.`);
  if (tooShort.length) {
    console.log(
      `Left alone, too short to tell from ordinary text: ${tooShort.join(', ')}. Change it to a longer one if it was pasted anywhere.`,
    );
  }
  console.log(
    `.env still holds every value. Looked in: ${roots.join(', ')}${since ? ' (files changed in the last 7 days; --all for every file)' : ''}.`,
  );
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
