import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AgentBase Models as an LLM provider (APP-020).
 *
 * Analysed as SOURCE, never imported: `scripts/bootstrap.mjs` calls `main()` at
 * module scope, and main() deletes the repo's git history. A spec that imported
 * it would destroy the checkout running it.
 *
 * The invariants below are the ones whose failure is silent. `bootstrap` is the
 * only place in Precast that accepts secret values, so where those values land
 * matters more than anything else here.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const src = readFileSync(join(REPO_ROOT, 'scripts/bootstrap.mjs'), 'utf8');

const REQUIRED_FIELDS = [
  'AGENTBASE_LLM_BASE_URL',
  'AGENTBASE_LLM_TOKEN_URL',
  'AGENTBASE_LLM_CLIENT_ID',
  'AGENTBASE_LLM_CLIENT_SECRET',
  'AGENTBASE_LLM_MODEL',
];

describe('bootstrap: AgentBase Models provider', () => {
  it('offers agentbase as a provider choice', () => {
    expect(src).toMatch(/key:\s*'agentbase'/);
  });

  it('collects every setting the gateway needs, not just the credentials', () => {
    // Four of five is a config that looks complete and fails at the first chat
    // with an auth error pointing nowhere.
    for (const env of REQUIRED_FIELDS) {
      expect(src, `${env} must be collected`).toContain(env);
    }
  });

  it('exposes a flag for each setting so it works non-interactively', () => {
    const table = src.slice(
      src.indexOf('const AGENTBASE_LLM_FIELDS'),
      src.indexOf('const rawArgs'),
    );
    for (const flag of [
      'agentbase-base-url',
      'agentbase-token-url',
      'agentbase-client-id',
      'agentbase-client-secret',
      'agentbase-model',
    ]) {
      expect(table, `--${flag}= must exist for CI use`).toContain(flag);
    }
  });

  it('writes collected secrets to .env ONLY, never to the committed .env.example', () => {
    const fn = src.slice(
      src.indexOf('function writeEnvValues'),
      src.indexOf('function printFeedForwardGuidance'),
    );
    expect(fn, 'writeEnvValues must target .env').toMatch(/join\(rootDir,\s*'\.env'\)/);
    expect(
      fn,
      '.env.example is committed — a secret written there would reach every clone',
    ).not.toContain('.env.example');
  });

  it('does not demand a vendor key for the agentbase choice', () => {
    // envVar is null for this provider; the old unconditional reminder would
    // have printed "set null in .env".
    expect(src).toMatch(/llmProvider\?\.key === 'agentbase'/);
  });
});
