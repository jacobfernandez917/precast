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
 * Base-image guard: every stage of every app Dockerfile runs on the current Node LTS
 * (`node:lts-alpine`, matching `.nvmrc`'s `lts/*`) on Alpine.
 *
 * Both halves matter. The LTS tag because the runtime must match the line the workspace is
 * built and tested against (CI installs `lts/*` too), and a builder/runtime skew shows up as
 * a native-module or API mismatch only once the container runs. Alpine because AgentBase
 * builds and stores this image for every import, and a slim base keeps that fast.
 */
const FROM_LINE = /^FROM\s+(\S+)/gm;
const LTS_BASE = 'node:lts-alpine';

describe('docker: node LTS alpine base images', () => {
  const dockerfiles = findDockerfiles();

  it.each(dockerfiles)('%s builds every stage on node:lts-alpine', (dockerfile) => {
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
        `${rel} has a stage on "${base}" — every stage must use ${LTS_BASE} so the runtime ` +
          'is the Node line the workspace is built and tested against (.nvmrc), and so ' +
          'the image AgentBase builds stays small.',
      ).toBe(LTS_BASE);
    }
  });

  // node:lts-alpine moved to Node 26 on 2026-10-28, and Node 25 and newer ship without
  // corepack: a bare `corepack enable` failed with exit 127 and no image built, so neither
  // CI nor an AgentBase import could build one.
  it.each(dockerfiles)('%s installs corepack before enabling it', (dockerfile) => {
    const rel = dockerfile.replace(REPO_ROOT, '').replace(/^\//, '');
    const body = stripComments(readFileSync(dockerfile, 'utf8'));
    for (const line of body.split('\n').filter((l) => /\bcorepack enable\b/.test(l))) {
      expect(
        line,
        `${rel} runs "corepack enable" without installing corepack, which Node 25+ images lack`,
      ).toMatch(/npm install -g corepack(@\S+)? && corepack enable/);
    }
  });

  it('.nvmrc follows the LTS line, as the images do', () => {
    const nvmrc = readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8').trim();
    expect(nvmrc, 'the Dockerfiles build on node:lts-alpine, so .nvmrc must say lts/*').toBe(
      'lts/*',
    );
  });
});

/**
 * Database-URL guard (APP-015).
 *
 * Precast is Postgres-only (ADR-002): the env schema validates `DATABASE_URL`
 * and `MASTRA_DB_URL` with `isPostgresUrl()` and rejects `file:` / `sqlite:` /
 * `libsql:`. A Dockerfile `ENV` default is NOT a harmless fallback: AgentBase
 * supplies DATABASE_URL from the project's variables and nothing else sets
 * MASTRA_DB_URL, so whatever the image declares is exactly what the container
 * gets, and an invalid value fails env validation at boot.
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

/**
 * WEB-014: the images prefer IPv4 when a host is dual-stack. AgentBase is Cloudflare-fronted
 * and publishes AAAA records, and a container network without IPv6 gets ENETUNREACH on the
 * AAAA, which surfaces as an intermittent `fetch failed` that looks exactly like bad
 * credentials. Set on CMD: a NODE_OPTIONS from the host's environment would replace an
 * image-level value and drop the flag. (`pnpm poc` starts both apps with it too; APP-033.)
 */
describe('docker: runtime images prefer IPv4', () => {
  const RUNTIMES = ['apps/agents/Dockerfile', 'apps/web/Dockerfile'];

  it.each(RUNTIMES)('%s starts node with --dns-result-order=ipv4first on CMD', (rel) => {
    const src = stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8'));
    const cmd = /^CMD \[.*\]$/m.exec(src)?.[0] ?? '';
    expect(cmd, `${rel} should have an exec-form CMD`).toBeTruthy();
    expect(cmd).toContain('--dns-result-order=ipv4first');
    expect(src).not.toMatch(/ENV\s+NODE_OPTIONS/);
  });
});
