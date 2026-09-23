import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Three runtime bugs found downstream, all upstream faults (WEB-012…014).
 *
 * What links them: each produced a symptom that pointed somewhere else. The
 * override made a documented flag do nothing; the probe made a healthy
 * container report sick for four days; the DNS default made a routing failure
 * look like bad credentials. None would be caught by typecheck, lint, or any
 * test that does not read these files directly.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
/**
 * Strip comment lines before matching. Without this the guards read the very
 * prose that documents the bug — the compose comment quotes the bad literal and
 * the Dockerfile comment names NODE_OPTIONS — and fail on their own explanation.
 */
const code = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

// ── WEB-012 ─────────────────────────────────────────────────────────────────
describe('WEB-012 — compose must not hard-code values that belong to .env', () => {
  const compose = code('docker/docker-compose.yml');

  it('ENABLE_AGENTBASE is overridable from .env', () => {
    // A bare `ENABLE_AGENTBASE: '0'` OVERRIDES env_file, so setting it in .env
    // did nothing — while the comment beside it, .env.example, and the env
    // schema all told you to set it to 1. The app answered `via: "direct"`
    // regardless, and nothing reported a conflict.
    expect(
      /ENABLE_AGENTBASE:\s*\$\{ENABLE_AGENTBASE:-[01]\}/.test(compose),
      'ENABLE_AGENTBASE must use ${ENABLE_AGENTBASE:-0} substitution, not a literal',
    ).toBe(true);
    expect(/ENABLE_AGENTBASE:\s*['"][01]['"]/.test(compose), 'no literal value').toBe(false);
  });

  it('no service hard-codes a key that .env.example also ships', () => {
    // Generalises the bug rather than patching the one instance. Any key
    // appearing in BOTH places is unsettable by the user, silently.
    const shipped = new Set(
      [...code('.env.example').matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    );
    // Keys a container must control regardless of .env — ports it binds inside
    // the network, and the Docker-DNS address of a sibling service.
    const INTENTIONAL = new Set([
      'MASTRA_HOST', 'MASTRA_PORT', 'WEB_HOST', 'WEB_PORT',
      'MASTRA_INTERNAL_URL', 'MASTRA_DB_SCHEMA', 'COMPOSE_PROFILES',
    ]);
    const shadowed: string[] = [];
    for (const m of compose.matchAll(/^\s{6}([A-Z_][A-Z0-9_]*):\s*(.+)$/gm)) {
      const [, key, value] = m;
      if (!shipped.has(key) || INTENTIONAL.has(key)) continue;
      if (value.includes('${')) continue; // substitution — user can still win
      shadowed.push(key);
    }
    expect(
      shadowed,
      `these compose keys silently override .env: ${shadowed.join(', ')}. Use ` +
        '${KEY:-default} so the user can set them, or add to INTENTIONAL with a reason.',
    ).toEqual([]);
  });
});

// ── WEB-013 ─────────────────────────────────────────────────────────────────
describe('WEB-013 — a 401 means up-and-enforcing, not unhealthy', () => {
  it('the compose healthcheck does not treat 401 as failure', () => {
    // /api/agents is protected once AGENT_API_TOKEN is set, and the probe sends
    // no bearer — so `r.ok` marked a working container unhealthy. Since v0.9.8
    // mints a token into every fresh .env, that is every new project.
    const compose = code('docker/docker-compose.yml');
    const probe = /fetch\("http:\/\/localhost:45000\/api\/agents"\)[^\n]*/.exec(compose)?.[0] ?? '';
    expect(probe, 'the agents healthcheck probe should exist').toBeTruthy();
    expect(probe, 'r.ok rejects a 401 from a perfectly healthy server').not.toContain('r.ok');
    expect(probe).toContain('r.status<500');
  });

  it('`pnpm poc` treats a 401 as up', () => {
    const poc = read('scripts/poc.mjs');
    expect(
      /res\.ok \|\| res\.status < 500/.test(poc),
      'poc.mjs must accept any non-5xx as "service is answering"',
    ).toBe(true);
  });
});

// ── WEB-014 ─────────────────────────────────────────────────────────────────
describe('WEB-014 — containers prefer IPv4 when a host is dual-stack', () => {
  const RUNTIMES = ['apps/agents/Dockerfile', 'apps/web/Dockerfile'];

  it.each(RUNTIMES)('%s starts node with --dns-result-order=ipv4first', (rel) => {
    // AgentBase is Cloudflare-fronted and publishes AAAA records; Docker's
    // default bridge has IPv6 disabled. A container that picks the AAAA gets
    // ENETUNREACH, which surfaces as an intermittent `fetch failed` that looks
    // exactly like bad credentials.
    const src = code(rel);
    const cmd = /^CMD \[.*\]$/m.exec(src)?.[0] ?? '';
    expect(cmd, `${rel} should have an exec-form CMD`).toBeTruthy();
    expect(cmd).toContain('--dns-result-order=ipv4first');
  });

  it.each(RUNTIMES)('%s sets it on CMD, not via NODE_OPTIONS', (rel) => {
    // A NODE_OPTIONS supplied through compose or .env would REPLACE the image's
    // value and silently drop the flag — the same shadowing as WEB-012.
    expect(code(rel)).not.toMatch(/ENV\s+NODE_OPTIONS/);
  });
});
