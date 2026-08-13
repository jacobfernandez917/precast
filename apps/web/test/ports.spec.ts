import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORT_RANGE, STACK_SIZE, pickConsecutivePorts } from '../../../scripts/set-ports.mjs';

/**
 * Port-block guards (APP-011).
 *
 * Precast assigns its stack ONE consecutive block of ports — agents, web,
 * keycloak — inside a bounded high range, picked free at bootstrap time:
 *
 *  - **Consecutive** so a project's whole stack is one memorable block.
 *  - **Random + verified free** so two Precast projects on the same machine
 *    don't both try to own 3000/4111, which they always did before.
 *  - **45000–49151** because that is above every common dev-server default and
 *    the privileged range, but BELOW where the OS ephemeral range starts
 *    (49152 on macOS/Linux/IANA). Publishing inside the ephemeral range means a
 *    random outbound socket can steal the port first — an "address already in
 *    use" that reproduces only sometimes. This test is what keeps the committed
 *    defaults inside those bounds.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const envExample = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');

/** Hard ceiling: the first ephemeral port on macOS/Linux/IANA. */
const EPHEMERAL_START = 49152;

function envPort(name: string): number {
  const hit = envExample.match(new RegExp(`^${name}=(\\d+)`, 'm'));
  expect(hit, `.env.example must define ${name}`).not.toBeNull();
  return Number(hit![1]);
}

describe('port block: bounded, consecutive, host-mapped', () => {
  const agents = envPort('MASTRA_PORT');
  const web = envPort('WEB_PORT');
  const keycloak = envPort('KEYCLOAK_HOST_PORT');

  it.each([
    ['agents', agents],
    ['web', web],
    ['keycloak', keycloak],
  ])('%s port sits in the safe high range', (name, port) => {
    expect(
      port,
      `${name} port must be ≥ ${PORT_RANGE.min} (clear of common dev defaults)`,
    ).toBeGreaterThanOrEqual(PORT_RANGE.min);
    expect(
      port,
      `${name} port must stay below ${EPHEMERAL_START} — the OS ephemeral range, where an ` +
        'outbound socket can grab the port before Compose binds it.',
    ).toBeLessThan(EPHEMERAL_START);
  });

  it('assigns one consecutive block in stack order (agents → web → keycloak)', () => {
    expect(
      [agents, web, keycloak],
      'the three ports must be consecutive and in stack order, e.g. 45000/45001/45002 — ' +
        '`pnpm set-ports --auto` and `pnpm bootstrap` both assign them that way.',
    ).toEqual([agents, agents + 1, agents + 2]);
  });

  it('published host ports default to the app ports', () => {
    // Compose interpolates these from .env; leaving them stale publishes the
    // containers on the previous project's ports.
    expect(envPort('AGENTS_HOST_PORT')).toBe(agents);
    expect(envPort('WEB_HOST_PORT')).toBe(web);
  });

  it('host-facing URLs follow the block', () => {
    expect(envExample).toMatch(new RegExp(`^MASTRA_INTERNAL_URL=http://localhost:${agents}$`, 'm'));
    expect(envExample).toMatch(
      new RegExp(`^KEYCLOAK_TOKEN_ISSUER_URI=http://localhost:${keycloak}/`, 'm'),
    );
  });
});

describe('pickConsecutivePorts', () => {
  it('returns a consecutive, in-range, bindable block', async () => {
    const block = await pickConsecutivePorts();
    expect(block).toHaveLength(STACK_SIZE);
    expect(block).toEqual([block[0], block[0] + 1, block[0] + 2]);
    expect(block[0]).toBeGreaterThanOrEqual(PORT_RANGE.min);
    expect(block[STACK_SIZE - 1]).toBeLessThan(EPHEMERAL_START);
  });

  it('keeps the whole block below the ephemeral range even at the top of PORT_RANGE', () => {
    expect(PORT_RANGE.max + STACK_SIZE).toBeLessThan(EPHEMERAL_START);
  });
});

/**
 * Env-file hygiene (APP-019).
 *
 * `.env.example` is copied verbatim to `.env` by `pnpm bootstrap`, and Docker
 * Compose's `env_file` does **not** strip inline `#` comments — the entire rest
 * of the line becomes the value. So
 *
 *     GOOGLE_GENERATIVE_AI_API_KEY=      # or GOOGLE_API_KEY — either is accepted
 *
 * shipped a 48-character "API key" containing an em dash to every scaffolded
 * project. Two failures followed, neither of which pointed at the cause:
 * `isLlmProviderConfigured()` saw a non-empty value and stayed quiet, and the
 * value went into an HTTP header, where a non-latin-1 character made every LLM
 * call die with "Cannot convert argument to a ByteString".
 *
 * Comments belong on their own line, above the assignment.
 */
describe('env files: no inline comment can become a value', () => {
  for (const file of ['.env.example']) {
    it(`${file} keeps comments off the value side`, () => {
      const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n');
      const offenders = lines
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /^[A-Z_][A-Z0-9_]*=[^#]*#/.test(line));

      expect(
        offenders.map((o) => `${file}:${o.n}  ${o.line}`),
        'Compose does not strip inline comments — the text after `#` becomes part of the ' +
          'value. Move the comment to its own line above the assignment.',
      ).toEqual([]);
    });
  }

  it('.env.example ships no non-ASCII inside a value', () => {
    // A header built from such a value throws before it ever reaches the wire.
    const bad: string[] = [];
    for (const [i, line] of readFileSync(join(REPO_ROOT, '.env.example'), 'utf8')
      .split('\n')
      .entries()) {
      const m = /^[A-Z_][A-Z0-9_]*=(.*)$/.exec(line);
      // eslint-disable-next-line no-control-regex
      if (m && /[^\x00-\x7F]/.test(m[1])) bad.push(`.env.example:${i + 1}  ${line}`);
    }
    expect(bad, 'a non-latin-1 character in an env value breaks HTTP header encoding').toEqual([]);
  });
});
