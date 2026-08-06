import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matches } from '../../../scripts/precast-lock.mjs';
import { classify } from '../../../scripts/precast-update.mjs';

/**
 * Precast upgrade-path guards (TOOL-004 … TOOL-006).
 *
 * `pnpm precast:update` lets a derived project pull later Precast improvements
 * in without any shared git history. Two things have to stay true for that to
 * work, and both fail silently rather than loudly:
 *
 *  1. **The manifest must describe reality.** A `managed` entry pointing at a
 *     file that no longer exists means an upgrade quietly skips it; a new root
 *     config that nobody added to `managed` never reaches derived projects at
 *     all. Neither shows up as an error — the plan just comes back short.
 *  2. **The 3-way classification must be exactly right.** It decides whether a
 *     file is overwritten or left alone. A wrong `update` verdict destroys a
 *     user's customization; a wrong `yours` verdict silently withholds an
 *     upstream fix forever.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'precast.manifest.json'), 'utf8'));

describe('precast.manifest.json', () => {
  it('declares a semver release, a repository, and both ownership lists', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.repository).toMatch(/^https?:\/\/.+\.git$/);
    expect(Array.isArray(manifest.managed)).toBe(true);
    expect(Array.isArray(manifest.advisory)).toBe(true);
  });

  it('lists only paths that actually exist', () => {
    const dead = [...manifest.managed, ...manifest.advisory]
      .map((p: string) => (p.endsWith('/**') ? p.slice(0, -3) : p))
      .filter((p: string) => !existsSync(join(REPO_ROOT, p)));
    expect(dead, `manifest references paths that no longer exist: ${dead.join(', ')}`).toEqual([]);
  });

  it('never claims the same path as both managed and advisory', () => {
    const overlap = manifest.advisory.filter((p: string) => manifest.managed.includes(p));
    expect(overlap, `a path cannot be both auto-synced and advisory: ${overlap.join(', ')}`).toEqual(
      [],
    );
  });

  it('keeps the files a derived project always customizes out of `managed`', () => {
    // Auto-overwriting any of these would clobber real project code on upgrade.
    for (const p of ['package.json', '.env.example', 'agentbase.import.json']) {
      expect(manifest.managed, `${p} must stay advisory`).not.toContain(p);
      expect(manifest.advisory).toContain(p);
    }
  });

  it('covers every root config that upgrades should carry', () => {
    for (const p of ['turbo.json', 'eslint.config.js', 'tsconfig.base.json', 'CLAUDE.md']) {
      expect(manifest.managed, `${p} should be synced to derived projects`).toContain(p);
    }
  });
});

describe('manifest path matching', () => {
  const patterns = ['scripts/**', 'turbo.json'];

  it('matches exact entries and directory prefixes', () => {
    expect(matches('turbo.json', patterns)).toBe(true);
    expect(matches('scripts/poc.mjs', patterns)).toBe(true);
    expect(matches('scripts/nested/deep.mjs', patterns)).toBe(true);
  });

  it('does not match unrelated paths or partial directory names', () => {
    expect(matches('apps/web/page.tsx', patterns)).toBe(false);
    expect(matches('turbo.json.bak', patterns)).toBe(false);
    // `scripts-old/` must not be swept in by the `scripts/**` prefix.
    expect(matches('scripts-old/poc.mjs', patterns)).toBe(false);
  });
});

describe('3-way classification', () => {
  const A = 'hash-a';
  const B = 'hash-b';
  const C = 'hash-c';

  it('takes an upstream change when the project never touched the file', () => {
    expect(classify({ base: A, local: A, up: B })).toBe('update');
  });

  it('leaves a locally customized file alone when upstream did not move', () => {
    expect(classify({ base: A, local: B, up: A })).toBe('yours');
  });

  it('flags a conflict when both sides moved', () => {
    expect(classify({ base: A, local: B, up: C })).toBe('conflict');
  });

  it('reports identical content as current, whatever the baseline says', () => {
    expect(classify({ base: A, local: B, up: B })).toBe('current');
    expect(classify({ base: null, local: A, up: A })).toBe('current');
  });

  it('distinguishes a brand-new upstream file from one deleted locally', () => {
    expect(classify({ base: null, local: null, up: A })).toBe('new');
    expect(classify({ base: A, local: null, up: A })).toBe('restore');
  });

  it('never auto-deletes a file that upstream removed', () => {
    expect(classify({ base: A, local: A, up: null })).toBe('removed');
  });

  it('refuses to guess when there is no baseline to compare against', () => {
    expect(classify({ base: null, local: A, up: B })).toBe('unknown');
  });

  it('ignores a path absent from every side', () => {
    expect(classify({ base: null, local: null, up: null })).toBeNull();
  });
});
