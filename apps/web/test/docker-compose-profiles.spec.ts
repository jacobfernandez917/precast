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

describe('docker compose: env-file wiring + service selection', () => {
  it.each(Object.keys(pkg.scripts).filter((k) => k.startsWith('docker:')))(
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

  it.each(['agents', 'web', 'keycloak'])('service "%s" declares a profile matching its own name', (name) => {
    const re = new RegExp(`\\n  ${name}:\\n(?:.*\\n)*?    profiles: \\['${name}'\\]`);
    expect(
      re.test(compose),
      `service "${name}" must declare \`profiles: ['${name}']\` so COMPOSE_PROFILES can select it independently.`,
    ).toBe(true);
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
