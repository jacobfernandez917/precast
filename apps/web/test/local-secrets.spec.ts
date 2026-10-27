import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocalSecrets } from '../../../scripts/local-secrets.mjs';

/**
 * APP-028: the secrets only this machine needs are created when missing, never
 * replaced, and .env stays readable by its owner only (it holds the
 * Application secret and the database password). Found on a fresh scaffold:
 * no BETTER_AUTH_SECRET at all, so every sign-in failed, and .env was 0644.
 */
const dirs: string[] = [];
const envWith = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
  dirs.push(dir);
  const path = join(dir, '.env');
  writeFileSync(path, text, { mode: 0o644 });
  return path;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('ensureLocalSecrets', () => {
  it('fills empty and absent secrets, and makes .env owner-only', () => {
    const path = envWith('AGENT_API_TOKEN=\nLOG_LEVEL=info\n');
    expect(ensureLocalSecrets(path)).toEqual(['AGENT_API_TOKEN', 'BETTER_AUTH_SECRET']);
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/^AGENT_API_TOKEN=[0-9a-f]{64}$/m);
    expect(text).toMatch(/^BETTER_AUTH_SECRET=[A-Za-z0-9_-]{43}$/m);
    expect(text).toContain('LOG_LEVEL=info');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('never replaces a secret that is already set', () => {
    const path = envWith('AGENT_API_TOKEN=keep-me\nBETTER_AUTH_SECRET=and-me\n');
    expect(ensureLocalSecrets(path)).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe('AGENT_API_TOKEN=keep-me\nBETTER_AUTH_SECRET=and-me\n');
  });

  it('does nothing when there is no .env', () => {
    expect(ensureLocalSecrets(join(tmpdir(), 'no-such-dir-xyz', '.env'))).toEqual([]);
  });
});
