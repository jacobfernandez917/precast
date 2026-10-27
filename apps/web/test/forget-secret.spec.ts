import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetSecrets,
  markerFor,
  scrubFile,
  secretsFrom,
} from '../../../scripts/forget-secret.mjs';

/**
 * APP-032: `pnpm forget-secret`. A secret pasted into the Claude Code chat lands in the session
 * files; once it is in `.env`, every other copy is overwritten in place with a marker of the same
 * length. Pinned here: what counts as a secret, every spelling found (raw, URL-encoded, JSON
 * escaped), `.env` files untouched, short values left alone, and lengths that never change, so a
 * transcript still being appended to stays whole.
 */
const SECRET = 'Zq8vB3nR7tLw2xKp9sYd4mHc6fJg1aEu';
const DB_PASSWORD = 'p@ss/word-with-31-characters!!x';
const DB_URL = `postgresql://app_owner:${encodeURIComponent(DB_PASSWORD)}@db.example.net:5432/app?sslmode=require`;
const ENV = [
  'AGENTBASE_URL=https://ab.test',
  `AGENTBASE_CLIENT_SECRET=${SECRET}`,
  `DATABASE_URL=${DB_URL}`,
  'OIDC_CLIENT_SECRET=short',
  'BETTER_AUTH_SECRET=',
  '',
].join('\n');

let dir: string;
let project: string;
let claude: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'precast-forget-'));
  project = join(dir, 'project');
  claude = join(dir, 'claude', 'projects', '-proj');
  mkdirSync(project, { recursive: true });
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(project, '.env'), ENV);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (since = 0) =>
  forgetSecrets({ envPath: join(project, '.env'), roots: [join(dir, 'claude'), project], since });

describe('APP-032 forget-secret', () => {
  it('finds the secrets in .env, with the URL password in both spellings', () => {
    const found = secretsFrom(ENV);
    expect(found.map((s) => s.label)).toEqual([
      'AGENTBASE_CLIENT_SECRET',
      'OIDC_CLIENT_SECRET',
      'DATABASE_URL password',
    ]);
    const db = found.find((s) => s.label === 'DATABASE_URL password')!;
    expect(db.spellings).toContain(encodeURIComponent(DB_PASSWORD));
    expect(db.spellings).toContain(DB_PASSWORD);
  });

  it('overwrites every copy in a transcript, keeping its length and its JSON whole', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: `my secret is ${SECRET}` } }),
      JSON.stringify({
        type: 'tool_use',
        input: { command: `AGENTBASE_CLIENT_SECRET='${SECRET}' pnpm bootstrap x` },
      }),
      JSON.stringify({ type: 'user', message: { content: `use ${DB_URL}` } }),
      JSON.stringify({ type: 'assistant', message: { content: `password ${DB_PASSWORD}` } }),
      '',
    ].join('\n');
    const transcript = join(claude, 'session.jsonl');
    writeFileSync(transcript, lines);
    const before = statSync(transcript).size;

    const { totals, tooShort } = run();
    const after = readFileSync(transcript, 'utf8');
    expect(statSync(transcript).size).toBe(before);
    expect(after).not.toContain(SECRET);
    expect(after).not.toContain(encodeURIComponent(DB_PASSWORD));
    expect(after).not.toContain(DB_PASSWORD);
    for (const line of after.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
    expect(after).toContain(markerFor(SECRET.length));
    expect(totals.AGENTBASE_CLIENT_SECRET).toEqual({ copies: 2, files: 1 });
    expect(totals['DATABASE_URL password']!.copies).toBe(2);
    expect(tooShort).toEqual(['OIDC_CLIENT_SECRET']);
  });

  it('leaves every .env alone, the project’s and any other, and does not follow symlinks', () => {
    const other = join(dir, 'claude', 'scratch', 'other-project');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, '.env'), `AGENTBASE_CLIENT_SECRET=${SECRET}\n`);
    writeFileSync(join(other, '.env.example'), `# e.g. ${SECRET}\n`);
    const outside = join(dir, 'outside.txt');
    writeFileSync(outside, SECRET);
    symlinkSync(outside, join(claude, 'link.txt'));

    run();
    expect(readFileSync(join(project, '.env'), 'utf8')).toBe(ENV);
    expect(readFileSync(join(other, '.env'), 'utf8')).toContain(SECRET);
    expect(readFileSync(join(other, '.env.example'), 'utf8')).not.toContain(SECRET);
    expect(readFileSync(outside, 'utf8')).toBe(SECRET);
  });

  it('by default skips files not changed recently, and a file still being appended to stays whole', () => {
    const old = join(claude, 'old.jsonl');
    writeFileSync(old, SECRET);
    const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    utimesSync(old, longAgo, longAgo);
    const live = join(claude, 'live.jsonl');
    writeFileSync(live, `a ${SECRET}\n`);

    run(Date.now() - 7 * 24 * 3600 * 1000);
    expect(readFileSync(old, 'utf8')).toBe(SECRET);
    writeFileSync(live, 'next line\n', { flag: 'a' });
    expect(readFileSync(live, 'utf8')).toBe(`a ${markerFor(SECRET.length)}\nnext line\n`);
  });

  it('a file with nothing to remove is not written', () => {
    const plain = join(claude, 'plain.jsonl');
    writeFileSync(plain, 'nothing secret here\n');
    const mtime = statSync(plain).mtimeMs;
    expect(scrubFile(plain, secretsFrom(ENV))).toEqual({});
    expect(statSync(plain).mtimeMs).toBe(mtime);
  });

  it('markers are exactly as long as what they replace', () => {
    for (const n of [1, 9, 12, 40]) expect(markerFor(n)).toHaveLength(n);
    expect(markerFor(12)).toBe('[removed]***');
  });
});
