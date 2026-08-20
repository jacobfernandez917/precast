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
      // The build stage is parameterised so `pnpm poc` can swap in a prebuilt
      // dependency image (see deps-image.spec.ts). That is only safe because
      // the ARG's DEFAULT is pinned to node:24-alpine and the deps image is
      // itself built FROM node:24-alpine — so every resolution of ${BASE_IMAGE}
      // is still Node 24 Alpine. The default is asserted below.
      if (base === '${BASE_IMAGE}') continue;
      expect(
        base,
        `${rel} has a stage on "${base}" — every stage must use node:24-alpine so the runtime ` +
          'matches the Node version the workspace is built and tested against (.nvmrc), and so ' +
          'the images stay small enough to rebuild on every `pnpm poc`.',
      ).toBe('node:24-alpine');
    }

    // A parameterised stage must still resolve to the pinned base by default,
    // or the guard above becomes vacuous.
    if (bases.includes('${BASE_IMAGE}')) {
      const fallback = body.match(/^ARG\s+BASE_IMAGE=(.+)$/m)?.[1].trim();
      expect(
        fallback,
        `${rel} parameterises a stage as \${BASE_IMAGE} but its ARG default is "${fallback}" — ` +
          'it must default to node:24-alpine.',
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

/**
 * Database-URL guard (APP-015).
 *
 * Precast is Postgres-only (ADR-002): the env schema validates `DATABASE_URL`
 * and `MASTRA_DB_URL` with `isPostgresUrl()` and rejects `file:` / `sqlite:` /
 * `libsql:`. A Dockerfile `ENV` default is NOT a harmless fallback — Compose
 * deliberately sets neither key, so whatever the image declares is exactly what
 * the container gets, and an invalid value fails env validation at boot.
 *
 * This regressed once: `apps/agents/Dockerfile` kept `MASTRA_DB_URL=file:/data/
 * mastra.db` after the Postgres-only change removed the matching override from
 * `docker-compose.yml`. The image-layer copy of the bug outlived the fix.
 */
describe('docker: no non-Postgres database URL baked into an image', () => {
  const dockerfiles = findDockerfiles();
  const DB_KEYS = ['DATABASE_URL', 'MASTRA_DB_URL'];

  it.each(dockerfiles.map((f) => [f.replace(REPO_ROOT, ''), f] as const))(
    '%s bakes no invalid database URL',
    (rel, file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const key of DB_KEYS) {
        const hit = src.match(new RegExp(`\\b${key}\\s*=\\s*['"]?([^\\s'"\\\\]+)`));
        if (!hit) continue;
        expect(
          hit[1],
          `${rel} sets ${key}=${hit[1]}. Precast is Postgres-only (ADR-002) and the env ` +
            `schema rejects anything else, so this is a boot failure rather than a fallback. ` +
            `Leave it unset — MASTRA_DB_URL falls back to DATABASE_URL from .env.`,
        ).toMatch(/^postgres(ql)?:\/\//);
      }
    },
  );
});

/**
 * Non-root runtime (APP-022).
 *
 * Both images ran as root until v0.9.7 — not by decision, but because that is
 * what happens when no `USER` is set. It turns any container escape or
 * arbitrary-write bug into a considerably worse incident, and nothing surfaces
 * it: the container is healthy and the app works either way, which is exactly
 * why it survived this long.
 *
 * Verified by running both images before this guard was written: each reports
 * `uid=1000(node)`, the agents card answers 200, and the web app renders 200 —
 * so the assertion below is pinning behaviour that was observed, not assumed.
 */
describe('docker: runtime stages drop root', () => {
  const RUNTIMES = ['apps/agents/Dockerfile', 'apps/web/Dockerfile'];
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

  it.each(RUNTIMES)('%s declares USER node', (rel) => {
    const src = read(rel);
    expect(src, `${rel} must switch to the unprivileged node user`).toMatch(/^USER node$/m);
  });

  it.each(RUNTIMES)('%s sets USER after the last COPY, or the copy lands unreadable', (rel) => {
    const src = read(rel);
    const userAt = src.search(/^USER node$/m);
    const lastCopy = src.lastIndexOf('COPY --from=build');
    expect(
      userAt,
      'USER must come after the final COPY — switching earlier makes the build copy as `node` ' +
        'into a root-owned WORKDIR, which fails or silently drops permissions',
    ).toBeGreaterThan(lastCopy);
  });

  it.each(RUNTIMES)('%s chowns what it copies to node', (rel) => {
    // Without --chown the bundle stays root-owned. It is still READABLE, so the
    // app boots and the gap only appears when something needs to write.
    for (const line of read(rel).split('\n')) {
      if (!line.startsWith('COPY --from=build')) continue;
      expect(line, `${rel}: "${line.slice(0, 60)}…" must copy with --chown=node:node`).toContain(
        '--chown=node:node',
      );
    }
  });
});
