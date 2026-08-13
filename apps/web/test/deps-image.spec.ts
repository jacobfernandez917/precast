import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lockHash, tagFor, DEPS_IMAGE_REPO, FALLBACK_BASE } from '../../../scripts/deps-image.mjs';
import { replaceToken } from '../../../scripts/rename-project.mjs';

/**
 * Dependency-base-image guards (APP-016 … APP-018).
 *
 * The deps image is a pure optimisation: it removes two full workspace installs
 * from a scaffold. Every invariant below exists because breaking it degrades
 * *silently* — the build still succeeds, just slowly or, worse, wrongly.
 *
 *  1. **The fallback must stay plain.** If a Dockerfile ever hard-codes the
 *     registry ref as its default, a clone with no network, no GHCR access, or
 *     a fork with nothing published stops building at all. The optimisation is
 *     only allowed to be additive.
 *  2. **`pnpm rename` must not rewrite the registry ref.** The Dockerfiles and
 *     docker-compose.yml are rename targets, so `ghcr.io/<owner>/precast-deps`
 *     would become `…/<project>-deps` on the very first scaffold and 404.
 *  3. **The cache key must ignore the rename.** A rename changes every
 *     workspace package NAME but not one byte of the dependency graph. If the
 *     hash moved, every derived project would miss the cache permanently —
 *     which looks exactly like the feature not working.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const APP_DOCKERFILES = ['apps/agents/Dockerfile', 'apps/web/Dockerfile'];

describe('app Dockerfiles: the deps image is optional', () => {
  it.each(APP_DOCKERFILES)('%s defaults BASE_IMAGE to a plain public image', (rel) => {
    const src = read(rel);
    const arg = src.match(/^ARG\s+BASE_IMAGE=(.+)$/m);
    expect(arg, `${rel} must declare ARG BASE_IMAGE`).not.toBeNull();
    expect(
      arg![1].trim(),
      `${rel} must fall back to ${FALLBACK_BASE}. Hard-coding the registry ref as the ` +
        'default breaks every clone that cannot reach GHCR — the deps image is an ' +
        'optimisation, never a prerequisite.',
    ).toBe(FALLBACK_BASE);
  });

  it.each(APP_DOCKERFILES)('%s builds FROM the arg, not a literal image', (rel) => {
    expect(read(rel)).toMatch(/^FROM\s+\$\{BASE_IMAGE\}\s+AS\s+build$/m);
  });

  it.each(APP_DOCKERFILES)('%s shares the store path baked into deps.Dockerfile', (rel) => {
    // A different --store-dir makes the warm content invisible: the build still
    // succeeds, having silently re-downloaded everything.
    const deps = read('docker/deps.Dockerfile');
    const baked = deps.match(/ENV\s+PNPM_STORE_DIR=(\S+)/)?.[1];
    expect(baked, 'deps.Dockerfile must set PNPM_STORE_DIR').toBeTruthy();
    expect(read(rel)).toContain(`--store-dir "\${PNPM_STORE_DIR:-${baked}}"`);
  });
});

describe('deps.Dockerfile', () => {
  it('is itself node:24-alpine, which is what makes ${BASE_IMAGE} safe', () => {
    // docker-build.spec.ts skips the parameterised stage on the strength of
    // this. If the deps image drifted to another base, every app build would
    // quietly run on it.
    const bases = [...read('docker/deps.Dockerfile').matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(bases.length).toBeGreaterThan(0);
    for (const b of bases) expect(b).toBe('node:24-alpine');
  });
});

describe('deps.Dockerfile carries no application source', () => {
  it('copies only dependency-graph inputs', () => {
    const copies = [...read('docker/deps.Dockerfile').matchAll(/^COPY\s+(.+)$/gm)].map((m) =>
      m[1].trim(),
    );
    expect(copies.length).toBeGreaterThan(0);
    for (const line of copies) {
      const sources = line.split(/\s+/).slice(0, -1);
      for (const src of sources) {
        expect(
          src,
          `deps.Dockerfile copies "${src}". Only lockfiles and package.json manifests may ` +
            'be copied — any source here would invalidate the layer on every edit, which ' +
            'is the whole thing this image exists to avoid.',
        ).toMatch(/(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/);
      }
    }
  });
});

describe('rename safety', () => {
  it('leaves an upstream ghcr.io reference untouched', () => {
    const src = `ARG BASE_IMAGE=${DEPS_IMAGE_REPO}:lock-deadbeef\nRUN echo precast`;
    const out = replaceToken(src, 'vectorizer');
    expect(out).toContain(`${DEPS_IMAGE_REPO}:lock-deadbeef`);
    expect(out).toContain('echo vectorizer');
  });

  it('still renames every case form outside a registry reference', () => {
    const out = replaceToken('precast Precast PRECAST', 'vectorizer');
    expect(out).toBe('vectorizer Vectorizer VECTORIZER');
  });

  it('restores protected spans exactly, with no whitespace drift', () => {
    const src = `FROM ${DEPS_IMAGE_REPO}:lock-abc AS build\n`;
    expect(replaceToken(src, 'vectorizer')).toBe(src);
  });

  it('handles two references on one line', () => {
    const src = `${DEPS_IMAGE_REPO}:a ${DEPS_IMAGE_REPO}:b`;
    expect(replaceToken(src, 'vectorizer')).toBe(src);
  });
});

describe('cache key', () => {
  it('produces a stable lock-<hash> tag', () => {
    const tag = tagFor();
    expect(tag).toMatch(/^lock-[0-9a-f]{16}$/);
    expect(tagFor(), 'the hash must be deterministic').toBe(tag);
  });

  it('is keyed on the dependency graph, not on package names', () => {
    // Proven structurally: lockHash reads only dependency blocks +
    // packageManager from each manifest. If a future edit folds `name` in,
    // every renamed project loses the cache forever and nobody notices.
    const src = readFileSync(join(REPO_ROOT, 'scripts/deps-image.mjs'), 'utf8');
    const body = src.slice(src.indexOf('export function lockHash'), src.indexOf('export function tagFor'));
    expect(body).toContain('dependencies');
    expect(body, 'lockHash must not hash package names — a rename is not a graph change').not.toMatch(
      /pkg\.name/,
    );
  });

  it('has a lockfile to hash', () => {
    expect(existsSync(join(REPO_ROOT, 'pnpm-lock.yaml'))).toBe(true);
    expect(lockHash()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('compose passes the resolved base through', () => {
  it.each(['agents', 'web'])('%s service forwards BASE_IMAGE as a build arg', (svc) => {
    const compose = read('docker/docker-compose.yml');
    const block = compose.slice(compose.indexOf(`  ${svc}:`));
    expect(block.slice(0, 600)).toMatch(/BASE_IMAGE:\s*\$\{BASE_IMAGE:-node:24-alpine\}/);
  });
});
