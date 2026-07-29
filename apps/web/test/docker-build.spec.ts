import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Build guard (repo-wide): every app Dockerfile must build the workspace with
 * **path-based** pnpm filters and **assert its artifact**.
 *
 * Why this exists: a name-based `pnpm --filter @scope/pkg build` that matches
 * nothing (e.g. after `pnpm rename` rewrites the package scope) prints
 * "No projects matched" and **exits 0** — a silent no-op. The build stage then
 * "succeeds" having produced no output, and the only symptom is an opaque
 * `COPY --from=build …` failure in the runtime stage. Path filters (`./apps/x`)
 * are immune to renames, and a trailing `test -f <artifact>` turns an empty
 * build into a loud, early failure. This test keeps both invariants from rotting.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const APPS_DIR = join(REPO_ROOT, 'apps');

// Drop full-line `#` comments so the explanatory prose in the Dockerfiles
// (which legitimately mentions `--filter @scope/pkg`) isn't matched as usage.
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function findDockerfiles(): string[] {
  if (!existsSync(APPS_DIR)) return [];
  const found: string[] = [];
  for (const app of readdirSync(APPS_DIR)) {
    const dockerfile = join(APPS_DIR, app, 'Dockerfile');
    if (existsSync(dockerfile)) found.push(dockerfile);
  }
  return found;
}

// `--filter @scope/pkg` or `--filter "@scope/pkg"` — rename-fragile.
const NAME_FILTER = /--filter\s+['"]?@[\w-]+\//;
// `--filter "./apps/web"` — rename-proof.
const PATH_FILTER = /--filter\s+['"]\.\//;
// `test -f <path>` — the artifact assertion.
const ARTIFACT_ASSERTION = /\btest -f\s+\S/;

describe('docker: rename-proof workspace builds', () => {
  const dockerfiles = findDockerfiles();

  it('finds at least one app Dockerfile to guard', () => {
    expect(dockerfiles.length).toBeGreaterThan(0);
  });

  it.each(dockerfiles)('%s uses path filters and asserts its artifact', (dockerfile) => {
    const rel = dockerfile.replace(REPO_ROOT, '').replace(/^\//, '');
    const body = stripComments(readFileSync(dockerfile, 'utf8'));

    expect(
      NAME_FILTER.test(body),
      `${rel} uses a name-based \`pnpm --filter @scope/…\`, which silently no-ops (exit 0) ` +
        `after a scope rename. Filter by workspace path instead, e.g. --filter "./apps/web".`,
    ).toBe(false);

    expect(
      PATH_FILTER.test(body),
      `${rel} must build via a path-based filter (e.g. --filter "./apps/web") so it survives renames.`,
    ).toBe(true);

    expect(
      ARTIFACT_ASSERTION.test(body),
      `${rel} must assert its build artifact (e.g. \`&& test -f apps/web/.next/standalone/apps/web/server.js\`) ` +
        `so a silent empty build fails loudly in the build stage, not as an opaque COPY error later.`,
    ).toBe(true);
  });
});

/**
 * Base-image guard: every stage of every app Dockerfile runs on Node 24 (the
 * active LTS line, matching .nvmrc) on Alpine.
 *
 * Both halves matter. Node 24 because the runtime must match the version the
 * workspace is built and tested against — a builder/runtime version skew shows
 * up as a native-module or API mismatch only once the container runs. Alpine
 * because these images are rebuilt on every `pnpm poc`, and a slim base is the
 * difference between a fast PoC loop and a slow one.
 */
const FROM_LINE = /^FROM\s+(\S+)/gm;

describe('docker: node 24 alpine base images', () => {
  const dockerfiles = findDockerfiles();

  it.each(dockerfiles)('%s builds every stage on node:24-alpine', (dockerfile) => {
    const rel = dockerfile.replace(REPO_ROOT, '').replace(/^\//, '');
    const body = stripComments(readFileSync(dockerfile, 'utf8'));
    const bases = [...body.matchAll(FROM_LINE)].map((m) => m[1]);

    expect(
      bases.length,
      `${rel} must declare at least a build and a runtime stage`,
    ).toBeGreaterThanOrEqual(2);

    for (const base of bases) {
      expect(
        base,
        `${rel} has a stage on "${base}" — every stage must use node:24-alpine so the runtime ` +
          'matches the Node version the workspace is built and tested against (.nvmrc), and so ' +
          'the images stay small enough to rebuild on every `pnpm poc`.',
      ).toBe('node:24-alpine');
    }
  });

  it('.nvmrc agrees with the image major version', () => {
    const nvmrc = readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8').trim();
    expect(
      nvmrc.replace(/^v/, '').split('.')[0],
      'the Dockerfiles pin node:24-alpine, so .nvmrc must be on the same major line.',
    ).toBe('24');
  });
});
