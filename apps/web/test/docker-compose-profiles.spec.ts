import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Compose service-selection guard (WEB-006).
 *
 * Why this exists: Docker Compose does NOT read the repo-root `.env` by default
 * when invoked with `-f docker/docker-compose.yml` from the repo root — it looks
 * for `.env` in the compose FILE's directory unless `--env-file` says otherwise.
 * Without that flag, `${AGENTS_HOST_PORT}` / `COMPOSE_PROFILES` / `${KEYCLOAK_ADMIN}`
 * silently fall back to their YAML defaults — a real bug found in this session.
 * `scripts/docker-compose.mjs` fixes it (fails fast if `.env` is missing, then
 * passes `--env-file .env`); every `pnpm docker:*` script must route through it.
 *
 * Separately, each app-stack service must declare a `profiles:` entry matching
 * its own name (so `COMPOSE_PROFILES` in `.env` can select a subset — e.g. build
 * only `web`+`keycloak` when Mastra agents are hosted elsewhere, such as an
 * AgentBase import), and `web`'s `depends_on: agents` must be `required: false`
 * so excluding `agents` doesn't break Compose validation.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const compose = readFileSync(join(REPO_ROOT, 'docker/docker-compose.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

// `docker:check` / `docker:wait` are runtime PREFLIGHT scripts — they ask "is a
// container runtime present?" and never invoke Compose, so the --env-file rule
// below doesn't apply to them. Everything else under `docker:` must route
// through the wrapper.
const PREFLIGHT_SCRIPTS = ['docker:check', 'docker:wait'];
const composeScripts = Object.keys(pkg.scripts).filter(
  (k) => k.startsWith('docker:') && !PREFLIGHT_SCRIPTS.includes(k),
);

describe('docker compose: env-file wiring + service selection', () => {
  it.each(PREFLIGHT_SCRIPTS)('%s exists as a runtime preflight', (name) => {
    expect(
      pkg.scripts[name],
      `pnpm ${name} must exist — a first-run user with no Docker installed needs the ` +
        'platform-specific install/start instructions, not a raw daemon-socket error.',
    ).toMatch(/^node scripts\/check-docker\.mjs\b/);
  });

  it.each(composeScripts)(
    '%s routes through scripts/docker-compose.mjs (so root .env is actually read)',
    (name) => {
      expect(
        pkg.scripts[name],
        `pnpm ${name} must run \`node scripts/docker-compose.mjs …\`, not a bare ` +
          '`docker compose …` — otherwise Compose silently ignores the root .env ' +
          '(ports, COMPOSE_PROFILES, Keycloak admin all revert to YAML defaults).',
      ).toMatch(/^node scripts\/docker-compose\.mjs\b/);
    },
  );

  it.each(['agents', 'web', 'keycloak'])(
    'service "%s" declares a profile matching its own name',
    (name) => {
      const re = new RegExp(`\\n  ${name}:\\n(?:.*\\n)*?    profiles: \\['${name}'\\]`);
      expect(
        re.test(compose),
        `service "${name}" must declare \`profiles: ['${name}']\` so COMPOSE_PROFILES can select it independently.`,
      ).toBe(true);
    },
  );

  it('declares an explicit project name (so projects do not share a namespace)', () => {
    // Compose derives the project name from the compose FILE's parent dir —
    // `docker/` in every Precast-derived repo. Without an explicit `name:`, every
    // such project lands in one namespace ("docker"), and `pnpm docker:up` in one
    // repo adopts/recreates/stops ANOTHER repo's containers and volumes. Observed
    // for real: bringing this stack up recreated a different project's Keycloak.
    expect(
      compose,
      'docker/docker-compose.yml must declare a top-level `name:` — otherwise the ' +
        'Compose project name comes from the `docker/` directory and collides with ' +
        'every other Precast-derived repo on the machine.',
    ).toMatch(/^name:\s*\S+/m);
  });

  it('declares volumes without a project-name prefix (Compose adds it)', () => {
    // Compose prefixes every volume with the project name, so declaring
    // `<project>-agents-data` yields `<project>_<project>-agents-data`. Bare
    // names resolve to `<project>_agents-data`; that prefix is what isolates
    // them between repos, so dropping it costs no collision safety.
    //
    // Derived from the compose file's own `name:` rather than hardcoding
    // "precast", so this guard keeps working after `pnpm rename`.
    const project = compose.match(/^name:\s*(\S+)/m)?.[1];
    expect(project, 'docker/docker-compose.yml must declare a top-level `name:`').toBeTruthy();

    const declared = compose
      .slice(compose.search(/^volumes:$/m))
      .split('\n')
      .slice(1)
      .filter((l) => /^ {2}\S+:/.test(l))
      .map((l) => l.trim().replace(/:$/, ''));

    expect(
      declared.length,
      'expected the top-level volumes block to declare volumes',
    ).toBeGreaterThan(0);
    for (const vol of declared) {
      expect(
        vol,
        `volume "${vol}" repeats the project name "${project}" — Compose already prefixes ` +
          `volumes with it, so this resolves to the stuttering "${project}_${vol}". ` +
          'Declare it bare (e.g. "agents-data").',
      ).not.toMatch(new RegExp(`^${project}[-_]`));
    }
  });

  it("web's dependency on agents is optional (required: false)", () => {
    const depBlock = compose.match(/depends_on:\n\s+agents:\n(?:.*\n)*?(?=\n {4}\S|\n {2}\S)/);
    expect(depBlock, 'web must declare depends_on.agents').not.toBeNull();
    expect(
      depBlock![0],
      'web depends_on.agents must set `required: false`, or excluding `agents` via ' +
        'COMPOSE_PROFILES makes Compose refuse the whole project ("depends on undefined service").',
    ).toMatch(/required:\s*false/);
  });
});
