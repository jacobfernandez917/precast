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
  // The API base: the LLM gateway route is derived from it and the model
  // (v0.9.10), so it is what gets collected; AGENTBASE_LLM_BASE_URL is an
  // optional override (asserted below).
  'AGENTBASE_URL',
  // Capability-specific settings keep the LLM_ infix...
  'AGENTBASE_LLM_MODEL',
  // ...credentials do not: one Application authenticates models, MCP and A2A.
  'AGENTBASE_TOKEN_URL',
  'AGENTBASE_CLIENT_ID',
  'AGENTBASE_CLIENT_SECRET',
];

/**
 * Bootstrap must write ONLY the canonical credential names. `.env.example`
 * already declares AGENTBASE_CLIENT_ID once; if bootstrap also emitted the
 * legacy AGENTBASE_LLM_CLIENT_ID the file would carry two names for one
 * credential — and a later empty assignment silently blanks an earlier real
 * one, which is a failure nothing reports until the first call.
 */
const RETIRED_FIELDS = [
  'AGENTBASE_LLM_TOKEN_URL',
  'AGENTBASE_LLM_CLIENT_ID',
  'AGENTBASE_LLM_CLIENT_SECRET',
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

  it('never writes the retired credential names', () => {
    const table = src.slice(
      src.indexOf('const AGENTBASE_LLM_FIELDS'),
      src.indexOf('const rawArgs'),
    );
    for (const env of RETIRED_FIELDS) {
      expect(table, `${env} is read for compatibility but must never be WRITTEN`).not.toContain(
        `'${env}'`,
      );
    }
  });

  it('keeps the gateway base URL optional, since it is derived from the API base', () => {
    const table = src.slice(
      src.indexOf('const AGENTBASE_LLM_FIELDS'),
      src.indexOf('const rawArgs'),
    );
    const entry = table.slice(table.indexOf("env: 'AGENTBASE_LLM_BASE_URL'"));
    expect(entry.slice(0, entry.indexOf('}'))).toMatch(/optional:\s*true/);
    expect(src).toMatch(/!f\.optional && !values\[f\.env\]/);
  });

  it('exposes a flag for each setting so it works non-interactively', () => {
    const table = src.slice(
      src.indexOf('const AGENTBASE_LLM_FIELDS'),
      src.indexOf('const rawArgs'),
    );
    for (const flag of [
      'agentbase-url',
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

  it('lets the person put the secret into .env themselves (--agentbase-client-secret=later)', () => {
    // The secret then never passes through a chat or a command line. Bootstrap must
    // leave the empty line for it, skip what needs it, and say what to do next.
    expect(src).toContain("=== 'later'");
    expect(src).toContain('!(secretDeferred && f.secret)');
    expect(src).toContain('AGENTBASE_CLIENT_SECRET= and save the file');
    expect(src).toContain("database.mode === 'provision' && secretDeferred");
  });

  it('does not demand a vendor key for the agentbase choice', () => {
    // envVar is null for this provider; the old unconditional reminder would
    // have printed "set null in .env".
    expect(src).toMatch(/llmProvider\?\.key === 'agentbase'/);
  });
});
